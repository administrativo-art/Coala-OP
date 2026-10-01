import { NextResponse, type NextRequest } from 'next/server';

import { loadNatashaAvailability } from '@/features/dp/natasha-availability/service.server';
import { requireUser } from '@/lib/auth-server';
import { natashaAvailabilityRequestSchema } from '@/lib/natasha-availability';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/dp/natasha/availability';

export const GET = withApiErrorHandling({
  source: 'api-dp',
  operation: 'list-natasha-availability',
  routeOrJob: ROUTE,
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
  });
  const parsed = natashaAvailabilityRequestSchema.safeParse({
    period: request.nextUrl.searchParams.get('period'),
    unitIds: request.nextUrl.searchParams.getAll('unit'),
  });
  if (!parsed.success) {
    throw new AppError({
      code: 'NATASHA_AVAILABILITY_QUERY_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Informe a competência e de uma a cinco unidades distintas.',
      cause: parsed.error,
    });
  }
  const result = await loadNatashaAvailability({ context, ...parsed.data });
  return NextResponse.json(result, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
