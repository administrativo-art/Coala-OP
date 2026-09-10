import { Timestamp } from "firebase-admin/firestore";

import { reconcileExpenseProvisionOnServer } from "../src/features/financial/expense-provision-reconciliation.server";
import { queueMatchedBankPayment } from "../src/features/financial/obligations/service.server";
import {
  payrollExpenseIdentityKey,
  payrollProvisionSeriesKey,
} from "../src/features/financial/lib/payroll-provisions";
import { financialDbAdmin } from "../src/lib/firebase-financial-admin";

const APPLY = process.argv.includes("--apply");
const APPLY_BANK = process.argv.includes("--apply-bank");

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

const competence = argument("--competence");
const dueDateInput = argument("--due-date");
const bankFrom = argument("--bank-from");
const bankThrough = argument("--bank-through");
const expectedBankTotal = argument("--expected-bank-total");
if (!/^\d{4}-\d{2}$/.test(competence)) throw new Error("Informe --competence AAAA-MM.");
if (dueDateInput && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateInput)) throw new Error("Informe --due-date AAAA-MM-DD.");
if ((bankFrom || bankThrough || APPLY_BANK) && (!/^\d{4}-\d{2}-\d{2}$/.test(bankFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(bankThrough))) {
  throw new Error("Para conciliar o extrato, informe --bank-from e --bank-through no formato AAAA-MM-DD.");
}
if (expectedBankTotal && (!Number.isFinite(Number(expectedBankTotal)) || Number(expectedBankTotal) <= 0)) {
  throw new Error("--expected-bank-total deve ser um valor positivo em reais.");
}

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function significantNameTokens(value: unknown) {
  const ignored = new Set(["da", "das", "de", "do", "dos", "e"]);
  return normalized(value).split(" ").filter((token) => token.length >= 2 && !ignored.has(token));
}

function matchesEmployeeName(employeeName: unknown, transaction: Record<string, any>) {
  const receiver = transaction.bankStatementData?.detalhes?.nomeRecebedor
    || transaction.rawBankDescription
    || transaction.description;
  const employeeTokens = significantNameTokens(employeeName);
  const receiverTokens = new Set(significantNameTokens(receiver));
  if (employeeTokens.length === 0 || !receiverTokens.has(employeeTokens[0])) return false;
  const matches = employeeTokens.filter((token) => receiverTokens.has(token)).length;
  return matches >= Math.min(2, employeeTokens.length);
}

function money(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

const displayCompetence = `${competence.slice(5, 7)}/${competence.slice(0, 4)}`;
const salarySnapshot = await financialDbAdmin.collection("expenses")
  .where("accountPlanName", "==", "Salários")
  .limit(500)
  .get();
const actuals = salarySnapshot.docs
  .map((document) => ({ id: document.id, ...document.data() }))
  .filter((expense) => (
    expense.provisionType !== "forecast"
    && (
      expense.provisionCompetence === competence
      || String(expense.description || "").startsWith(`Salário - ${displayCompetence} |`)
      || String(expense.description || "").startsWith(`Complemento salarial - ${displayCompetence} |`)
    )
  ));
const forecastsSnapshot = await financialDbAdmin.collection("expenses")
  .where("provisionCompetence", "==", competence)
  .where("provisionType", "==", "forecast")
  .limit(500)
  .get();
const forecasts = forecastsSnapshot.docs
  .map((document) => ({ id: document.id, ...document.data() }))
  .filter((expense) => String(expense.provisionSeriesKey || "").startsWith("payroll-salary:"));
const forecastsBySeries = new Map(forecasts.map((expense) => [String(expense.provisionSeriesKey), expense]));

const seenPayrollIdentities = new Set<string>();
const plan = actuals.map((expense) => {
  const employeeId = String(expense.employeeId || expense.employeeUserId || "").trim();
  if (!employeeId) throw new Error(`A despesa ${expense.id} não possui employeeId.`);
  const earningType = String(expense.payrollEarningType || "").trim()
    || (String(expense.description || "").startsWith("Complemento salarial -") ? "adjustment" : "salary");
  const payrollIdentityKey = payrollExpenseIdentityKey(employeeId, competence, earningType);
  if (seenPayrollIdentities.has(payrollIdentityKey)) {
    throw new Error(`Há mais de uma verba ${earningType} para ${employeeId} em ${competence}.`);
  }
  seenPayrollIdentities.add(payrollIdentityKey);
  const provisionSeriesKey = payrollProvisionSeriesKey(employeeId, earningType);
  const forecast = forecastsBySeries.get(provisionSeriesKey) || null;
  return {
    expense,
    employeeId,
    earningType,
    payrollIdentityKey,
    provisionSeriesKey,
    forecast,
    variance: forecast
      ? Number((Number(expense.totalValue || 0) - Number(forecast.totalValue || 0)).toFixed(2))
      : null,
  };
});

type BankPlanRow = {
  expense: Record<string, any> & { id: string };
  transaction: Record<string, any> & { id: string };
  alreadyLinked: boolean;
};

let bankPlan: BankPlanRow[] = [];
if (bankFrom && bankThrough) {
  const from = Timestamp.fromDate(new Date(`${bankFrom}T00:00:00-03:00`));
  const throughExclusive = Timestamp.fromMillis(
    new Date(`${bankThrough}T00:00:00-03:00`).getTime() + 86_400_000,
  );
  const transactionSnapshot = await financialDbAdmin.collection("transactions")
    .where("date", ">=", from)
    .where("date", "<", throughExclusive)
    .limit(501)
    .get();
  if (transactionSnapshot.size > 500) {
    throw new Error("A janela bancária possui mais de 500 lançamentos. Reduza o período antes de conciliar.");
  }
  const bankTransactions = transactionSnapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((transaction) => (
      transaction.direction === "out"
      && transaction.importSource === "inter_api"
      && transaction.bankTransactionType === "PIX"
    ));
  const claimedTransactions = new Set<string>();
  bankPlan = plan.map(({ expense }) => {
    const employeeName = expense.employeeName || expense.supplier;
    const candidates = bankTransactions.filter((transaction) => (
      money(transaction.amount) === money(expense.totalValue)
      && matchesEmployeeName(employeeName, transaction)
    ));
    const linkedTransactionId = String(expense.linkedBankTransactionId || "");
    const selected = linkedTransactionId
      ? candidates.find((transaction) => transaction.id === linkedTransactionId)
      : candidates.length === 1
        ? candidates[0]
        : null;
    if (!selected) {
      throw new Error(
        `A despesa ${expense.id} possui ${candidates.length} Pix compatível(is); a conciliação exige correspondência única.`,
      );
    }
    const transactionLinkedExpenseId = String(selected.linkedExpenseId || selected.expenseId || "");
    if (transactionLinkedExpenseId && transactionLinkedExpenseId !== expense.id) {
      throw new Error(`O Pix ${selected.id} já está vinculado à despesa ${transactionLinkedExpenseId}.`);
    }
    if (claimedTransactions.has(selected.id)) throw new Error(`O Pix ${selected.id} foi associado a mais de um salário.`);
    claimedTransactions.add(selected.id);
    return {
      expense: expense as Record<string, any> & { id: string },
      transaction: selected as Record<string, any> & { id: string },
      alreadyLinked: linkedTransactionId === selected.id && transactionLinkedExpenseId === expense.id,
    };
  });
  const plannedTotal = money(bankPlan.reduce((total, row) => total + money(row.transaction.amount), 0));
  if (expectedBankTotal && plannedTotal !== money(expectedBankTotal)) {
    throw new Error(`O total bancário encontrado é R$ ${plannedTotal.toFixed(2)}, não R$ ${money(expectedBankTotal).toFixed(2)}.`);
  }
}

console.log(JSON.stringify({
  mode: APPLY || APPLY_BANK ? "apply" : "dry-run",
  competence,
  dueDate: dueDateInput || null,
  actualCount: plan.length,
  forecastCount: forecasts.length,
  rows: plan.map(({ expense, employeeId, earningType, payrollIdentityKey, forecast, variance }) => ({
    actualExpenseId: expense.id,
    employeeId,
    employeeName: expense.employeeName || expense.supplier,
    earningType,
    payrollIdentityKey,
    actualValue: expense.totalValue,
    actualStatus: expense.status,
    forecastExpenseId: forecast?.id || null,
    forecastValue: forecast?.totalValue ?? null,
    forecastStatus: forecast?.status ?? null,
    variance,
  })),
  bankReconciliation: bankPlan.length ? {
    from: bankFrom,
    through: bankThrough,
    expectedTotal: expectedBankTotal ? money(expectedBankTotal) : null,
    actualTotal: money(bankPlan.reduce((total, row) => total + money(row.transaction.amount), 0)),
    rows: bankPlan.map(({ expense, transaction, alreadyLinked }) => ({
      expenseId: expense.id,
      employeeName: expense.employeeName || expense.supplier,
      amount: money(expense.totalValue),
      transactionId: transaction.id,
      bankDescription: transaction.rawBankDescription || transaction.description,
      alreadyLinked,
    })),
  } : null,
}, null, 2));

if (!APPLY && !APPLY_BANK) process.exit(0);

const actor = { uid: "migration:reconcile-payroll-history", name: "Migração de conciliação da folha" };
if (APPLY) {
  for (const { expense, employeeId, earningType, payrollIdentityKey, provisionSeriesKey } of plan) {
    const currentInstallments = Array.isArray(expense.installments) ? expense.installments : [];
    const dueDate = dueDateInput && earningType === "salary"
      ? Timestamp.fromDate(new Date(`${dueDateInput}T12:00:00-03:00`))
      : null;
    const expensePatch = {
      employeeId,
      employeeName: String(expense.employeeName || expense.supplier || ""),
      payrollEarningType: earningType,
      payrollIdentityKey,
      provisionSource: expense.provisionSource || (earningType === "salary" ? "payslip" : "bank_statement"),
      ...(dueDate ? {
        dueDate,
        installments: currentInstallments.map((installment) => ({ ...installment, dueDate })),
      } : {}),
    };
    await reconcileExpenseProvisionOnServer(expense.id, actor, {
      identity: { provisionSeriesKey, provisionCompetence: competence, provisionType: "actual" },
      expensePatch,
    });
  }
}

if (APPLY_BANK) {
  for (const { expense, transaction, alreadyLinked } of bankPlan) {
    if (alreadyLinked) continue;
    const paidAt = transaction.date instanceof Timestamp
      ? transaction.date
      : Timestamp.fromDate(new Date(transaction.date));
    const now = Timestamp.now();
    const batch = financialDbAdmin.batch();
    const match = await queueMatchedBankPayment({
      batch,
      expenseId: expense.id,
      expense,
      bankTransactionId: transaction.id,
      principalAmount: money(expense.totalValue),
      cashAmount: money(transaction.amount),
      paidAt,
      actor,
    });
    const installments = Array.isArray(expense.installments)
      ? expense.installments.map((installment: Record<string, unknown>) => (
        installment.status === "cancelled"
          ? installment
          : { ...installment, status: "paid", paidAt, linkedBankTransactionId: transaction.id }
      ))
      : expense.installments;
    batch.set(financialDbAdmin.collection("expenses").doc(expense.id), {
      ...match.expensePatch,
      installments,
      linkedBankTransactionId: transaction.id,
      paidAt,
      bankReconciledAt: now,
      bankReconciledBy: actor.uid,
    }, { merge: true });
    batch.set(financialDbAdmin.collection("transactions").doc(transaction.id), {
      description: expense.description,
      supplier: expense.supplier || expense.employeeName || null,
      expenseId: expense.id,
      linkedExpenseId: expense.id,
      obligationId: match.obligationId,
      obligationPaymentLinkId: match.linkId,
      accountPlanId: expense.accountPlanId || null,
      accountPlanName: expense.accountPlanName || null,
      auditStatus: "resolved",
      autoMatched: true,
      autoMatchConfidence: "exact_amount_beneficiary",
      bankReconciledAt: now,
      auditedAt: now,
      auditedBy: actor.uid,
    }, { merge: true });
    batch.set(financialDbAdmin.collection("bankStatementEvents").doc(transaction.id), {
      linkedExpenseId: expense.id,
      reconciliationMode: "exact_amount_beneficiary",
      reconciliationError: null,
      updatedAt: now,
    }, { merge: true });
    await batch.commit();
  }
}

const verified = await financialDbAdmin.getAll(...plan.map(({ expense }) =>
  financialDbAdmin.collection("expenses").doc(expense.id)
));
const verification = verified.map((document) => ({
  id: document.id,
  provisionType: document.get("provisionType"),
  provisionCompetence: document.get("provisionCompetence"),
  provisionSeriesKey: document.get("provisionSeriesKey"),
  reconciledProvisionId: document.get("reconciledProvisionId") || null,
  dueDate: document.get("dueDate")?.toDate?.().toISOString?.() || null,
}));
const invalid = verification.filter((row) => (
  row.provisionType !== "actual"
  || row.provisionCompetence !== competence
  || !row.provisionSeriesKey
  || (forecastsBySeries.has(row.provisionSeriesKey) && !row.reconciledProvisionId)
));
if (invalid.length > 0) throw new Error(`Falha na verificação de ${invalid.length} salário(s).`);
if (bankPlan.length) {
  const transactionVerification = await financialDbAdmin.getAll(...bankPlan.map(({ transaction }) =>
    financialDbAdmin.collection("transactions").doc(transaction.id)
  ));
  const expenseById = new Map(verified.map((document) => [document.id, document]));
  const transactionById = new Map(transactionVerification.map((document) => [document.id, document]));
  const invalidBank = bankPlan.filter(({ expense, transaction }) => {
    const currentExpense = expenseById.get(expense.id);
    const currentTransaction = transactionById.get(transaction.id);
    return currentExpense?.get("status") !== "paid"
      || currentExpense?.get("linkedBankTransactionId") !== transaction.id
      || currentTransaction?.get("linkedExpenseId") !== expense.id
      || currentTransaction?.get("auditStatus") !== "resolved";
  });
  if (invalidBank.length > 0) throw new Error(`Falha na verificação de ${invalidBank.length} conciliação(ões) bancária(s).`);
}
console.log(JSON.stringify({
  provisionsApplied: APPLY ? plan.length : 0,
  bankPaymentsApplied: APPLY_BANK ? bankPlan.filter((row) => !row.alreadyLinked).length : 0,
  bankPaymentsAlreadyLinked: bankPlan.filter((row) => row.alreadyLinked).length,
  verification,
}, null, 2));
