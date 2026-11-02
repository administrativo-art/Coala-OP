import { emptyDimensions, type CentralWorkItem } from "../types";

type AbsenceRecord = Record<string, unknown> & { id: string };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function absenceFlowItem(record: AbsenceRecord): CentralWorkItem {
  const status = text(record.status) ?? "in_review";
  const attachmentCount = typeof record.attachmentCount === "number" ? record.attachmentCount : 0;
  const subject = text(record.beneficiaryName) ?? "Colaborador";
  return {
    id: `absence:flow:${record.id}`,
    source: "absence",
    tab: "flows",
    documentRef: attachmentCount ? { source: "absence", sourceId: record.id } : null,
    processRef: { source: "absence", processId: record.id, stage: text(record.stage) },
    title: text(record.typeName) ?? "Solicitação de ausência",
    subject,
    status,
    statusLabel: status === "in_review" ? "Aguardando análise" : status,
    detail: attachmentCount ? `${attachmentCount} comprovante(s) anexado(s), com acesso restrito.` : "Solicitação sem comprovante anexado.",
    updatedAt: text(record.updatedAt) ?? text(record.submittedAt),
    href: `/dashboard/dp/requests?request=${encodeURIComponent(record.id)}`,
    actionLabel: "Abrir solicitação",
    missingFields: [],
    dimensions: { ...emptyDimensions(), classification: attachmentCount ? "confirmed" : "not_applicable", preparation: "pending", archiving: attachmentCount ? "pending" : "not_applicable", publication: "private" },
    metadata: { attachmentCount, documentType: "COMPROVANTE-AUSENCIA" },
  };
}
