import { NextResponse, type NextRequest } from 'next/server';

import { decideShiftSwap, shiftSwapForViewer } from '@/features/dp/shift-swaps/contract.server';
import { shiftSwapIdentityEvidence } from '@/features/dp/shift-swaps/identity.server';
import { decideShiftSwapSchema, shiftSwapRouteSchema, type DecideShiftSwapInput } from '@/features/dp/shift-swaps/schemas';
import { sendUserPush } from '@/features/mobile/push/send.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ requestId: string }> };
type Resource = { requestId: string; ownerId: string; workspaceId: string };

const contract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.requests.shift-swaps.decide', version: 1,
  surface: { method: 'PATCH', path: '/api/collaborator/requests/shift-swaps/[requestId]' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'shift-swap-participant-action' }, resourceScope: { kind: 'custom', strategy: 'shift-swap-participant' },
  input: { kind: 'schema', schema: 'shift-swap-decision', unknownFields: 'reject' }, effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, DecideShiftSwapInput, Resource>({
  id: 'collaborator-shift-swap-decision-v1', guarantees: ['authenticated-user', 'active-user', 'authorization:participant-action', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const current = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (current.userDoc.id !== current.decoded.uid) throw new AppError({ code: 'SHIFT_SWAP_OWNER_MISMATCH', kind: 'AUTHORIZATION' });
    const [params, body] = await Promise.all([routeContext.params, request.json().catch(() => null)]);
    const route = shiftSwapRouteSchema.safeParse(params);
    const input = decideShiftSwapSchema.safeParse(body);
    if (!route.success || !input.success) throw new AppError({ code: 'SHIFT_SWAP_DECISION_INPUT_INVALID', kind: 'VALIDATION', safeMessage: input.error?.issues[0]?.message ?? 'Decisão inválida.', reportable: false });
    return { actor: current, input: input.data, resource: { requestId: route.data.requestId, ownerId: current.decoded.uid, workspaceId: current.workspace_id } };
  },
});
export const PATCH = secureRoute({ contract, enforcer }, async ({ request, security }) => {
  const result = await decideShiftSwap(security.actor, security.resource.requestId, security.input,
    shiftSwapIdentityEvidence(request, security.actor, security.input.operationId));
  if (result.notification) await sendUserPush({ workspaceId: security.actor.workspace_id, ...result.notification }).catch(() => null);
  return NextResponse.json({ request: shiftSwapForViewer(result.request, security.actor.decoded.uid) },
    { headers: { 'Cache-Control': 'private, no-store' } });
});
