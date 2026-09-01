import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser } from '@/lib/auth-server';
import { vacationQueryWindow } from '@/lib/dp-vacation-schedule-rules';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError, withApiErrorHandling } from '@/lib/observability';
import { canAccessUnit, resolveUnitAccess } from '@/lib/unit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/dp/schedules/[scheduleId]/vacations';
const QUERY_LIMIT = 500;

const routeSchema = z.object({
  scheduleId: z.string().trim().min(1).max(180),
});

const scheduleSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2200),
  unitId: z.string().trim().min(1).optional(),
});

type RouteContext = {
  params: Promise<{ scheduleId: string }>;
};

export const GET = withApiErrorHandling<RouteContext>({
  source: 'api-dp',
  operation: 'list-schedule-vacations',
  routeOrJob: ROUTE,
}, async (request: NextRequest, contextArg: RouteContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
  });

  if (!context.isDefaultAdmin && !context.permissions.dp?.schedules?.view) {
    throw new AppError({
      code: 'DP_SCHEDULE_VACATIONS_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem permissão para validar as férias desta escala.',
    });
  }

  const parsedRoute = routeSchema.safeParse(await contextArg.params);
  if (!parsedRoute.success) {
    throw new AppError({ code: 'DP_SCHEDULE_ID_INVALID', kind: 'VALIDATION' });
  }

  const scheduleSnapshot = await dbAdmin.collection('dp_schedules').doc(parsedRoute.data.scheduleId).get();
  if (!scheduleSnapshot.exists) {
    throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
  }

  const parsedSchedule = scheduleSchema.safeParse(scheduleSnapshot.data());
  if (!parsedSchedule.success) {
    throw new AppError({
      code: 'DP_SCHEDULE_PERIOD_INVALID',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'A competência da escala está inválida.',
      metadata: { scheduleId: parsedRoute.data.scheduleId },
    });
  }

  const unitAccess = resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin });
  const canReadSchedule = parsedSchedule.data.unitId
    ? canAccessUnit(context.userDoc, parsedSchedule.data.unitId, { isDefaultAdmin: context.isDefaultAdmin })
    : unitAccess.allUnits;
  if (!canReadSchedule) {
    throw new AppError({
      code: 'DP_SCHEDULE_UNIT_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem acesso à unidade desta escala.',
    });
  }

  const { monthStart, monthEnd, queryEnd } = vacationQueryWindow(
    parsedSchedule.data.year,
    parsedSchedule.data.month,
  );
  const snapshot = await dbAdmin.collection('dp_vacations')
    .where('endDate', '>=', monthStart)
    .where('endDate', '<=', queryEnd)
    .orderBy('endDate', 'asc')
    .limit(QUERY_LIMIT)
    .get();

  if (snapshot.size === QUERY_LIMIT) {
    throw new AppError({
      code: 'DP_SCHEDULE_VACATIONS_LIMIT_REACHED',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'Há registros demais para validar as férias desta escala com segurança.',
      metadata: { scheduleId: parsedRoute.data.scheduleId, queryLimit: QUERY_LIMIT },
    });
  }

  const vacations = snapshot.docs.flatMap((document) => {
    const data = document.data();
    if (
      data.status !== 'APPROVED'
      || data.recordType !== 'gozo'
      || typeof data.startDate !== 'string'
      || typeof data.endDate !== 'string'
      || data.startDate > monthEnd
    ) return [];

    return [{
      id: document.id,
      userId: typeof data.userId === 'string' ? data.userId : '',
      cycleId: typeof data.cycleId === 'string' ? data.cycleId : '',
      recordType: 'gozo' as const,
      startDate: data.startDate,
      endDate: data.endDate,
      days: typeof data.days === 'number' ? data.days : 0,
      status: 'APPROVED' as const,
      warnings: [],
      createdAt: null,
    }];
  }).filter((vacation) => vacation.userId);

  return NextResponse.json(
    { vacations },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});
