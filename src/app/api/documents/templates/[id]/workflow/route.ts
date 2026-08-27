import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { normalizeFieldMapping, pendingPlaceholders } from "@/features/hr/documents/field-mapping";
import {
  canTransitionDocumentTemplateWorkflow,
  defaultSystemTemplateWorkflowStatus,
  isDocumentTemplateWorkflowStatus,
  type DocumentTemplateWorkflowDecision,
} from "@/features/hr/documents/document-template-workflow";
import { inspectStoredDocumentTemplateIntegrity } from "@/features/hr/documents/document-template-integrity.server";
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
    const candidateReference = dbAdmin.collection("companyDocumentTemplates").doc(id);
    const candidateDocument = template ? null : await candidateReference.get();
    const officialCandidate = Boolean(
      candidateDocument?.exists
      && !candidateDocument.get("deletedAt")
      && candidateDocument.get("officialCandidate") === true
      && typeof candidateDocument.get("derivedFromSystemTemplateId") === "string"
    );
    if (!template && !officialCandidate) {
      return NextResponse.json({ error: "Fluxo disponível somente para modelos oficiais e suas novas versões." }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    if (!isDocumentTemplateWorkflowStatus(body.status)) {
      return NextResponse.json({ error: "Etapa do modelo inválida." }, { status: 400 });
    }
    const decision: DocumentTemplateWorkflowDecision = body.decision === "return"
      ? "return"
      : "advance";
    if (
      officialCandidate
      && !(
        ["rh_approval", "published"].includes(body.status)
        || (decision === "return" && body.status === "technical_validation")
      )
    ) {
      return NextResponse.json(
        { error: "Uma nova versão oficial só pode avançar por validação técnica e homologação do RH." },
        { status: 409 },
      );
    }
    const access = await assertFormalizationAccess(
      request,
      body.status === "published" ? "templates.publish" : "templates.manage",
    );
    const reference = template
      ? dbAdmin.collection(SYSTEM_TEMPLATE_WORKFLOW_COLLECTION).doc(id)
      : candidateReference;
    const currentDocument = template
      ? await reference.get()
      : candidateDocument!;
    const storedStatus = template
      ? currentDocument.get("status")
      : currentDocument.get("workflowStatus");
    const currentStatus = isDocumentTemplateWorkflowStatus(storedStatus)
      ? storedStatus
      : template
        ? defaultSystemTemplateWorkflowStatus(template)
        : "technical_validation";
    if (!canTransitionDocumentTemplateWorkflow({
      current: currentStatus,
      next: body.status,
      decision,
    })) {
      return NextResponse.json(
        { error: decision === "return"
          ? "Esta versão não pode ser devolvida a partir da etapa atual."
          : "A etapa informada não é a próxima etapa válida deste modelo." },
        { status: 409 },
      );
    }
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
    if (!note) {
      return NextResponse.json(
        { error: decision === "return"
          ? "Informe o motivo da devolução para ajustes."
          : "Registre uma observação ou evidência antes de avançar." },
        { status: 400 },
      );
    }
    let sourceIntegrity: Awaited<ReturnType<typeof inspectStoredDocumentTemplateIntegrity>> | null = null;
    let activeAttestations: Record<string, unknown> | null = null;
    if (
      officialCandidate
      && decision === "advance"
      && (body.status === "rh_approval" || body.status === "published")
    ) {
      const variables = Array.isArray(currentDocument.get("variables"))
        ? currentDocument.get("variables").filter((value: unknown): value is string => typeof value === "string")
        : [];
      const mapping = normalizeFieldMapping(currentDocument.get("fieldMapping"), variables);
      const pending = pendingPlaceholders(variables, mapping);
      if (pending.length) {
        return NextResponse.json(
          { error: `Defina a origem destes campos antes de avançar: ${pending.join(", ")}.` },
          { status: 409 },
        );
      }
      const validation = currentDocument.get("templateValidation");
      if (!validation || validation.valid !== true) {
        return NextResponse.json(
          { error: "A nova versão precisa respeitar a área segura do papel timbrado antes de avançar." },
          { status: 409 },
        );
      }
      const standardValidation = currentDocument.get("documentStandardValidation");
      if (!standardValidation || standardValidation.valid !== true) {
        const messages = Array.isArray(standardValidation?.issues)
          ? standardValidation.issues
            .map((issue: unknown) =>
              issue && typeof issue === "object" && "message" in issue
                ? String(issue.message)
                : "",
            )
            .filter(Boolean)
            .join(" ")
          : "";
        return NextResponse.json(
          {
            error:
              "A nova versão ainda não atende ao padrão documental CT Sorvetes." +
              (messages ? ` ${messages}` : ""),
          },
          { status: 409 },
        );
      }
      if (!currentDocument.get("fieldPreparationTestedAt")) {
        return NextResponse.json(
          { error: "Gere e confira o teste visual com dados fictícios antes de avançar." },
          { status: 409 },
        );
      }
      const requestedAttestations = body.attestations
        && typeof body.attestations === "object"
        && !Array.isArray(body.attestations)
        ? body.attestations as Record<string, unknown>
        : {};
      const storedAttestations = currentDocument.get("technicalAttestations");
      const previous = storedAttestations
        && typeof storedAttestations === "object"
        && !Array.isArray(storedAttestations)
        ? storedAttestations as Record<string, unknown>
        : {};
      const layoutReviewed = requestedAttestations.layoutReviewed === true
        || previous.layoutReviewed === true;
      const fictionalDataReviewed = requestedAttestations.fictionalDataReviewed === true
        || previous.fictionalDataReviewed === true;
      if (!layoutReviewed || !fictionalDataReviewed) {
        return NextResponse.json(
          { error: "Confirme a conferência do layout e do preenchimento com dados fictícios." },
          { status: 409 },
        );
      }
      sourceIntegrity = await inspectStoredDocumentTemplateIntegrity(currentDocument);
      if (!sourceIntegrity.valid) {
        return NextResponse.json(
          {
            error: "O DOCX mudou ou o contrato de variáveis está inconsistente. Reverifique o arquivo antes de avançar.",
            integrity: serializeHrValue(sourceIntegrity),
          },
          { status: 409 },
        );
      }
      const nowIso = new Date().toISOString();
      activeAttestations = {
        layoutReviewed: true,
        fictionalDataReviewed: true,
        attestedAt: nowIso,
        attestedBy: access.decoded.uid,
        attestedByName: access.actorName,
      };
    }
    const now = Timestamp.now();
    const contentEditorId = String(
      currentDocument.get("contentUpdatedBy")
      ?? currentDocument.get("fieldPreparationTestedBy")
      ?? currentDocument.get("updatedBy")
      ?? "",
    );
    const sameActorAsEditor = Boolean(contentEditorId && contentEditorId === access.decoded.uid);
    const event = {
      from: currentStatus,
      to: body.status,
      decision,
      note,
      actorId: access.decoded.uid,
      actorName: access.actorName,
      at: now,
      sameActorAsEditor,
      ...(activeAttestations ? { attestations: activeAttestations } : {}),
      ...(sourceIntegrity ? { sourceHash: sourceIntegrity.actualHash } : {}),
    };
    if (template) {
      await reference.set({
        status: body.status,
        note,
        updatedAt: now,
        updatedBy: access.decoded.uid,
        updatedByName: access.actorName,
        history: FieldValue.arrayUnion(event),
      }, { merge: true });
    } else {
      const update: Record<string, unknown> = {
        workflowStatus: body.status,
        workflowNote: note,
        workflowUpdatedAt: now,
        workflowUpdatedBy: access.decoded.uid,
        workflowUpdatedByName: access.actorName,
        workflowHistory: FieldValue.arrayUnion(event),
        updatedAt: now,
        updatedBy: access.decoded.uid,
        updatedByName: access.actorName,
        segregationOfDuties: {
          editorId: contentEditorId || null,
          reviewerId: access.decoded.uid,
          sameActor: sameActorAsEditor,
          checkedAt: now,
        },
      };
      if (activeAttestations) update.technicalAttestations = activeAttestations;
      if (sourceIntegrity) {
        update.sourceIntegrity = sourceIntegrity;
        update.sourceIntegrityCheckedAt = now;
        update.sourceIntegrityCheckedBy = access.decoded.uid;
        update.sourceIntegrityCheckedByName = access.actorName;
      }
      if (decision === "return") {
        update.status = "draft";
        update.preparationStatus = "validation_editing";
        update.technicalAttestations = null;
        update.fieldPreparationTestedAt = null;
        update.fieldPreparationTestedBy = null;
        update.fieldPreparationTestedByName = null;
        update.returnedForAdjustmentsAt = now;
        update.returnedForAdjustmentsBy = access.decoded.uid;
        update.returnedForAdjustmentsByName = access.actorName;
      }
      if (body.status === "published") {
        update.status = "published";
        update.publishedAt = now;
        update.publishedBy = access.decoded.uid;
        update.publishedByName = access.actorName;
        update.homologatedAt = now;
        update.homologatedBy = access.decoded.uid;
        update.homologatedByName = access.actorName;
      }
      const batch = dbAdmin.batch();
      batch.update(candidateReference, update);
      if (body.status === "published") {
        const sourceId = String(
          currentDocument.get("derivedFromTemplateId")
          ?? currentDocument.get("derivedFromSystemTemplateId"),
        );
        const sourceTemplate = systemDocumentTemplateById(sourceId);
        const supersessionNote = `Substituído pela versão ${currentDocument.get("version")} (${id}).`;
        if (sourceTemplate) {
          const sourceStateReference = dbAdmin.collection(SYSTEM_TEMPLATE_WORKFLOW_COLLECTION).doc(sourceId);
          const sourceState = await sourceStateReference.get();
          const sourceStoredStatus = sourceState.get("status");
          const sourceStatus = isDocumentTemplateWorkflowStatus(sourceStoredStatus)
            ? sourceStoredStatus
            : defaultSystemTemplateWorkflowStatus(sourceTemplate);
          batch.set(sourceStateReference, {
            status: "superseded",
            note: supersessionNote,
            supersededByTemplateId: id,
            updatedAt: now,
            updatedBy: access.decoded.uid,
            updatedByName: access.actorName,
            history: FieldValue.arrayUnion({
              from: sourceStatus,
              to: "superseded",
              note: supersessionNote,
              actorId: access.decoded.uid,
              actorName: access.actorName,
              at: now,
            }),
          }, { merge: true });
        } else {
          const sourceReference = dbAdmin.collection("companyDocumentTemplates").doc(sourceId);
          const sourceDocument = await sourceReference.get();
          if (
            !sourceDocument.exists
            || sourceDocument.get("officialCandidate") !== true
            || sourceDocument.get("status") !== "published"
          ) {
            return NextResponse.json({ error: "A versão oficial de origem não está mais publicada." }, { status: 409 });
          }
          batch.update(sourceReference, {
            status: "draft",
            workflowStatus: "superseded",
            workflowNote: supersessionNote,
            supersededByTemplateId: id,
            workflowUpdatedAt: now,
            workflowUpdatedBy: access.decoded.uid,
            workflowUpdatedByName: access.actorName,
            workflowHistory: FieldValue.arrayUnion({
              from: "published",
              to: "superseded",
              note: supersessionNote,
              actorId: access.decoded.uid,
              actorName: access.actorName,
              at: now,
            }),
            updatedAt: now,
            updatedBy: access.decoded.uid,
            updatedByName: access.actorName,
          });
        }
      }
      await batch.commit();
    }
    const historyField = template ? "history" : "workflowHistory";
    return NextResponse.json({
      workflow: serializeHrValue({
        status: body.status,
        note,
        updatedAt: now,
        updatedByName: access.actorName,
        history: [...(Array.isArray(currentDocument.get(historyField)) ? currentDocument.get(historyField) : []), event],
      }),
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Falha ao atualizar o modelo." },
      { status: 403 },
    );
  }
}
