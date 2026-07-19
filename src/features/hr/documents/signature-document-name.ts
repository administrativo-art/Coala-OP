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
  documentType: unknown;
  holderName: unknown;
}) {
  const documentType = cleanPart(params.documentType, "Documento");
  const holderName = cleanPart(params.holderName, "Titular não identificado");
  return `COALA SHAKES - ${documentType} - ${holderName}`.slice(0, 240);
}

export function buildSignatureFileName(documentName: string, extension = "docx") {
  const safeName = documentName
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${safeName}.${extension.replace(/^\./, "")}`;
}
