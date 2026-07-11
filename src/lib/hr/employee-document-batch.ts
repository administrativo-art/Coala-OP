/**
 * Fase 7 — Lote e itens de importação (modelo + máquina de estados).
 *
 * Parte pura e testável: contadores do lote, derivação de status e guardas de
 * idempotência. A persistência (Firestore/Storage) vive nas rotas.
 */

export type UploadItemStatus =
  | "analyzing"
  | "ready"
  | "review"
  | "blocked"
  | "duplicate"
  | "filing"
  | "filed"
  | "failed";

export type UploadBatchStatus =
  | "ANALYZING"
  | "AWAITING_REVIEW"
  | "PARTIALLY_FILED"
  | "FILED"
  | "CANCELLED"
  | "FAILED";

export interface BatchCounters {
  totalFiles: number;
  analyzedFiles: number;
  readyFiles: number;
  pendingFiles: number;
  filedFiles: number;
  failedFiles: number;
}

/** Estados que aguardam ação humana (não prontos, não arquivados). */
const PENDING_STATUSES: UploadItemStatus[] = ["review", "blocked", "duplicate"];

export function computeBatchCounters(items: { status: UploadItemStatus }[]): BatchCounters {
  const count = (s: UploadItemStatus) => items.filter((i) => i.status === s).length;
  return {
    totalFiles: items.length,
    analyzedFiles: items.filter((i) => i.status !== "analyzing").length,
    readyFiles: count("ready"),
    pendingFiles: items.filter((i) => PENDING_STATUSES.includes(i.status)).length,
    filedFiles: count("filed"),
    failedFiles: count("failed"),
  };
}

export function deriveBatchStatus(counters: BatchCounters): UploadBatchStatus {
  const { totalFiles, analyzedFiles, readyFiles, pendingFiles, filedFiles, failedFiles } = counters;
  if (totalFiles === 0) return "AWAITING_REVIEW";
  if (analyzedFiles < totalFiles) return "ANALYZING";
  if (filedFiles > 0 && (readyFiles > 0 || pendingFiles > 0)) return "PARTIALLY_FILED";
  if (filedFiles > 0 && readyFiles === 0 && pendingFiles === 0) return "FILED";
  if (readyFiles > 0 || pendingFiles > 0) return "AWAITING_REVIEW";
  if (failedFiles === totalFiles) return "FAILED";
  return "AWAITING_REVIEW";
}

/** Idempotência: só arquiva item pronto que ainda não foi arquivado/está arquivando. */
export function canFileItem(item: { status: UploadItemStatus }): boolean {
  return item.status === "ready";
}
