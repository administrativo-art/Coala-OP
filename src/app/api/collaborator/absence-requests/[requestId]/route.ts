import { NextResponse, type NextRequest } from 'next/server';
import type { ServerUserContext } from '@/lib/auth-server';
import { requireAbsenceRequestAccess } from '@/features/dp/absences/requests/access.server';
import { actOnAbsenceRequest, getAbsenceRequest } from '@/features/dp/absences/requests/workflow.server';
import { absenceActionSchema, absenceRequestRouteSchema, type AbsenceActionInput } from '@/features/dp/absences/requests/workflow-schemas';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ requestId: string }> };
type Resource = { ownerId: string; workspaceId: string };
const getContract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.absence-requests.read', version: 1,
  surface: { method: 'GET', path: '/api/collaborator/absence-requests/[requestId]' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'absence.requests.read' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'absence-requests.id', unknownFields: 'reject' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const patchContract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.absence-requests.action', version: 1,
  surface: { method: 'PATCH', path: '/api/collaborator/absence-requests/[requestId]' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'absence.requests.action' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'absence-requests.action', unknownFields: 'reject' }, effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const getEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, { requestId: string }, Resource>({
  id: 'collaborator-absence-request-read-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireAbsenceRequestAccess(request);
    const parsed = absenceRequestRouteSchema.safeParse(await routeContext.params);
    if (!parsed.success) throw new AppError({ code: 'ABSENCE_REQUEST_ID_INVALID', kind: 'VALIDATION' });
    return { actor, input: parsed.data, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});
const patchEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, { requestId: string; action: AbsenceActionInput }, Resource>({
  id: 'collaborator-absence-request-action-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireAbsenceRequestAccess(request);
    const id = absenceRequestRouteSchema.safeParse(await routeContext.params);
    const action = absenceActionSchema.safeParse(await request.json().catch(() => null));
    if (!id.success || !action.success) throw new AppError({ code: 'ABSENCE_ACTION_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Ação inválida.' });
    return { actor, input: { requestId: id.data.requestId, action: action.data }, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});
export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => NextResponse.json(
  { request: await getAbsenceRequest(security.actor, security.input.requestId) }, { headers: { 'Cache-Control': 'private, no-store' } }));
export const PATCH = secureRoute({ contract: patchContract, enforcer: patchEnforcer }, async ({ security }) => NextResponse.json(
  { request: await actOnAbsenceRequest(security.actor, security.input.requestId, security.input.action) }, { headers: { 'Cache-Control': 'private, no-store' } }));
