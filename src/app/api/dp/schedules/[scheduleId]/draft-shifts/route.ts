import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { discardConflictingDraftShifts, listEditableScheduleShifts } from '@/features/dp/schedules/publication-service.server';
import { bulkWorkShiftRouteSchema } from '@/features/dp/shifts/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';
import { canAccessUnit } from '@/lib/unit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ scheduleId: string }> };
const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.schedules.draft-shifts', version: 1,
  surface: { method: 'GET', path: '/api/dp/schedules/[scheduleId]/draft-shifts' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.edit' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'dp.schedule.route', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const resolveContract = defineSecurityContract({ schemaVersion: 1, id: 'dp.schedules.draft-conflicts-discard', version: 1,
  surface: { method: 'POST', path: '/api/dp/schedules/[scheduleId]/draft-shifts' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.edit' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'dp.schedule.draft-conflicts-discard', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext,
  null, { scheduleId: string }>({
  id: 'dp-schedule-draft-shifts-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked',
    'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) {
      throw new AppError({ code: 'DP_SCHEDULE_DRAFT_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    const parsed = bulkWorkShiftRouteSchema.safeParse(await routeContext.params);
    if (!parsed.success) throw new AppError({ code: 'DP_SCHEDULE_ID_INVALID', kind: 'VALIDATION' });
    const schedule = await dbAdmin.collection('dp_schedules').doc(parsed.data.scheduleId).get();
    if (!schedule.exists) throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND' });
    const unitId = schedule.get('unitId');
    if (typeof unitId !== 'string' || !canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'DP_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: null, resource: { scheduleId: parsed.data.scheduleId } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await listEditableScheduleShifts(security.actor, security.resource.scheduleId),
    { headers: { 'Cache-Control': 'private, no-store' } }));

const resolveBodySchema = z.object({ expectedDraftVersion: z.number().int().min(0) }).strict();
const resolveEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext,
  z.infer<typeof resolveBodySchema>, { scheduleId: string }>({
  id: 'dp-schedule-draft-conflicts-discard-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked',
    'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) {
      throw new AppError({ code: 'DP_SCHEDULE_DRAFT_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    const route = bulkWorkShiftRouteSchema.safeParse(await routeContext.params);
    const input = resolveBodySchema.safeParse(await request.json().catch(() => null));
    if (!route.success || !input.success) throw new AppError({ code: 'DP_SCHEDULE_DRAFT_RESOLVE_INVALID', kind: 'VALIDATION' });
    const schedule = await dbAdmin.collection('dp_schedules').doc(route.data.scheduleId).get();
    if (!schedule.exists) throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND' });
    const unitId = schedule.get('unitId');
    if (typeof unitId !== 'string' || !canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'DP_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: input.data, resource: { scheduleId: route.data.scheduleId } };
  },
});

export const POST = secureRoute({ contract: resolveContract, enforcer: resolveEnforcer }, async ({ security }) =>
  NextResponse.json(await discardConflictingDraftShifts(security.actor, security.resource.scheduleId,
    security.input.expectedDraftVersion), { headers: { 'Cache-Control': 'private, no-store' } }));
