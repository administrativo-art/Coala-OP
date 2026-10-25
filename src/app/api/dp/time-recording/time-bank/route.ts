import { NextResponse, type NextRequest } from 'next/server';

import { timeBankActionSchema, timeBankQuerySchema, type TimeBankActionInput } from '@/features/dp/time-bank/schemas';
import { createBankMovement, generateBankMonth, readBankStatement, reverseBankMovement, settleBankCycle } from '@/features/dp/time-bank/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/time-bank' as const;
type Resource = { workspaceId: string };
// O próprio banco é do titular; consultar outra pessoa aceita a permissão dedicada, mas escrever continua exigindo fechamento.
const getContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.time-bank.statement', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'owner-or-time-recording' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-bank.query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const getEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, { employeeUid?: string; date?: string }, Resource>({
  id: 'dp-time-bank-statement-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:owner-or-time-recording', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const parsed = timeBankQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: 'PTRP_BANK_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Consulta inválida.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});
const postContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.time-bank.act', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'owner-or-time-closure' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-bank.action', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const postEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, TimeBankActionInput, Resource>({
  id: 'dp-time-bank-act-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:owner-or-time-closure', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'PTRP_BANK_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = timeBankActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'PTRP_BANK_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Pedido inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json(await readBankStatement(security.actor, security.input), { headers: { 'Cache-Control': 'private, no-store' } }));
export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => {
  const input = security.input;
  if (input.action === 'settle') return NextResponse.json({ settlement: await settleBankCycle(security.actor, input) }, { headers: { 'Cache-Control': 'private, no-store' } });
  if (input.action === 'approve_overtime' || input.action === 'movement') {
    return NextResponse.json({ movement: await createBankMovement(security.actor, input) }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (input.action === 'reverse') return NextResponse.json({ movement: await reverseBankMovement(security.actor, input) }, { headers: { 'Cache-Control': 'private, no-store' } });
  const record = await generateBankMonth(security.actor, input);
  return NextResponse.json({ month: { competence: record.competence, closureVersion: record.closureVersion, totals: record.totals } },
    { headers: { 'Cache-Control': 'private, no-store' } });
});
