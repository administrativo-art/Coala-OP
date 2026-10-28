import { NextResponse, type NextRequest } from 'next/server';

import { readAdjustmentDayContext } from '@/features/dp/time-adjustments/day-context.server';
import { adjustmentRouteSchema } from '@/features/dp/time-adjustments/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ adjustmentId: string }> };
// Leitura do dia inteiro de um pedido, para quem analisa. O serviço confere unidades e que não seja o próprio pedido.
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.adjustments.day-context', version: 1,
  surface: { method: 'GET', path: '/api/dp/time-recording/adjustments/[adjustmentId]/day' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.requests.review' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, { workspaceId: string; adjustmentId: string }>({
  id: 'dp-time-adjustments-day-context-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!actor.isDefaultAdmin && actor.permissions.dp?.requests?.review !== true) {
      throw new AppError({ code: 'PTRP_ADJUSTMENT_REVIEW_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para analisar ajustes de ponto.' });
    }
    const route = adjustmentRouteSchema.safeParse(await routeContext.params);
    if (!route.success) throw new AppError({ code: 'PTRP_ADJUSTMENT_ID_INVALID', kind: 'VALIDATION', safeMessage: 'Pedido inválido.' });
    return { actor, input: null, resource: { workspaceId: actor.workspace_id, adjustmentId: route.data.adjustmentId } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json({ day: await readAdjustmentDayContext(security.actor, security.resource.adjustmentId) }, { headers: { 'Cache-Control': 'private, no-store' } }));
