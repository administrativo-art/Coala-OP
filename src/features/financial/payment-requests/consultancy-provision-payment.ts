import type { PaymentBeneficiaryReference } from "../beneficiaries/types";

export type ConsultancyProvisionPaymentInput = {
  sourceId: string;
  expenseId?: string;
  beneficiaryReference: PaymentBeneficiaryReference;
  amount: number;
  description: string;
  scheduledFor?: string | null;
};

type Target = Record<string, unknown> & { id: string };

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}
function slug(value: unknown) {
  return normalized(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function cents(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const result = Math.round(amount * 100);
  return Number.isSafeInteger(result) ? result : null;
}

function isoDay(value: unknown) {
  const date = value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
    ? value.toDate() as Date
    : value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

/** Checks the exact forecast and beneficiary before a request can reach Inter. */
export function assertConsultancyProvisionPaymentTarget(input: ConsultancyProvisionPaymentInput, expense: Target | null, employee: Target | null, workspaceId = "coala", requestId?: string) {
  if (!input.expenseId || input.sourceId !== input.expenseId || expense?.id !== input.expenseId) {
    throw new Error("O Pix da consultoria deve usar a própria provisão como origem.");
  }
  if (input.beneficiaryReference.sourceType !== "employee" || !employee || employee.id !== input.beneficiaryReference.sourceId || employee.status !== "active") {
    throw new Error("O favorecido da consultoria não corresponde a um cadastro ativo.");
  }
  if (expense.consultancyEmployeeId !== employee.id) throw new Error("A provisão não possui vínculo confirmado com este favorecido.");
  if (!/^[a-f0-9-]{32,40}$/i.test(String(expense.consultancyContractDocumentId ?? ""))) throw new Error("A provisão não possui aditivo identificado.");
  if ((expense.workspaceId && expense.workspaceId !== workspaceId) || expense.status !== "provisioned" || expense.provisionType !== "forecast") {
    throw new Error("A despesa não é uma provisão de consultoria aberta neste ambiente.");
  }
  const series = String(expense.provisionSeriesKey ?? "");
  const competence = String(expense.provisionCompetence ?? "");
  if (!/^recurring:consultoria-rh:[a-z0-9-]+$/.test(series) || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(competence)) {
    throw new Error("A provisão não tem identidade de consultoria de RH válida.");
  }
  if (normalized(expense.supplier) !== normalized(employee.name) || !normalized(employee.name)) {
    throw new Error("O nome do favorecido diverge do fornecedor da provisão.");
  }
  if (series !== `recurring:consultoria-rh:${slug(employee.name)}`) throw new Error("A série da provisão diverge do favorecido.");
  const dueDate = isoDay(expense.dueDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate.slice(0, 7) !== competence || input.scheduledFor !== dueDate) {
    throw new Error("O Pix deve ser programado para o vencimento da competência da provisão.");
  }
  const expectedCents = cents(expense.totalValue);
  if (expectedCents === null || cents(input.amount) !== expectedCents || String(expense.description ?? "").trim() !== input.description.trim()) {
    throw new Error("O valor ou a descrição do Pix diverge da provisão.");
  }
  if (expense.paidAt || expense.linkedBankTransactionId || expense.paymentState === "paid") {
    throw new Error("A provisão já possui evidência de pagamento.");
  }
  const linkedRequestId = String(expense.paymentRequestId ?? "").trim();
  if (linkedRequestId && linkedRequestId !== requestId) {
    throw new Error("A provisão já possui outra solicitação bancária.");
  }
  const installments = expense.installments;
  if (!Array.isArray(installments) || installments.length !== 1) {
    throw new Error("A provisão deve conter exatamente uma parcela.");
  }
  const installment = installments[0] as Record<string, unknown>;
  if (installment.status !== "pending" || installment.paidAt || installment.linkedBankTransactionId || installment.paymentRequestId) {
    throw new Error("A parcela da provisão já possui pagamento ou solicitação vinculada.");
  }
  if (isoDay(installment.dueDate) !== dueDate) throw new Error("O vencimento da parcela diverge da provisão.");
  const installmentAmount = cents(installment.value ?? installment.amount ?? installment.totalValue);
  if (installmentAmount !== null && installmentAmount !== expectedCents) {
    throw new Error("A parcela diverge do valor total da provisão.");
  }
}

/** The payable is the actual contract obligation created from the forecast, never the forecast itself. */
export function assertConsultancyActualPaymentTarget(input: ConsultancyProvisionPaymentInput, expense: Target | null, employee: Target | null, workspaceId = "coala", requestId?: string) {
  if (!input.expenseId || input.expenseId !== `consultancy_actual_${input.sourceId}` || expense?.id !== input.expenseId
    || expense?.sourceType !== "consultancy_contract_payment" || expense?.reconciledProvisionId !== input.sourceId
    || expense?.provisionType !== "actual" || expense?.status !== "pending" || expense.workspaceId !== workspaceId) {
    throw new Error("A obrigação real da consultoria não corresponde à provisão original.");
  }
  if (input.beneficiaryReference.sourceType !== "employee" || !employee || employee.id !== input.beneficiaryReference.sourceId || employee.status !== "active" || normalized(expense.supplier) !== normalized(employee.name)) {
    throw new Error("O favorecido da obrigação real não corresponde à consultoria.");
  }
  if (expense.consultancyEmployeeId !== employee.id) throw new Error("A obrigação real perdeu o vínculo com o favorecido.");
  if (!/^[a-f0-9-]{32,40}$/i.test(String(expense.consultancyContractDocumentId ?? ""))) throw new Error("A obrigação real perdeu o aditivo identificado.");
  if (!/^recurring:consultoria-rh:[a-z0-9-]+$/.test(String(expense.provisionSeriesKey ?? "")) || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(expense.provisionCompetence ?? ""))) {
    throw new Error("A obrigação real não tem identidade de competência válida.");
  }
  if (expense.provisionSeriesKey !== `recurring:consultoria-rh:${slug(employee.name)}`) throw new Error("A série da obrigação real diverge do favorecido.");
  const dueDate = isoDay(expense.dueDate);
  if (input.scheduledFor !== dueDate || dueDate.slice(0, 7) !== expense.provisionCompetence || cents(input.amount) !== cents(expense.totalValue) || input.description.trim() !== String(expense.description ?? "").trim()) {
    throw new Error("Data, valor ou descrição do Pix divergem da obrigação real.");
  }
  const linkedRequestId = String(expense.paymentRequestId ?? "").trim();
  if ((linkedRequestId && linkedRequestId !== requestId) || expense.paidAt || expense.linkedBankTransactionId || expense.paymentState === "paid") {
    throw new Error("A obrigação real já possui outro pagamento ou solicitação.");
  }
  const installments = expense.installments;
  if (!Array.isArray(installments) || installments.length !== 1)throw new Error("A obrigação real deve ter uma parcela.");
  const installment = installments[0] as Record<string, unknown>;
  if (installment.status !== "pending" || installment.paidAt || installment.linkedBankTransactionId || (installment.paymentRequestId && installment.paymentRequestId !== requestId) || cents(installment.value ?? installment.amount) !== cents(expense.totalValue)) {
    throw new Error("A parcela real mudou ou já foi paga.");
  }
}
