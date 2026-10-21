import { NextResponse, type NextRequest } from 'next/server';

import { adjustmentMonthSchema, createAdjustmentSchema, type AdjustmentMonthInput, type CreateAdjustmentInput } from '@/features/dp/time-adjustments/schemas';
import { createOwnAdjustment, listOwnAdjustments } from '@/features/dp/time-adjustments/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/adjustments' as const;
type Resource = { workspaceId: string; employeeId: string };

async function ownActor(request: NextRequest) {
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  if (!actor.isDefaultAdmin && (actor.permissions.dashboard.collaborator ?? actor.permissions.dashboard.view) !== true) {
    throw new AppError({ code: 'PTRP_ADJUSTMENT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para ajustes de ponto.' });
  }
  return actor;
}

const getContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.adjustments.list-own', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'dp.time-adjustments.month', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const getEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, AdjustmentMonthInput, Resource>({
  id: 'dp-time-adjustments-list-own-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await ownActor(request);
    const parsed = adjustmentMonthSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: 'PTRP_ADJUSTMENT_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Mês inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid } };
  },
});

const postContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.adjustments.create-own', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'dp.time-adjustments.create', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const postEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, CreateAdjustmentInput, Resource>({
  id: 'dp-time-adjustments-create-own-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await ownActor(request);
    const parsed = createAdjustmentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'PTRP_ADJUSTMENT_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Pedido de ajuste inválido.' });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json(await listOwnAdjustments(security.actor, security.input), { headers: { 'Cache-Control': 'private, no-store' } }));
export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) =>
  NextResponse.json({ adjustment: await createOwnAdjustment(security.actor, security.input) }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } }));
