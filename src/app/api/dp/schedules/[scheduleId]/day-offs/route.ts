import { NextResponse, type NextRequest } from 'next/server';

import { dayOffRouteSchema, publishDayOffSchema } from '@/features/dp/day-offs/schemas';
import { publishDayOff } from '@/features/dp/day-offs/service.server';
import { requireUser } from '@/lib/auth-server';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/dp/schedules/[scheduleId]/day-offs';

type RouteContext = {
  params: Promise<{ scheduleId: string }>;
};

export const POST = withApiErrorHandling<RouteContext>({
  source: 'api-dp',
  operation: 'publish-day-off-to-bizneo',
  routeOrJob: ROUTE,
}, async (request: NextRequest, contextArg: RouteContext, observation) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
  });
  const parsedRoute = dayOffRouteSchema.safeParse(await contextArg.params);
  if (!parsedRoute.success) {
    throw new AppError({ code: 'DP_DAY_OFF_SCHEDULE_ID_INVALID', kind: 'VALIDATION' });
  }
  const parsedBody = publishDayOffSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    throw new AppError({
      code: 'DP_DAY_OFF_PAYLOAD_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Os dados da folga são inválidos.',
      cause: parsedBody.error,
    });
  }

  const result = await publishDayOff({
    context,
    scheduleId: parsedRoute.data.scheduleId,
    input: parsedBody.data,
    requestId: observation.requestId,
  });

  return NextResponse.json(result, {
    status: result.alreadyPublished ? 200 : 201,
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
