import { paymentRequestError } from "./business-error";
export type SalaryPaymentInput = {
  sourceId: string;
  expenseId?: string;
  beneficiaryReference: { sourceType: "employee" | "entity"; sourceId: string };
  amount: number;
  description: string;
  scheduledFor?: string | null;
};

export type SalaryExpenseTarget = {
  workspaceId?: unknown;
  status?: unknown;
  provisionType?: unknown;
  payrollEarningType?: unknown;
  employeeId?: unknown;
  totalValue?: unknown;
  description?: unknown;
};

export type SalaryEmployeeTarget = {
  id: string;
  authUid?: unknown;
  sourceUserId?: unknown;
};

function cents(value: unknown) {
  return Math.round(Number(value) * 100);
}

export function assertSalaryPaymentTarget(
  input: SalaryPaymentInput,
  expense: SalaryExpenseTarget | null,
  employee: SalaryEmployeeTarget | null,
  workspaceId = "coala",
) {
  if (!input.expenseId || input.sourceId !== input.expenseId) {
    throw paymentRequestError("O salário deve usar a própria despesa como origem.");
  }
  if (input.beneficiaryReference.sourceType !== "employee") {
    throw paymentRequestError("O favorecido do salário deve ser um colaborador.");
  }
  if (!input.scheduledFor) {
    throw paymentRequestError("Informe a data programada do salário.");
  }
  if (!expense || expense.workspaceId !== workspaceId) {
    throw paymentRequestError("A despesa salarial não foi encontrada.");
  }
  if (expense.provisionType !== "actual" || expense.payrollEarningType !== "salary") {
    throw paymentRequestError("A despesa informada não é um salário efetivo.");
  }
  if (expense.status !== "pending") {
    throw paymentRequestError("A despesa salarial não está pendente para pagamento.");
  }
  if (!Number.isSafeInteger(cents(expense.totalValue))
    || cents(expense.totalValue) !== cents(input.amount)) {
    throw paymentRequestError("O valor do Pix diverge da despesa salarial.");
  }
  if (String(expense.description ?? "").trim() !== input.description.trim()) {
    throw paymentRequestError("A descrição do Pix diverge da despesa salarial.");
  }
  if (!employee || employee.id !== input.beneficiaryReference.sourceId) {
    throw paymentRequestError("O cadastro funcional do favorecido não foi encontrado.");
  }
  const expenseEmployeeId = String(expense.employeeId ?? "").trim();
  const employeeLinks = new Set([
    employee.id,
    String(employee.authUid ?? "").trim(),
    String(employee.sourceUserId ?? "").trim(),
  ].filter(Boolean));
  if (!expenseEmployeeId || !employeeLinks.has(expenseEmployeeId)) {
    throw paymentRequestError("O favorecido não corresponde ao colaborador da despesa salarial.");
  }
}
