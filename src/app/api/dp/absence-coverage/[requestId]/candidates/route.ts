import { NextResponse, type NextRequest } from 'next/server';

import { absenceCoverageCandidatesQuerySchema, absenceCoverageRouteSchema } from '@/features/dp/absences/coverage/schemas';
import { listAbsenceCoverageCandidates } from '@/features/dp/absences/coverage/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ requestId: string }> };
type Resource = { workspaceId: string; requestId: string };

const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.absence-coverage.candidates', version: 1,
  surface: { method: 'GET', path: '/api/dp/absence-coverage/[requestId]/candidates' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.edit' },
  resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'dp.absence-coverage.candidates', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext,
  ReturnType<typeof absenceCoverageCandidatesQuerySchema.parse>, Resource>({
  id: 'dp-absence-coverage-candidates-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => { throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause }); });
    const route = absenceCoverageRouteSchema.safeParse(await routeContext.params);
    const input = absenceCoverageCandidatesQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!route.success || !input.success) throw new AppError({ code: 'DP_ABSENCE_COVERAGE_INPUT_INVALID', kind: 'VALIDATION' });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) {
      throw new AppError({ code: 'DP_ABSENCE_COVERAGE_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: input.data, resource: { workspaceId: actor.workspace_id, requestId: route.data.requestId } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await listAbsenceCoverageCandidates(security.actor, security.resource.requestId, security.input),
    { headers: { 'Cache-Control': 'private, no-store' } }));
