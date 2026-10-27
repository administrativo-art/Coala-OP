import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export type ExpenseComplementPaymentInput = {
  sourceId: string;
  expenseId: string;
  beneficiaryReference: { sourceType: "employee"; sourceId: string };
  amount: number;
  description: string;
  scheduledFor?: string | null;
};

function cents(value: unknown) {
  return Math.round(Number(value) * 100);
}

function normalizeText(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}

export async function assertExpenseComplementPaymentTarget(
  input: ExpenseComplementPaymentInput,
  workspaceId = "coala",
) {
  if (!input.expenseId || input.sourceId !== input.expenseId) {
    throw new Error("O complemento deve usar a própria despesa como origem.");
  }
  if (input.beneficiaryReference.sourceType !== "employee") {
    throw new Error("O complemento deve usar o colaborador favorecido da despesa.");
  }
  const expenseRef = financialDbAdmin.collection("expenses").doc(input.expenseId);
  const expenseSnapshot = await expenseRef.get();
  if (!expenseSnapshot.exists || (expenseSnapshot.get("workspaceId") ?? workspaceId) !== workspaceId) {
    throw new Error("A despesa do complemento não foi encontrada.");
  }
  const expense = expenseSnapshot.data() ?? {};
  if (!["pending", "provisioned"].includes(String(expense.status))) {
    throw new Error("A despesa não está aberta para complemento.");
  }
  const payments = await financialDbAdmin.collection("payments").where("expenseId", "==", input.expenseId).get();
  const paidCents = payments.docs.reduce((sum, payment) => {
    if (payment.get("reversed") === true) return sum;
    return sum + cents(payment.get("totalPaid") ?? payment.get("principalAmountCents") / 100);
  }, 0);
  const outstandingCents = cents(expense.totalValue) - paidCents;
  if (outstandingCents <= 0) throw new Error("A despesa não possui saldo para complemento.");
  if (cents(input.amount) !== outstandingCents) {
    throw new Error(`O complemento deve ser exatamente R$ ${(outstandingCents / 100).toFixed(2).replace(".", ",")}.`);
  }
  const expectedDescription = `${String(expense.description ?? "").trim()} — complemento`;
  if (input.description.trim() !== expectedDescription) {
    throw new Error("A descrição do complemento diverge da despesa.");
  }
  const employeeSnapshot = await hrDbAdmin.collection("employees").doc(input.beneficiaryReference.sourceId).get();
  if (!employeeSnapshot.exists || employeeSnapshot.get("status") !== "active") {
    throw new Error("O colaborador favorecido não foi encontrado ou está inativo.");
  }
  if (normalizeText(expense.supplier) !== normalizeText(employeeSnapshot.get("name"))) {
    throw new Error("O favorecido não corresponde à despesa.");
  }
  return { expenseId: input.expenseId, outstandingCents };
}
