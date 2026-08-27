export const GENERATED_DOCUMENT_STATUSES = [
  "draft",
  "review_pending",
  "approved",
  "final",
  "superseded",
  "cancelled",
  "discarded",
] as const;

export type GeneratedDocumentStatus = (typeof GENERATED_DOCUMENT_STATUSES)[number];

export const SIGNATURE_REQUEST_STATUSES = [
  "pending",
  "sending",
  "sent",
  "viewed",
  "partially_signed",
  "signed",
  "rejected",
  "expired",
  "cancelled",
  "delivery_failed",
  "failed",
] as const;

export type SignatureRequestStatus = (typeof SIGNATURE_REQUEST_STATUSES)[number];

export const ARCHIVE_STATUSES = [
  "pending",
  "archived",
  "archive_failed",
  "retention_expired",
  "disposed",
] as const;

export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

const GENERATED_TRANSITIONS: Record<GeneratedDocumentStatus, readonly GeneratedDocumentStatus[]> = {
  draft: ["review_pending", "discarded"],
  review_pending: ["draft", "approved", "discarded"],
  approved: ["review_pending", "final", "cancelled"],
  final: ["superseded", "cancelled"],
  superseded: [],
  cancelled: [],
  discarded: [],
};

export function canTransitionGeneratedDocument(
  current: GeneratedDocumentStatus,
  next: GeneratedDocumentStatus,
) {
  return current === next || GENERATED_TRANSITIONS[current].includes(next);
}

const SIGNATURE_TERMINAL = new Set<SignatureRequestStatus>([
  "signed",
  "rejected",
  "expired",
  "cancelled",
]);

export function isSignatureTerminal(status: SignatureRequestStatus) {
  return SIGNATURE_TERMINAL.has(status);
}

export const DOCUMENT_STATUS_LABELS: Record<GeneratedDocumentStatus, string> = {
  draft: "Rascunho",
  review_pending: "Em conferência",
  approved: "Aprovado",
  final: "Finalizado",
  superseded: "Substituído",
  cancelled: "Cancelado",
  discarded: "Descartado",
};

export const SIGNATURE_STATUS_LABELS: Record<SignatureRequestStatus, string> = {
  pending: "Aguardando envio",
  sending: "Enviando",
  sent: "Enviado",
  viewed: "Visualizado",
  partially_signed: "Parcialmente assinado",
  signed: "Assinado",
  rejected: "Recusado",
  expired: "Expirado",
  cancelled: "Cancelado",
  delivery_failed: "Falha na entrega",
  failed: "Falha no envio",
};
