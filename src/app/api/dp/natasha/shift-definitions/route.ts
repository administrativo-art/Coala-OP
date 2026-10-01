import { NextResponse, type NextRequest } from 'next/server';

import { loadNatashaShiftDirectory } from '@/features/dp/natasha-shift-directory/service.server';
import { requireUser } from '@/lib/auth-server';
import { natashaShiftDirectoryRequestSchema } from '@/lib/natasha-shift-directory';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/dp/natasha/shift-definitions';

export const GET = withApiErrorHandling({
  source: 'api-dp',
  operation: 'list-natasha-shift-definitions',
  routeOrJob: ROUTE,
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
  });
  const parsed = natashaShiftDirectoryRequestSchema.safeParse({
    unitIds: request.nextUrl.searchParams.getAll('unit'),
  });
  if (!parsed.success) {
    throw new AppError({
      code: 'NATASHA_SHIFT_DEFINITION_QUERY_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Informe de uma a cinco unidades distintas.',
      cause: parsed.error,
    });
  }
  const result = await loadNatashaShiftDirectory({ context, unitIds: parsed.data.unitIds });
  return NextResponse.json(result, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
