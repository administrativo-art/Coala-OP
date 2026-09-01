import { NextResponse, type NextRequest } from 'next/server';

import { updateVacationSchema } from '@/features/hr/vacations/schemas';
import {
  deleteVacation,
  finalizeVacationWorkflow,
  generateVacationNotice,
  prepareVacationPayment,
  retryVacationReceiptSignatureAction,
  reviewVacationReceipt,
  sendVacationToAccountant,
  sendVacationNotice,
  syncVacationPayment,
  syncVacationReceiptSignatureAction,
  syncVacationNotice,
  updateVacation,
  validateVacationNotice,
} from '@/features/hr/vacations/server';
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

export const PATCH = withApiErrorHandling({
  source: 'api',
  operation: 'update-dp-vacation',
  routeOrJob: '/api/dp/vacations/[vacationId]',
}, async (request: NextRequest, context: { params: Promise<{ vacationId: string }> }) => {
  const params = await context.params;
  const input = updateVacationSchema.parse(await request.json());
  const id = vacationId(params.vacationId);
  if (input.action === 'generate_notice') {
    return NextResponse.json({ vacation: await generateVacationNotice(request, id) });
  }
  if (input.action === 'validate_notice') {
    return NextResponse.json({ vacation: await validateVacationNotice(request, id) });
  }
  if (input.action === 'send_notice') {
    return NextResponse.json({ vacation: await sendVacationNotice(request, id) });
  }
  if (input.action === 'sync_notice') {
    return NextResponse.json({ vacation: await syncVacationNotice(request, id) });
  }
  if (input.action === 'send_accountant') {
    return NextResponse.json({ vacation: await sendVacationToAccountant(request, id) });
  }
  if (input.action === 'review_receipt') {
    return NextResponse.json({ vacation: await reviewVacationReceipt(request, id, input) });
  }
  if (input.action === 'prepare_payment') {
    return NextResponse.json({ vacation: await prepareVacationPayment(request, id) });
  }
  if (input.action === 'sync_payment') {
    return NextResponse.json({ vacation: await syncVacationPayment(request, id) });
  }
  if (input.action === 'retry_receipt_signature') {
    return NextResponse.json({ vacation: await retryVacationReceiptSignatureAction(request, id) });
  }
  if (input.action === 'sync_receipt_signature') {
    return NextResponse.json({ vacation: await syncVacationReceiptSignatureAction(request, id) });
  }
  if (input.action === 'finalize_workflow') {
    return NextResponse.json({ vacation: await finalizeVacationWorkflow(request, id) });
  }
  return NextResponse.json({
    vacation: await updateVacation(request, id, input),
  });
});

export const DELETE = withApiErrorHandling({
  source: 'api',
  operation: 'delete-dp-vacation',
  routeOrJob: '/api/dp/vacations/[vacationId]',
}, async (request: NextRequest, context: { params: Promise<{ vacationId: string }> }) => {
  const params = await context.params;
  await deleteVacation(request, vacationId(params.vacationId));
  return new NextResponse(null, { status: 204 });
});
