import { NextRequest, NextResponse } from 'next/server';

import { createAbsenceTypeSchema, type CreateAbsenceTypeInput } from '@/features/dp/absences/schemas';
import { createAbsenceType, listAbsenceTypes } from '@/features/dp/absences/service.server';
import { requireAbsenceManager } from '@/features/dp/time-config/access.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaticContext = { params: Promise<Record<string, never>> };
type WorkspaceResource = { workspaceId: string };

const getContract = defineSecurityContract({ schemaVersion: 1, id: 'dp.time.absence-types.list', version: 1, surface: { method: 'GET', path: '/api/dp/time/absence-types' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.absences.manage' }, resourceScope: { kind: 'workspace' }, input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const postContract = defineSecurityContract({ schemaVersion: 1, id: 'dp.time.absence-types.create', version: 1, surface: { method: 'POST', path: '/api/dp/time/absence-types' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.absences.manage' }, resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'dp.absence-type.create', unknownFields: 'reject' }, effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });

const getEnforcer = defineSecurityEnforcer<NextRequest, StaticContext, unknown, ServerUserContext, null, WorkspaceResource>({
  id: 'dp-time-absence-types-list-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'],
  async enforce({ request }) { const actor = await requireAbsenceManager(request); return { actor, input: null, resource: { workspaceId: actor.workspace_id } }; },
});
const postEnforcer = defineSecurityEnforcer<NextRequest, StaticContext, unknown, ServerUserContext, CreateAbsenceTypeInput, WorkspaceResource>({
  id: 'dp-time-absence-types-create-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireAbsenceManager(request);
    const parsed = createAbsenceTypeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'DP_ABSENCE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Dados do tipo de ausência inválidos.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async () => (
  NextResponse.json({ absenceTypes: await listAbsenceTypes() }, { headers: { 'Cache-Control': 'private, no-store' } })
));

export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security, observation }) => (
  NextResponse.json({ absenceType: await createAbsenceType({ context: security.actor, input: security.input, requestId: observation.requestId }) }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
));
