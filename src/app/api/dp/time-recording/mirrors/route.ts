import { NextResponse, type NextRequest } from 'next/server';

import { generateMirror, readMirrorStatus } from '@/features/dp/time-adjustments/mirror.server';
import { mirrorActionSchema, mirrorQuerySchema, type MirrorActionInput } from '@/features/dp/time-adjustments/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/mirrors' as const;
type Resource = { workspaceId: string };
// O próprio espelho é do titular; o de outra pessoa exige dp.timeClosure, conferido no serviço.
const getContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.mirrors.status', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'owner-or-time-closure' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-mirror.query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const getEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, { competence: string; employeeUid?: string }, Resource>({
  id: 'dp-time-mirror-status-v1',
  guarantees: ['authenticated-user', 'active-user', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const parsed = mirrorQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: 'PTRP_MIRROR_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Competência inválida.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});
const postContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.mirrors.act', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'owner-or-time-closure' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-mirror.action', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const postEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, MirrorActionInput, Resource>({
  id: 'dp-time-mirror-act-v1',
  guarantees: ['authenticated-user', 'active-user', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'PTRP_MIRROR_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = mirrorActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'PTRP_MIRROR_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Pedido inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json(await readMirrorStatus(security.actor, security.input.competence, security.input.employeeUid), { headers: { 'Cache-Control': 'private, no-store' } }));
export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => {
  const record = await generateMirror(security.actor, security.input);
  return NextResponse.json({ mirror: { snapshotHash: record.snapshotHash, generatedAt: record.snapshot.generatedAt, agreement: record.agreement } },
    { headers: { 'Cache-Control': 'private, no-store' } });
});
