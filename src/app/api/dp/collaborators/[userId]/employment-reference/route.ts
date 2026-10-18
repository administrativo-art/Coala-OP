import { NextResponse, type NextRequest } from 'next/server';

import { readEmploymentHistory, readEmploymentReference, publishEmploymentReference } from '@/features/dp/employment-reference/service.server';
import {
  bindEmploymentReferencePublication,
  employmentReferenceRouteSchema,
  parseEmploymentReferenceQuery,
  type PublishEmploymentReferenceInput,
} from '@/features/dp/employment-reference/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ userId: string }> };
type ReadInput = NonNullable<ReturnType<typeof parseEmploymentReferenceQuery>>;
type WriteInput = PublishEmploymentReferenceInput;
type Resource = { workspaceId: string; userId: string };
const path = '/api/dp/collaborators/[userId]/employment-reference' as const;

const getContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.collaborators.employment-reference.read', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'employment-reference-coarse-read' },
  resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.employment-reference.query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const putContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.collaborators.employment-reference.publish', version: 1,
  surface: { method: 'PUT', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'employment-reference-coarse-write' },
  resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.employment-reference.timeline', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});

async function actorAndUserId(request: NextRequest, routeContext: RouteContext) {
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  const route = employmentReferenceRouteSchema.safeParse(await routeContext.params);
  if (!route.success) throw new AppError({ code: 'DP_EMPLOYMENT_ROUTE_INVALID', kind: 'VALIDATION' });
  return { actor, userId: route.data.userId };
}

const getEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, ReadInput, Resource>({
  id: 'dp-employment-reference-read-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:employment-reference-coarse-read',
    'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const { actor, userId } = await actorAndUserId(request, routeContext);
    const parsed = parseEmploymentReferenceQuery(request.nextUrl.searchParams);
    if (!parsed) throw new AppError({ code: 'DP_EMPLOYMENT_QUERY_INVALID', kind: 'VALIDATION' });
    if (!actor.isDefaultAdmin && actor.permissions.dp.collaborators.view !== true
      && actor.permissions.settings.manageUsers !== true) {
      throw new AppError({ code: 'DP_EMPLOYMENT_READ_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: parsed, resource: { workspaceId: actor.workspace_id, userId } };
  },
});

const putEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, WriteInput, Resource>({
  id: 'dp-employment-reference-publish-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:employment-reference-coarse-write',
    'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const { actor, userId } = await actorAndUserId(request, routeContext);
    if ([...request.nextUrl.searchParams.keys()].length) {
      throw new AppError({ code: 'DP_EMPLOYMENT_BODY_INVALID', kind: 'VALIDATION' });
    }
    const parsed = bindEmploymentReferencePublication(userId, await request.json().catch(() => null));
    if (!parsed) {
      throw new AppError({ code: 'DP_EMPLOYMENT_BODY_INVALID', kind: 'VALIDATION', safeMessage: 'Histórico de vínculo inválido.' });
    }
    if (!actor.isDefaultAdmin && (actor.permissions.dp.collaborators.ownProfileOnly === true
      || actor.permissions.settings.manageUsers !== true && actor.permissions.dp.collaborators.edit !== true)) {
      throw new AppError({ code: 'DP_EMPLOYMENT_WRITE_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: parsed, resource: { workspaceId: actor.workspace_id, userId } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => {
  // Person, historical units and ownProfileOnly are rechecked in the service.
  const result = security.input.date
    ? await readEmploymentReference(security.actor, { userId: security.resource.userId, ...security.input, date: security.input.date })
    : await readEmploymentHistory(security.actor, { userId: security.resource.userId, revision: security.input.revision });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});

export const PUT = secureRoute({ contract: putContract, enforcer: putEnforcer }, async ({ security }) => {
  const result = await publishEmploymentReference(security.actor, security.input);
  return NextResponse.json(result, {
    status: result.replayed ? 200 : 201,
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
