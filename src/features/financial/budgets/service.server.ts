import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import { calculateBudgetConsumption, calculateBudgetForecastCoverage, buildBudgetBurndownData, type BudgetExpense } from "@/features/financial/lib/budget-consumption";
import { serializeFinancialValue } from "@/features/financial/lib/server-access";
import { createBudgetSchema, createBudgetRuleSchema, createBudgetProjectSchema, updateBudgetSchema, updateBudgetRuleSchema, updateBudgetProjectSchema } from "./schemas";
import type { FinancialBudget, FinancialBudgetRule, FinancialBudgetSummary, FinancialBudgetProject, FinancialBudgetProjectSummary } from "./types";
import type { z } from "zod";
import { BudgetDomainError } from "./errors";
import { estimateConsumptionPriceBudget } from "./input-estimate.server";
import { calculateProjectBudgetConsumption } from "@/features/financial/lib/budget-project-consumption";
export { BudgetDomainError } from "./errors";

const budgets = financialDbAdmin.collection("financialBudgets");
const rules = financialDbAdmin.collection("financialBudgetRules");
const budgetClaims = financialDbAdmin.collection("financialBudgetAccountClaims");
const ruleClaims = financialDbAdmin.collection("financialBudgetRuleAccountClaims");
const projects = financialDbAdmin.collection("financialBudgetProjects");
const projectExpenseClaims = financialDbAdmin.collection("financialBudgetProjectExpenseClaims");
const revisions = financialDbAdmin.collection("financialBudgetRevisions");
const projectEvents = financialDbAdmin.collection("financialBudgetProjectEvents");
const MAX_EXPENSES_PER_MONTH = 2000;

function docData<T>(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return { id: snapshot.id, ...(serializeFinancialValue(snapshot.data()) as Record<string, unknown>) } as T;
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentMonth() {
  return financialDateKey(new Date())!.slice(0, 7);
}

export async function validateBudgetAccounts(accountPlanIds: string[]) {
  const snapshots = await financialDbAdmin.getAll(...accountPlanIds.map((id) => financialDbAdmin.collection("accounts").doc(id)));
  if (snapshots.some((snapshot) => !snapshot.exists || snapshot.data()?.active === false || snapshot.data()?.isGroup === true)) {
    throw new BudgetDomainError("Escolha apenas contas ativas que aceitam despesas.");
  }
}

export async function expensesForMonth(month: string): Promise<BudgetExpense[]> {
  const snapshot = await financialDbAdmin.collection("expenses")
    .where("competenceMonth", "==", month).limit(MAX_EXPENSES_PER_MONTH + 1).get();
  if (snapshot.size > MAX_EXPENSES_PER_MONTH) {
    throw new BudgetDomainError("Há mais despesas no mês do que esta consulta suporta. Refine a apuração antes de continuar.");
  }
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as BudgetExpense));
}

function summarize(budget: FinancialBudget, expenses: BudgetExpense[], today: string): FinancialBudgetSummary {
  return {
    ...budget,
    ...calculateBudgetConsumption(budget, expenses),
    forecastCoverageAmountCents: calculateBudgetForecastCoverage(budget, expenses),
    curve: buildBudgetBurndownData(budget, expenses, today),
  };
}

export async function listBudgetSummaries(month: string) {
  const [budgetSnapshot, expenseRows] = await Promise.all([
    budgets.where("competenceMonth", "==", month).limit(101).get(),
    expensesForMonth(month),
  ]);
  if (budgetSnapshot.size > 100) throw new BudgetDomainError("Há orçamentos demais nesta competência.");
  const today = financialDateKey(new Date())!;
  return budgetSnapshot.docs.map((doc) => summarize(docData<FinancialBudget>(doc), expenseRows, today));
}

export async function getBudgetSummary(id: string) {
  const snapshot = await budgets.doc(id).get();
  if (!snapshot.exists) throw new BudgetDomainError("Orçamento não encontrado.");
  const budget = docData<FinancialBudget>(snapshot);
  return summarize(budget, await expensesForMonth(budget.competenceMonth), financialDateKey(new Date())!);
}

export async function listBudgetRules() {
  const snapshot = await rules.limit(101).get();
  if (snapshot.size > 100) throw new BudgetDomainError("Há regras de orçamento demais para esta consulta.");
  return snapshot.docs.map((doc) => docData<FinancialBudgetRule>(doc));
}

export async function createBudget(input: z.infer<typeof createBudgetSchema>, uid: string, options?: {
  ruleId?: string;
  calculationMode?: FinancialBudget["calculationMode"];
  calculationSnapshot?: FinancialBudget["calculationSnapshot"];
}) {
  await validateBudgetAccounts(input.accountPlanIds);
  const ref = options?.ruleId ? budgets.doc(`${options.ruleId}_${input.competenceMonth}`) : budgets.doc();
  const claimRefs = input.accountPlanIds.map((accountId) => budgetClaims.doc(`${input.competenceMonth}_${accountId}`));
  const now = Timestamp.now();
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const [existing, ...claims] = await Promise.all([transaction.get(ref), ...claimRefs.map((claim) => transaction.get(claim))]);
    if (existing.exists && options?.ruleId) return { id: ref.id, created: false };
    if (claims.some((claim) => claim.exists)) {
      if (options?.ruleId) return { id: ref.id, created: false, skipped: "Já há orçamento para uma das contas deste mês." };
      throw new BudgetDomainError("Uma das contas já pertence a outro orçamento neste mês.");
    }
    transaction.create(ref, {
      ...input, active: true, source: options?.ruleId ? "generated" : "manual",
      ruleId: options?.ruleId ?? null, calculationMode: options?.calculationMode ?? "manual",
      calculationSnapshot: options?.calculationSnapshot ?? null,
      createdBy: uid, createdAt: now, updatedAt: now,
    });
    claimRefs.forEach((claim) => transaction.create(claim, { budgetId: ref.id, competenceMonth: input.competenceMonth }));
    return { id: ref.id, created: true };
  });
  return result;
}

export async function updateBudget(id: string, input: z.infer<typeof updateBudgetSchema>, uid: string) {
  const ref = budgets.doc(id);
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BudgetDomainError("Orçamento não encontrado.");
    const budget = snapshot.data() as FinancialBudget;
    if (input.budgetedAmountCents !== undefined && input.budgetedAmountCents !== budget.budgetedAmountCents && !input.reason) {
      throw new BudgetDomainError("Explique por que o valor orçado foi alterado.");
    }
    const claims = budget.accountPlanIds.map((accountId) => budgetClaims.doc(`${budget.competenceMonth}_${accountId}`));
    const claimSnapshots = input.active === true && !budget.active
      ? await Promise.all(claims.map((claim) => transaction.get(claim))) : [];
    if (claimSnapshots.some((claim) => claim.exists && claim.data()?.budgetId !== id)) {
      throw new BudgetDomainError("Uma das contas já pertence a outro orçamento neste mês.");
    }
    const { reason, ...changes } = input;
    const now = Timestamp.now();
    transaction.update(ref, { ...changes, updatedAt: now, updatedBy: uid });
    transaction.create(revisions.doc(), { budgetId: id, previous: {
      name: budget.name, budgetedAmountCents: budget.budgetedAmountCents, active: budget.active,
    }, changes, reason: reason ?? null, actorUid: uid, createdAt: now });
    if (input.active === false && budget.active) claims.forEach((claim) => transaction.delete(claim));
    if (input.active === true && !budget.active) claims.forEach((claim) => transaction.set(claim, { budgetId: id, competenceMonth: budget.competenceMonth }));
  });
}

export async function createBudgetRule(input: z.infer<typeof createBudgetRuleSchema>, uid: string) {
  await validateBudgetAccounts(input.accountPlanIds);
  if (input.mode === "consumption_price") await previewBudgetRule(input, input.startMonth);
  const ref = rules.doc();
  const claims = input.accountPlanIds.map((accountId) => ruleClaims.doc(accountId));
  const initialMonthClaims = input.accountPlanIds.map((accountId) => budgetClaims.doc(`${input.startMonth}_${accountId}`));
  await financialDbAdmin.runTransaction(async (transaction) => {
    const [existing, initial] = await Promise.all([
      Promise.all(claims.map((claim) => transaction.get(claim))),
      Promise.all(initialMonthClaims.map((claim) => transaction.get(claim))),
    ]);
    if (existing.some((claim) => claim.exists)) throw new BudgetDomainError("Uma das contas já tem outra regra automática ativa.");
    if (initial.some((claim) => claim.exists)) throw new BudgetDomainError("Uma das contas já tem orçamento no mês inicial. Escolha outra competência ou desative o orçamento existente.");
    const now = Timestamp.now();
    transaction.create(ref, { ...input, active: true, createdBy: uid, createdAt: now, updatedAt: now });
    claims.forEach((claim) => transaction.create(claim, { ruleId: ref.id }));
  });
  return { id: ref.id };
}

export async function updateBudgetRule(id: string, input: z.infer<typeof updateBudgetRuleSchema>, uid: string) {
  const ref = rules.doc(id);
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BudgetDomainError("Regra não encontrada.");
    const rule = snapshot.data() as FinancialBudgetRule;
    const claims = rule.accountPlanIds.map((accountId) => ruleClaims.doc(accountId));
    const existing = input.active && !rule.active ? await Promise.all(claims.map((claim) => transaction.get(claim))) : [];
    if (existing.some((claim) => claim.exists && claim.data()?.ruleId !== id)) {
      throw new BudgetDomainError("Uma das contas já tem outra regra automática ativa.");
    }
    const now = Timestamp.now();
    transaction.update(ref, { active: input.active, updatedAt: now, updatedBy: uid });
    transaction.create(revisions.doc(), { ruleId: id, previous: { active: rule.active }, changes: input,
      reason: null, actorUid: uid, createdAt: now });
    if (!input.active && rule.active) claims.forEach((claim) => transaction.delete(claim));
    if (input.active && !rule.active) claims.forEach((claim) => transaction.set(claim, { ruleId: id }));
  });
}

export async function previewBudgetRule(rule: Pick<FinancialBudgetRule, "mode" | "accountPlanIds" | "fixedAmountCents" | "averageMonths">, month: string) {
  if (rule.mode === "consumption_price") {
    const stockRule = rule as Pick<FinancialBudgetRule,
      "baseProductIds" | "averageMonths" | "closingStockDays" | "accountPlanIds" | "stockKioskId">;
    const estimate = await estimateConsumptionPriceBudget(stockRule, month);
    const committedAmountCents = calculateBudgetConsumption({
      accountPlanIds: rule.accountPlanIds, competenceMonth: month, budgetedAmountCents: 0,
    }, await expensesForMonth(month)).consumedAmountCents;
    return { amountCents: committedAmountCents + estimate.additionalAmountCents,
      snapshot: { referenceMonths: estimate.referenceMonths, referenceAmountsCents: [] as number[],
        calculatedAt: new Date().toISOString(), inputEstimates: estimate.inputEstimates, committedAmountCents } };
  }
  if (rule.mode === "fixed") return {
    amountCents: rule.fixedAmountCents ?? 0,
    snapshot: { referenceMonths: [] as string[], referenceAmountsCents: [] as number[], calculatedAt: new Date().toISOString() },
  };
  const referenceMonths: string[] = [];
  let reference = previousMonth(month);
  const lastClosed = previousMonth(currentMonth());
  if (reference > lastClosed) reference = lastClosed;
  const count = rule.mode === "expense_previous" ? 1 : rule.averageMonths;
  for (let i = 0; i < count; i++) {
    referenceMonths.push(reference);
    reference = previousMonth(reference);
  }
  const references = await Promise.all(referenceMonths.map(expensesForMonth));
  if (references.some((expenses, index) => !expenses.some((expense) => {
    if (expense.provisionType === "forecast" || ["draft", "cancelled", "reconciled"].includes(String(expense.status))) return false;
    return calculateBudgetConsumption({ accountPlanIds: rule.accountPlanIds,
      competenceMonth: referenceMonths[index], budgetedAmountCents: 0 }, [expense]).consumedAmountCents > 0;
  }))) {
    throw new BudgetDomainError("Faltam despesas válidas em um ou mais meses de referência. Confira o histórico antes de usar o cálculo automático.");
  }
  const referenceAmountsCents = references.map((expenses, index) => calculateBudgetConsumption({
    accountPlanIds: rule.accountPlanIds, competenceMonth: referenceMonths[index], budgetedAmountCents: 0,
  }, expenses).consumedAmountCents);
  const amountCents = Math.round(referenceAmountsCents.reduce((sum, amount) => sum + amount, 0) / count);
  return { amountCents, snapshot: { referenceMonths, referenceAmountsCents, calculatedAt: new Date().toISOString() } };
}

export async function generateBudgetMonth(month: string, uid: string) {
  const activeRules = (await listBudgetRules()).filter((rule) => rule.active && rule.startMonth <= month);
  const results = [];
  for (const rule of activeRules) {
    const generatedId = `${rule.id}_${month}`;
    if ((await budgets.doc(generatedId).get()).exists) {
      results.push({ ruleId: rule.id, id: generatedId, created: false });
      continue;
    }
    const preview = await previewBudgetRule(rule, month);
    results.push({ ruleId: rule.id, ...await createBudget({
      name: rule.name, accountPlanIds: rule.accountPlanIds,
      competenceMonth: month, budgetedAmountCents: preview.amountCents,
    }, uid, { ruleId: rule.id, calculationMode: rule.mode, calculationSnapshot: preview.snapshot }) });
  }
  return results;
}

export async function listBudgetProjects() {
  const snapshot = await projects.limit(51).get();
  if (snapshot.size > 50) throw new BudgetDomainError("Há projetos demais para esta consulta.");
  return snapshot.docs.map((doc) => docData<FinancialBudgetProject>(doc));
}

export async function createBudgetProject(input: z.infer<typeof createBudgetProjectSchema>, uid: string) {
  await validateBudgetAccounts(input.accountPlanIds);
  const ref = projects.doc();
  const now = Timestamp.now();
  await ref.create({ ...input, active: true, expenseIds: [], createdBy: uid, createdAt: now, updatedAt: now });
  return { id: ref.id };
}

export async function getBudgetProjectSummary(id: string): Promise<FinancialBudgetProjectSummary> {
  const snapshot = await projects.doc(id).get();
  if (!snapshot.exists) throw new BudgetDomainError("Projeto não encontrado.");
  const project = docData<FinancialBudgetProject>(snapshot);
  if (project.expenseIds.length > 100) throw new BudgetDomainError("Há despesas demais neste projeto.");
  const expenseSnapshots = project.expenseIds.length
    ? await financialDbAdmin.getAll(...project.expenseIds.map((expenseId) => financialDbAdmin.collection("expenses").doc(expenseId))) : [];
  const existing = expenseSnapshots.filter((expense) => expense.exists)
    .map((expense) => ({ id: expense.id, ...expense.data() } as BudgetExpense));
  const summary = calculateProjectBudgetConsumption(project, existing);
  const missing = expenseSnapshots.filter((expense) => !expense.exists).map((expense) => `Despesa ${expense.id} não encontrada.`);
  return { ...project, ...summary, issues: [...summary.issues, ...missing] };
}

export async function updateBudgetProject(id: string, input: z.infer<typeof updateBudgetProjectSchema>, uid: string) {
  const ref = projects.doc(id);
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BudgetDomainError("Projeto não encontrado.");
    const project = snapshot.data() as FinancialBudgetProject;
    if (input.budgetedAmountCents !== undefined && input.budgetedAmountCents !== project.budgetedAmountCents && !input.reason) {
      throw new BudgetDomainError("Explique por que o limite do projeto foi alterado.");
    }
    const { reason, ...changes } = input;
    const now = Timestamp.now();
    transaction.update(ref, { ...changes, updatedAt: now, updatedBy: uid });
    transaction.create(revisions.doc(), { projectId: id, previous: {
      name: project.name, budgetedAmountCents: project.budgetedAmountCents, active: project.active,
    }, changes, reason: reason ?? null, actorUid: uid, createdAt: now });
  });
}

export async function listProjectCandidates(id: string, month: string, search: string) {
  const snapshot = await projects.doc(id).get();
  if (!snapshot.exists) throw new BudgetDomainError("Projeto não encontrado.");
  const project = docData<FinancialBudgetProject>(snapshot);
  if (month < project.startMonth || month > project.endMonth) return [];
  const linked = new Set(project.expenseIds);
  return (await expensesForMonth(month)).filter((expense) => !linked.has(expense.id)
    && (!search || `${expense.description ?? ""} ${expense.id}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))))
    .map((expense) => ({ expense, value: calculateProjectBudgetConsumption(project, [expense]).consumedAmountCents }))
    .filter(({ value }) => value > 0).slice(0, 50)
    .map(({ expense, value }) => ({ id: expense.id, description: expense.description || "Despesa sem descrição", amountCents: value }));
}

export async function linkProjectExpense(projectId: string, expenseId: string, uid: string) {
  const projectRef = projects.doc(projectId);
  const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
  const claimRef = projectExpenseClaims.doc(expenseId);
  await financialDbAdmin.runTransaction(async (transaction) => {
    const [projectSnap, expenseSnap, claimSnap] = await Promise.all([
      transaction.get(projectRef), transaction.get(expenseRef), transaction.get(claimRef),
    ]);
    if (!projectSnap.exists || !expenseSnap.exists) throw new BudgetDomainError("Projeto ou despesa não encontrado.");
    if (claimSnap.exists) throw new BudgetDomainError("Esta despesa já está vinculada a um projeto.");
    const project = projectSnap.data() as FinancialBudgetProject;
    if (!project.active) throw new BudgetDomainError("Reative o projeto antes de vincular despesas.");
    if (project.expenseIds.length >= 100) throw new BudgetDomainError("Este projeto chegou ao limite de 100 despesas.");
    const contribution = calculateProjectBudgetConsumption(project, [{ id: expenseId, ...expenseSnap.data() } as BudgetExpense]);
    if (contribution.consumedAmountCents <= 0 || contribution.issues.length) {
      throw new BudgetDomainError("A despesa não pertence ao período ou às contas deste projeto.");
    }
    const now = Timestamp.now();
    transaction.create(claimRef, { projectId, createdAt: now });
    transaction.update(projectRef, { expenseIds: [...project.expenseIds, expenseId], updatedAt: now });
    transaction.create(projectEvents.doc(), { projectId, expenseId, action: "link", actorUid: uid, createdAt: now });
  });
}

export async function unlinkProjectExpense(projectId: string, expenseId: string, uid: string) {
  const projectRef = projects.doc(projectId);
  const claimRef = projectExpenseClaims.doc(expenseId);
  await financialDbAdmin.runTransaction(async (transaction) => {
    const [projectSnap, claimSnap] = await Promise.all([transaction.get(projectRef), transaction.get(claimRef)]);
    if (!projectSnap.exists || !claimSnap.exists || claimSnap.data()?.projectId !== projectId) {
      throw new BudgetDomainError("Vínculo não encontrado.");
    }
    const project = projectSnap.data() as FinancialBudgetProject;
    transaction.delete(claimRef);
    const now = Timestamp.now();
    transaction.update(projectRef, { expenseIds: project.expenseIds.filter((id) => id !== expenseId), updatedAt: now });
    transaction.create(projectEvents.doc(), { projectId, expenseId, action: "unlink", actorUid: uid, createdAt: now });
  });
}
