import { NextResponse, type NextRequest } from 'next/server';

import { saveWorkShiftSchema, workShiftRouteSchema } from '@/features/dp/shifts/schemas';
import { saveWorkShift } from '@/features/dp/shifts/service.server';
import { requireUser } from '@/lib/auth-server';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/dp/schedules/[scheduleId]/shifts/[shiftId]';

type RouteContext = {
  params: Promise<{ scheduleId: string; shiftId: string }>;
};

async function handleSave(request: NextRequest, contextArg: RouteContext, mode: 'create' | 'update', requestId: string) {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
  });
  const parsedRoute = workShiftRouteSchema.safeParse(await contextArg.params);
  if (!parsedRoute.success) {
    throw new AppError({ code: 'DP_SHIFT_ROUTE_INVALID', kind: 'VALIDATION' });
  }
  const parsedBody = saveWorkShiftSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    throw new AppError({
      code: 'DP_SHIFT_PAYLOAD_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Os dados do turno são inválidos.',
      cause: parsedBody.error,
    });
  }

  const result = await saveWorkShift({
    context,
    scheduleId: parsedRoute.data.scheduleId,
    shiftId: parsedRoute.data.shiftId,
    input: parsedBody.data,
    mode,
    requestId,
  });
  return NextResponse.json(result, {
    status: mode === 'create' ? 201 : 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export const PUT = withApiErrorHandling<RouteContext>({
  source: 'api-dp',
  operation: 'create-work-shift',
  routeOrJob: ROUTE,
}, async (request, contextArg, observation) => handleSave(request, contextArg, 'create', observation.requestId));

export const PATCH = withApiErrorHandling<RouteContext>({
  source: 'api-dp',
  operation: 'update-work-shift',
  routeOrJob: ROUTE,
}, async (request, contextArg, observation) => handleSave(request, contextArg, 'update', observation.requestId));
