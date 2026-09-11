import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { listVacationEvents } from '@/features/hr/vacations/server';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  limit: z.coerce.number().int().min(5).max(50).default(20),
  cursor: z.string().trim().min(1).max(180).nullish(),
});

function vacationId(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 180) {
    throw new AppError({
      code: 'DP_VACATION_ID_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Identificador de férias inválido.',
      httpStatus: 400,
    });
  }
  return normalized;
}

export const GET = withApiErrorHandling({
  source: 'api',
  operation: 'list-dp-vacation-events',
  routeOrJob: '/api/dp/vacations/[vacationId]/events',
}, async (request: NextRequest, context: { params: Promise<{ vacationId: string }> }) => {
  const params = await context.params;
  const input = querySchema.parse({
    limit: request.nextUrl.searchParams.get('limit') ?? undefined,
    cursor: request.nextUrl.searchParams.get('cursor'),
  });
  return NextResponse.json(await listVacationEvents(
    request,
    vacationId(params.vacationId),
    input,
  ), { headers: { 'Cache-Control': 'private, no-store' } });
});
