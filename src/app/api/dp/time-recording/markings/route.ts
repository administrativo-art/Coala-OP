import { NextResponse, type NextRequest } from 'next/server';

import { listOwnRepPMarkings, recordOwnRepPMarking } from '@/features/dp/rep-p/service.server';
import { repPMarkingSchema, repPOwnHistorySchema, type RepPMarkingRequest, type RepPOwnHistoryRequest } from '@/features/dp/rep-p/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { assertOfficialMobileApp } from '@/lib/security/mobile-app-attestation.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/markings' as const;
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.markings.create', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'dp.rep-p.marking', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
  additionalGuarantees: ['replay-protected'],
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, RepPMarkingRequest,
  { workspaceId: string; employeeId: string }>({
  id: 'dp-rep-p-marking-create-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted', 'replay-protected'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'REP_P_MARKING_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = repPMarkingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'REP_P_MARKING_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Solicitação de marcação inválida.' });
    if (parsed.data.offline) assertOfficialMobileApp(request, actor.decoded.uid);
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await recordOwnRepPMarking(security.actor, security.input);
  const { marking } = result;
  return NextResponse.json({ status: result.status, pilot: 'pilot' in result && result.pilot === true, receiptId: result.receiptId,
    receiptStatus: result.receiptStatus, receiptIssue: result.receiptIssue, ...('offlineCycle' in result ? { offlineCycle: result.offlineCycle } : {}), location: result.location, marking: {
    markingId: marking.markingId, nsr: marking.nsr, markedAt: marking.markedAt, recordedAt: marking.recordedAt,
    employerUnitId: marking.employerUnitId, executionUnitId: marking.executionUnitId,
    establishmentId: marking.establishmentId, collectorId: marking.collectorId, hash: marking.hash,
  } }, { status: result.status === 'recorded' ? 201 : 200,
    headers: { 'Cache-Control': 'private, no-store' } });
});

const historyContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.markings.list-own', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'dp.rep-p.own-history', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const historyEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, RepPOwnHistoryRequest,
  { workspaceId: string; employeeId: string }>({
  id: 'dp-rep-p-marking-list-own-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const parsed = repPOwnHistorySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: 'REP_P_HISTORY_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Período de consulta inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid } };
  },
});

export const GET = secureRoute({ contract: historyContract, enforcer: historyEnforcer }, async ({ security }) => {
  const result = await listOwnRepPMarkings(security.actor, security.input);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
