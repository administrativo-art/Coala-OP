import { NextRequest, NextResponse } from "next/server";

import {
  assertTerminationVisible,
  auditTerminationDocuments,
  completeEmployeeResignation,
  completeTerminationOperations,
  completeTermination,
  decideTerminationNotice,
  getTermination,
  listTerminationEvents,
  prepareTerminationPayment,
  formalizeEmployerDismissalNoticeRefusal,
  reconcileTerminationProviderState,
  reviewTerminationLetter,
  revokeTerminationAccess,
  retryEmployerDismissalNotice,
  sendTerminationEmployeePackage,
  sendTerminationToAccountant,
  sendTerminationDocumentsForSignature,
  syncTerminationPayment,
  syncTerminationUniformReturn,
  terminationContext,
  terminationForViewer,
  updateTerminationStep,
  validateTerminationRequest,
} from "@/features/hr/termination/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha ao processar desligamento.";
  return NextResponse.json({ error: message }, { status: /permissão|autenticad/i.test(message) ? 403 : 400 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await terminationContext(request);
    const { id } = await params;
    const storedProcess = await getTermination(id);
    const process = storedProcess ? await reconcileTerminationProviderState(storedProcess).catch(() => storedProcess) : null;
    if (!process) return NextResponse.json({ error: "Desligamento não encontrado." }, { status: 404 });
    await assertTerminationVisible(context, process);
    return NextResponse.json({ process: terminationForViewer(context, process), events: await listTerminationEvents(id) });
  } catch (error) { return responseError(error); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await terminationContext(request);
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    let process;
    if (body.action === "review_letter") process = await reviewTerminationLetter({
      context,
      id,
      decision: body.decision as "approved" | "correction_requested" | "exception_review",
      notes: typeof body.notes === "string" ? body.notes : null,
      appBaseUrl: request.nextUrl.origin,
    });
    else if (body.action === "validate") process = await validateTerminationRequest({ context, id, notes: typeof body.notes === "string" ? body.notes : null });
    else if (body.action === "retry_dismissal_notice") process = await retryEmployerDismissalNotice({ context, id });
    else if (body.action === "formalize_dismissal_notice_refusal") process = await formalizeEmployerDismissalNoticeRefusal({
      context,
      id,
      witnessNames: Array.isArray(body.witnessNames) ? body.witnessNames.filter((value): value is string => typeof value === "string") : [],
      notes: typeof body.notes === "string" ? body.notes : "",
    });
    else if (body.action === "decide_notice") process = await decideTerminationNotice({
      context, id,
      decision: body.decision as "worked" | "waived_no_discount" | "waived_with_discount" | "exception_review",
      communicationDate: String(body.communicationDate ?? ""),
      contractEndDate: typeof body.contractEndDate === "string" ? body.contractEndDate : null,
      holidays: Array.isArray(body.holidays) ? body.holidays.filter((v): v is string => typeof v === "string") : [],
      notes: typeof body.notes === "string" ? body.notes : null,
    });
    else if (body.action === "update_step") process = await updateTerminationStep({ context, id, stepId: body.stepId as never, status: body.status as never, note: typeof body.note === "string" ? body.note : null });
    else if (body.action === "sync_uniform_return") {
      const result = await syncTerminationUniformReturn({ context, id });
      return NextResponse.json(result);
    }
    else if (body.action === "send_accountant") process = await sendTerminationToAccountant({ context, id, recipientEmail: String(body.recipientEmail ?? ""), appBaseUrl: request.nextUrl.origin });
    else if (body.action === "audit_documents") process = await auditTerminationDocuments({
      context,
      id,
      reviews: Array.isArray(body.reviews)
        ? body.reviews.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const review = value as Record<string, unknown>;
          if (typeof review.id !== "string" || !["approved", "correction_required"].includes(String(review.decision))) return [];
          return [{
            id: review.id,
            decision: review.decision as "approved" | "correction_required",
            reason: typeof review.reason === "string" ? review.reason : null,
            selectedForEmployee: review.selectedForEmployee !== false,
            signatureMode: typeof review.signatureMode === "string" ? review.signatureMode as never : undefined,
          }];
        })
        : [],
      appBaseUrl: request.nextUrl.origin,
    });
    else if (body.action === "send_signatures") process = await sendTerminationDocumentsForSignature({ context, id });
    else if (body.action === "prepare_payment") process = await prepareTerminationPayment({ context, id });
    else if (body.action === "sync_payment") process = await syncTerminationPayment({ context, id });
    else if (body.action === "send_employee_package") process = await sendTerminationEmployeePackage({
      context,
      id,
      appBaseUrl: request.nextUrl.origin,
      recipientEmail: typeof body.recipientEmail === "string" ? body.recipientEmail : null,
    });
    else if (body.action === "revoke_access") process = await revokeTerminationAccess({
      context,
      id,
      target: body.target as "pdv" | "bizneo" | "healthPlan",
    });
    else if (body.action === "complete_operations") process = await completeTerminationOperations({
      context,
      id,
      scheduleRemoved: body.scheduleRemoved === true,
      benefitsClosed: body.benefitsClosed === true,
      assetsReturned: body.assetsReturned === true,
      notes: typeof body.notes === "string" ? body.notes : null,
    });
    else if (body.action === "complete_resignation" || body.action === "complete_guided_termination") process = await completeEmployeeResignation({
      context,
      id,
      reservations: Array.isArray(body.reservations)
        ? body.reservations.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const reservation = value as Record<string, unknown>;
          if (!["uniforms_not_returned", "aso_no_show"].includes(String(reservation.type)) || typeof reservation.note !== "string") return [];
          return [{ type: reservation.type as "uniforms_not_returned" | "aso_no_show", note: reservation.note }];
        })
        : [],
      recipientEmail: typeof body.recipientEmail === "string" ? body.recipientEmail : null,
    });
    else if (body.action === "complete") process = await completeTermination({ context, id });
    else throw new Error("Ação inválida.");
    return NextResponse.json({ process });
  } catch (error) { return responseError(error); }
}
