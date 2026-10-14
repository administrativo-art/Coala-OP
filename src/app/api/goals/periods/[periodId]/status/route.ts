import { NextResponse, type NextRequest } from 'next/server';

import { goalPeriodStatusRouteSchema, transitionGoalPeriodSchema, type TransitionGoalPeriodInput } from '@/features/goals/period-status/schemas';
import { transitionGoalPeriod } from '@/features/goals/period-status/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ periodId: string }> };
type Resource = { workspaceId: string; periodId: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'goals.periods.status.transition',
  version: 1,
  surface: { method: 'POST', path: '/api/goals/periods/[periodId]/status' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'goals.manage' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'goals.period.status.transition', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
});

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, TransitionGoalPeriodInput, Resource>({
  id: 'goals-period-status-transition-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'GOAL_PERIOD_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!actor.isDefaultAdmin && actor.permissions.goals.manage !== true && actor.permissions.settings.manageUsers !== true) {
      throw new AppError({ code: 'GOAL_PERIOD_STATUS_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para encerrar metas.' });
    }
    const route = goalPeriodStatusRouteSchema.safeParse(await routeContext.params);
    if (!route.success) throw new AppError({ code: 'GOAL_PERIOD_ID_INVALID', kind: 'VALIDATION' });
    const input = transitionGoalPeriodSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) {
      throw new AppError({ code: 'GOAL_PERIOD_STATUS_INPUT_INVALID', kind: 'VALIDATION', safeMessage: input.error.issues[0]?.message ?? 'Transição de meta inválida.' });
    }
    return {
      actor,
      input: input.data,
      resource: { workspaceId: actor.workspace_id, periodId: route.data.periodId },
    };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security, observation }) => {
  await transitionGoalPeriod({
    context: security.actor,
    periodId: security.resource.periodId,
    input: security.input,
    requestId: observation.requestId,
  });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
});
