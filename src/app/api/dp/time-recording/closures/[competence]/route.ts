import { NextResponse, type NextRequest } from 'next/server';

import { assertClosureAccess, reopenCompetence } from '@/features/dp/time-adjustments/closure.server';
import { closureActionSchema, closureRouteSchema, type ClosureActionInput } from '@/features/dp/time-adjustments/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ competence: string }> };
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.closures.reopen', version: 1,
  surface: { method: 'PATCH', path: '/api/dp/time-recording/closures/[competence]' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.time-closure.reopen' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-closure.action', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, ClosureActionInput, { workspaceId: string; competence: string }>({
  id: 'dp-time-closure-reopen-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    assertClosureAccess(actor, 'reopen');
    const route = closureRouteSchema.safeParse(await routeContext.params);
    if (!route.success) throw new AppError({ code: 'PTRP_CLOSURE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Competência inválida.' });
    const parsed = closureActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'PTRP_CLOSURE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Reabertura inválida.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, competence: route.data.competence } };
  },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json({ closure: await reopenCompetence(security.actor, security.resource.competence, security.input) },
    { headers: { 'Cache-Control': 'private, no-store' } }));
