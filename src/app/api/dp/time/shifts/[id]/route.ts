import { NextRequest, NextResponse } from 'next/server';

import { requireShiftManager } from '@/features/dp/time-config/access.server';
import { timeConfigRouteSchema, updateShiftDefinitionSchema, type UpdateShiftDefinitionInput } from '@/features/dp/time-config/schemas';
import { deleteShiftDefinition, getShiftDefinition, updateShiftDefinition } from '@/features/dp/time-config/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
type Resource = { workspaceId: string; id: string };
const getContract = defineSecurityContract({ schemaVersion: 1, id: 'dp.time.shift.get', version: 1, surface: { method: 'GET', path: '/api/dp/time/shifts/[id]' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.shifts.manage' }, resourceScope: { kind: 'workspace' }, input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const patchContract = defineSecurityContract({ schemaVersion: 1, id: 'dp.time.shift.patch', version: 1, surface: { method: 'PATCH', path: '/api/dp/time/shifts/[id]' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.shifts.manage' }, resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'dp.time.shift-definition.update', unknownFields: 'reject' }, effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const deleteContract = defineSecurityContract({ schemaVersion: 1, id: 'dp.time.shift.delete', version: 1, surface: { method: 'DELETE', path: '/api/dp/time/shifts/[id]' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.shifts.manage' }, resourceScope: { kind: 'workspace' }, input: { kind: 'none' }, effects: { mode: 'delete', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
async function actorAndResource(request: NextRequest, routeContext: RouteContext) { const actor = await requireShiftManager(request); const parsed = timeConfigRouteSchema.safeParse(await routeContext.params); if (!parsed.success) throw new AppError({ code: 'DP_SHIFT_DEFINITION_ID_INVALID', kind: 'VALIDATION' }); return { actor, resource: { workspaceId: actor.workspace_id, id: parsed.data.id } }; }
const getEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, Resource>({ id: 'dp-time-shift-get-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'], async enforce({ request, routeContext }) { const value = await actorAndResource(request, routeContext); return { ...value, input: null }; } });
const deleteEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, Resource>({ id: 'dp-time-shift-delete-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'], async enforce({ request, routeContext }) { const value = await actorAndResource(request, routeContext); return { ...value, input: null }; } });
const patchEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, UpdateShiftDefinitionInput, Resource>({ id: 'dp-time-shift-patch-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'], async enforce({ request, routeContext }) { const value = await actorAndResource(request, routeContext); const parsed = updateShiftDefinitionSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: 'DP_SHIFT_DEFINITION_UPDATE_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Alteração do turno inválida.' }); return { ...value, input: parsed.data }; } });

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => NextResponse.json({ shift: await getShiftDefinition(security.actor, security.resource.id) }, { headers: { 'Cache-Control': 'private, no-store' } }));
export const PATCH = secureRoute({ contract: patchContract, enforcer: patchEnforcer }, async ({ security, observation }) => NextResponse.json({ shift: await updateShiftDefinition({ context: security.actor, id: security.resource.id, input: security.input, requestId: observation.requestId }) }, { headers: { 'Cache-Control': 'private, no-store' } }));
export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security, observation }) => { await deleteShiftDefinition({ context: security.actor, id: security.resource.id, requestId: observation.requestId }); return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } }); });
