import { NextRequest, NextResponse } from "next/server";

import {
  assertTerminationVisible,
  auditTerminationDocuments,
  completeTermination,
  decideTerminationNotice,
  getTermination,
  listTerminationEvents,
  reconcileTerminationProviderState,
  revokeTerminationAccess,
  sendTerminationToAccountant,
  sendTerminationDocumentsForSignature,
  syncTerminationUniformReturn,
  terminationContext,
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
    return NextResponse.json({ process, events: await listTerminationEvents(id) });
  } catch (error) { return responseError(error); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await terminationContext(request);
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    let process;
    if (body.action === "validate") process = await validateTerminationRequest({ context, id, notes: typeof body.notes === "string" ? body.notes : null });
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
    else if (body.action === "audit_documents") process = await auditTerminationDocuments({ context, id, approvedIds: Array.isArray(body.approvedIds) ? body.approvedIds.filter((value): value is string => typeof value === "string") : [], selectedIds: Array.isArray(body.selectedIds) ? body.selectedIds.filter((value): value is string => typeof value === "string") : [] });
    else if (body.action === "send_signatures") process = await sendTerminationDocumentsForSignature({ context, id });
    else if (body.action === "revoke_access") process = await revokeTerminationAccess({
      context,
      id,
      target: body.target as "pdv" | "bizneo" | "healthPlan",
    });
    else if (body.action === "complete") process = await completeTermination({ context, id });
    else throw new Error("Ação inválida.");
    return NextResponse.json({ process });
  } catch (error) { return responseError(error); }
}
