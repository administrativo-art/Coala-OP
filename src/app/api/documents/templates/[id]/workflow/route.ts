import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  canAdvanceDocumentTemplateWorkflow,
  defaultSystemTemplateWorkflowStatus,
  isDocumentTemplateWorkflowStatus,
} from "@/features/hr/documents/document-template-workflow";
import { SYSTEM_TEMPLATE_WORKFLOW_COLLECTION } from "@/features/hr/documents/document-template-workflow.server";
import { systemDocumentTemplateById } from "@/features/hr/documents/system-template-catalog";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const template = systemDocumentTemplateById(id);
    if (!template) {
      return NextResponse.json({ error: "Fluxo disponível somente para modelos oficiais." }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    if (!isDocumentTemplateWorkflowStatus(body.status)) {
      return NextResponse.json({ error: "Etapa do modelo inválida." }, { status: 400 });
    }
    const access = await assertFormalizationAccess(
      request,
      body.status === "published" ? "templates.publish" : "templates.manage",
    );
    const reference = dbAdmin.collection(SYSTEM_TEMPLATE_WORKFLOW_COLLECTION).doc(id);
    const currentDocument = await reference.get();
    const storedStatus = currentDocument.get("status");
    const currentStatus = isDocumentTemplateWorkflowStatus(storedStatus)
      ? storedStatus
      : defaultSystemTemplateWorkflowStatus(template);
    if (!canAdvanceDocumentTemplateWorkflow(currentStatus, body.status)) {
      return NextResponse.json(
        { error: "A etapa informada não é a próxima etapa válida deste modelo." },
        { status: 409 },
      );
    }
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
    const now = Timestamp.now();
    const event = {
      from: currentStatus,
      to: body.status,
      note: note || null,
      actorId: access.decoded.uid,
      actorName: access.actorName,
      at: now,
    };
    await reference.set({
      status: body.status,
      note: note || null,
      updatedAt: now,
      updatedBy: access.decoded.uid,
      updatedByName: access.actorName,
      history: FieldValue.arrayUnion(event),
    }, { merge: true });
    return NextResponse.json({
      workflow: serializeHrValue({
        status: body.status,
        note: note || null,
        updatedAt: now,
        updatedByName: access.actorName,
        history: [...(Array.isArray(currentDocument.get("history")) ? currentDocument.get("history") : []), event],
      }),
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Falha ao atualizar o modelo." },
      { status: 403 },
    );
  }
}
