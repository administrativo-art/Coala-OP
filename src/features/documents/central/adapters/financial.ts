import { emptyDimensions, type CentralWorkItem } from "../types";

type FinancialRecord = Record<string, unknown> & { id: string };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function financialWorkItem(record: FinancialRecord): CentralWorkItem | null {
  const status = text(record.status) ?? "pending_review";
  const classification = object(record.classification);
  const classify = ["pending_review", "document_pending", "under_review", "error"].includes(status);
  const prepare = ["suggestion_available", "divergent", "linked", "awaiting_authorization", "payment_failed", "scheduled", "awaiting_statement"].includes(status);
  if (!classify && !prepare) return null;
  const supplier = text(classification.supplierName) ?? text(record.fromAddress) ?? text(record.from);
  const subject = text(record.subject) ?? "Documento financeiro";
  const statusLabels: Record<string, string> = {
    pending_review: "Aguardando classificação",
    document_pending: "Documento pendente",
    under_review: "Em análise",
    error: "Falha no processamento",
    suggestion_available: "Vínculo sugerido",
    divergent: "Divergência para revisar",
    linked: "Vinculado, aguardando preparo",
    awaiting_authorization: "Aguardando autorização",
    payment_failed: "Falha no envio ao banco",
    scheduled: "Pagamento agendado",
    awaiting_statement: "Aguardando extrato",
  };
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  const failed = ["error", "payment_failed"].includes(status);
  return {
    id: `financial:${classify ? "classify" : "preparation"}:${record.id}`,
    source: "financial",
    tab: classify ? "classify" : "preparation",
    documentRef: { source: "financial", sourceId: record.id },
    processRef: { source: "financial", processId: record.id, stage: classify ? "classify" : "financial" },
    title: subject,
    subject: supplier,
    status,
    statusLabel: statusLabels[status] ?? status,
    detail: failed ? "O tratamento exige revisão no módulo Financeiro." : null,
    updatedAt: text(record.updatedAt) ?? text(record.receivedAt),
    href: `/dashboard/financial/inbox?sourceId=${encodeURIComponent(record.id)}`,
    actionLabel: "Abrir no Financeiro",
    missingFields: Array.isArray(object(record.creationSuggestion).missingFields)
      ? (object(record.creationSuggestion).missingFields as unknown[]).map(String).slice(0, 8) : [],
    dimensions: { ...emptyDimensions(), classification: classify ? failed ? "failed" : "pending" : "confirmed", preparation: prepare ? failed ? "failed" : "pending" : "not_applicable", archiving: "pending" },
    metadata: { documentType: text(classification.documentType), attachmentCount: attachments.length, analysisMethod: "unknown" },
  };
}
