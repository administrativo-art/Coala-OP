import { NextResponse, type NextRequest } from 'next/server';

import { adjustmentDecisionSchema, adjustmentRouteSchema, type AdjustmentDecisionInput } from '@/features/dp/time-adjustments/schemas';
import { decideAdjustment } from '@/features/dp/time-adjustments/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ adjustmentId: string }> };
// Titular cancela o próprio pedido; quem analisa aprova ou recusa. O serviço confere papel, unidade e versão.
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.adjustments.decide', version: 1,
  surface: { method: 'PATCH', path: '/api/dp/time-recording/adjustments/[adjustmentId]' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'owner-cancels-or-reviewer-decides' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-adjustments.decision', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, AdjustmentDecisionInput, { workspaceId: string; adjustmentId: string }>({
  id: 'dp-time-adjustments-decide-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:owner-cancels-or-reviewer-decides', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const route = adjustmentRouteSchema.safeParse(await routeContext.params);
    if (!route.success) throw new AppError({ code: 'PTRP_ADJUSTMENT_ID_INVALID', kind: 'VALIDATION', safeMessage: 'Pedido inválido.' });
    const parsed = adjustmentDecisionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'PTRP_ADJUSTMENT_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Decisão inválida.' });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, adjustmentId: route.data.adjustmentId } };
  },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json({ adjustment: await decideAdjustment(security.actor, security.resource.adjustmentId, security.input) },
    { headers: { 'Cache-Control': 'private, no-store' } }));
