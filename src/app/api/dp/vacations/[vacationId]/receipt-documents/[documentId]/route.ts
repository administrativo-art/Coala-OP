import { NextResponse, type NextRequest } from 'next/server';

import { getVacationReceiptDocumentAsset } from '@/features/hr/vacations/server';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function boundedId(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 180) {
    throw new AppError({
      code: 'DP_VACATION_RECEIPT_DOCUMENT_PARAMETER_INVALID',
      kind: 'VALIDATION',
      safeMessage: `${label} inválido.`,
      httpStatus: 400,
    });
  }
  return normalized;
}

export const GET = withApiErrorHandling({
  source: 'api',
  operation: 'open-dp-vacation-receipt-document',
  routeOrJob: '/api/dp/vacations/[vacationId]/receipt-documents/[documentId]',
}, async (
  request: NextRequest,
  context: { params: Promise<{ vacationId: string; documentId: string }> },
) => {
  const params = await context.params;
  const vacationId = boundedId(params.vacationId, 'Identificador de férias');
  const documentId = boundedId(params.documentId, 'Identificador do arquivo');
  const asset = await getVacationReceiptDocumentAsset(request, vacationId, documentId);
  return new NextResponse(new Uint8Array(asset.buffer), {
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-SHA256': asset.hashSha256,
    },
  });
});
