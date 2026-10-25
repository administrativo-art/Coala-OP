import { NextResponse, type NextRequest } from 'next/server';

import { listAdjustmentsForReview } from '@/features/dp/time-adjustments/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.adjustments.review-queue', version: 1,
  surface: { method: 'GET', path: '/api/dp/time-recording/adjustments/review' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.requests.review' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, null, { workspaceId: string }>({
  id: 'dp-time-adjustments-review-queue-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!actor.isDefaultAdmin && actor.permissions.dp?.requests?.review !== true) {
      throw new AppError({ code: 'PTRP_ADJUSTMENT_REVIEW_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para analisar ajustes de ponto.' });
    }
    return { actor, input: null, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await listAdjustmentsForReview(security.actor), { headers: { 'Cache-Control': 'private, no-store' } }));
