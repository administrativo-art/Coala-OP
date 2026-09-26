import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import { calculateBudgetConsumption, calculateBudgetForecastCoverage, buildBudgetBurndownData, type BudgetExpense } from "@/features/financial/lib/budget-consumption";
import { serializeFinancialValue } from "@/features/financial/lib/server-access";
import { createBudgetSchema, createBudgetRuleSchema, createBudgetProjectSchema, updateBudgetSchema, updateBudgetRuleSchema, updateBudgetProjectSchema, budgetCoverageSchema } from "./schemas";
import type { FinancialBudget, FinancialBudgetRule, FinancialBudgetSummary, FinancialBudgetProject, FinancialBudgetProjectSummary } from "./types";
import type { z } from "zod";
import { BudgetDomainError } from "./errors";
import { estimateConsumptionPriceBudget } from "./input-estimate.server";
import { calculateProjectBudgetConsumption } from "@/features/financial/lib/budget-project-consumption";
import type { ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { changeBudgetClaim, claimConflicts } from "./claims";
import { makeBudgetCoverage, materializeBudgetComposition, shiftBudgetMonth, summarizeBudgetPeople } from "./composition";
import { resolveBudgetCenter, resolveBudgetEmployees, resolveBudgetExpenseCenters } from "./references.server";
import { canEditBudgetPersonnel } from "./personnel-access";
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

export async function validateBudgetAccounts(accountPlanIds: string[], transaction?: FirebaseFirestore.Transaction) {
  const refs = accountPlanIds.map((id) => financialDbAdmin.collection("accounts").doc(id));
  const snapshots = transaction ? await transaction.getAll(...refs) : await financialDbAdmin.getAll(...refs);
  const childrenQuery = financialDbAdmin.collection("accounts").where("parentId", "in", accountPlanIds).limit(1);
  const children = transaction ? await transaction.get(childrenQuery) : await childrenQuery.get();
  if (!children.empty || snapshots.some((snapshot) => !snapshot.exists || snapshot.data()?.active === false || snapshot.data()?.isGroup === true)) {
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
  const consumption = calculateBudgetConsumption(budget, expenses);
  const composition = budget.composition?.length ? summarizeBudgetPeople(budget, expenses) : undefined;
  return {
    ...budget,
    hasComposition: Boolean(budget.composition?.length),
    ...consumption,
    ...composition,
    issues: [...consumption.issues, ...composition?.issues ?? []],
    forecastCoverageAmountCents: calculateBudgetForecastCoverage(budget, expenses),
    curve: buildBudgetBurndownData(budget, expenses, today),
  };
}

export async function listBudgetSummaries(month: string, resultCenterId?: string, actor?: ServerUserContext) {
  await resolveBudgetCenter(resultCenterId, actor, undefined, false);
  let query = budgets.where("competenceMonth", "==", month);
  if (resultCenterId) query = query.where("resultCenterId", "==", resultCenterId);
  const [budgetSnapshot, expenseRows] = await Promise.all([
    query.limit(101).get(),
    expensesForMonth(month),
  ]);
  if (budgetSnapshot.size > 100) throw new BudgetDomainError("Há orçamentos demais nesta competência.");
  const today = financialDateKey(new Date())!;
  const rows = await resolveBudgetExpenseCenters(expenseRows);
  return budgetSnapshot.docs.map((doc) => summarize(docData<FinancialBudget>(doc), rows, today));
}

export async function getBudgetSummary(id: string, actor?: ServerUserContext) {
  const snapshot = await budgets.doc(id).get();
  if (!snapshot.exists) throw new BudgetDomainError("Orçamento não encontrado.");
  const budget = docData<FinancialBudget>(snapshot);
  await resolveBudgetCenter(budget.resultCenterId, actor, undefined, false);
  return summarize(budget, await resolveBudgetExpenseCenters(await expensesForMonth(budget.competenceMonth)), financialDateKey(new Date())!);
}

export async function listBudgetRules(options?: { active?: boolean; resultCenterId?: string; actor?: ServerUserContext }) {
  await resolveBudgetCenter(options?.resultCenterId, options?.actor, undefined, false);
  let query = rules.where("active", "==", options?.active ?? true);
  if (options?.resultCenterId) query = query.where("resultCenterId", "==", options.resultCenterId);
  const snapshot = await query.limit(101).get();
  if (snapshot.size > 100) throw new BudgetDomainError("Há regras de orçamento demais para esta consulta.");
  return snapshot.docs.map((doc) => { const rule = docData<FinancialBudgetRule>(doc); return { ...rule, hasComposition: Boolean(rule.composition?.length) }; });
}

function assertPersonnelWrite(actor?: ServerUserContext) {
  if (actor && !canEditBudgetPersonnel(actor)) throw new AppError({ code: "BUDGET_PERSONNEL_FORBIDDEN", kind: "AUTHORIZATION" });
}

function writeClaims(transaction: FirebaseFirestore.Transaction, snapshots: FirebaseFirestore.DocumentSnapshot[], centerId: string | null | undefined, ownerId: string, acquire: boolean) {
  snapshots.forEach((snapshot) => {
    const next = changeBudgetClaim(snapshot.data(), centerId, ownerId, acquire);
    if (next) transaction.set(snapshot.ref, next);
    else if (snapshot.exists) transaction.delete(snapshot.ref);
  });
}

export async function createBudget(input: z.infer<typeof createBudgetSchema>, uid: string, options?: {
  ruleId?: string;
  calculationMode?: FinancialBudget["calculationMode"];
  calculationSnapshot?: FinancialBudget["calculationSnapshot"];
  actor?: ServerUserContext;
}) {
  input = createBudgetSchema.parse(input);
  if (input.composition) assertPersonnelWrite(options?.actor);
  const names = await resolveBudgetEmployees(input.composition?.map((line) => line.employeeId) ?? [], input.competenceMonth, options?.actor);
  const composition = input.composition?.map((line) => ({ ...line, employeeName: names.get(line.employeeId)! }));
  const ref = options?.ruleId ? budgets.doc(`${options.ruleId}_${input.competenceMonth}`) : budgets.doc();
  const claimRefs = input.accountPlanIds.map((accountId) => budgetClaims.doc(`${input.competenceMonth}_${accountId}`));
  const now = Timestamp.now();
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const [existing, ...claims] = await Promise.all([transaction.get(ref), ...claimRefs.map((claim) => transaction.get(claim))]);
    if (existing.exists && options?.ruleId) return { id: ref.id, created: false };
    await validateBudgetAccounts(input.accountPlanIds, transaction);
    const scope = await resolveBudgetCenter(input.resultCenterId, options?.actor, transaction);
    if (options?.ruleId) {
      const ruleSnapshot = await transaction.get(rules.doc(options.ruleId));
      const rule = ruleSnapshot.data() as FinancialBudgetRule | undefined;
      if (!rule?.active || rule.startMonth > input.competenceMonth || (rule.endMonth && rule.endMonth < input.competenceMonth)) {
        throw new BudgetDomainError("Regra inativa ou fora da vigência durante a geração.");
      }
    }
    if (claims.some((claim) => claimConflicts(claim.data(), input.resultCenterId))) {
      if (options?.ruleId) return { id: ref.id, created: false, skipped: "Já há orçamento para uma das contas deste mês." };
      throw new BudgetDomainError("Uma das contas já pertence a outro orçamento neste mês.");
    }
    transaction.create(ref, {
      ...input, active: true, source: options?.ruleId ? "generated" : "manual",
      ...scope, ...(composition ? { composition, compositionEmployeeIds: [...new Set(composition.map((line) => line.employeeId))], purchaseMonths: [...new Set(composition.map((line) => line.expectedPurchaseDate.slice(0, 7)))].sort() } : {}),
      ruleId: options?.ruleId ?? null, calculationMode: options?.calculationMode ?? "manual",
      calculationSnapshot: options?.calculationSnapshot ?? null,
      createdBy: uid, createdAt: now, updatedAt: now,
    });
    writeClaims(transaction, claims, input.resultCenterId, ref.id, true);
    return { id: ref.id, created: true };
  });
  return result;
}

export async function updateBudget(id: string, input: z.infer<typeof updateBudgetSchema>, uid: string, actor?: ServerUserContext) {
  input = updateBudgetSchema.parse(input);
  const ref = budgets.doc(id);
  // HR is a separate database: eligibility preflight, never represented as a cross-database transaction.
  const before = await ref.get();
  if (!before.exists) throw new BudgetDomainError("Orçamento não encontrado.");
  const original = before.data() as FinancialBudget;
  await resolveBudgetCenter(original.resultCenterId, actor, undefined, false);
  if (original.composition || input.composition) assertPersonnelWrite(actor);
  if (input.active === true && !original.active && original.composition) {
    await resolveBudgetEmployees(original.composition.map((line) => line.employeeId), original.competenceMonth, actor);
  }
  const names = input.composition ? await resolveBudgetEmployees(input.composition.map((line) => line.employeeId), original.competenceMonth, actor) : null;
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BudgetDomainError("Orçamento não encontrado.");
    const budget = snapshot.data() as FinancialBudget;
    await resolveBudgetCenter(budget.resultCenterId, actor, transaction, input.active === true);
    if (input.active === true && !budget.active) await validateBudgetAccounts(budget.accountPlanIds, transaction);
    if (budget.composition || input.composition) assertPersonnelWrite(actor);
    const composition = input.composition?.map((line) => ({ ...line, employeeName: names!.get(line.employeeId)! })) ?? budget.composition;
    if (input.composition) {
      if (!input.reason) throw new BudgetDomainError("Explique a revisão da composição.");
      for (const previous of budget.composition ?? []) {
        const matching = composition?.find((line) => line.employeeId === previous.employeeId && line.accountPlanId === previous.accountPlanId);
        const sameId = composition?.find((line) => line.id === previous.id);
        if ((matching && matching.id !== previous.id) || (sameId && (sameId.employeeId !== previous.employeeId || sameId.accountPlanId !== previous.accountPlanId))) {
          throw new BudgetDomainError("Preserve os identificadores das linhas e não os reutilize para outra pessoa/conta.");
        }
      }
    }
    const amount = input.budgetedAmountCents ?? (input.composition ? composition!.reduce((sum, line) => sum + line.amountCents, 0) : budget.budgetedAmountCents);
    const candidate = createBudgetSchema.safeParse({ ...budget, ...input, composition, budgetedAmountCents: amount });
    if (!candidate.success) throw new BudgetDomainError("Composição, centro, contas ou soma incompatíveis com o orçamento.");
    if (input.budgetedAmountCents !== undefined && input.budgetedAmountCents !== budget.budgetedAmountCents && !input.reason) {
      throw new BudgetDomainError("Explique por que o valor orçado foi alterado.");
    }
    const claims = budget.accountPlanIds.map((accountId) => budgetClaims.doc(`${budget.competenceMonth}_${accountId}`));
    const claimSnapshots = input.active !== undefined && input.active !== budget.active
      ? await Promise.all(claims.map((claim) => transaction.get(claim))) : [];
    if (input.active === true && claimSnapshots.some((claim) => claimConflicts(claim.data(), budget.resultCenterId, id))) {
      throw new BudgetDomainError("Uma das contas já pertence a outro orçamento neste mês.");
    }
    const { reason, composition: _composition, ...fields } = input;
    const changes = { ...fields, budgetedAmountCents: amount, ...(input.composition ? {
      composition, compositionEmployeeIds: [...new Set(composition!.map((line) => line.employeeId))], purchaseMonths: [...new Set(composition!.map((line) => line.expectedPurchaseDate.slice(0, 7)))].sort(), coverage: [],
    } : {}) };
    const now = Timestamp.now();
    transaction.update(ref, { ...changes, updatedAt: now, updatedBy: uid });
    transaction.create(revisions.doc(), { budgetId: id, previous: {
      name: budget.name, budgetedAmountCents: budget.budgetedAmountCents, active: budget.active,
      ...(budget.composition ? { composition: budget.composition, coverage: budget.coverage ?? [] } : {}),
    }, changes, reason: reason ?? null, actorUid: uid, createdAt: now });
    if (input.active !== undefined && input.active !== budget.active) writeClaims(transaction, claimSnapshots, budget.resultCenterId, id, input.active);
  });
}

export async function createBudgetRule(input: z.infer<typeof createBudgetRuleSchema>, uid: string, actor?: ServerUserContext) {
  input = createBudgetRuleSchema.parse(input);
  if (input.composition) assertPersonnelWrite(actor);
  const names = await resolveBudgetEmployees(input.composition?.map((line) => line.employeeId) ?? [], input.startMonth, actor);
  const composition = input.composition?.map((line) => ({ ...line, employeeName: names.get(line.employeeId)! }));
  if (input.mode === "consumption_price") await previewBudgetRule(input, input.startMonth);
  const ref = rules.doc();
  const claims = input.accountPlanIds.map((accountId) => ruleClaims.doc(accountId));
  const initialMonthClaims = input.accountPlanIds.map((accountId) => budgetClaims.doc(`${input.startMonth}_${accountId}`));
  await financialDbAdmin.runTransaction(async (transaction) => {
    const [existing, initial] = await Promise.all([
      Promise.all(claims.map((claim) => transaction.get(claim))),
      Promise.all(initialMonthClaims.map((claim) => transaction.get(claim))),
    ]);
    await validateBudgetAccounts(input.accountPlanIds, transaction);
    const scope = await resolveBudgetCenter(input.resultCenterId, actor, transaction);
    if (existing.some((claim) => claimConflicts(claim.data(), input.resultCenterId))) throw new BudgetDomainError("Uma das contas já tem outra regra automática ativa.");
    if (initial.some((claim) => claimConflicts(claim.data(), input.resultCenterId))) throw new BudgetDomainError("Uma das contas já tem orçamento no mês inicial. Escolha outra competência ou desative o orçamento existente.");
    const now = Timestamp.now();
    transaction.create(ref, { ...input, ...scope, ...(composition ? { composition } : {}), active: true, createdBy: uid, createdAt: now, updatedAt: now });
    writeClaims(transaction, existing, input.resultCenterId, ref.id, true);
  });
  return { id: ref.id };
}

export async function updateBudgetRule(id: string, input: z.infer<typeof updateBudgetRuleSchema>, uid: string, actor?: ServerUserContext) {
  input = updateBudgetRuleSchema.parse(input);
  const ref = rules.doc(id);
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BudgetDomainError("Regra não encontrada.");
    const rule = snapshot.data() as FinancialBudgetRule;
    if (rule.composition) assertPersonnelWrite(actor);
    await resolveBudgetCenter(rule.resultCenterId, actor, transaction, input.active);
    if (input.active && !rule.active) await validateBudgetAccounts(rule.accountPlanIds, transaction);
    const claims = rule.accountPlanIds.map((accountId) => ruleClaims.doc(accountId));
    const existing = input.active !== rule.active ? await Promise.all(claims.map((claim) => transaction.get(claim))) : [];
    if (input.active && existing.some((claim) => claimConflicts(claim.data(), rule.resultCenterId, id))) {
      throw new BudgetDomainError("Uma das contas já tem outra regra automática ativa.");
    }
    const now = Timestamp.now();
    transaction.update(ref, { active: input.active, updatedAt: now, updatedBy: uid });
    transaction.create(revisions.doc(), { ruleId: id, previous: { active: rule.active }, changes: input,
      reason: null, actorUid: uid, createdAt: now });
    if (input.active !== rule.active) writeClaims(transaction, existing, rule.resultCenterId, id, input.active);
  });
}

export async function previewBudgetRule(rule: Pick<FinancialBudgetRule, "mode" | "accountPlanIds" | "fixedAmountCents" | "averageMonths" | "resultCenterId">, month: string,
  loadExpenses: (month: string) => Promise<BudgetExpense[]> = async (key) => resolveBudgetExpenseCenters(await expensesForMonth(key))) {
  if (rule.mode === "consumption_price") {
    if (rule.resultCenterId) throw new BudgetDomainError("Consumo/estoque por centro ainda não é suportado.");
    const stockRule = rule as Pick<FinancialBudgetRule,
      "baseProductIds" | "averageMonths" | "closingStockDays" | "accountPlanIds" | "stockKioskId">;
    const estimate = await estimateConsumptionPriceBudget(stockRule, month);
    const committedAmountCents = calculateBudgetConsumption({
      accountPlanIds: rule.accountPlanIds, competenceMonth: month, budgetedAmountCents: 0,
    }, await loadExpenses(month)).consumedAmountCents;
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
  const references = await Promise.all(referenceMonths.map(loadExpenses));
  if (references.some((expenses, index) => !expenses.some((expense) => {
    if (expense.provisionType === "forecast" || ["draft", "cancelled", "reconciled"].includes(String(expense.status))) return false;
    return calculateBudgetConsumption({ accountPlanIds: rule.accountPlanIds, resultCenterId: rule.resultCenterId,
      competenceMonth: referenceMonths[index], budgetedAmountCents: 0 }, [expense]).consumedAmountCents > 0;
  }))) {
    throw new BudgetDomainError("Faltam despesas válidas em um ou mais meses de referência. Confira o histórico antes de usar o cálculo automático.");
  }
  const referenceAmountsCents = references.map((expenses, index) => calculateBudgetConsumption({
    accountPlanIds: rule.accountPlanIds, resultCenterId: rule.resultCenterId, competenceMonth: referenceMonths[index], budgetedAmountCents: 0,
  }, expenses).consumedAmountCents);
  const amountCents = Math.round(referenceAmountsCents.reduce((sum, amount) => sum + amount, 0) / count);
  return { amountCents, snapshot: { referenceMonths, referenceAmountsCents, calculatedAt: new Date().toISOString() } };
}

export async function generateBudgetMonth(month: string, uid: string, options?: {
  actor?: ServerUserContext; resultCenterId?: string; advanceOnly?: boolean;
  expenseCache?: Map<string, Promise<BudgetExpense[]>>;
}) {
  const activeRules = (await listBudgetRules({ actor: options?.actor, resultCenterId: options?.resultCenterId }))
    .filter((rule) => rule.startMonth <= month && (!rule.endMonth || rule.endMonth >= month)
      && (!options?.advanceOnly || rule.generationLeadMonths === 1));
  // Validate permissions for the entire request before making the first write.
  if (activeRules.some((rule) => rule.composition?.length)) assertPersonnelWrite(options?.actor);
  const cache = options?.expenseCache ?? new Map<string, Promise<BudgetExpense[]>>();
  const loadExpenses = (key: string) => {
    if (!cache.has(key)) cache.set(key, expensesForMonth(key).then(resolveBudgetExpenseCenters));
    return cache.get(key)!;
  };
  const results = [];
  for (const rule of activeRules) {
    const generatedId = `${rule.id}_${month}`;
    if ((await budgets.doc(generatedId).get()).exists) {
      results.push({ ruleId: rule.id, id: generatedId, created: false });
      continue;
    }
    try {
      const preview = await previewBudgetRule(rule, month, loadExpenses);
      const composition = materializeBudgetComposition(rule, month);
      results.push({ ruleId: rule.id, ...await createBudget({
        name: rule.name, accountPlanIds: rule.accountPlanIds, ...(rule.resultCenterId ? { resultCenterId: rule.resultCenterId } : {}),
        competenceMonth: month, budgetedAmountCents: preview.amountCents, ...(composition ? { composition } : {}),
      }, uid, { ruleId: rule.id, calculationMode: rule.mode, calculationSnapshot: preview.snapshot, actor: options?.actor }) });
    } catch (error) {
      if (!(error instanceof BudgetDomainError)) throw error;
      results.push({ ruleId: rule.id, created: false, skipped: error.message });
    }
  }
  return results;
}

export async function generateScheduledBudgetMonths(month: string, uid: string) {
  const expenseCache = new Map<string, Promise<BudgetExpense[]>>();
  const current = await generateBudgetMonth(month, uid, { expenseCache });
  const nextMonth = shiftBudgetMonth(month, 1);
  const next = await generateBudgetMonth(nextMonth, uid, { advanceOnly: true, expenseCache });
  return { current, nextMonth, next };
}

export async function confirmBudgetCoverage(id: string, input: z.infer<typeof budgetCoverageSchema>, uid: string, actor?: ServerUserContext) {
  input = budgetCoverageSchema.parse(input);
  assertPersonnelWrite(actor);
  await financialDbAdmin.runTransaction(async (transaction) => {
    const ref = budgets.doc(id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BudgetDomainError("Orçamento não encontrado.");
    const budget = docData<FinancialBudget>(snapshot);
    await resolveBudgetCenter(budget.resultCenterId, actor, transaction);
    const expenseSnapshot = await transaction.get(financialDbAdmin.collection("expenses")
      .where("competenceMonth", "==", budget.competenceMonth).limit(MAX_EXPENSES_PER_MONTH + 1));
    if (expenseSnapshot.size > MAX_EXPENSES_PER_MONTH) throw new BudgetDomainError("Limite de 2.000 despesas por competência excedido.");
    const rows = await resolveBudgetExpenseCenters(expenseSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as BudgetExpense)));
    const now = new Date().toISOString();
    const confirmation = makeBudgetCoverage(budget, rows, input, uid, now);
    const coverage = [...(budget.coverage ?? []).filter((item) => item.lineId !== input.lineId), confirmation];
    transaction.update(ref, { coverage, updatedAt: Timestamp.now(), updatedBy: uid });
    transaction.create(revisions.doc(), { budgetId: id, action: "coverage", previous: budget.coverage ?? [],
      changes: confirmation, reason: input.reason, actorUid: uid, createdAt: Timestamp.now() });
  });
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
