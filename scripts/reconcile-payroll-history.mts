import { Timestamp } from "firebase-admin/firestore";

import { reconcileExpenseProvisionOnServer } from "../src/features/financial/expense-provision-reconciliation.server";
import {
  payrollExpenseIdentityKey,
  payrollProvisionSeriesKey,
} from "../src/features/financial/lib/payroll-provisions";
import { financialDbAdmin } from "../src/lib/firebase-financial-admin";

const APPLY = process.argv.includes("--apply");

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

const competence = argument("--competence");
const dueDateInput = argument("--due-date");
if (!/^\d{4}-\d{2}$/.test(competence)) throw new Error("Informe --competence AAAA-MM.");
if (dueDateInput && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateInput)) throw new Error("Informe --due-date AAAA-MM-DD.");

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

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
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
}, null, 2));

if (!APPLY) process.exit(0);

const actor = { uid: "migration:reconcile-payroll-history", name: "Migração de conciliação da folha" };
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
console.log(JSON.stringify({ applied: plan.length, verification }, null, 2));
