import { emptyDimensions, type CentralWorkItem } from "../types";

type GeneratedRecord = Record<string, unknown> & { id: string };

const SIGNATURE_LABELS: Record<string, string> = {
  pending: "Aguardando envio",
  sending: "Preparando envio",
  sent: "Enviado para assinatura",
  viewed: "Visualizado",
  partially_signed: "Parcialmente assinado",
  signed: "Assinado",
  archived: "Assinado e arquivado",
  rejected: "Assinatura recusada",
  expired: "Assinatura expirada",
  cancelled: "Assinatura cancelada",
  failed: "Falha na assinatura",
  delivery_failed: "Falha na entrega",
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function generatedWorkItem(record: GeneratedRecord, tab: "preparation" | "signatures"): CentralWorkItem | null {
  const status = text(record.status) ?? "unknown";
  const signatureStatus = text(record.signatureStatus);
  const title = text(record.templateName) ?? "Documento gerado";
  const subject = text(record.employeeName);
  const base = emptyDimensions();

  if (tab === "signatures") {
    if (!signatureStatus || ["signed", "archived"].includes(signatureStatus)) return null;
    const failed = ["rejected", "expired", "cancelled", "failed", "delivery_failed"].includes(signatureStatus);
    return {
      id: `generated:signature:${record.id}`,
      source: "generated",
      tab,
      documentRef: { source: "generated", sourceId: record.id },
      processRef: { source: "generated", processId: text(record.onboardingId) ?? record.id, stage: "signature" },
      title,
      subject,
      status: signatureStatus,
      statusLabel: SIGNATURE_LABELS[signatureStatus] ?? signatureStatus,
      detail: failed ? "A trilha exige revisão antes de um novo envio." : "Acompanhe a entrega e os signatários na trilha de assinatura.",
      updatedAt: text(record.signatureUpdatedAt) ?? text(record.updatedAt) ?? text(record.generatedAt),
      href: `/dashboard/documents/generated/manage?document=${encodeURIComponent(record.id)}&tab=signatures`,
      actionLabel: "Abrir assinatura",
      missingFields: [],
      dimensions: { ...base, preparation: "completed", signature: failed ? "failed" : signatureStatus === "partially_signed" ? "partially_signed" : "pending", archiving: "pending" },
      metadata: { displayName: title, provider: text(record.signatureProvider) ?? "Provedor não registrado" },
    };
  }

  if (!["draft", "review_pending", "approved", "final"].includes(status)) return null;
  if (signatureStatus && !["cancelled", "failed", "delivery_failed"].includes(signatureStatus)) return null;
  const pdfAvailable = record.pdfAvailable === true || Boolean(record.pdfStoragePath);
  const failed = status === "approved" && !pdfAvailable;
  const label = status === "approved" ? "Aprovado, aguardando finalização" : status === "final" ? "Finalizado sem assinatura" : "Aguardando conferência";
  return {
    id: `generated:preparation:${record.id}`,
    source: "generated",
    tab,
    documentRef: { source: "generated", sourceId: record.id },
    processRef: text(record.onboardingId) ? { source: "generated", processId: text(record.onboardingId)!, stage: "document" } : null,
    title,
    subject,
    status,
    statusLabel: failed ? "Conversão para PDF pendente" : label,
    detail: failed ? "O DOCX existe, mas a prévia em PDF precisa ser gerada antes da finalização." : null,
    updatedAt: text(record.updatedAt) ?? text(record.generatedAt),
    href: `/dashboard/documents/generated/manage?document=${encodeURIComponent(record.id)}&tab=preparation`,
    actionLabel: "Abrir documento",
    missingFields: failed ? ["pdf"] : [],
    dimensions: { ...base, preparation: failed ? "failed" : status === "final" ? "completed" : "pending", signature: "not_sent", archiving: status === "final" ? "filed" : "pending" },
    metadata: { displayName: title },
  };
}
