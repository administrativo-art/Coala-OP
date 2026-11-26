import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { markReviewRequestReviewed } from '@/features/dp/time-review/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ requestId: string }> };
type Resource = { workspaceId: string; employeeId: string; requestId: string };
const path = '/api/dp/time-recording/review-requests/[requestId]' as const;
const routeSchema = z.object({ requestId: z.string().regex(/^[a-f0-9]{40}$/) }).strict();
const inputSchema = z.object({ action: z.literal('reviewed') }).strict();

/** "Revisei este dia": confirmação organizacional da própria colaboradora; não altera batida, espelho nem AEJ. */
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.review-request.reviewed', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'dp.time-recording.review-request-reviewed', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, { action: 'reviewed' }, Resource>({
  id: 'dp-time-recording-review-request-reviewed-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!actor.isDefaultAdmin && (actor.permissions.dashboard.collaborator ?? actor.permissions.dashboard.view) !== true) {
      throw new AppError({ code: 'TIME_REVIEW_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para revisar seu ponto.' });
    }
    const route = routeSchema.safeParse(await routeContext.params);
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    if (!route.success || !input.success) {
      throw new AppError({ code: 'TIME_REVIEW_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Pedido inválido.' });
    }
    // A titularidade do pedido é conferida no serviço contra o uid autenticado.
    return { actor, input: input.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid, requestId: route.data.requestId } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await markReviewRequestReviewed(security.actor, security.resource.requestId),
    { headers: { 'Cache-Control': 'private, no-store' } }));
