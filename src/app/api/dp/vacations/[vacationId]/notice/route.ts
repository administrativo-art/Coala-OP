import { NextResponse, type NextRequest } from 'next/server';

import { getVacationNoticeAsset } from '@/features/hr/vacations/server';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  operation: 'open-dp-vacation-notice',
  routeOrJob: '/api/dp/vacations/[vacationId]/notice',
}, async (request: NextRequest, context: { params: Promise<{ vacationId: string }> }) => {
  const params = await context.params;
  const asset = await getVacationNoticeAsset(request, vacationId(params.vacationId));
  return new NextResponse(new Uint8Array(asset.buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-SHA256': asset.hashSha256,
    },
  });
});
