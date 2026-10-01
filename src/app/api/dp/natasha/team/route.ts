import { NextResponse, type NextRequest } from 'next/server';

import { loadNatashaTeam } from '@/features/dp/natasha-team/service.server';
import { requireUser } from '@/lib/auth-server';
import { natashaTeamRequestSchema } from '@/lib/natasha-team-directory';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/dp/natasha/team';

export const GET = withApiErrorHandling({
  source: 'api-dp',
  operation: 'list-natasha-team',
  routeOrJob: ROUTE,
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
  });
  const parsed = natashaTeamRequestSchema.safeParse({
    unitIds: request.nextUrl.searchParams.getAll('unit'),
  });
  if (!parsed.success) {
    throw new AppError({
      code: 'NATASHA_TEAM_QUERY_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Informe de uma a cinco unidades distintas.',
      cause: parsed.error,
    });
  }
  const result = await loadNatashaTeam({ context, unitIds: parsed.data.unitIds });
  return NextResponse.json(result, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
