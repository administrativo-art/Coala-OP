import { NextResponse, type NextRequest } from 'next/server';

import { listShiftSwapOptions } from '@/features/dp/shift-swaps/contract.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<Record<string, never>> };

const contract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.requests.shift-swaps.options', version: 1,
  surface: { method: 'GET', path: '/api/collaborator/requests/shift-swaps/options' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, null, { ownerId: string }>({
  id: 'collaborator-shift-swap-options-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (actor.userDoc.id !== actor.decoded.uid) throw new AppError({ code: 'SHIFT_SWAP_OWNER_MISMATCH', kind: 'AUTHORIZATION' });
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'SHIFT_SWAP_OPTIONS_QUERY_INVALID', kind: 'VALIDATION' });
    return { actor, input: null, resource: { ownerId: actor.decoded.uid } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => NextResponse.json(
  await listShiftSwapOptions(security.actor), { headers: { 'Cache-Control': 'private, no-store' } }));
