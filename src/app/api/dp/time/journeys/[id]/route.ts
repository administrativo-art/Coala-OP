import { NextRequest, NextResponse } from 'next/server';

import { requireTimeManager } from '@/features/dp/time-config/access.server';
import { timeConfigRouteSchema, updateJourneySchema, type UpdateJourneyInput } from '@/features/dp/time-config/schemas';
import { deleteTimeConfig, DP_TIME_COLLECTIONS, getTimeConfig, updateTimeConfig } from '@/features/dp/time-config/service.server';
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
  return defineSecurityContract({ schemaVersion: 1, id: `dp.time.journey.${method.toLowerCase()}`, version: 1, surface: { method, path: '/api/dp/time/journeys/[id]' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.time.manage' }, resourceScope: { kind: 'workspace' }, input: input === 'none' ? { kind: 'none' } : { kind: 'schema', schema: 'dp.time.journey.update', unknownFields: 'reject' }, effects: { mode: effect, audit: effect === 'read' ? 'none' : 'server-authoritative' }, errorExposure: 'sanitized' });
}
const getContract = contract('GET', 'read', 'none');
const patchContract = contract('PATCH', 'write', 'schema');
const deleteContract = contract('DELETE', 'delete', 'none');

async function actorAndResource(request: NextRequest, routeContext: RouteContext) {
  const actor = await requireTimeManager(request);
  const parsed = timeConfigRouteSchema.safeParse(await routeContext.params);
  if (!parsed.success) throw new AppError({ code: 'DP_JOURNEY_ID_INVALID', kind: 'VALIDATION' });
  return { actor, resource: { workspaceId: actor.workspace_id, id: parsed.data.id } };
}
const getEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, Resource>({ id: 'dp-time-journey-get-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'], async enforce({ request, routeContext }) { const value = await actorAndResource(request, routeContext); return { ...value, input: null }; } });
const deleteEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, Resource>({ id: 'dp-time-journey-delete-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'], async enforce({ request, routeContext }) { const value = await actorAndResource(request, routeContext); return { ...value, input: null }; } });
const patchEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, UpdateJourneyInput, Resource>({
  id: 'dp-time-journey-patch-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) { const value = await actorAndResource(request, routeContext); const parsed = updateJourneySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: 'DP_JOURNEY_UPDATE_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Alteração da jornada inválida.' }); return { ...value, input: parsed.data }; },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => NextResponse.json({ journey: await getTimeConfig(security.actor, DP_TIME_COLLECTIONS.journeys, security.resource.id) }, { headers: { 'Cache-Control': 'private, no-store' } }));
export const PATCH = secureRoute({ contract: patchContract, enforcer: patchEnforcer }, async ({ security, observation }) => NextResponse.json({ journey: await updateTimeConfig({ context: security.actor, collectionName: DP_TIME_COLLECTIONS.journeys, id: security.resource.id, input: security.input, requestId: observation.requestId }) }, { headers: { 'Cache-Control': 'private, no-store' } }));
export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security, observation }) => { await deleteTimeConfig({ context: security.actor, collectionName: DP_TIME_COLLECTIONS.journeys, id: security.resource.id, requestId: observation.requestId }); return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } }); });
