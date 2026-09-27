import { PaymentCliError } from "./payment-cli-transport";

type RecordValue = Record<string, unknown>;

export function paymentReadPath(input: {
  command: string; query?: string; view?: string; cursor?: string; collection?: string; id?: string;
}) {
  if (input.command === "find") {
    const query = input.query?.trim() ?? "";
    if (query.length < 3 || query.length > 120) throw new PaymentCliError("Busca exige de 3 a 120 caracteres.");
    const view = input.view || "work";
    if (!["work", "identified"].includes(view)) throw new PaymentCliError("Visão inválida.");
    const params = new URLSearchParams({ q: query, view, limit: "25" });
    if (input.cursor) {
      if (!/^[a-zA-Z0-9_-]{1,2000}$/.test(input.cursor)) throw new PaymentCliError("Cursor inválido.");
      params.set("cursor", input.cursor);
    }
    return `/api/financial/inbox?${params}`;
  }
  if (!input.id || !/^[a-zA-Z0-9_-]{1,170}$/.test(input.id)) throw new PaymentCliError("ID inválido.");
  if (input.command === "inspect") return `/api/financial/inbox/${encodeURIComponent(input.id)}`;
  if (input.command === "document" && ["expenses", "bankPaymentRequests", "transactions"].includes(input.collection ?? "")) {
    return `/api/financial/data?${new URLSearchParams({ path: `${input.collection}/${input.id}` })}`;
  }
  throw new PaymentCliError("Consulta não permitida.");
}

function pick(value: unknown, keys: string[]): RecordValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as RecordValue;
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
}

const inboxKeys = ["id", "status", "subject", "receivedAt", "linkedExpenseId", "paymentRequestId",
  "classification", "resolution", "provisionSuggestion", "expenseSuggestion", "existingBankPayment", "existingSettlement"];

function inboxSummary(value: unknown) {
  const result = pick(value, inboxKeys);
  const attachments = (value as RecordValue | null)?.attachments;
  if (result && Array.isArray(attachments)) result.attachments = attachments.map((attachment) => {
    const item = pick(attachment, ["id", "filename", "sha256", "archiveStatus", "extractionStatus"]);
    if (item) item.hints = pick((attachment as RecordValue).extractedHints,
      ["supplierName", "supplierTaxId", "competence", "dueDate", "amountCents", "barcode", "confidence"]);
    return item;
  });
  return result;
}

export function summarizePaymentRead(command: string, body: RecordValue) {
  if (command === "find") return {
    messages: Array.isArray(body.messages) ? body.messages.map(inboxSummary) : [],
    nextCursor: body.nextCursor ?? null,
    searchTruncated: body.searchTruncated ?? null,
    searchIndexed: body.searchIndexed ?? null,
    coverage: "Somente a página e visão consultadas; resultado vazio não comprova inexistência de despesa, solicitação ou pagamento.",
  };
  if (command === "inspect") return { message: inboxSummary(body.message) };
  const doc = pick(body.doc, ["id", "status", "description", "supplier", "supplierId", "supplierName",
    "amount", "amountCents", "totalAmount", "totalValue", "dueDate", "competence", "competenceMonth", "competenceDate", "paymentDate",
    "unitId", "unit", "accountPlan", "accountId", "resultCenter", "resultCenterId", "sourceType", "sourceId", "expenseId",
    "paymentRequestId", "paymentRail", "barcodeSnapshot", "interRequestId", "bankStatus", "bankObservation", "submissionStartedAt",
    "financialDocumentIdentity", "installments", "isForecast", "provisionStatus", "paidAt", "resultCenterName", "accountPlanName",
    "unitName", "apportionments", "accountAllocations", "provisionSeriesKey", "provisionKind", "provisionType", "provisionCompetence", "provisionReconciliationStatus", "reconciledExpenseId", "reconciledProvisionId", "name", "notes",
    "statementTransactionId", "bankTransactionId", "linkedTransactionId", "importedFrom", "documentNumber", "documentReference",
    "externalReference", "receiptNumber", "legalEntitySnapshot", "statementReconciliationStatus", "bankLiquidationObservedAt",
    "date", "type", "direction", "bankPaymentTransactionId", "linkedBankTransactionId", "importSessionId", "importItemId"]);
  if (doc) doc.bankStatementData = pick((body.doc as RecordValue).bankStatementData,
    ["idTransacao", "codigoTransacao", "dataPagamento", "dataTransacao", "dataVencimento", "dataVencimentoTitulo",
      "valor", "valorPago", "valorPagar", "valorNominal", "descricao", "numeroDocumento", "codBarraLinhaDigitavel",
      "codigoBarras", "linhaDigitavel", "statusPagamento", "nomeBeneficiario", "cpfCnpjBeneficiario"]);
  return { doc };
}
