import { NextResponse, type NextRequest } from 'next/server';

import { createVacationSchema } from '@/features/hr/vacations/schemas';
import { createVacation } from '@/features/hr/vacations/server';
import { withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiErrorHandling({
  source: 'api',
  operation: 'create-dp-vacation',
  routeOrJob: '/api/dp/vacations',
}, async (request: NextRequest) => {
  const input = createVacationSchema.parse(await request.json());
  return NextResponse.json({ vacation: await createVacation(request, input) }, { status: 201 });
});
