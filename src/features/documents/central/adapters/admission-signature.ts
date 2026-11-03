import { emptyDimensions, type CentralWorkItem } from "../types";

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

/** Only persisted provider evidence; never infer email delivery from request status. */
export function admissionSignatureItem(request: Record<string, unknown> & { id: string }, process: Record<string, unknown>): CentralWorkItem | null {
  const onboardingId = text(request.onboardingId);
  const status = text(request.status);
  if (!onboardingId || !status || ["signed", "archived", "completed"].includes(status)) return null;
  const labels: Record<string, string> = { placement_pending: "Posicionamento pendente", sending: "Preparando envio", pending: "Aguardando envio", sent: "Enviado para assinatura", viewed: "Documento visualizado", partially_signed: "Parcialmente assinado", failed: "Falha no envio", delivery_failed: "Falha na entrega", rejected: "Assinatura recusada", expired: "Assinatura expirada", cancelled: "Assinatura cancelada" };
  const participants = Object.values(object(request.participants)).map(object);
  const delivered = participants.filter((entry) => text(entry.emailDeliveredAt)).length;
  const viewed = participants.filter((entry) => text(entry.viewedAt)).length;
  const signed = participants.filter((entry) => text(entry.signedAt)).length;
  const failed = ["failed", "delivery_failed", "rejected", "expired", "cancelled"].includes(status) || participants.some((entry) => text(entry.deliveryFailureReason));
  return {
    id: `onboarding:signature:${request.id}`, source: "onboarding", tab: "signatures",
    documentRef: { source: "onboarding", sourceId: request.id }, processRef: { source: "onboarding", processId: onboardingId, stage: "signature_preparation" },
    title: text(request.documentName) ?? "Pacote admissional", subject: text(process.candidateName), status,
    statusLabel: labels[status] ?? "Trilha de assinatura em andamento",
    detail: participants.length ? `${participants.length} participantes; ${delivered} entregas, ${viewed} visualizações e ${signed} assinaturas com confirmação registrada.` : "Entrega e eventos dos participantes ainda não registrados. Consulte a trilha na admissão.",
    updatedAt: text(request.updatedAt) ?? text(request.sentAt) ?? text(request.requestedAt) ?? text(request.preparedAt),
    href: `/dashboard/hr/recruitment/integration?process=${encodeURIComponent(onboardingId)}`,
    actionLabel: "Abrir trilha na admissão", missingFields: [],
    dimensions: { ...emptyDimensions(), preparation: status === "placement_pending" ? "pending" : "completed", signature: failed ? "failed" : status === "partially_signed" ? "partially_signed" : "pending", archiving: "pending" },
    metadata: { provider: text(request.provider) === "autentique" ? "Autentique" : text(request.provider) ?? "Provedor não registrado" },
  };
}
