import { NextResponse, type NextRequest } from 'next/server';
import type { ServerUserContext } from '@/lib/auth-server';
import { requireAbsenceRequestAccess } from '@/features/dp/absences/requests/access.server';
import { createAbsenceDraft, listAbsenceRequests } from '@/features/dp/absences/requests/workflow.server';
import { createAbsenceDraftSchema, absenceListQuerySchema, type CreateAbsenceDraftInput } from '@/features/dp/absences/requests/workflow-schemas';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<Record<string, never>> };
type Resource = { ownerId: string; workspaceId: string };
const getContract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.absence-requests.list', version: 1,
  surface: { method: 'GET', path: '/api/collaborator/absence-requests' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'absence.requests.read' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'absence-requests.list', unknownFields: 'reject' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const postContract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.absence-requests.create', version: 1,
  surface: { method: 'POST', path: '/api/collaborator/absence-requests' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'absence.requests.create' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'absence-requests.create', unknownFields: 'reject' }, effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const getEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, ReturnType<typeof absenceListQuerySchema.parse>, Resource>({
  id: 'collaborator-absence-requests-list-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireAbsenceRequestAccess(request);
    const values = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = absenceListQuerySchema.safeParse(values);
    if (!parsed.success) throw new AppError({ code: 'ABSENCE_LIST_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Filtros inválidos.' });
    return { actor, input: parsed.data, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});
const postEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, CreateAbsenceDraftInput, Resource>({
  id: 'collaborator-absence-requests-create-v2', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireAbsenceRequestAccess(request);
    const parsed = createAbsenceDraftSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'ABSENCE_CREATE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Dados da solicitação inválidos.' });
    return { actor, input: parsed.data, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});
export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => NextResponse.json(
  await listAbsenceRequests(security.actor, security.input), { headers: { 'Cache-Control': 'private, no-store' } }));
export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => NextResponse.json(
  { request: await createAbsenceDraft(security.actor, security.input) }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } }));
