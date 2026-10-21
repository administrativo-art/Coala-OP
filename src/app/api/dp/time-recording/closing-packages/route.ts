import { NextResponse, type NextRequest } from 'next/server';

import { finalizeClosingMonth, readClosingPackage, readClosingSummary, sendClosingPackage } from '@/features/dp/time-adjustments/closing-package.server';
import { closingPackageActionSchema, closingPackageQuerySchema, type ClosingPackageActionInput } from '@/features/dp/time-adjustments/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/closing-packages' as const;
type Resource = { workspaceId: string };
// Pacote do fechamento (espelho e contracheque): ler exige dp.timeClosure.read; enviar, dp.timeClosure.close (no serviço).
const getContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.closing-packages.status', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'time-closure' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-closing-package.query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const getEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, { competence: string; employeeUid?: string }, Resource>({
  id: 'dp-time-closing-package-status-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:time-closure', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const parsed = closingPackageQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: 'PTRP_PACKAGE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Consulta inválida.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});
const postContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.closing-packages.act', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'time-closure' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-closing-package.action', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const postEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, ClosingPackageActionInput, Resource>({
  id: 'dp-time-closing-package-act-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:time-closure', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'PTRP_PACKAGE_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = closingPackageActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'PTRP_PACKAGE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Pedido inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => {
  const { competence, employeeUid } = security.input;
  const body = employeeUid ? await readClosingPackage(security.actor, { competence, employeeUid }) : await readClosingSummary(security.actor, competence);
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
});
export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => {
  const input = security.input;
  if (input.action === 'finalize') return NextResponse.json({ finalization: await finalizeClosingMonth(security.actor, input) }, { headers: { 'Cache-Control': 'private, no-store' } });
  const record = await sendClosingPackage(security.actor, input);
  return NextResponse.json({ package: { status: record.status, sentAt: record.sentAt, signedAt: record.signedAt, lastError: record.lastError } },
    { headers: { 'Cache-Control': 'private, no-store' } });
});
