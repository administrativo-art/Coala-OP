import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { deleteDPSchedule } from '@/features/dp/schedules/delete-service.server';
import { getSchedule } from '@/features/dp/schedules/read-service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { canAccessUnit } from '@/lib/unit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ scheduleId: string }> };
type Resource = { scheduleId: string; unitId: string };
type GetResource = Resource & { schedule: { id: string } & Record<string, unknown> };
const routeSchema = z.object({ scheduleId: z.string().trim().min(1).max(180) }).strict();
const deleteContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'dp.schedules.delete',
  version: 1,
  surface: { method: 'DELETE', path: '/api/dp/schedules/[scheduleId]' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.schedules.delete' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'none' },
  effects: { mode: 'delete', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
});
const getContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'dp.schedules.get',
  version: 1,
  surface: { method: 'GET', path: '/api/dp/schedules/[scheduleId]' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.schedules.view' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'dp.schedule.route', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});
const deleteEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, Resource>({
  id: 'dp-schedules-delete-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'DP_SCHEDULE_DELETE_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.delete !== true) {
      throw new AppError({ code: 'DP_SCHEDULE_DELETE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para excluir escalas.' });
    }
    const route = routeSchema.safeParse(await routeContext.params);
    if (!route.success) throw new AppError({ code: 'DP_SCHEDULE_DELETE_ROUTE_INVALID', kind: 'VALIDATION' });
    const schedule = await dbAdmin.collection('dp_schedules').doc(route.data.scheduleId).get();
    const unitId = schedule.get('unitId');
    if (!schedule.exists || typeof unitId !== 'string' || !unitId) {
      throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    }
    if (!canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'DP_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta escala.' });
    }
    return { actor, input: null, resource: { scheduleId: route.data.scheduleId, unitId } };
  },
});

const getEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, GetResource>({
  id: 'dp-schedules-get-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'DP_SCHEDULE_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.view !== true) {
      throw new AppError({ code: 'DP_SCHEDULE_VIEW_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para consultar escalas.' });
    }
    const route = routeSchema.safeParse(await routeContext.params);
    if (!route.success) throw new AppError({ code: 'DP_SCHEDULE_ROUTE_INVALID', kind: 'VALIDATION' });
    const schedule = await getSchedule(actor, route.data.scheduleId);
    return {
      actor,
      input: null,
      resource: {
        scheduleId: route.data.scheduleId,
        unitId: String(schedule.unitId ?? ''),
        schedule,
      },
    };
  },
});


export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json(
    { schedule: security.resource.schedule },
    { headers: { 'Cache-Control': 'private, no-store' } },
  ));

export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security, observation }) => {
  await deleteDPSchedule({ context: security.actor, scheduleId: security.resource.scheduleId, requestId: observation.requestId });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
});
