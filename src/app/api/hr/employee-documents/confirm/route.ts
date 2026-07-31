import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { getDocumentTypeConfig } from "@/lib/hr/employee-document-catalog";
import {
  resolveDocumentDestination,
  resolveDuplicateAndVersion,
  buildLogicalKey,
  type ExistingDocumentRef,
} from "@/lib/hr/employee-document-distribution";
import { loadExpectedIdentity, employeeCodeFrom } from "@/lib/hr/employee-document-identity";
import type { ExpectedEmployeeIdentity } from "@/lib/hr/employee-document-match";
import {
  computeBatchCounters,
  deriveBatchStatus,
  type UploadItemStatus,
} from "@/lib/hr/employee-document-batch";
import { applyEmployeeProfileSuggestions } from "@/lib/hr/employee-document-profile-suggestions";
import { assertEmployeeUnitAccess } from "@/features/hr/lib/employee-document-access-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "employeeDocuments";
const BATCHES = "documentUploadBatches";
const ITEMS = "documentUploadItems";
const VERSION_COUNTERS = "documentVersionCounters";

function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
function pad2(n: number) { return String(n).padStart(2, "0"); }
function extOf(path: string, fallback = "bin") { return path.split(".").pop() || fallback; }

/**
 * Reserva o próximo número de versão de forma ATÔMICA (transação num contador
 * por chave lógica), evitando colisão em confirmações concorrentes.
 */
async function reserveVersion(logicalKey: string, documentId: string): Promise<number> {
  const keyId = createHash("sha256").update(logicalKey).digest("hex");
  const ref = hrDbAdmin.collection(VERSION_COUNTERS).doc(keyId);
  return hrDbAdmin.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists && typeof snap.get("version") === "number" ? snap.get("version") : 0) + 1;
    tx.set(ref, { logicalKey, version: next, lastDocumentId: documentId, updatedAt: Timestamp.now() }, { merge: true });
    return next;
  });
}

/**
 * Fase 7 — Confirma o arquivamento de um lote. Lê os ITENS persistidos (fonte
 * do servidor; o cliente não envia tipo/pasta/acesso/arquivo). Arquiva apenas os
 * itens 'ready', movendo do temporário para o definitivo (versão), atualiza os
 * contadores do lote (arquivamento parcial) e é idempotente por item.
 */
export async function POST(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "manage");
    const body = await request.json().catch(() => ({}));
    const batchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
    const onlyItemIds: string[] | null = Array.isArray(body.itemIds) ? body.itemIds.filter((x: unknown) => typeof x === "string") : null;
    if (!batchId) return error("Lote não informado.");

    const batchRef = hrDbAdmin.collection(BATCHES).doc(batchId);
    const batchSnap = await batchRef.get();
    if (!batchSnap.exists) return error("Lote não encontrado.", 404);

    const batchEmployeeId = String(batchSnap.get("employeeId") ?? "");
    await assertEmployeeUnitAccess(access, batchEmployeeId);
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);

    // Identidade resolvida POR colaborador do item (permite item redirecionado).
    const identityCache = new Map<string, ExpectedEmployeeIdentity | null>();
    const identityFor = async (empId: string) => {
      if (!identityCache.has(empId)) identityCache.set(empId, await loadExpectedIdentity(empId));
      return identityCache.get(empId) ?? null;
    };

    const itemsSnap = await hrDbAdmin.collection(ITEMS).where("batchId", "==", batchId).get();
    const targets = itemsSnap.docs.filter((d) => {
      if (d.get("status") !== "ready") return false;
      return !onlyItemIds || onlyItemIds.includes(d.id);
    });

    const filed: { itemId: string; documentId: string; version: number }[] = [];
    const failures: { itemId: string; error: string }[] = [];

    for (const itemDoc of targets) {
      const itemRef = itemDoc.ref;
      // Idempotência: só prossegue se o item ainda estiver 'ready' (lock → 'filing').
      const locked = await hrDbAdmin.runTransaction(async (tx) => {
        const fresh = await tx.get(itemRef);
        if (fresh.get("status") !== "ready") return false;
        tx.update(itemRef, { status: "filing", updatedAt: Timestamp.now() });
        return true;
      });
      if (!locked) continue;

      try {
        const item = itemDoc.data();
        if (item.employeeMatchStatus !== "MATCH") {
          throw new Error("Colaborador não confirmado para este item.");
        }
        const documentId = String(item.documentId ?? itemDoc.id);
        const employeeId = String(item.employeeId ?? batchEmployeeId);
        await assertEmployeeUnitAccess(access, employeeId);
        const identity = await identityFor(employeeId);
        const employeeCode = employeeCodeFrom(identity, employeeId);
        const config = getDocumentTypeConfig(item.documentTypeCode);
        const fields = (item.extractedFields && typeof item.extractedFields === "object" ? item.extractedFields : {}) as Record<string, unknown>;
        const tempPath = String(item.tempStoragePath ?? "");
        const contentHash = String(item.contentHash ?? "");
        if (!tempPath) throw new Error("Arquivo temporário ausente.");

        // Guard server-side: duplicata exata nunca deve gerar outro documento/versão,
        // mesmo que a prévia do cliente não tenha percebido.
        const existingSnap = await hrDbAdmin.collection(COLLECTION).where("employeeId", "==", employeeId).get();
        const existingRefs: ExistingDocumentRef[] = existingSnap.docs
          .filter((d) => !d.get("deletedAt"))
          .map((d) => ({
            id: d.id,
            documentTypeCode: d.get("documentTypeCode") ?? null,
            contentHash: d.get("contentHash") ?? null,
            logicalKey: d.get("logicalKey") ?? null,
            version: typeof d.get("version") === "number" ? d.get("version") : 1,
          }));
        const dedupe = resolveDuplicateAndVersion({
          employeeId,
          code: config.code,
          strategy: config.duplicateStrategy,
          keys: config.duplicateKeys,
          fields,
          contentHash,
          existing: existingRefs,
        });
        if (dedupe.resolution === "EXACT_DUPLICATE" && dedupe.existingDocumentId) {
          const now = Timestamp.now();
          await bucket.file(tempPath).delete({ ignoreNotFound: true });
          await itemRef.update({
            status: "duplicate",
            tempStoragePath: null,
            duplicateResolution: "EXACT_DUPLICATE",
            duplicateOfId: dedupe.existingDocumentId,
            filedDocumentId: dedupe.existingDocumentId,
            updatedAt: now,
          });
          await itemRef.collection("audit").add({
            action: "EXACT_DUPLICATE_BLOCKED",
            actorId: access.decoded.uid,
            duplicateOfId: dedupe.existingDocumentId,
            traceId: item.traceId ?? null,
            at: now,
          });
          continue;
        }

        // Reserva o número da versão de forma atômica (concorrência).
        const logicalKey = dedupe.logicalKey || buildLogicalKey(employeeId, config.code, config.duplicateKeys, fields);
        const version = await reserveVersion(logicalKey, documentId);
        const destination = resolveDocumentDestination({ config, employeeCode, fields, version });
        const ext = extOf(tempPath);
        const storageSubfolder = `hr/employee-documents/${employeeId}/documents/${documentId}`;
        const storagePath = `${storageSubfolder}/versions/${pad2(version)}/original.${ext}`;

        // Move do temporário para o definitivo (copia e remove o temp).
        await bucket.file(tempPath).copy(bucket.file(storagePath));

        const now = Timestamp.now();
        const profileSync = await applyEmployeeProfileSuggestions({
          employeeId,
          documentTypeCode: config.code,
          extractedFields: fields,
          fieldConfidences: item.fieldConfidences && typeof item.fieldConfidences === "object"
            ? item.fieldConfidences as Record<string, number>
            : {},
          actorId: access.decoded.uid,
          actorName: access.actorName,
          documentId,
          traceId: typeof item.traceId === "string" ? item.traceId : null,
        });
        const profileSuggestions = profileSync.suggestions.length > 0
          ? profileSync.suggestions
          : item.profileSuggestions ?? [];
        const profileAutofill = {
          filledFields: profileSync.filledFields,
          divergentFields: profileSync.divergentFields,
          matchingFields: profileSync.matchingFields,
          profileCompletion: profileSync.profileCompletion,
        };
        const autoValidated = item.decisionAction === "READY_TO_FILE" && item.decisionReason === "VALIDATED";
        const payload = {
          employeeId, candidateId: null,
          category: config.category, documentType: config.label, documentTypeCode: config.code,
          accessLevel: config.defaultAccessLevel, accessPolicyId: config.accessPolicyId,
          status: autoValidated ? "validated" : "received",
          validationSource: autoValidated ? "document_analysis" : null,
          folderCode: destination.folderCode, caseId: destination.caseId, subcaseId: destination.subcaseId,
          destinationTrail: destination.pathSegments, displayName: destination.displayName, storedName: destination.downloadName,
          contentHash, hashAlgorithm: "sha256", logicalKey, version,
          versionResolution: version > 1 ? "NEW_VERSION" : "NEW_DOCUMENT",
          extractedFields: fields,
          fieldConfidences: item.fieldConfidences ?? {},
          profileSuggestions,
          profileAutofill,
          inputTokens: item.inputTokens ?? null, outputTokens: item.outputTokens ?? null,
          estimatedCostUsd: item.estimatedCostUsd ?? null,
          promptVersion: item.promptVersion ?? null, schemaVersion: item.schemaVersion ?? null,
          originalName: String(item.originalName ?? "").slice(0, 180), mimeType: String(item.mimeType ?? ""), size: Number(item.size ?? 0),
          storagePath, storageSubfolder,
          batchId, itemId: itemDoc.id, traceId: item.traceId ?? null,
          uploadedBy: access.decoded.uid, uploadedByName: access.actorName,
          validatedBy: autoValidated ? "system:document-analysis" : null,
          validatedByName: autoValidated ? "Copiloto RH" : null,
          validatedAt: autoValidated ? now : null,
          uploadedAt: now, updatedAt: now,
          accessCount: 0, deletedAt: null,
        };
        await hrDbAdmin.collection(COLLECTION).doc(documentId).set(payload);
        await hrDbAdmin.collection(COLLECTION).doc(documentId).collection("audit").add({
          action: "DOCUMENT_FILED", actorId: access.decoded.uid, actorName: payload.uploadedByName,
          documentTypeCode: config.code, version, accessPolicyId: config.accessPolicyId, batchId,
          resultingStatus: payload.status, autoValidated,
          traceId: item.traceId ?? null, at: now,
        });
        if (autoValidated) {
          await hrDbAdmin.collection(COLLECTION).doc(documentId).collection("audit").add({
            action: "DOCUMENT_AUTO_VALIDATED",
            actorId: "system:document-analysis",
            actorName: "Copiloto RH",
            decisionAction: item.decisionAction,
            decisionReason: item.decisionReason,
            confidence: item.confidence ?? null,
            analysisModel: item.analysisModel ?? null,
            promptVersion: item.promptVersion ?? null,
            traceId: item.traceId ?? null,
            at: now,
          });
        }
        await bucket.file(tempPath).delete({ ignoreNotFound: true });
        await itemRef.update({ status: "filed", filedDocumentId: documentId, version, profileSuggestions, profileAutofill, updatedAt: now });
        filed.push({ itemId: itemDoc.id, documentId, version });
      } catch (cause) {
        await itemRef.update({ status: "failed", updatedAt: Timestamp.now(), lastError: cause instanceof Error ? cause.message.slice(0, 240) : "Falha ao arquivar." }).catch(() => {});
        failures.push({ itemId: itemDoc.id, error: cause instanceof Error ? cause.message : "Falha ao arquivar." });
      }
    }

    // Recalcula os contadores do lote a partir do estado real dos itens.
    const finalItems = await hrDbAdmin.collection(ITEMS).where("batchId", "==", batchId).get();
    const counters = computeBatchCounters(finalItems.docs.map((d) => ({ status: d.get("status") as UploadItemStatus })));
    const batchStatus = deriveBatchStatus(counters);
    await batchRef.update({ ...counters, status: batchStatus, updatedAt: Timestamp.now() });

    return NextResponse.json({ batchId, batchStatus, filed, failures, counters });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao arquivar lote.", 403);
  }
}
