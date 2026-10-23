import { PaymentCliError } from "./payment-cli-transport";

function equal(fieldPath: string, stringValue: string) {
  return { fieldFilter: { field: { fieldPath }, op: "EQUAL", value: { stringValue } } };
}

export function mainPaymentLookupQuery(kind: string, value: string) {
  if (kind === "entity-document") {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 14) throw new PaymentCliError("CNPJ de fornecedor inválido.");
    const formatted = `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
    return { from: [{ collectionId: "entities" }], where: { compositeFilter: { op: "OR", filters: [
      equal("documentNormalized", digits), equal("cnpj", digits), equal("document", digits), equal("document", formatted),
    ] } }, limit: 26 };
  }
  if (kind === "entity-name") {
    const name = value.trim();
    if (name.length < 2 || name.length > 160 || /[\r\n]/.test(name)) throw new PaymentCliError("Nome de fornecedor inválido.");
    return { from: [{ collectionId: "entities" }], where: { compositeFilter: { op: "OR", filters: [
      equal("name", name), equal("fantasyName", name), equal("razao_social", name), equal("nome_fantasia", name), equal("nickname", name),
    ] } }, limit: 26 };
  }
  if (kind === "purchase-supplier") {
    if (!/^[a-zA-Z0-9_-]{1,170}$/.test(value)) throw new PaymentCliError("ID de fornecedor inválido.");
    return { from: [{ collectionId: "purchase_orders" }], where: equal("supplierId", value), limit: 26 };
  }
  if (kind === "purchase-supplier-name") {
    const name = value.trim();
    if (name.length < 2 || name.length > 160 || /[\r\n]/.test(name)) throw new PaymentCliError("Nome de fornecedor inválido.");
    return { from: [{ collectionId: "purchase_orders" }], where: equal("supplierName", name), limit: 26 };
  }
  if (kind === "purchase-invoice-key") {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 44) throw new PaymentCliError("Chave da NF-e inválida.");
    return { from: [{ collectionId: "purchase_orders" }], where: equal("invoiceAccessKey", digits), limit: 26 };
  }
  throw new PaymentCliError("Busca no cadastro principal não permitida.");
}

export function summarizeMainPaymentLookup(doc: Record<string, unknown>) {
  const allowed = [
    "id", "type", "name", "fantasyName", "document", "documentNormalized", "cnpj", "status",
    "supplierId", "supplierName", "destinationKioskId", "receiptMode", "estimatedReceiptDate",
    "totalEstimated", "paymentCondition", "paymentMethod", "paymentDueDate", "purchaseDate",
    "installmentsCount", "installmentDueDates", "accountPlanId", "accountPlanName", "resultCenterId",
    "resultCenterName", "invoiceNumber", "invoiceAccessKey", "fiscal", "documentUrl", "createdAt",
    "linkedExpenseId", "notes",
  ];
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(doc, key)).map((key) => [key, doc[key]]));
}
