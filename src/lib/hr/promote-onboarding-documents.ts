import "server-only";

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { getDocumentTypeConfig } from "@/lib/hr/employee-document-catalog";
import {
  resolveDocumentDestination,
  resolveDuplicateAndVersion,
  type ExistingDocumentRef,
} from "@/lib/hr/employee-document-distribution";
import { employeeCodeFrom, hashBuffer, loadExpectedIdentity } from "@/lib/hr/employee-document-identity";
import { fileExtension } from "@/lib/hr/employee-document-planning";
import { onboardingDocumentTypeCode } from "@/lib/hr/onboarding-document-classification";
import type { OnboardingDocument } from "@/types";

const COLLECTION = "employeeDocuments";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function deterministicDocumentId(onboardingId: string, onboardingDocumentId: string) {
  return createHash("sha256")
    .update(`onboarding:${onboardingId}:${onboardingDocumentId}`)
    .digest("hex")
    .slice(0, 32);
}

function timestampFromIso(value: string | null | undefined, fallback: Timestamp) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? Timestamp.fromDate(date) : fallback;
}

function originalNameFromPath(path: string) {
  const lastSegment = path.split("/").pop() ?? "documento";
  const match = lastSegment.match(/^\d+-[a-f0-9-]{36}-(.+)$/i);
  return (match?.[1] ?? lastSegment).slice(0, 180);
}

function extractedFieldsFor(document: OnboardingDocument, process: Record<string, unknown>) {
  const fields = { ...(document.extractedFields ?? {}) } as Record<string, unknown>;
  if (!fields.employeeName && asString(process.candidateName)) fields.employeeName = asString(process.candidateName);

  const childMatch = document.id.match(/^child_(\d+)_/);
  if (childMatch) {
    const childIndex = Number(childMatch[1]) - 1;
    const answers = asRecord(process.publicFormAnswers);
    const children = Array.isArray(answers.children) ? answers.children : [];
    const child = asRecord(children[childIndex]);
    fields.dependentName ??= `Filho ${childIndex + 1}`;
    fields.dependentBirthDate ??= asString(child.birthDate);
  }
  return fields;
}

async function removeOnboardingSource(path: string | null) {
  if (!path?.startsWith("hr/onboarding/")) return;
  await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(path)
    .delete({ ignoreNotFound: true });
}

export type PromoteOnboardingDocumentsResult = {
  documents: OnboardingDocument[];
  promotedDocumentIds: string[];
  promotedCount: number;
  duplicateCount: number;
};

export async function promoteApprovedOnboardingDocuments(params: {
  onboardingId: string;
  employeeId: string;
  process: Record<string, unknown>;
  actorId: string;
  actorName: string;
}): Promise<PromoteOnboardingDocumentsResult> {
  const documents = Array.isArray(params.process.documents)
    ? params.process.documents as OnboardingDocument[]
    : [];
  const approved = documents.filter((document) => document.status === "approved" && document.promotedDocumentId == null);
  const promotedByOnboardingId = new Map<string, { documentId: string; promotedAt: string }>();
  const promotedDocumentIds: string[] = [];
  let duplicateCount = 0;

  const existingSnap = await hrDbAdmin.collection(COLLECTION).where("employeeId", "==", params.employeeId).get();
  const existing: ExistingDocumentRef[] = existingSnap.docs
    .filter((doc) => !doc.get("deletedAt"))
    .map((doc) => ({
      id: doc.id,
      documentTypeCode: doc.get("documentTypeCode") ?? null,
      contentHash: doc.get("contentHash") ?? null,
      logicalKey: doc.get("logicalKey") ?? null,
      version: typeof doc.get("version") === "number" ? doc.get("version") : 1,
    }));
  const identity = await loadExpectedIdentity(params.employeeId);
  const employeeCode = employeeCodeFrom(identity, params.employeeId);
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);

  for (const document of approved) {
    const now = Timestamp.now();
    const promotedAt = now.toDate().toISOString();
    const documentId = deterministicDocumentId(params.onboardingId, document.id);
    const targetRef = hrDbAdmin.collection(COLLECTION).doc(documentId);
    const existingTarget = await targetRef.get();
    const sourcePath = asString(document.filePath);

    if (existingTarget.exists) {
      if (existingTarget.get("employeeId") !== params.employeeId) {
        throw new Error(`Documento de destino inválido para ${document.label}.`);
      }
      await removeOnboardingSource(sourcePath);
      promotedByOnboardingId.set(document.id, { documentId, promotedAt });
      promotedDocumentIds.push(documentId);
      continue;
    }

    if (!sourcePath?.startsWith("hr/onboarding/")) {
      throw new Error(`O arquivo aprovado “${document.label}” não está disponível para arquivamento.`);
    }

    const sourceFile = bucket.file(sourcePath);
    const [sourceExists] = await sourceFile.exists();
    if (!sourceExists) throw new Error(`O arquivo aprovado “${document.label}” não foi encontrado no armazenamento.`);

    const [[sourceBuffer], [sourceMetadata]] = await Promise.all([
      sourceFile.download(),
      sourceFile.getMetadata(),
    ]);
    const metadata = asRecord(sourceMetadata.metadata);
    const originalName = asString(metadata.originalName) ?? originalNameFromPath(sourcePath);
    const mimeType = asString(sourceMetadata.contentType) ?? "application/octet-stream";
    const contentHash = hashBuffer(sourceBuffer);
    const config = getDocumentTypeConfig(onboardingDocumentTypeCode(document));
    const fields = extractedFieldsFor(document, params.process);
    const dedupe = resolveDuplicateAndVersion({
      employeeId: params.employeeId,
      code: config.code,
      strategy: config.duplicateStrategy,
      keys: config.duplicateKeys,
      fields,
      contentHash,
      existing,
    });

    if (dedupe.resolution === "EXACT_DUPLICATE" && dedupe.existingDocumentId) {
      duplicateCount += 1;
      const duplicateRef = hrDbAdmin.collection(COLLECTION).doc(dedupe.existingDocumentId);
      await duplicateRef.collection("audit").add({
        action: "ONBOARDING_DUPLICATE_LINKED",
        actorId: params.actorId,
        actorName: params.actorName,
        onboardingId: params.onboardingId,
        onboardingDocumentId: document.id,
        sourcePath,
        at: now,
      });
      await removeOnboardingSource(sourcePath);
      promotedByOnboardingId.set(document.id, { documentId: dedupe.existingDocumentId, promotedAt });
      promotedDocumentIds.push(dedupe.existingDocumentId);
      continue;
    }

    const version = dedupe.version;
    const destination = resolveDocumentDestination({ config, employeeCode, fields, version });
    const extension = fileExtension(originalName, mimeType);
    const storageSubfolder = `hr/employee-documents/${params.employeeId}/documents/${documentId}`;
    const storagePath = `${storageSubfolder}/versions/${String(version).padStart(2, "0")}/original.${extension}`;
    await bucket.file(storagePath).save(sourceBuffer, {
      resumable: false,
      metadata: {
        contentType: mimeType,
        cacheControl: "private, max-age=0, no-store",
        metadata: {
          employeeId: params.employeeId,
          documentId,
          onboardingId: params.onboardingId,
          onboardingDocumentId: document.id,
        },
      },
    });

    const uploadedAt = timestampFromIso(document.receivedAt, now);
    const payload = {
      employeeId: params.employeeId,
      candidateId: asString(params.process.candidateId),
      category: config.category,
      documentType: config.label,
      documentTypeCode: config.code,
      accessLevel: config.defaultAccessLevel,
      accessPolicyId: config.accessPolicyId,
      status: "validated",
      folderCode: destination.folderCode,
      caseId: destination.caseId,
      subcaseId: destination.subcaseId,
      destinationTrail: destination.pathSegments,
      displayName: destination.displayName,
      storedName: destination.downloadName,
      contentHash,
      hashAlgorithm: "sha256",
      logicalKey: dedupe.logicalKey,
      version,
      versionResolution: dedupe.resolution,
      extractedFields: fields,
      fieldConfidences: document.fieldConfidences ?? {},
      originalName,
      mimeType,
      size: Number(sourceMetadata.size ?? sourceBuffer.byteLength),
      storagePath,
      storageSubfolder,
      uploadedBy: asString(params.process.candidateId) ?? `onboarding:${params.onboardingId}`,
      uploadedByName: asString(params.process.candidateName) ?? "Candidato",
      validatedBy: params.actorId,
      validatedByName: params.actorName,
      validatedAt: now,
      uploadedAt,
      updatedAt: now,
      accessCount: 0,
      deletedAt: null,
      source: "recruitment_onboarding",
      sourceOnboardingId: params.onboardingId,
      sourceOnboardingDocumentId: document.id,
      sourceStoragePath: sourcePath,
      sourceStatus: document.status,
      promotedAt: now,
      promotedBy: params.actorId,
    };
    await targetRef.set(payload);
    await targetRef.collection("audit").add({
      action: "ONBOARDING_DOCUMENT_PROMOTED",
      actorId: params.actorId,
      actorName: params.actorName,
      onboardingId: params.onboardingId,
      onboardingDocumentId: document.id,
      documentTypeCode: config.code,
      version,
      accessPolicyId: config.accessPolicyId,
      sourcePath,
      at: now,
    });
    await removeOnboardingSource(sourcePath);

    existing.push({
      id: documentId,
      documentTypeCode: config.code,
      contentHash,
      logicalKey: dedupe.logicalKey,
      version,
    });
    promotedByOnboardingId.set(document.id, { documentId, promotedAt });
    promotedDocumentIds.push(documentId);
  }

  const nextDocuments = documents.map((document) => {
    const promotion = promotedByOnboardingId.get(document.id);
    if (!promotion) return document;
    return {
      ...document,
      fileUrl: null,
      filePath: null,
      promotedDocumentId: promotion.documentId,
      promotedAt: promotion.promotedAt,
      promotedBy: params.actorId,
    };
  });

  return {
    documents: nextDocuments,
    promotedDocumentIds: Array.from(new Set(promotedDocumentIds)),
    promotedCount: promotedByOnboardingId.size,
    duplicateCount,
  };
}
