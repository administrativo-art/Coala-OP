import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';
import { readOfficialScheduleShifts } from '@/features/dp/schedules/official-revision.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<Record<string, never>> };
const querySchema = z.object({ scheduleId: z.string().min(1).max(180).refine((value) => !value.includes('/')),
  employeeIds: z.array(z.string().min(1).max(180).refine((value) => !value.includes('/'))).min(1).max(30) });
const contract = defineSecurityContract({ schemaVersion: 1, id: 'goals.schedule-shifts', version: 1,
  surface: { method: 'GET', path: '/api/goals/schedule-shifts' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'custom', strategy: 'goals-read-or-manage' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'goals.schedule-shifts-query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext,
  z.infer<typeof querySchema>, { scheduleId: string; unitId: string }>({
  id: 'goals-schedule-shifts-v1', guarantees: ['authenticated-user', 'active-user', 'authorization:goals-read-or-manage', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && actor.permissions.goals.view !== true && actor.permissions.goals.manage !== true
      && actor.permissions.settings.manageUsers !== true) throw new AppError({ code: 'GOALS_SCHEDULE_FORBIDDEN', kind: 'AUTHORIZATION' });
    const params = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({ scheduleId: params.get('scheduleId'), employeeIds: params.getAll('employeeId') });
    if (!parsed.success || [...params.keys()].some((key) => key !== 'scheduleId' && key !== 'employeeId')) {
      throw new AppError({ code: 'GOALS_SCHEDULE_INPUT_INVALID', kind: 'VALIDATION' });
    }
    const schedule = await dbAdmin.collection('dp_schedules').doc(parsed.data.scheduleId).get();
    const unitId = schedule.get('unitId');
    if (!schedule.exists || typeof unitId !== 'string'
      || (schedule.get('workspaceId') && schedule.get('workspaceId') !== actor.workspace_id)) {
      throw new AppError({ code: 'GOALS_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND' });
    }
    const unit = await dbAdmin.collection('dp_units').doc(unitId).get();
    const externalId = unit.exists ? unit.get('externalId') : null;
    if (!canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })
      && !(typeof externalId === 'string' && canAccessUnit(actor.userDoc, externalId, { isDefaultAdmin: actor.isDefaultAdmin }))) {
      throw new AppError({ code: 'GOALS_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: parsed.data, resource: { scheduleId: parsed.data.scheduleId, unitId } };
  },
});
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const allowed = new Set(security.input.employeeIds);
  const shifts = (await readOfficialScheduleShifts({ scheduleId: security.resource.scheduleId })).shifts
    .filter((shift) => allowed.has(String(shift.userId ?? '')))
    .map((shift) => ({ id: shift.id, scheduleId: shift.scheduleId, userId: shift.userId,
      unitId: shift.unitId, date: shift.date, type: shift.type, startTime: shift.startTime,
      endTime: shift.endTime, countsTowardGoals: shift.countsTowardGoals }));
  return NextResponse.json({ shifts }, { headers: { 'Cache-Control': 'private, no-store' } });
});
