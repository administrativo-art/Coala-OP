import { NextResponse, type NextRequest } from 'next/server';

import { createShiftSwap, listOwnShiftSwaps, shiftSwapForViewer } from '@/features/dp/shift-swaps/contract.server';
import { shiftSwapIdentityEvidence } from '@/features/dp/shift-swaps/identity.server';
import { createShiftSwapSchema, type CreateShiftSwapInput } from '@/features/dp/shift-swaps/schemas';
import { sendUserPush } from '@/features/mobile/push/send.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<Record<string, never>> };
type Resource = { ownerId: string; workspaceId: string };

const listContract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.requests.shift-swaps.list', version: 1,
  surface: { method: 'GET', path: '/api/collaborator/requests/shift-swaps' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' }, input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const createContract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.requests.shift-swaps.create', version: 1,
  surface: { method: 'POST', path: '/api/collaborator/requests/shift-swaps' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' }, input: { kind: 'schema', schema: 'shift-swap-create', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });

async function actor(request: NextRequest) {
  const value = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  if (value.userDoc.id !== value.decoded.uid) throw new AppError({ code: 'SHIFT_SWAP_OWNER_MISMATCH', kind: 'AUTHORIZATION' });
  return value;
}
const listEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, null, Resource>({
  id: 'collaborator-shift-swap-list-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked'],
  async enforce({ request }) {
    const current = await actor(request);
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'SHIFT_SWAP_LIST_QUERY_INVALID', kind: 'VALIDATION' });
    return { actor: current, input: null, resource: { ownerId: current.decoded.uid, workspaceId: current.workspace_id } };
  },
});
const createEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, CreateShiftSwapInput, Resource>({
  id: 'collaborator-shift-swap-create-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const current = await actor(request);
    const parsed = createShiftSwapSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'SHIFT_SWAP_CREATE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Troca inválida.', reportable: false });
    return { actor: current, input: parsed.data, resource: { ownerId: current.decoded.uid, workspaceId: current.workspace_id } };
  },
});
export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async ({ security }) => NextResponse.json(
  { requests: (await listOwnShiftSwaps(security.actor)).map((request) => shiftSwapForViewer(request, security.actor.decoded.uid)) },
  { headers: { 'Cache-Control': 'private, no-store' } }));

export const POST = secureRoute({ contract: createContract, enforcer: createEnforcer }, async ({ request, security }) => {
  const result = await createShiftSwap(security.actor, security.input,
    shiftSwapIdentityEvidence(request, security.actor, security.input.operationId));
  if (result.notification) await sendUserPush({ workspaceId: security.actor.workspace_id, ...result.notification }).catch(() => null);
  return NextResponse.json({ request: shiftSwapForViewer(result.request, security.actor.decoded.uid) },
    { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
});
