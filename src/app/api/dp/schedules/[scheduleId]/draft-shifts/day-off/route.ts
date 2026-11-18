import { NextResponse, type NextRequest } from 'next/server';
import { draftDayOffSchema, type DraftDayOffInput } from '@/features/dp/day-offs/schemas';
import { assertPublishDayOffPermission } from '@/features/dp/day-offs/service.server';
import { stageScheduleDayOff } from '@/features/dp/schedules/publication-service.server';
import { bulkWorkShiftRouteSchema } from '@/features/dp/shifts/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';
import { canAccessUnit } from '@/lib/unit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ scheduleId: string }> };

const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.schedules.draft-day-off.edit', version: 1,
  surface: { method: 'PATCH', path: '/api/dp/schedules/[scheduleId]/draft-shifts/day-off' },
  exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.schedules.publish-bizneo' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'dp.schedule.draft-day-off', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext,
  DraftDayOffInput, { scheduleId: string; unitId: string }>({
  id: 'dp-schedule-draft-day-off-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked',
    'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    assertPublishDayOffPermission(actor);
    const route = bulkWorkShiftRouteSchema.safeParse(await routeContext.params);
    const body = draftDayOffSchema.safeParse(await request.json().catch(() => null));
    if (!route.success || !body.success) {
      throw new AppError({ code: 'DP_DAY_OFF_DRAFT_PAYLOAD_INVALID', kind: 'VALIDATION', safeMessage: 'Os dados do DSR são inválidos.' });
    }
    const unitId = body.data.unitId;
    if (!canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'DP_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: body.data, resource: { scheduleId: route.data.scheduleId, unitId } };
  },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security, observation }) => {
  const result = await stageScheduleDayOff(security.actor, security.resource.scheduleId, security.input, observation.requestId);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
