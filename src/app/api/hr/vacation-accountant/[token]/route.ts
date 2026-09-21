import { NextResponse, type NextRequest } from 'next/server';

import {
  getVacationReceiptPortal,
  uploadVacationReceipt,
} from '@/features/hr/vacations/receipt-upload.server';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tokenValue(value: string) {
  const token = value.trim();
  if (!token || token.length > 256) {
    throw new AppError({
      code: 'DP_VACATION_RECEIPT_TOKEN_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Link inválido.',
      httpStatus: 400,
    });
  }
  return token;
}

export const GET = withApiErrorHandling({
  source: 'api',
  operation: 'get-vacation-accountant-portal',
  routeOrJob: '/api/hr/vacation-accountant/[token]',
}, async (_request: NextRequest, context: { params: Promise<{ token: string }> }) => {
  const { token } = await context.params;
  return NextResponse.json({
    process: await getVacationReceiptPortal(tokenValue(token)),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
});

export const POST = withApiErrorHandling({
  source: 'api',
  operation: 'upload-vacation-receipt',
  routeOrJob: '/api/hr/vacation-accountant/[token]',
}, async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
  const { token } = await context.params;
  const form = await request.formData();
  const files = [
    ...form.getAll('files'),
    ...form.getAll('file'),
  ].filter((value): value is File => value instanceof File && value.size > 0);
  if (!files.length) {
    throw new AppError({
      code: 'DP_VACATION_RECEIPT_FILE_REQUIRED',
      kind: 'VALIDATION',
      safeMessage: 'Selecione ao menos um arquivo em PDF, JPG ou PNG.',
      httpStatus: 400,
    });
  }
  const result = await uploadVacationReceipt({
    token: tokenValue(token),
    files,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
  });
  return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
});
