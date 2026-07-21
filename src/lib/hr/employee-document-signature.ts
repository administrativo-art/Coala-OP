export type EmployeeDocumentSignatureMetadata = {
  signatureRequired?: unknown;
  signatureStatus?: unknown;
  signedAt?: unknown;
  source?: unknown;
};

export function employeeDocumentSignatureIndicator(document: EmployeeDocumentSignatureMetadata) {
  const signed = document.signatureStatus === "signed"
    || (typeof document.signedAt === "string" && document.signedAt.trim().length > 0);
  const required = document.signatureRequired === true
    || signed
    || document.source === "autentique_signature";

  if (!required) return null;
  return {
    required: true as const,
    signed,
    statusLabel: signed ? "Assinado" : "Assinatura pendente",
  };
}
