import { normalizePaymentBarcode } from "@/features/financial/inbox/parser";

export type DuplicateCheckState = "clear" | "duplicate" | "unknown";

export type DuplicateCheckResult = {
  state: DuplicateCheckState;
  reason: string | null;
};

const CLEAR: DuplicateCheckResult = { state: "clear", reason: null };
const DEFINITIVELY_INACTIVE_REQUEST_STATUSES = new Set(["cancelled", "rejected", "approval_expired"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function leafTexts(value: unknown, depth = 0): string[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => leafTexts(item, depth + 1));
  if (typeof value === "object") return Object.values(value as Record<string, unknown>)
    .flatMap((item) => leafTexts(item, depth + 1));
  return [];
}

export function localRequestDuplicateCheck(params: {
  currentRequestId: string;
  requests: Array<{ id: string; data: Record<string, unknown> }>;
  truncated?: boolean;
}): DuplicateCheckResult {
  if (params.truncated) return { state: "unknown", reason: "A consulta de solicitações bancárias excedeu o limite seguro." };
  const conflicting = params.requests.find(({ id, data }) => {
    if (id === params.currentRequestId) return false;
    const status = String(data.status ?? "").trim();
    if (status === "failed" && data.supersededByPaymentRequestId === params.currentRequestId) return false;
    return !DEFINITIVELY_INACTIVE_REQUEST_STATUSES.has(status)
      || Boolean(data.interRequestId)
      || Boolean(data.submissionStartedAt);
  });
  return conflicting
    ? { state: "duplicate", reason: "Já existe outra solicitação bancária para a mesma cobrança." }
    : CLEAR;
}

export function sourceAndFingerprintDuplicateCheck(params: {
  currentMessageId: string;
  messages: Array<{ id: string; data: Record<string, unknown> }>;
  rawSha256: string | null;
  truncated?: boolean;
}): DuplicateCheckResult {
  if (!params.rawSha256) return { state: "unknown", reason: "A cobrança não possui hash integral do e-mail arquivado." };
  if (params.truncated) return { state: "unknown", reason: "A consulta de impressões digitais excedeu o limite seguro." };
  return params.messages.some(({ id }) => id !== params.currentMessageId)
    ? { state: "duplicate", reason: "O mesmo e-mail arquivado já aparece em outra cobrança." }
    : CLEAR;
}

export function expenseAndObligationDuplicateCheck(params: {
  expense: Record<string, unknown> | null;
  obligation: Record<string, unknown> | null;
  payments: Record<string, unknown>[];
  paymentLinks: Record<string, unknown>[];
  truncated?: boolean;
}): DuplicateCheckResult {
  if (!params.expense) return { state: "unknown", reason: "A despesa vinculada não foi encontrada." };
  if (params.truncated) return { state: "unknown", reason: "A consulta de pagamentos da despesa excedeu o limite seguro." };
  const expense = params.expense;
  const expenseSummary = record(expense.settlementSummary);
  if (["paid", "partially_paid"].includes(String(expense.status))
    || ["paid", "partially_paid"].includes(String(expense.paymentState))
    || Boolean(expense.linkedBankTransactionId)
    || Boolean(expense.statementTransactionId)
    || positive(expenseSummary.confirmedPrincipalAmountCents)
    || positive(expenseSummary.principalSettledAmountCents)) {
    return { state: "duplicate", reason: "A despesa vinculada já possui liquidação total ou parcial." };
  }
  if (params.payments.some((payment) => (
    !["VOIDED", "CANCELLED", "cancelled"].includes(String(payment.status))
    && (positive(payment.principalAmountCents) || positive(payment.totalPaid) || Boolean(payment.bankTransactionId))
  ))) {
    return { state: "duplicate", reason: "Já existe pagamento registrado para a despesa vinculada." };
  }
  if (params.paymentLinks.some((link) => (
    ["MATCHED", "REPORTED"].includes(String(link.status))
    && (positive(link.principalAmountCents) || positive(link.cashAmountCents) || Boolean(link.bankTransactionId))
  ))) {
    return { state: "duplicate", reason: "A obrigação já possui pagamento conciliado ou informado." };
  }
  const obligation = params.obligation;
  const obligationSummary = record(obligation?.summary);
  if (obligation && (["PAID", "PARTIALLY_PAID"].includes(String(obligation.status))
    || positive(obligationSummary.confirmedPrincipalAmountCents)
    || positive(obligationSummary.principalSettledAmountCents)
    || positive(obligationSummary.reportedCashAmountCents))) {
    return { state: "duplicate", reason: "A obrigação financeira já possui liquidação total ou parcial." };
  }
  return CLEAR;
}

export function importedStatementDuplicateCheck(params: {
  events: Record<string, unknown>[];
  barcode: string;
  supplierTaxId?: string | null;
  supplierName?: string | null;
  truncated?: boolean;
}): DuplicateCheckResult {
  if (params.truncated) return { state: "unknown", reason: "A consulta do extrato importado excedeu o limite seguro." };
  if (!params.events.length) return CLEAR;
  const barcode = normalizePaymentBarcode(params.barcode);
  const taxId = String(params.supplierTaxId ?? "").replace(/\D/g, "");
  const supplier = normalizedText(params.supplierName);
  for (const event of params.events) {
    const values = leafTexts(event.bankStatementData ?? event);
    const digitValues = values.map((value) => value.replace(/\D/g, ""));
    const text = normalizedText([event.description, ...values].join(" "));
    if ((barcode && digitValues.includes(barcode))
      || (taxId && digitValues.includes(taxId))
      || (supplier.length >= 4 && text.includes(supplier))) {
      return { state: "duplicate", reason: "O extrato importado já contém débito compatível com a cobrança." };
    }
  }
  return {
    state: "unknown",
    reason: "O extrato contém débito de mesmo valor e período sem identidade suficiente para descartá-lo.",
  };
}

export function assertDuplicateChecksClear(checks: DuplicateCheckResult[]) {
  const duplicate = checks.find((check) => check.state === "duplicate");
  if (duplicate) throw new Error(duplicate.reason || "Possível pagamento duplicado encontrado.");
  const unknown = checks.find((check) => check.state === "unknown");
  if (unknown) throw new Error(unknown.reason || "A verificação de duplicidade ficou incompleta.");
}
