/**
 * Cria, autoriza e envia o complemento exato de uma despesa PJ já parcialmente paga.
 *
 * Uso:
 *   node --env-file=../Coala-OP/.env.local --import tsx scripts/financial/expense-complement-payment.mts \
 *     --expense-id provision_isabela_dominici_2026_10 --employee-id 17517966
 *   ... --apply --production --confirm-financial-actions
 */
import { createPaymentRequest, authorizePaymentRequest, submitPaymentRequest } from "../../src/features/financial/payment-requests/service.server";
import { assertExpenseComplementPaymentTarget } from "../../src/features/financial/payment-requests/expense-complement";
import { financialDbAdmin } from "../../src/lib/firebase-financial-admin";

const value = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? "" : "";
};
const expenseId = value("--expense-id");
const employeeId = value("--employee-id");
const apply = process.argv.includes("--apply");
const production = process.argv.includes("--production");
const confirmed = process.argv.includes("--confirm-financial-actions");
if (!expenseId || !employeeId) throw new Error("Informe --expense-id e --employee-id.");
if (apply && (!production || !confirmed)) throw new Error("Produção exige --apply --production --confirm-financial-actions.");

const expenseSnapshot = await financialDbAdmin.collection("expenses").doc(expenseId).get();
if (!expenseSnapshot.exists) throw new Error("Despesa não encontrada.");
const expense = expenseSnapshot.data() ?? {};
const description = `${String(expense.description ?? "").trim()} — complemento`;
const payments = await financialDbAdmin.collection("payments").where("expenseId", "==", expenseId).get();
const cents = (input: unknown) => Math.round(Number(input) * 100);
const paidCents = payments.docs.reduce((sum, payment) => payment.get("reversed") === true ? sum : sum + cents(payment.get("totalPaid") ?? Number(payment.get("principalAmountCents") ?? 0) / 100), 0);
const amountCents = cents(expense.totalValue) - paidCents;
if (amountCents <= 0) throw new Error("A despesa não possui saldo de complemento.");
const amount = amountCents / 100;
await assertExpenseComplementPaymentTarget({
  sourceId: expenseId,
  expenseId,
  beneficiaryReference: { sourceType: "employee", sourceId: employeeId },
  amount,
  description,
}, "coala");

const actor = { uid: "codex:user-authorized", email: null, name: "Codex (autorizado pelo usuário)" };
if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", expenseId, employeeId, amount, requestId: null, status: "not_created" }, null, 2));
  process.exit(0);
}
const request = await createPaymentRequest({
  sourceType: "expense_complement",
  sourceId: expenseId,
  expenseId,
  beneficiaryReference: { sourceType: "employee", sourceId: employeeId },
  amount,
  description,
  scheduledFor: null,
}, actor);
console.log(JSON.stringify({ mode: "apply", expenseId, employeeId, amount, requestId: request.id, status: request.status }, null, 2));
const authorized = await authorizePaymentRequest(request.id, actor);
const submitted = await submitPaymentRequest(authorized.id, actor);
console.log(JSON.stringify({ authorizedStatus: authorized.status, submittedStatus: submitted.status, interRequestId: submitted.interRequestId ?? null }, null, 2));
