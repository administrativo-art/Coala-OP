import { NextResponse, type NextRequest } from 'next/server';

import { bulkWorkShiftRouteSchema, bulkWorkShiftSchema } from '@/features/dp/shifts/schemas';
import { applyWorkShiftBulkChange } from '@/features/dp/shifts/bulk-service.server';
import { requireUser } from '@/lib/auth-server';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/dp/schedules/[scheduleId]/shifts/bulk';

type RouteContext = {
  params: Promise<{ scheduleId: string }>;
};

export const POST = withApiErrorHandling<RouteContext>({
  source: 'api-dp',
  operation: 'bulk-edit-work-shifts',
  routeOrJob: ROUTE,
}, async (request: NextRequest, contextArg: RouteContext, observation) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
  });
  const parsedRoute = bulkWorkShiftRouteSchema.safeParse(await contextArg.params);
  if (!parsedRoute.success) {
    throw new AppError({ code: 'DP_SHIFT_BULK_ROUTE_INVALID', kind: 'VALIDATION' });
  }
  const parsedBody = bulkWorkShiftSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    throw new AppError({
      code: 'DP_SHIFT_BULK_PAYLOAD_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Os dados da edição em lote são inválidos.',
      cause: parsedBody.error,
    });
  }

  const result = await applyWorkShiftBulkChange({
    context,
    scheduleId: parsedRoute.data.scheduleId,
    input: parsedBody.data,
    requestId: observation.requestId,
  });
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
