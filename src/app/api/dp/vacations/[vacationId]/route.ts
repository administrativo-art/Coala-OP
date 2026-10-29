import { NextResponse, type NextRequest } from 'next/server';

import { updateVacationSchema } from '@/features/hr/vacations/schemas';
import {
  authorizeVacationMutation,
  deleteVacation,
  discardVacationReceiptDocument,
  finalizeVacationWorkflow,
  generateVacationNotice,
  prepareVacationPayment,
  retryVacationReceiptSignatureAction,
  reviewVacationReceipt,
  selectVacationReceiptDocument,
  sendVacationToAccountant,
  sendVacationNotice,
  syncVacationPayment,
  syncVacationReceiptSignatureAction,
  syncVacationNotice,
  updateVacation,
  validateVacationNotice,
} from '@/features/hr/vacations/server';
import { AppError } from '@/lib/observability';

import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';
import type { ServerUserContext } from '@/lib/auth-server';
import type { UpdateVacationInput } from '@/features/hr/vacations/schemas';

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

type Context = { params: Promise<{ vacationId: string }> };
function mutationContract(method: 'PATCH' | 'DELETE') {
  return defineSecurityContract({
    schemaVersion: 1, id: `dp.vacations.${method.toLowerCase()}`, version: 1,
    surface: { method, path: '/api/dp/vacations/[vacationId]' }, exposure: 'authenticated',
    identity: { kind: 'active-user' },
    authorization: { kind: 'permission', action: 'dp.vacation.action-dependent' },
    resourceScope: { kind: 'custom', strategy: 'vacation-target-access' },
    input: { kind: 'schema', schema: 'dp.vacations.mutation', unknownFields: 'strip' },
    effects: { mode: method === 'DELETE' ? 'delete' : 'write', audit: 'server-authoritative' },
    errorExposure: 'sanitized',
  });
}
function mutationEnforcer(method: 'PATCH' | 'DELETE') {
  return defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, UpdateVacationInput | null, { id: string }>({
    id: `dp-vacations-${method.toLowerCase()}-v1`,
    guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'scope:vacation-target-access', 'input-validated', 'fields-allowlisted'],
    async enforce({ request, routeContext }) {
      const id = vacationId((await routeContext.params).vacationId);
      const parsed = method === 'PATCH' ? updateVacationSchema.safeParse(await request.json().catch(() => null)) : null;
      if (parsed && !parsed.success) {
        throw new AppError({ code: 'DP_VACATION_INPUT_INVALID', kind: 'VALIDATION', httpStatus: 400,
          safeMessage: 'Revise os dados da solicitação de férias.' });
      }
      const input = parsed?.success ? parsed.data : null;
      const actor = await authorizeVacationMutation(request, id, input?.action ?? 'delete');
      return { actor, input, resource: { id } };
    },
  });
}

export const PATCH = secureRoute({ contract: mutationContract('PATCH'), enforcer: mutationEnforcer('PATCH') }, async ({ request, security }) => {
  const input = security.input!;
  const id = security.resource.id;
  if (input.action === 'generate_notice') {
    return NextResponse.json({ vacation: await generateVacationNotice(request, id) });
  }
  if (input.action === 'validate_notice') {
    return NextResponse.json({ vacation: await validateVacationNotice(request, id) });
  }
  if (input.action === 'send_notice') {
    return NextResponse.json({ vacation: await sendVacationNotice(request, id, input) });
  }
  if (input.action === 'sync_notice') {
    return NextResponse.json({ vacation: await syncVacationNotice(request, id) });
  }
  if (input.action === 'send_accountant') {
    return NextResponse.json({ vacation: await sendVacationToAccountant(request, id) });
  }
  if (input.action === 'select_receipt_document') {
    return NextResponse.json({ vacation: await selectVacationReceiptDocument(request, id, input.documentId) });
  }
  if (input.action === 'discard_receipt_document') {
    return NextResponse.json({ vacation: await discardVacationReceiptDocument(request, id, input.documentId, input.reason) });
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

export const DELETE = secureRoute({ contract: mutationContract('DELETE'), enforcer: mutationEnforcer('DELETE') }, async ({ request, security }) => {
  await deleteVacation(request, security.resource.id);
  return new NextResponse(null, { status: 204 });
});
