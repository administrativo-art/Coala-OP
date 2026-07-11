import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { getDocumentTypeConfig, missingCriticalFields } from "@/lib/hr/employee-document-catalog";
import { resolveDocumentDestination } from "@/lib/hr/employee-document-distribution";
import { decideDocumentAction } from "@/lib/hr/employee-document-decision";
import { loadExpectedIdentity, employeeCodeFrom } from "@/lib/hr/employee-document-identity";
import { matchEmployeeAgainstExpected, type EmployeeMatchStatus } from "@/lib/hr/employee-document-match";
import {
  computeBatchCounters,
  deriveBatchStatus,
  type UploadItemStatus,
} from "@/lib/hr/employee-document-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCHES = "documentUploadBatches";
const ITEMS = "documentUploadItems";

function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Fase 9 — Correção de um item do lote. O usuário pode alterar o TIPO e/ou
 * redirecionar para outro COLABORADOR. O BACKEND recalcula match, destino, nome,
 * acesso e a situação (decisão). Trocar de colaborador exige justificativa e é
 * auditado. Não arquiva aqui — só reprepara o item.
 */
export async function PATCH(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "manage");
    const body = await request.json().catch(() => ({}));
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    const newTypeCode = typeof body.documentTypeCode === "string" ? body.documentTypeCode.trim() : "";
    const newEmployeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!itemId || (!newTypeCode && !newEmployeeId)) return error("Informe o item e o que corrigir (tipo e/ou colaborador).");

    const itemRef = hrDbAdmin.collection(ITEMS).doc(itemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) return error("Item não encontrado.", 404);
    const item = itemSnap.data() as Record<string, unknown>;
    if (["filed", "filing"].includes(String(item.status))) return error("Item já arquivado ou em arquivamento.");

    const fields = (item.extractedFields && typeof item.extractedFields === "object" ? item.extractedFields : {}) as Record<string, unknown>;
    const fieldConfidences = (item.fieldConfidences && typeof item.fieldConfidences === "object" ? item.fieldConfidences : {}) as Record<string, number>;
    const structure = (item.structure && typeof item.structure === "object" ? item.structure : {}) as { legibility?: string; multipleDocumentsDetected?: boolean };

    const currentEmployeeId = String(item.employeeId ?? "");
    const employeeChanged = !!newEmployeeId && newEmployeeId !== currentEmployeeId;
    if (employeeChanged && reason.length < 3) {
      return error("Trocar o colaborador exige uma justificativa.");
    }
    const employeeId = employeeChanged ? newEmployeeId : currentEmployeeId;
    const typeCode = newTypeCode || String(item.documentTypeCode ?? "UNKNOWN_DOCUMENT");

    const config = getDocumentTypeConfig(typeCode);
    const identity = await loadExpectedIdentity(employeeId);
    const employeeCode = employeeCodeFrom(identity, employeeId);

    // Se trocou de colaborador, o backend REVERIFICA o vínculo com o novo cadastro.
    let employeeMatchStatus = (item.employeeMatchStatus as EmployeeMatchStatus) ?? "UNKNOWN";
    let employeeMatchReason = asString(item.employeeMatchReason) ?? "";
    if (employeeChanged) {
      const match = identity
        ? matchEmployeeAgainstExpected({
            extracted: {
              cpf: asString(fields.cpf),
              registrationNumber: asString(fields.registrationNumber),
              name: asString(item.identifiedEmployeeName) ?? asString(fields.employeeName),
              birthDate: asString(fields.birthDate),
            },
            expected: identity,
          })
        : { status: "UNKNOWN" as EmployeeMatchStatus, reason: "Colaborador não localizado no RH.", matchedBy: "NONE" as const };
      employeeMatchStatus = match.status;
      employeeMatchReason = match.reason;
    }

    const destination = resolveDocumentDestination({ config, employeeCode, fields, version: 1 });
    const decision = decideDocumentAction({
      userHasPermission: true,
      fileSafe: !!item.tempStoragePath,
      duplicateResolution: "NEW_DOCUMENT",
      employeeMatchStatus,
      multipleDocumentsDetected: structure.multipleDocumentsDetected === true,
      legibility: (structure.legibility as "GOOD" | "PARTIAL" | "POOR") ?? "PARTIAL",
      documentTypeCode: config.code,
      missingCriticalFields: missingCriticalFields(config, fields, fieldConfidences),
      documentTypeConfidence: newTypeCode ? 0.9 : (typeof item.confidence === "number" ? item.confidence : 0.9),
      confirmationThreshold: config.confirmationThreshold,
    });

    const now = Timestamp.now();
    await itemRef.update({
      status: decision.status,
      decisionAction: decision.action,
      decisionReason: decision.reason,
      documentTypeCode: config.code,
      category: config.category,
      accessPolicyId: config.accessPolicyId,
      destination,
      employeeId,
      employeeMatchStatus,
      employeeMatchReason,
      correctedBy: access.decoded.uid,
      updatedAt: now,
    });
    if (newTypeCode) {
      await itemRef.collection("audit").add({
        action: "ITEM_CORRECTED", actorId: access.decoded.uid, traceId: item.traceId ?? null,
        documentTypeCode: config.code, decision: decision.action, at: now,
      });
    }
    if (employeeChanged) {
      await itemRef.collection("audit").add({
        action: "ITEM_EMPLOYEE_CHANGED", actorId: access.decoded.uid, traceId: item.traceId ?? null,
        fromEmployeeId: currentEmployeeId, toEmployeeId: employeeId, reason, employeeMatchStatus, at: now,
      });
    }

    // Recalcula contadores do lote.
    const batchId = String(item.batchId ?? "");
    if (batchId) {
      const itemsSnap = await hrDbAdmin.collection(ITEMS).where("batchId", "==", batchId).get();
      const counters = computeBatchCounters(itemsSnap.docs.map((d) => ({ status: d.get("status") as UploadItemStatus })));
      await hrDbAdmin.collection(BATCHES).doc(batchId).update({ ...counters, status: deriveBatchStatus(counters), updatedAt: now });
    }

    return NextResponse.json({
      itemId,
      status: decision.status,
      action: decision.action,
      documentTypeCode: config.code,
      documentType: config.label,
      category: config.category,
      employeeId,
      employeeMatchStatus,
      employeeMatchReason,
      decisionReason: decision.reason,
      destinationTrail: destination.pathSegments,
      displayName: destination.displayName,
      fileName: destination.downloadName,
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao corrigir item.", 403);
  }
}
