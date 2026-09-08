import "server-only";

import { createHash } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type {
  CardStatementImportPreview,
  CardStatementPreviousImportLine,
  CardStatementRevisionPreview,
} from "@/features/financial/lib/card-statement-import";
import { diffCardStatementRevision } from "@/features/financial/lib/card-statement-revisions";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";

type RawRecord = Record<string, any>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value: unknown) {
  const date = value && typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : value ? new Date(value as string) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function cleanExtension(fileName: string, contentType: string) {
  const extension = fileName.split(".").pop()?.toLocaleLowerCase("pt-BR");
  if (extension === "pdf" || extension === "csv") return extension;
  return contentType === "application/pdf" ? "pdf" : "csv";
}

export function cardStatementDocumentId(statementKey: string) {
  return statementKey.replaceAll(":", "__").replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function cardStatementImportFileHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function cardStatementImportId(statementKey: string, fileSha256: string, previousImportId: string | null = null) {
  return `import_${createHash("sha256").update(`${statementKey}|${fileSha256}|${previousImportId || "initial"}`).digest("hex").slice(0, 32)}`;
}

function previousLinesFromLegacy(statement: RawRecord, expenses: Array<{ id: string; data: RawRecord }>) {
  const allocations = Array.isArray(statement.allocations) ? statement.allocations as RawRecord[] : [];
  return expenses.flatMap(({ id, data }): CardStatementPreviousImportLine[] => {
    if (data.cardStatementRevisionStatus === "removed") return [];
    const fingerprints = [...new Set([
      text(data.cardStatementImportFingerprint),
      ...(Array.isArray(data.cardStatementImportFingerprints) ? data.cardStatementImportFingerprints.map(text) : []),
    ].filter(Boolean))];
    if (!fingerprints.length) return [];
    const matchingAllocations = allocations.filter((allocation) => text(allocation.expenseId) === id);
    const allocation = matchingAllocations[0] ?? {};
    const installmentNumber = number(allocation.installmentNumber) || number(data.installmentNumber) || null;
    return fingerprints.slice(-1).map((fingerprint) => ({
      fingerprint,
      sourceReference: text(data.cardStatementImportSourceReference) || text(allocation.sourceReference) || fingerprint,
      date: text(data.originalCardChargeDate) || dateKey(data.cardChargeDate),
      description: text(allocation.description) || text(data.description),
      supplier: text(allocation.supplier) || text(data.supplier),
      amount: number(allocation.amount) || number(data.totalValue),
      installmentNumber,
      installmentTotal: number(data.installmentTotal) || null,
      expenseId: id,
      lineId: text(allocation.lineId) || (installmentNumber ? `${id}:installment:${installmentNumber}` : id),
    }));
  });
}

function storedPreviousLines(value: unknown): CardStatementPreviousImportLine[] {
  return (Array.isArray(value) ? value : []).flatMap((entry): CardStatementPreviousImportLine[] => {
    const line = entry && typeof entry === "object" ? entry as RawRecord : {};
    const fingerprint = text(line.fingerprint);
    const expenseId = text(line.expenseId);
    const lineId = text(line.lineId);
    if (!fingerprint || !expenseId || !lineId) return [];
    return [{
      fingerprint,
      sourceReference: text(line.sourceReference) || fingerprint,
      date: text(line.date),
      description: text(line.description),
      supplier: text(line.supplier),
      amount: number(line.amount),
      installmentNumber: number(line.installmentNumber) || null,
      installmentTotal: number(line.installmentTotal) || null,
      expenseId,
      lineId,
    }];
  });
}

function plainPreview(preview: CardStatementImportPreview) {
  const { revision: _revision, ...base } = preview;
  return JSON.parse(JSON.stringify(base)) as CardStatementImportPreview;
}

export async function getCachedCardStatementPreview(params: {
  statementKey: string;
  fileSha256: string;
}) {
  const statementId = cardStatementDocumentId(params.statementKey);
  const statementRef = financialDbAdmin.collection("cardStatements").doc(statementId);
  const statementSnapshot = await statementRef.get();
  const activeImportId = text(statementSnapshot.data()?.activeImportId) || null;
  const importId = activeImportId && text(statementSnapshot.data()?.activeImportFileSha256) === params.fileSha256
    ? activeImportId
    : cardStatementImportId(params.statementKey, params.fileSha256, activeImportId);
  const snapshot = await statementRef.collection("imports").doc(importId).get();
  const preview = snapshot.data()?.preview;
  return preview && typeof preview === "object" ? preview as CardStatementImportPreview : null;
}

export async function prepareVersionedCardStatementPreview(params: {
  statementKey: string;
  accountId: string;
  accountName?: string;
  paymentMethodId: string;
  paymentMethodLabel?: string;
  monthKey: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
  preview: CardStatementImportPreview;
  actorId: string;
}) {
  const statementId = cardStatementDocumentId(params.statementKey);
  const fileSha256 = cardStatementImportFileHash(params.buffer);
  const extension = cleanExtension(params.fileName, params.contentType);
  const statementRef = financialDbAdmin.collection("cardStatements").doc(statementId);
  const now = Timestamp.now();
  const basePreview = plainPreview(params.preview);

  const prepared = await financialDbAdmin.runTransaction(async (transaction) => {
    const statementSnapshot = await transaction.get(statementRef);
    const statement = statementSnapshot.data() ?? {};
    const previousImportId = text(statement.activeImportId) || null;
    const exactActiveFile = previousImportId && text(statement.activeImportFileSha256) === fileSha256;
    const importId = exactActiveFile
      ? previousImportId
      : cardStatementImportId(params.statementKey, fileSha256, previousImportId);
    const importRef = statementRef.collection("imports").doc(importId);
    const currentImportSnapshot = await transaction.get(importRef);
    const previousImportSnapshot = previousImportId && previousImportId !== importId
      ? await transaction.get(statementRef.collection("imports").doc(previousImportId))
      : currentImportSnapshot;
    let previousLines = storedPreviousLines(previousImportSnapshot.data()?.appliedLines);
    if (!previousLines.length && !previousImportId) {
      const legacySnapshot = await transaction.get(
        financialDbAdmin.collection("expenses").where("cardStatementKey", "==", params.statementKey).limit(500),
      );
      previousLines = previousLinesFromLegacy(
        statement,
        legacySnapshot.docs.map((document) => ({ id: document.id, data: document.data() ?? {} })),
      );
    }

    const diff = diffCardStatementRevision(basePreview.transactions, previousLines);
    const statementStatus = statement.status === "open" || statement.status === "closed" || statement.status === "paid"
      ? statement.status
      : null;
    const exactFileReimport = Boolean(exactActiveFile);
    const previousTotal = number(statement.officialTotal) || previousLines.reduce((total, line) => total + line.amount, 0);
    const nextTotal = number(basePreview.officialTotal) || number(basePreview.analysis.includedTotal);
    const difference = Number((nextTotal - previousTotal).toFixed(2));
    const adjustment: CardStatementRevisionPreview["adjustment"] = statementStatus === "paid" && diff.hasChanges
      ? {
          kind: difference > 0 ? "additional_charge" : difference < 0 ? "credit" : "allocation_revision",
          amount: Math.abs(difference),
        }
      : null;
    const version = currentImportSnapshot.exists
      ? number(currentImportSnapshot.data()?.version) || 1
      : number(statement.importVersionCounter) + 1;
    const revision: CardStatementRevisionPreview = {
      ...diff,
      importId,
      fileSha256,
      version,
      previousImportId,
      statementStatus,
      exactFileReimport,
      requiresReopen: statementStatus === "closed" && diff.hasChanges,
      blockedReason: statementStatus === "paid" && diff.hasChanges ? "paid_statement" : null,
      adjustment,
    };
    const currentStatus = text(currentImportSnapshot.data()?.status);
    const previewStatus = revision.blockedReason
      ? "blocked_paid_revision"
      : exactFileReimport && !diff.hasChanges
        ? "duplicate"
        : "preview_ready";
    const storagePath = `financial/card-statements/${statementId}/imports/${importId}/original.${extension}`;

    transaction.set(importRef, {
      statementId,
      statementKey: params.statementKey,
      accountId: params.accountId,
      accountName: params.accountName || null,
      paymentMethodId: params.paymentMethodId,
      paymentMethodLabel: params.paymentMethodLabel || null,
      monthKey: params.monthKey,
      version,
      fileName: params.fileName,
      contentType: params.contentType,
      fileSize: params.buffer.length,
      fileSha256,
      storagePath,
      archiveStatus: "pending",
      preview: basePreview,
      previousImportId,
      previousLines,
      diff,
      revisionState: {
        statementStatus,
        exactFileReimport,
        requiresReopen: revision.requiresReopen,
        blockedReason: revision.blockedReason,
        adjustment,
        summary: diff.summary,
      },
      previewStatus,
      status: currentStatus === "applied" ? "applied" : previewStatus,
      previewedAt: now,
      previewedBy: params.actorId,
      previewCount: FieldValue.increment(1),
      updatedAt: now,
      ...(!currentImportSnapshot.exists ? { createdAt: now, createdBy: params.actorId } : {}),
    }, { merge: true });
    transaction.set(statementRef, {
      key: params.statementKey,
      monthKey: params.monthKey,
      accountId: params.accountId,
      accountName: params.accountName || statement.accountName || null,
      paymentMethodId: params.paymentMethodId,
      paymentMethodLabel: params.paymentMethodLabel || statement.paymentMethodLabel || null,
      ...(!currentImportSnapshot.exists ? { importVersionCounter: version } : {}),
      updatedAt: now,
      ...(!statementSnapshot.exists ? { createdAt: now, createdBy: params.actorId } : {}),
    }, { merge: true });

    return {
      preview: { ...basePreview, revision } satisfies CardStatementImportPreview,
      importId,
      storagePath,
    };
  });

  const importRef = statementRef.collection("imports").doc(prepared.importId);
  try {
    const storedFile = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(prepared.storagePath);
    const [fileExists] = await storedFile.exists();
    if (!fileExists) {
      await storedFile.save(params.buffer, {
        resumable: false,
        validation: "crc32c",
        contentType: params.contentType || (extension === "pdf" ? "application/pdf" : "text/csv"),
        metadata: {
          cacheControl: "private, max-age=0, no-store",
          metadata: { sha256: fileSha256, statementId, importId: prepared.importId },
        },
      });
    }
    await importRef.set({
      archiveStatus: "stored",
      archivedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  } catch (error) {
    await importRef.set({
      archiveStatus: "failed",
      archiveFailedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true }).catch(() => undefined);
    throw error;
  }
  return prepared.preview;
}
