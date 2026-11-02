import { emptyDimensions, type CentralWorkItem } from "../types";

type UploadRecord = Record<string, unknown> & { id: string };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function uploadBatchItem(record: UploadRecord): CentralWorkItem | null {
  const status = text(record.status) ?? "review";
  if (["filed", "discarded", "cancelled"].includes(status.toLowerCase())) return null;
  const documentId = text(record.documentId) ?? record.id;
  const provider = text(record.analysisProvider);
  const analysisMethod = provider === "openai" ? "ai" : provider === "local_fallback" ? "rule" : "unknown";
  const errors = Array.isArray(record.errors) ? record.errors.map(String).filter(Boolean) : [];
  return {
    id: `employee_upload:classify:${record.id}`,
    source: "employee_upload",
    tab: "classify",
    documentRef: { source: "employee_upload", sourceId: documentId },
    processRef: null,
    title: text(record.originalName) ?? text(record.destinationDisplayName) ?? "Documento do colaborador",
    subject: text(record.employeeName),
    status,
    statusLabel: status === "ready" ? "Pronto para confirmação" : status === "review" ? "Revisão necessária" : "Análise em andamento",
    detail: text(record.decisionReason) ?? errors[0] ?? null,
    updatedAt: text(record.updatedAt) ?? text(record.createdAt),
    href: text(record.employeeId) ? `/dashboard/documents/collaborators?employeeId=${encodeURIComponent(text(record.employeeId)!)}&batch=${encodeURIComponent(text(record.batchId) ?? "")}` : "/dashboard/documents/collaborators",
    actionLabel: "Retomar revisão",
    missingFields: errors.slice(0, 8),
    dimensions: { ...emptyDimensions(), classification: status === "ready" ? "suggested" : errors.length ? "failed" : "pending", preparation: "pending", archiving: "pending" },
    metadata: { originalName: text(record.originalName), displayName: text(record.destinationDisplayName), documentType: text(record.documentTypeCode), analysisMethod },
  };
}
