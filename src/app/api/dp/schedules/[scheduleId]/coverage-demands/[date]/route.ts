import { NextResponse, type NextRequest } from 'next/server';

import { saveClosedScheduleDay, saveCoverageDemands } from '@/features/dp/coverage-demands/service.server';
import { requireUser } from '@/lib/auth-server';
import { coverageDemandRouteSchema, saveClosedScheduleDaySchema, saveCoverageDemandsSchema } from '@/lib/dp-coverage-demands';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/dp/schedules/[scheduleId]/coverage-demands/[date]';

type RouteContext = {
  params: Promise<{ scheduleId: string; date: string }>;
};

export const PUT = withApiErrorHandling<RouteContext>({
  source: 'api-dp',
  operation: 'save-coverage-demands',
  routeOrJob: ROUTE,
}, async (request: NextRequest, contextArg: RouteContext, observation) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
  });
  const parsedRoute = coverageDemandRouteSchema.safeParse(await contextArg.params);
  if (!parsedRoute.success) {
    throw new AppError({ code: 'DP_COVERAGE_DEMAND_ROUTE_INVALID', kind: 'VALIDATION' });
  }
  const parsedBody = saveCoverageDemandsSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    throw new AppError({
      code: 'DP_COVERAGE_DEMAND_PAYLOAD_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Os dados da demanda são inválidos.',
      cause: parsedBody.error,
    });
  }

  const result = await saveCoverageDemands({
    context,
    scheduleId: parsedRoute.data.scheduleId,
    date: parsedRoute.data.date,
    input: parsedBody.data,
    requestId: observation.requestId,
  });

  return NextResponse.json(result, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
});

export const PATCH = withApiErrorHandling<RouteContext>({
  source: 'api-dp',
  operation: 'save-closed-schedule-day',
  routeOrJob: ROUTE,
}, async (request: NextRequest, contextArg: RouteContext, observation) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
  });
  const route = coverageDemandRouteSchema.safeParse(await contextArg.params);
  const body = saveClosedScheduleDaySchema.safeParse(await request.json().catch(() => null));
  if (!route.success || !body.success) {
    throw new AppError({ code: 'DP_SCHEDULE_CLOSED_INPUT_INVALID', kind: 'VALIDATION',
      safeMessage: 'Confira a data e as escalas selecionadas.' });
  }
  const result = await saveClosedScheduleDay({ context, ...route.data, input: body.data,
    requestId: observation.requestId });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
