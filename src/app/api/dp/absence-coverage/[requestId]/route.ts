import { NextResponse, type NextRequest } from 'next/server';

import { absenceCoverageDecisionSchema, absenceCoverageRouteSchema } from '@/features/dp/absences/coverage/schemas';
import { decideAbsenceCoverage, getAbsenceCoverage } from '@/features/dp/absences/coverage/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ requestId: string }> };
type Resource = { workspaceId: string; requestId: string };

async function actorFrom(request: NextRequest) {
  return requireUser(request).catch((cause) => { throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause }); });
}

const readContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.absence-coverage.read', version: 1,
  surface: { method: 'GET', path: '/api/dp/absence-coverage/[requestId]' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'custom', strategy: 'dp.absence-coverage.read' },
  resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'dp.absence-coverage.route', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const readEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, null, Resource>({
  id: 'dp-absence-coverage-read-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:dp.absence-coverage.read', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await actorFrom(request);
    const route = absenceCoverageRouteSchema.safeParse(await routeContext.params);
    if (!route.success) throw new AppError({ code: 'DP_ABSENCE_COVERAGE_INPUT_INVALID', kind: 'VALIDATION' });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.view !== true && actor.permissions.dp.requests.review !== true) {
      throw new AppError({ code: 'DP_ABSENCE_COVERAGE_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: null, resource: { workspaceId: actor.workspace_id, requestId: route.data.requestId } };
  },
});

export const GET = secureRoute({ contract: readContract, enforcer: readEnforcer }, async ({ security }) =>
  NextResponse.json({ coverage: await getAbsenceCoverage(security.actor, security.resource.requestId) },
    { headers: { 'Cache-Control': 'private, no-store' } }));

const decideContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.absence-coverage.decide', version: 1,
  surface: { method: 'POST', path: '/api/dp/absence-coverage/[requestId]' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.edit' },
  resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'dp.absence-coverage.decision', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const decideEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext,
  ReturnType<typeof absenceCoverageDecisionSchema.parse>, Resource>({
  id: 'dp-absence-coverage-decide-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await actorFrom(request);
    const route = absenceCoverageRouteSchema.safeParse(await routeContext.params);
    const input = absenceCoverageDecisionSchema.safeParse(await request.json().catch(() => null));
    if (!route.success || !input.success) throw new AppError({ code: 'DP_ABSENCE_COVERAGE_INPUT_INVALID', kind: 'VALIDATION' });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) {
      throw new AppError({ code: 'DP_ABSENCE_COVERAGE_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: input.data, resource: { workspaceId: actor.workspace_id, requestId: route.data.requestId } };
  },
});

export const POST = secureRoute({ contract: decideContract, enforcer: decideEnforcer }, async ({ security }) =>
  NextResponse.json({ coverage: await decideAbsenceCoverage(security.actor, security.resource.requestId, security.input) }));
