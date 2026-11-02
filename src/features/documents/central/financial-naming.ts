export const FINANCIAL_DOCUMENT_KINDS = ["NOTA-FISCAL", "BOLETO", "RECIBO-QUITACAO", "COMPROVANTE-PAGAMENTO"] as const;
export function financialDocumentName(input: { documentType: string; counterpartyId: string; reference: string; version: number; extension: string }) {
  const reference = input.reference.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase();
  return `${input.documentType}__CONTRAPARTE-${input.counterpartyId}__${reference}__v${String(input.version).padStart(2, "0")}.${input.extension}`;
}
