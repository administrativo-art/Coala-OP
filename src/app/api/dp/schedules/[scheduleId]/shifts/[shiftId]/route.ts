import { NextResponse, type NextRequest } from 'next/server';
import { saveWorkShiftSchema, workShiftRouteSchema } from '@/features/dp/shifts/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { dbAdmin } from '@/lib/firebase-admin';
import { canAccessUnit } from '@/lib/unit-access';
import { stageWorkShift } from '@/features/dp/schedules/publication-service.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ scheduleId: string; shiftId: string }> };
type Resource = { scheduleId: string; shiftId: string; unitId: string };
type Input = { input?: ReturnType<typeof saveWorkShiftSchema.parse> };
function route(method: 'PUT' | 'PATCH' | 'DELETE', mode: 'create' | 'update' | 'delete') {
  const contract = defineSecurityContract({ schemaVersion: 1, id: `dp.schedules.shifts.${method.toLowerCase()}`, version: 1,
    surface: { method, path: '/api/dp/schedules/[scheduleId]/shifts/[shiftId]' }, exposure: 'authenticated',
    identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.edit' },
    resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'dp.shift.write', unknownFields: 'reject' },
    effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
  const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, Input, Resource>({
    id: `dp-schedule-shift-${method.toLowerCase()}-v1`, guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
    async enforce({ request, routeContext }) {
      const actor = await requireUser(request).catch((cause) => {
        throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
      });
      if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) throw new AppError({ code: 'DP_SHIFT_EDIT_FORBIDDEN', kind: 'AUTHORIZATION' });
      const parsed = workShiftRouteSchema.safeParse(await routeContext.params);
      const body = mode === 'delete' ? null : saveWorkShiftSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success || (body && !body.success)) throw new AppError({ code: 'DP_SHIFT_INPUT_INVALID', kind: 'VALIDATION' });
      const scheduleId = parsed.data.scheduleId;
      const schedule = await dbAdmin.collection('dp_schedules').doc(scheduleId).get();
      const unitId = schedule.get('unitId');
      if (!schedule.exists) throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND' });
      if (typeof unitId !== 'string' || !canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) throw new AppError({ code: 'DP_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION' });
      return { actor, input: { ...(body?.success ? { input: body.data } : {}) }, resource: { scheduleId, shiftId: parsed.data.shiftId, unitId } };
    },
  });
  return { contract, enforcer };

}
const put = route('PUT', 'create');
const patch = route('PATCH', 'update');
const deletion = route('DELETE', 'delete');
async function handle(security: { actor: ServerUserContext; input: Input; resource: Resource },
  requestId: string, mode: 'create' | 'update' | 'delete'): Promise<NextResponse> {
  const result = await stageWorkShift({ context: security.actor, scheduleId: security.resource.scheduleId,
    shiftId: security.resource.shiftId, input: security.input.input, mode, requestId });
  return NextResponse.json(result, { status: mode === 'create' ? 201 : 200,
    headers: { 'Cache-Control': 'private, no-store' } });
}

export const PUT = secureRoute({ contract: put.contract, enforcer: put.enforcer }, async ({ security, observation }) =>
  handle(security, observation.requestId, 'create'));
export const PATCH = secureRoute({ contract: patch.contract, enforcer: patch.enforcer }, async ({ security, observation }) =>
  handle(security, observation.requestId, 'update'));
export const DELETE = secureRoute({ contract: deletion.contract, enforcer: deletion.enforcer }, async ({ security, observation }) =>
  handle(security, observation.requestId, 'delete'));
