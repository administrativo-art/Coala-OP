function cleanPart(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-–—\s]+|[-–—\s]+$/g, "")
    .trim();
  return cleaned || fallback;
}

export function buildSignatureDocumentName(params: {
  department?: "RH" | "FN" | "OP";
  documentType: unknown;
  holderName: unknown;
}) {
  const documentType = cleanPart(params.documentType, "Documento");
  const holderName = cleanPart(params.holderName, "Titular não identificado");
  return `Coala Shakes - ${params.department ?? "RH"} | ${documentType} - ${holderName}`.slice(0, 240);
}

export function buildAdmissionSignatureDocumentName(holderName: unknown) {
  return buildSignatureDocumentName({ department: "RH", documentType: "Admissão", holderName });
}

/** Department comes from the document's catalog/context, never the signer's job. */
export function signatureDepartmentForTemplate(template: { id?: unknown; category?: unknown; sourceModule?: unknown } | null | undefined): "RH" | "FN" | "OP" {
  if (template?.id === "system-receipt-standard" || ["Financeiro", "Financeiro e recibos"].includes(String(template?.category))) return "FN";
  if (["assets", "uniforms", "operations"].includes(String(template?.sourceModule)) || ["Operações", "Patrimônio", "Uniformes"].includes(String(template?.category))) return "OP";
  return "RH";
}

export function buildSignatureFileName(documentName: string, extension = "docx") {
  const safeName = documentName
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${safeName}.${extension.replace(/^\./, "")}`;
}
