import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { validateScheduleJourneys } from '@/features/dp/journey-validation/service.server';
import { getSchedule } from '@/features/dp/schedules/read-service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ scheduleId: string }> };
type Resource = { scheduleId: string; unitId: string; schedule: { id: string } & Record<string, unknown> };

const routeSchema = z.object({ scheduleId: z.string().trim().min(1).max(180) }).strict();

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'dp.schedules.journey-validation.get',
  version: 1,
  surface: { method: 'GET', path: '/api/dp/schedules/[scheduleId]/journey-validation' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.schedules.view' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'dp.schedule.route', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, Resource>({
  id: 'dp-schedule-journey-validation-get-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'DP_JOURNEY_VALIDATION_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.view !== true) {
      throw new AppError({ code: 'DP_JOURNEY_VALIDATION_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para validar jornadas da escala.' });
    }
    const route = routeSchema.safeParse(await routeContext.params);
    if (!route.success) throw new AppError({ code: 'DP_JOURNEY_VALIDATION_ROUTE_INVALID', kind: 'VALIDATION' });
    const schedule = await getSchedule(actor, route.data.scheduleId);
    return {
      actor,
      input: null,
      resource: { scheduleId: route.data.scheduleId, unitId: String(schedule.unitId ?? ''), schedule },
    };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const validation = await validateScheduleJourneys({
    context: security.actor,
    scheduleId: security.resource.scheduleId,
    authorizedSchedule: security.resource.schedule,
  });
  return NextResponse.json({ validation }, { headers: { 'Cache-Control': 'private, no-store' } });
});
