import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { saveClosedScheduleDay, saveCoverageDemands } from '@/features/dp/coverage-demands/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { coverageDemandRouteSchema, saveClosedScheduleDaySchema, saveCoverageDemandsSchema } from '@/lib/dp-coverage-demands';
import { AppError } from '@/lib/observability';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';
import { canAccessUnit } from '@/lib/unit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/dp/schedules/[scheduleId]/coverage-demands/[date]';
type RouteContext = { params: Promise<{ scheduleId: string; date: string }> };
type Resource = z.infer<typeof coverageDemandRouteSchema>;

const coverageContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.schedules.coverage-demands.save', version: 1,
  surface: { method: 'PUT', path: ROUTE }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.edit' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'dp.schedule.coverage-demand', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});

const closedDayContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.schedules.closed-day.save', version: 1,
  surface: { method: 'PATCH', path: ROUTE }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.edit' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'dp.schedule.closed-day', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});

function scheduleWriteEnforcer<T>(id: string, schema: z.ZodType<T>, targetUnits: (input: T) => string[]) {
  return defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, T, Resource>({
    id,
    guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
    async enforce({ request, routeContext }) {
      const actor = await requireUser(request).catch((cause) => {
        throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
      });
      if (!actor.isDefaultAdmin && !actor.permissions.dp.schedules.edit) {
        throw new AppError({ code: 'DP_COVERAGE_DEMAND_EDIT_FORBIDDEN', kind: 'AUTHORIZATION' });
      }
      const route = coverageDemandRouteSchema.safeParse(await routeContext.params);
      const body = schema.safeParse(await request.json().catch(() => null));
      if (!route.success || !body.success) {
        throw new AppError({ code: 'DP_SCHEDULE_DAY_INPUT_INVALID', kind: 'VALIDATION',
          safeMessage: 'Confira a data e as escalas selecionadas.' });
      }
      if (targetUnits(body.data).some((unit) => !canAccessUnit(actor.userDoc, unit, { isDefaultAdmin: actor.isDefaultAdmin }))) {
        throw new AppError({ code: 'DP_COVERAGE_DEMAND_UNIT_FORBIDDEN', kind: 'AUTHORIZATION' });
      }
      return { actor, input: body.data, resource: route.data };
    },
  });
}

const coverageEnforcer = scheduleWriteEnforcer('dp-schedule-coverage-demand-write-v1', saveCoverageDemandsSchema,
  ({ unitId }) => [unitId]);
const closedDayEnforcer = scheduleWriteEnforcer('dp-schedule-closed-day-write-v1', saveClosedScheduleDaySchema,
  ({ schedules }) => schedules.map(({ unitId }) => unitId));

export const PUT = secureRoute({ contract: coverageContract, enforcer: coverageEnforcer }, async ({ security, observation }) =>
  NextResponse.json(await saveCoverageDemands({ context: security.actor, ...security.resource, input: security.input,
    requestId: observation.requestId }), { headers: { 'Cache-Control': 'private, no-store' } }));

export const PATCH = secureRoute({ contract: closedDayContract, enforcer: closedDayEnforcer }, async ({ security, observation }) =>
  NextResponse.json(await saveClosedScheduleDay({ context: security.actor, ...security.resource, input: security.input,
    requestId: observation.requestId }), { headers: { 'Cache-Control': 'private, no-store' } }));
