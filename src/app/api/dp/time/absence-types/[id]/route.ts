import { NextRequest, NextResponse } from 'next/server';

import { absenceTypeRouteSchema, updateAbsenceTypeSchema, type UpdateAbsenceTypeInput } from '@/features/dp/absences/schemas';
import { deleteAbsenceType, getAbsenceType, updateAbsenceType } from '@/features/dp/absences/service.server';
import { requireAbsenceManager } from '@/features/dp/time-config/access.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };
type Resource = { workspaceId: string; id: string };

function contract(method: 'GET' | 'PATCH' | 'DELETE', effect: 'read' | 'write' | 'delete', input: 'none' | 'schema') {
  return defineSecurityContract({ schemaVersion: 1, id: `dp.time.absence-type.${method.toLowerCase()}`, version: 1, surface: { method, path: '/api/dp/time/absence-types/[id]' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.absences.manage' }, resourceScope: { kind: 'workspace' }, input: input === 'none' ? { kind: 'none' } : { kind: 'schema', schema: 'dp.absence-type.update', unknownFields: 'reject' }, effects: { mode: effect, audit: effect === 'read' ? 'none' : 'server-authoritative' }, errorExposure: 'sanitized' });
}

async function actorAndResource(request: NextRequest, routeContext: RouteContext) {
  const actor = await requireAbsenceManager(request);
  const parsed = absenceTypeRouteSchema.safeParse(await routeContext.params);
  if (!parsed.success) throw new AppError({ code: 'DP_ABSENCE_ID_INVALID', kind: 'VALIDATION', safeMessage: 'Identificador do tipo de ausência inválido.' });
  return { actor, resource: { workspaceId: actor.workspace_id, id: parsed.data.id } };
}

const getEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, Resource>({ id: 'dp-time-absence-type-get-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'], async enforce({ request, routeContext }) { const value = await actorAndResource(request, routeContext); return { ...value, input: null }; } });
const deleteEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, Resource>({ id: 'dp-time-absence-type-delete-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'], async enforce({ request, routeContext }) { const value = await actorAndResource(request, routeContext); return { ...value, input: null }; } });
const patchEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, UpdateAbsenceTypeInput, Resource>({
  id: 'dp-time-absence-type-patch-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const value = await actorAndResource(request, routeContext);
    const parsed = updateAbsenceTypeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'DP_ABSENCE_UPDATE_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Alteração inválida.' });
    return { ...value, input: parsed.data };
  },
});

export const GET = secureRoute({ contract: contract('GET', 'read', 'none'), enforcer: getEnforcer }, async ({ security }) => (
  NextResponse.json({ absenceType: await getAbsenceType(security.resource.id) }, { headers: { 'Cache-Control': 'private, no-store' } })
));
export const PATCH = secureRoute({ contract: contract('PATCH', 'write', 'schema'), enforcer: patchEnforcer }, async ({ security, observation }) => (
  NextResponse.json({ absenceType: await updateAbsenceType({ context: security.actor, id: security.resource.id, input: security.input, requestId: observation.requestId }) }, { headers: { 'Cache-Control': 'private, no-store' } })
));
export const DELETE = secureRoute({ contract: contract('DELETE', 'delete', 'none'), enforcer: deleteEnforcer }, async ({ security, observation }) => {
  await deleteAbsenceType({ context: security.actor, id: security.resource.id, requestId: observation.requestId });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
});
