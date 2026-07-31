import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { analyzeEmployeeDocumentWithAi } from "@/lib/hr/employee-document-ai";
import { getDocumentTypeConfig, missingCriticalFields } from "@/lib/hr/employee-document-catalog";
import { decideDocumentAction } from "@/lib/hr/employee-document-decision";
import { resolveDocumentDestination } from "@/lib/hr/employee-document-distribution";
import { employeeCodeFrom, findEmployeeIdentityByExtractedIdentity, loadExpectedIdentity } from "@/lib/hr/employee-document-identity";
import { matchEmployeeAgainstExpected, type EmployeeMatchStatus } from "@/lib/hr/employee-document-match";
import { computeBatchCounters, deriveBatchStatus, type UploadItemStatus } from "@/lib/hr/employee-document-batch";
import { buildEmployeeProfileSuggestions } from "@/lib/hr/employee-document-profile-suggestions";
import { assertEmployeeUnitAccess } from "@/features/hr/lib/employee-document-access-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCHES = "documentUploadBatches";
const ITEMS = "documentUploadItems";

function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Reanalisa um item a partir do binário temporário já persistido. */
export async function POST(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "manage");
    const body = await request.json().catch(() => ({}));
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    if (!itemId) return error("Item não informado.");

    const itemRef = hrDbAdmin.collection(ITEMS).doc(itemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) return error("Item não encontrado.", 404);
    const item = itemSnap.data() as Record<string, unknown>;
    if (["filed", "filing"].includes(String(item.status))) return error("Item já arquivado.");

    const tempStoragePath = asString(item.tempStoragePath);
    if (!tempStoragePath) return error("Arquivo temporário não está mais disponível.", 410);
    const employeeId = String(item.employeeId ?? "");
    if (!employeeId) return error("Colaborador do item não encontrado.");
    await assertEmployeeUnitAccess(access, employeeId);

    await itemRef.update({ status: "analyzing", updatedAt: Timestamp.now() });
    const file = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(tempStoragePath);
    const [downloadRes, metaRes] = await Promise.all([file.download(), file.getMetadata()]);
    const buffer = downloadRes[0];
    const originalName = String(item.originalName ?? "documento");
    const mimeType = String(metaRes[0]?.contentType ?? item.mimeType ?? "application/octet-stream");
    const analysisStartedAt = Date.now();
    const ai = await analyzeEmployeeDocumentWithAi({
      file: new File([new Uint8Array(buffer)], originalName, { type: mimeType }),
      expectedEmployeeName: null,
    });
    const analysisDurationMs = Date.now() - analysisStartedAt;
    const fields = ai.extractedFields;
    const config = getDocumentTypeConfig(ai.documentTypeCode);
    const identity = await loadExpectedIdentity(employeeId);
    const employeeCode = employeeCodeFrom(identity, employeeId);
    const extractedIdentity = {
      cpf: asString(fields.cpf),
      registrationNumber: asString(fields.registrationNumber),
      name: ai.identifiedEmployeeName ?? asString(fields.employeeName),
      birthDate: asString(fields.birthDate),
      admissionDate: asString(fields.admissionDate),
    };
    const match = identity
      ? matchEmployeeAgainstExpected({
          extracted: extractedIdentity,
          expected: identity,
        })
      : { status: "UNKNOWN" as EmployeeMatchStatus, reason: "Colaborador não localizado no RH.", matchedBy: "NONE" as const };
    const locatedEmployee = await findEmployeeIdentityByExtractedIdentity(extractedIdentity, employeeId);
    let employeeMatchStatus = match.status;
    let employeeMatchReason = match.reason;
    let suggestedEmployeeId: string | null = null;
    let suggestedEmployeeName: string | null = null;
    if (locatedEmployee && locatedEmployee.employeeId !== employeeId) {
      employeeMatchStatus = "MISMATCH";
      suggestedEmployeeId = locatedEmployee.employeeId;
      suggestedEmployeeName = locatedEmployee.name ?? null;
      employeeMatchReason = `Documento pertence a ${locatedEmployee.name ?? "outro colaborador"}, que possui cadastro no sistema. Confirme o direcionamento para o dossiê correto.`;
    } else if (locatedEmployee && locatedEmployee.employeeId === employeeId && employeeMatchStatus !== "MATCH") {
      employeeMatchStatus = "MATCH";
      employeeMatchReason = `${locatedEmployee.matchedBy === "CPF" ? "CPF" : locatedEmployee.matchedBy === "REGISTRATION" ? "Matrícula" : locatedEmployee.matchedBy === "NAME_BIRTH" ? "Nome e nascimento" : "Nome completo"} localizado no cadastro deste colaborador.`;
    }
    const destination = resolveDocumentDestination({ config, employeeCode, fields, version: 1 });
    const decision = decideDocumentAction({
      userHasPermission: true, fileSafe: true, duplicateResolution: "NEW_DOCUMENT",
      employeeMatchStatus, multipleDocumentsDetected: ai.structure.multipleDocumentsDetected,
      legibility: ai.structure.legibility, documentTypeCode: config.code,
      missingCriticalFields: missingCriticalFields(config, fields, ai.fieldConfidences),
      documentTypeConfidence: ai.documentTypeConfidence, confirmationThreshold: config.confirmationThreshold,
    });
    const profileSuggestions = employeeMatchStatus !== "MISMATCH"
      ? await buildEmployeeProfileSuggestions({ employeeId, documentTypeCode: config.code, extractedFields: fields, fieldConfidences: ai.fieldConfidences })
      : [];
    const now = Timestamp.now();
    await itemRef.update({
      status: decision.status, decisionAction: decision.action, decisionReason: decision.reason,
      analysisDurationMs, analysisStartedAt: Timestamp.fromMillis(analysisStartedAt),
      documentTypeCode: config.code, category: config.category, accessPolicyId: config.accessPolicyId,
      confidence: ai.documentTypeConfidence, employeeMatchStatus, employeeMatchReason,
      suggestedEmployeeId, suggestedEmployeeName,
      aiEmployeeMatchStatus: ai.employeeMatchStatus, identifiedEmployeeName: ai.identifiedEmployeeName ?? null,
      extractedFields: fields, fieldConfidences: ai.fieldConfidences, profileSuggestions, structure: ai.structure, destination,
      analysisProvider: ai.provider, analysisModel: ai.model, inputTokens: ai.inputTokens ?? null,
      outputTokens: ai.outputTokens ?? null, estimatedCostUsd: ai.estimatedCostUsd ?? null,
      promptVersion: ai.promptVersion, schemaVersion: ai.schemaVersion,
      warnings: ai.warnings, errors: ai.issues, reanalyzedBy: access.decoded.uid, reanalyzedAt: now, updatedAt: now,
    });
    await itemRef.collection("audit").add({
      action: "ITEM_REANALYZED", actorId: access.decoded.uid, traceId: item.traceId ?? null,
      documentTypeCode: config.code, employeeMatchStatus, decision: decision.action,
      inputTokens: ai.inputTokens ?? null, outputTokens: ai.outputTokens ?? null,
      estimatedCostUsd: ai.estimatedCostUsd ?? null, at: now,
    });

    const batchId = String(item.batchId ?? "");
    if (batchId) {
      const items = await hrDbAdmin.collection(ITEMS).where("batchId", "==", batchId).get();
      const counters = computeBatchCounters(items.docs.map((doc) => ({ status: doc.get("status") as UploadItemStatus })));
      await hrDbAdmin.collection(BATCHES).doc(batchId).update({ ...counters, status: deriveBatchStatus(counters), updatedAt: now });
    }

    return NextResponse.json({
      itemId, status: decision.status, action: decision.action, documentTypeCode: config.code,
      documentType: config.label, category: config.category, employeeMatchStatus,
      employeeMatchReason, suggestedEmployeeId, suggestedEmployeeName,
      decisionReason: decision.reason, destinationTrail: destination.pathSegments,
      fileName: destination.downloadName, fieldConfidences: ai.fieldConfidences, extractedFields: fields,
      profileSuggestions, warnings: ai.warnings, errors: ai.issues, analysisModel: ai.model,
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao reanalisar item.", 403);
  }
}
