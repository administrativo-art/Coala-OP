import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { analyzeEmployeeDocumentWithAi } from "@/lib/hr/employee-document-ai";
import {
  isAllowedEmployeeDocumentMimeType,
  MAX_EMPLOYEE_DOCUMENT_BYTES,
  fileExtension,
} from "@/lib/hr/employee-document-planning";
import {
  matchEmployeeAgainstExpected,
  type EmployeeMatchStatus,
} from "@/lib/hr/employee-document-match";
import { getDocumentTypeConfig, missingCriticalFields } from "@/lib/hr/employee-document-catalog";
import {
  resolveDocumentDestination,
  resolveDuplicateAndVersion,
  type ExistingDocumentRef,
} from "@/lib/hr/employee-document-distribution";
import { decideDocumentAction } from "@/lib/hr/employee-document-decision";
import {
  findEmployeeIdentityByExtractedIdentity,
  loadExpectedIdentity,
  employeeCodeFrom,
  hashBuffer,
} from "@/lib/hr/employee-document-identity";
import {
  computeBatchCounters,
  deriveBatchStatus,
  type UploadItemStatus,
} from "@/lib/hr/employee-document-batch";
import { buildEmployeeProfileSuggestions } from "@/lib/hr/employee-document-profile-suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCHES = "documentUploadBatches";
const ITEMS = "documentUploadItems";
const COLLECTION = "employeeDocuments";
const BATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function tsToIso(value: unknown): string | null {
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
function text(value: FormDataEntryValue | null, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Analisa um lote: o usuário só anexa arquivos. Cada arquivo vira um ITEM
 * persistido, com o binário na área TEMPORÁRIA. A IA identifica o tipo e extrai
 * dados; o BACKEND decide o vínculo (match determinístico), o destino, o nome, o
 * acesso e a situação — tudo persistido no item. O arquivamento (confirm) lê o
 * item do servidor, não confia em nada do cliente.
 */
async function analyzeFreeBatch(request: NextRequest, access: Awaited<ReturnType<typeof assertHrAccess>>) {
  const form = await request.formData();
  const employeeId = text(form.get("employeeId"), 128);
  const employeeName = text(form.get("employeeName"), 160);
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);

  if (!employeeId || files.length === 0) {
    return error("Informe o colaborador e selecione ao menos um arquivo.");
  }

  const batchId = randomUUID();
  const traceId = randomUUID();
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const expectedIdentity = await loadExpectedIdentity(employeeId);
  const employeeCode = employeeCodeFrom(expectedIdentity, employeeId);
  const now = Timestamp.now();

  // Documentos que o colaborador JÁ tem — base para avisar duplicidade na prévia.
  const existingSnap = await hrDbAdmin.collection(COLLECTION).where("employeeId", "==", employeeId).get();
  const existingDocs = existingSnap.docs.filter((d) => !d.get("deletedAt"));
  const existingRefs: ExistingDocumentRef[] = existingDocs.map((d) => ({
    id: d.id,
    documentTypeCode: d.get("documentTypeCode") ?? null,
    contentHash: d.get("contentHash") ?? null,
    logicalKey: d.get("logicalKey") ?? null,
    version: typeof d.get("version") === "number" ? d.get("version") : 1,
  }));
  const existingById = new Map(existingDocs.map((d) => [d.id, d]));
  const summarize = (id: string | null) => {
    if (!id) return null;
    const d = existingById.get(id);
    if (!d) return null;
    return {
      id: d.id,
      documentType: d.get("documentType") ?? null,
      storedName: d.get("storedName") ?? d.get("displayName") ?? null,
      version: typeof d.get("version") === "number" ? d.get("version") : 1,
      uploadedAt: tsToIso(d.get("uploadedAt")),
    };
  };

  const responseDocs = [];
  const itemStatuses: { status: UploadItemStatus }[] = [];
  const batchHashSeen = new Map<string, { itemId: string; originalName: string }>();

  for (const [fileIndex, file] of files.entries()) {
    const itemId = randomUUID();
    const documentId = itemId; // id estável do futuro documento
    const fileErrors: string[] = [];
    if (!isAllowedEmployeeDocumentMimeType(file.type)) fileErrors.push("Formato não permitido.");
    if (file.size <= 0) fileErrors.push("Arquivo vazio.");
    if (file.size > MAX_EMPLOYEE_DOCUMENT_BYTES) fileErrors.push("Arquivo acima de 15 MB.");

    // Sobe o binário para a ÁREA TEMPORÁRIA (Fase 8) — nunca ao destino ainda.
    const ext = fileExtension(file.name, file.type);
    const tempStoragePath = `hr/pending-document-batches/${batchId}/items/${itemId}/original.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentHash = hashBuffer(buffer);
    const duplicateInCurrentBatch = fileErrors.length === 0 ? batchHashSeen.get(contentHash) ?? null : null;
    if (fileErrors.length === 0 && !duplicateInCurrentBatch) {
      batchHashSeen.set(contentHash, { itemId, originalName: file.name });
    }
    if (fileErrors.length === 0) {
      await bucket.file(tempStoragePath).save(buffer, {
        resumable: false,
        metadata: { contentType: file.type, cacheControl: "private, max-age=0, no-store", metadata: { batchId, itemId } },
      });
    }

    const analysisStartedAt = Date.now();
    const ai = fileErrors.length === 0
      ? await analyzeEmployeeDocumentWithAi({ file, expectedEmployeeName: employeeName })
      : null;
    const analysisDurationMs = Date.now() - analysisStartedAt;
    const config = getDocumentTypeConfig(ai?.documentTypeCode ?? "UNKNOWN_DOCUMENT");
    const fields = ai?.extractedFields ?? {};
    const fieldConfidences = ai?.fieldConfidences ?? {};

    const extractedIdentity = {
      cpf: asString(fields.cpf),
      registrationNumber: asString(fields.registrationNumber),
      name: ai?.identifiedEmployeeName ?? asString(fields.employeeName),
      birthDate: asString(fields.birthDate),
      admissionDate: asString(fields.admissionDate),
    };
    const backendMatch = ai && expectedIdentity
      ? matchEmployeeAgainstExpected({
          extracted: extractedIdentity,
          expected: expectedIdentity,
        })
      : { status: "UNKNOWN" as EmployeeMatchStatus, reason: expectedIdentity ? "Sem análise de IA." : "Colaborador não localizado no RH.", matchedBy: "NONE" as const };
    const locatedEmployee = ai ? await findEmployeeIdentityByExtractedIdentity(extractedIdentity, employeeId) : null;
    let employeeMatchStatus = backendMatch.status;
    let employeeMatchReason = backendMatch.reason;
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
      userHasPermission: true,
      fileSafe: fileErrors.length === 0,
      duplicateResolution: "NEW_DOCUMENT",
      employeeMatchStatus,
      multipleDocumentsDetected: ai?.structure.multipleDocumentsDetected ?? false,
      legibility: ai?.structure.legibility ?? "PARTIAL",
      documentTypeCode: config.code,
      missingCriticalFields: missingCriticalFields(config, fields, fieldConfidences),
      documentTypeConfidence: ai?.documentTypeConfidence ?? 0,
      confirmationThreshold: config.confirmationThreshold,
    });
    // Duplicidade: o colaborador já tem esse documento? (não descarta — só avisa)
    const dedupe = ai && employeeMatchStatus !== "MISMATCH"
      ? resolveDuplicateAndVersion({
          employeeId, code: config.code, strategy: config.duplicateStrategy,
          keys: config.duplicateKeys, fields, contentHash, existing: existingRefs,
        })
      : { resolution: "NEW_DOCUMENT" as const, version: 1, existingDocumentId: null, logicalKey: "" };
    const profileSuggestions = ai && employeeMatchStatus !== "MISMATCH"
      ? await buildEmployeeProfileSuggestions({ employeeId, documentTypeCode: config.code, extractedFields: fields, fieldConfidences })
      : [];
    const requiresDuplicateReview =
      duplicateInCurrentBatch != null ||
      dedupe.resolution === "EXACT_DUPLICATE" ||
      dedupe.resolution === "POSSIBLE_DUPLICATE";
    const existingDocument = duplicateInCurrentBatch ? null : summarize(dedupe.existingDocumentId);
    const duplicateResolution = duplicateInCurrentBatch ? "EXACT_DUPLICATE" : dedupe.resolution;
    const duplicateWarnings = duplicateInCurrentBatch
      ? [`Arquivo idêntico já selecionado neste lote: ${duplicateInCurrentBatch.originalName}. Descarte este item ou mantenha apenas um arquivo.`]
      : [];

    // Duplicata exata/ambígua exige revisão. Nova versão lógica é arquivável:
    // o confirm reserva o próximo número de versão transacionalmente.
    let itemStatus = decision.status as UploadItemStatus;
    if (requiresDuplicateReview && itemStatus === "ready") itemStatus = "review";
    itemStatuses.push({ status: itemStatus });

    const itemPayload = {
      batchId,
      traceId,
      employeeId,
      documentId,
      status: itemStatus,
      analysisDurationMs,
      analysisStartedAt: Timestamp.fromMillis(analysisStartedAt),
      decisionAction: decision.action,
      decisionReason: decision.reason,
      originalName: file.name.slice(0, 180),
      mimeType: file.type,
      size: file.size,
      tempStoragePath: fileErrors.length === 0 ? tempStoragePath : null,
      contentHash,
      documentTypeCode: config.code,
      category: config.category,
      accessPolicyId: config.accessPolicyId,
      confidence: ai?.documentTypeConfidence ?? 0,
      employeeMatchStatus,
      employeeMatchReason,
      suggestedEmployeeId,
      suggestedEmployeeName,
      aiEmployeeMatchStatus: ai?.employeeMatchStatus ?? "UNKNOWN",
      identifiedEmployeeName: ai?.identifiedEmployeeName ?? null,
      extractedFields: fields,
      fieldConfidences,
      profileSuggestions,
      structure: ai?.structure ?? { legibility: "PARTIAL", multipleDocumentsDetected: false, pageCount: null },
      destination,
      analysisProvider: ai?.provider ?? "local_fallback",
      analysisModel: ai?.model ?? "not-run",
      inputTokens: ai?.inputTokens ?? null,
      outputTokens: ai?.outputTokens ?? null,
      estimatedCostUsd: ai?.estimatedCostUsd ?? null,
      promptVersion: ai?.promptVersion ?? "employee-document-v2",
      schemaVersion: ai?.schemaVersion ?? "employee-document-analysis-v2",
      warnings: [...(ai?.warnings ?? []), ...duplicateWarnings],
      errors: [...fileErrors, ...(ai?.issues ?? [])],
      duplicateResolution,
      duplicateOfId: duplicateInCurrentBatch?.itemId ?? dedupe.existingDocumentId,
      duplicateOfItemId: duplicateInCurrentBatch?.itemId ?? null,
      duplicateOfName: duplicateInCurrentBatch?.originalName ?? null,
      existingDocument,
      filedDocumentId: null,
      createdAt: now,
      updatedAt: now,
    };
    await hrDbAdmin.collection(ITEMS).doc(itemId).set(itemPayload);
    await hrDbAdmin.collection(ITEMS).doc(itemId).collection("audit").add({
      action: "ITEM_ANALYZED", actorId: access.decoded.uid, traceId, documentTypeCode: config.code,
      employeeMatchStatus, decision: decision.action, analysisModel: itemPayload.analysisModel,
      analysisDurationMs, inputTokens: itemPayload.inputTokens, outputTokens: itemPayload.outputTokens,
      estimatedCostUsd: itemPayload.estimatedCostUsd, promptVersion: itemPayload.promptVersion,
      schemaVersion: itemPayload.schemaVersion, at: now,
    });

    responseDocs.push({
      clientFileId: `file-${fileIndex}`,
      itemId,
      documentId,
      category: config.category,
      documentType: config.label,
      documentTypeCode: config.code,
      accessLevel: config.defaultAccessLevel,
      accessPolicyId: config.accessPolicyId,
      originalName: file.name,
      size: file.size,
      mimeType: file.type,
      confidence: ai?.documentTypeConfidence ?? 0,
      status: itemStatus,
      action: decision.action,
      decisionReason: decision.reason,
      employeeId,
      employeeMatchStatus,
      employeeMatchReason,
      suggestedEmployeeId,
      suggestedEmployeeName,
      identifiedEmployeeName: ai?.identifiedEmployeeName ?? null,
      extractedFields: fields,
      fieldConfidences,
      profileSuggestions,
      structure: itemPayload.structure,
      analysisModel: itemPayload.analysisModel,
      warnings: itemPayload.warnings,
      errors: itemPayload.errors,
      fileName: destination.downloadName,
      displayName: destination.displayName,
      destinationTrail: destination.pathSegments,
      storageSubfolder: `hr/employee-documents/${employeeId}/documents/${documentId}`,
      duplicateResolution,
      duplicateInBatch: duplicateInCurrentBatch
        ? { itemId: duplicateInCurrentBatch.itemId, originalName: duplicateInCurrentBatch.originalName }
        : null,
      existingDocument,
    });
  }

  const counters = computeBatchCounters(itemStatuses);
  const batchStatus = deriveBatchStatus(counters);
  await hrDbAdmin.collection(BATCHES).doc(batchId).set({
    employeeId,
    entryPoint: "EMPLOYEE_PROFILE",
    traceId,
    status: batchStatus,
    ...counters,
    createdBy: access.decoded.uid,
    createdByName: access.actorName,
    createdAt: now,
    updatedAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + BATCH_TTL_MS),
  });
  await hrDbAdmin.collection(BATCHES).doc(batchId).collection("audit").add({
    action: "BATCH_CREATED", actorId: access.decoded.uid, traceId, totalFiles: counters.totalFiles, at: now,
  });

  return NextResponse.json({
    batchId,
    analysis: {
      batchId,
      batchStatus,
      totalFiles: counters.totalFiles,
      readyFiles: counters.readyFiles,
      reviewFiles: responseDocs.filter((d) => d.status === "review").length,
      blockedFiles: responseDocs.filter((d) => d.status === "blocked").length,
      totalBytes: responseDocs.reduce((sum, item) => sum + item.size, 0),
      documents: responseDocs,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "manage");
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return error("Envie os arquivos como multipart/form-data.");
    }
    return await analyzeFreeBatch(request, access);
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao analisar anexos.", 403);
  }
}
