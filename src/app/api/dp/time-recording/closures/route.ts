import { NextResponse, type NextRequest } from 'next/server';

import { assertClosureAccess, closeCompetence, readCompetenceClosure } from '@/features/dp/time-adjustments/closure.server';
import { closureCloseSchema, closureQuerySchema, type ClosureCloseInput } from '@/features/dp/time-adjustments/schemas';
import { generateBankClosedCompetence } from '@/features/dp/time-bank/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/closures' as const;
type Resource = { workspaceId: string };

const getContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.closures.read', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.time-closure.read' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-closure.query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const getEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, { competence: string }, Resource>({
  id: 'dp-time-closure-read-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    assertClosureAccess(actor, 'read');
    const parsed = closureQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: 'PTRP_CLOSURE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Competência inválida.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

const postContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.closures.close', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.time-closure.close' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-closure.close', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const postEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, ClosureCloseInput, Resource>({
  id: 'dp-time-closure-close-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    assertClosureAccess(actor, 'close');
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'PTRP_CLOSURE_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = closureCloseSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'PTRP_CLOSURE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Fechamento inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json(await readCompetenceClosure(security.actor, security.input.competence), { headers: { 'Cache-Control': 'private, no-store' } }));
export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => {
  const closure = await closeCompetence(security.actor, security.input);
  const timeBank = await generateBankClosedCompetence(security.actor, closure.competence, closure.version);
  return NextResponse.json({ closure, timeBank }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
});
