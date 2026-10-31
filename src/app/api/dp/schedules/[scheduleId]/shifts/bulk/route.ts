import { NextResponse, type NextRequest } from 'next/server';
import { bulkWorkShiftRouteSchema, bulkWorkShiftSchema } from '@/features/dp/shifts/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { dbAdmin } from '@/lib/firebase-admin';
import { canAccessUnit } from '@/lib/unit-access';
import { stageBulkWorkShift } from '@/features/dp/schedules/publication-service.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ scheduleId: string }> };
const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.schedules.shifts.bulk', version: 1,
  surface: { method: 'POST', path: '/api/dp/schedules/[scheduleId]/shifts/bulk' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.edit' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'dp.shift.bulk', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext,
  ReturnType<typeof bulkWorkShiftSchema.parse>, { scheduleId: string; unitId: string }>({
  id: 'dp-schedule-shifts-bulk-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) throw new AppError({ code: 'DP_SHIFT_EDIT_FORBIDDEN', kind: 'AUTHORIZATION' });
    const parsed = bulkWorkShiftRouteSchema.safeParse(await routeContext.params);
    const body = bulkWorkShiftSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !body.success) throw new AppError({ code: 'DP_SHIFT_BULK_INPUT_INVALID', kind: 'VALIDATION' });
    const scheduleId = parsed.data.scheduleId;
    const schedule = await dbAdmin.collection('dp_schedules').doc(scheduleId).get();
    const unitId = schedule.get('unitId');
    if (!schedule.exists) throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND' });
    if (typeof unitId !== 'string' || !canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) throw new AppError({ code: 'DP_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION' });
    return { actor, input: body.data, resource: { scheduleId, unitId } };
  },
});
export const POST = secureRoute({ contract, enforcer }, async ({ security, observation }) =>
  NextResponse.json(await stageBulkWorkShift({ context: security.actor, scheduleId: security.resource.scheduleId,
    input: security.input, requestId: observation.requestId }),
  { headers: { 'Cache-Control': 'private, no-store' } }));
