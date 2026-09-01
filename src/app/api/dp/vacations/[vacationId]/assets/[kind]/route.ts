import { NextResponse, type NextRequest } from 'next/server';

import { getVacationWorkflowAsset } from '@/features/hr/vacations/server';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function boundedId(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 180) {
    throw new AppError({
      code: 'DP_VACATION_ASSET_PARAMETER_INVALID',
      kind: 'VALIDATION',
      safeMessage: `${label} inválido.`,
      httpStatus: 400,
    });
  }
  return normalized;
}

export const GET = withApiErrorHandling({
  source: 'api',
  operation: 'open-dp-vacation-workflow-asset',
  routeOrJob: '/api/dp/vacations/[vacationId]/assets/[kind]',
}, async (
  request: NextRequest,
  context: { params: Promise<{ vacationId: string; kind: string }> },
) => {
  const params = await context.params;
  const vacationId = boundedId(params.vacationId, 'Identificador de férias');
  const kind = boundedId(params.kind, 'Tipo de documento');
  if (kind !== 'receipt-original' && kind !== 'receipt-signed') {
    throw new AppError({
      code: 'DP_VACATION_ASSET_KIND_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Tipo de documento inválido.',
      httpStatus: 400,
    });
  }
  const asset = await getVacationWorkflowAsset(request, vacationId, kind);
  return new NextResponse(new Uint8Array(asset.buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-SHA256': asset.hashSha256,
    },
  });
});
