import { NextResponse, type NextRequest } from 'next/server';

import { createVacationSchema } from '@/features/hr/vacations/schemas';
import { createVacation, listVacations } from '@/features/hr/vacations/server';
import { AppError, withApiErrorHandling } from '@/lib/observability';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listSchema = z.object({
  userId: z.string().trim().min(1).max(180),
  limit: z.coerce.number().int().min(10).max(100).default(50),
  cursor: z.string().trim().min(1).max(180).nullish(),
});

export const GET = withApiErrorHandling({
  source: 'api',
  operation: 'list-dp-vacations',
  routeOrJob: '/api/dp/vacations',
}, async (request: NextRequest) => {
  const parsed = listSchema.safeParse({
    userId: request.nextUrl.searchParams.get('userId'),
    limit: request.nextUrl.searchParams.get('limit') ?? undefined,
    cursor: request.nextUrl.searchParams.get('cursor'),
  });
  if (!parsed.success) {
    throw new AppError({
      code: 'DP_VACATION_LIST_QUERY_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Informe o colaborador para consultar o histórico de férias.',
      httpStatus: 400,
    });
  }
  return NextResponse.json(await listVacations(request, parsed.data), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
});

export const POST = withApiErrorHandling({
  source: 'api',
  operation: 'create-dp-vacation',
  routeOrJob: '/api/dp/vacations',
}, async (request: NextRequest) => {
  const input = createVacationSchema.parse(await request.json());
  return NextResponse.json({ vacation: await createVacation(request, input) }, { status: 201 });
});
