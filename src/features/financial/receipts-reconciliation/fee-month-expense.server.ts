import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { AppError } from "@/lib/observability/app-error";
import { FEE_ACCOUNTS } from "../agent/management";
import { sourceExpenseGuard } from "../cash-closures/withdrawal-classification";
import { assertNoOtherSettlement, readClassificationCatalog } from "../cash-closures/withdrawal-classification.server";
import { financialExpenseAccountingFields } from "../lib/expense-accounting-contract";
import { sourceSettlementSummary } from "../lib/source-settlement";
import { buildFeeReview } from "./fee-review.server";
import { FEE_EXPENSE_LABEL, planFeeMonthExpense, type FeeExpenseKind, type FeeExpensePlan, type FeeExpenseRecordView, type FeeExpenseStatus } from "./fee-month-expense";
import { readStoneReceiptSnapshot } from "./stone-account-snapshot.server";
import { receiptGroupKey, receiptMonthRange } from "./stone-account";

/**
 * Lançamento das taxas Stone do mês como despesa já paga na origem. Registro em `stoneFeeMonthExpenses`
 * (um por workspace × StoneCode × mês) e histórico em `stoneFeeMonthExpenseEvents`, com o ator (`main.users`).
 * Despesa, registro e evento ficam na mesma transação; desfazer cancela as despesas criadas aqui.
 */
type Scope = { workspaceId: string; mappingId: string; kioskId: string; stoneCode: string };
type Actor = { uid: string };
type RecordItem = { kind: FeeExpenseKind; amountCents: number; expenseId: string; expenseGuard: string };
type RecordData = {
  workspaceId: string; mappingId: string; kioskId: string; stoneCode: string; month: string;
  active: boolean; revision: number; fingerprint: string; items: RecordItem[];
  accountPlanId: string; resultCenterId: string; resultCenterName: string;
  actorId: string; actorNamespace: "main.users"; launchedAt: string;
  cancelledAt: string | null; cancelReason: string | null; cancelledBy: string | null;
};

const records = () => db.collection("stoneFeeMonthExpenses");
const events = () => db.collection("stoneFeeMonthExpenseEvents");
const recordId = (scope: Scope, month: string) => createHash("sha256").update(`${scope.workspaceId}:${scope.stoneCode}:${month}`).digest("hex");
const fail = (code: string, safeMessage: string, kind: "CONFLICT" | "EXPECTED_BUSINESS" = "CONFLICT"): never => {
  throw new AppError({ code: `STONE_FEE_EXPENSE_${code}`, kind, safeMessage });
};
const view = (row: RecordData): FeeExpenseRecordView => ({
  active: row.active, revision: row.revision, launchedAt: row.launchedAt, resultCenterName: row.resultCenterName,
  items: row.items.map(item => ({ kind: item.kind, amountCents: item.amountCents, expenseId: item.expenseId })),
  cancelledAt: row.cancelledAt, cancelReason: row.cancelReason,
});

/** Plano do mês a partir da conferência salva e da aba Taxas (mesma fonte que a tela mostra). */
export async function planFromSaved(scope: Scope, month: string, now = new Date()): Promise<FeeExpensePlan> {
  const [saved, review] = await Promise.all([readStoneReceiptSnapshot({ ...scope, month }), buildFeeReview(scope, month, now)]);
  const result = saved.status === "ready" ? saved.result : null;
  const monthKeys = new Set((result?.parcels ?? []).filter(parcel => parcel.saleDate?.startsWith(month)).map(receiptGroupKey));
  const unconfirmedGroups = review.groups.filter(group => monthKeys.has(group.key) && group.reference?.status !== "confirmed").map(group => group.label);
  return planFeeMonthExpense({ month, result, pendingCount: review.pendingCount, unconfirmedGroups });
}

async function unitCenters(scope: Scope) {
  const snapshot = await db.collection("resultCenters").where("unitIds", "array-contains", scope.kioskId).limit(51).get();
  return snapshot.docs.filter(doc => {
    const data = doc.data();
    return (data.workspaceId ?? WORKSPACE_ID) === scope.workspaceId && data.active !== false && Array.isArray(data.unitIds) && data.unitIds.length === 1;
  }).map(doc => ({ id: doc.id, name: String(doc.data().name ?? doc.id) })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function feeMonthExpenseStatus(scope: Scope, month: string, now = new Date()): Promise<FeeExpenseStatus> {
  const [plan, record, centers, account] = await Promise.all([
    planFromSaved(scope, month, now),
    records().doc(recordId(scope, month)).get(),
    unitCenters(scope),
    db.collection("accounts").doc(FEE_ACCOUNTS.mdr).get(),
  ]);
  return { plan, record: record.exists ? view(record.data() as RecordData) : null, centers, accountName: String(account.data()?.name ?? "Taxas de cartão") };
}

export async function launchFeeMonthExpense(scope: Scope, input: { month: string; fingerprint: string; resultCenterId: string }, actor: Actor, now = new Date()) {
  const plan = await planFromSaved(scope, input.month, now);
  if (plan.blockers.length) fail("BLOCKED", plan.blockers[0], "EXPECTED_BUSINESS");
  if (plan.fingerprint !== input.fingerprint) fail("STALE", "Os valores mudaram desde que a tela foi aberta. Recarregue e confira antes de lançar.");
  const id = recordId(scope, input.month);
  const ref = records().doc(id);
  const range = receiptMonthRange(input.month);
  return db.runTransaction(async tx => {
    const current = await tx.get(ref);
    const previous = current.exists ? current.data() as RecordData : null;
    if (previous?.active) {
      if (previous.fingerprint === plan.fingerprint) return { record: view(previous), idempotent: true };
      fail("ALREADY_LAUNCHED", "As taxas deste mês já foram lançadas com outros valores. Desfaça o lançamento antes de lançar de novo.");
    }
    const catalog = await readClassificationCatalog(tx, { workspaceId: scope.workspaceId, unitId: scope.kioskId }, FEE_ACCOUNTS.mdr, input.resultCenterId);
    const revision = (previous?.revision ?? 0) + 1;
    const planned = plan.items.map(item => ({ ...item, expenseId: `stone_fee_${id.slice(0, 20)}_${item.kind}_r${revision}` }));
    // Leituras antes das escritas: despesa já existente com o mesmo ID ou lançamento manual igual bloqueiam.
    const existing = await Promise.all(planned.map(item => tx.get(db.collection("expenses").doc(item.expenseId))));
    if (existing.some(doc => doc.exists)) fail("COLLISION", "Já existe uma despesa com este identificador. Confira o histórico antes de repetir.");
    for (const item of planned) {
      let query = db.collection("expenses").where("competenceMonth", "==", input.month)
        .where("resultCenterId", "==", catalog.resultCenterId).where("totalValue", "==", item.amountCents / 100).limit(26);
      if (scope.workspaceId !== WORKSPACE_ID) query = query.where("workspaceId", "==", scope.workspaceId);
      const manual = await tx.get(query);
      if (manual.size > 25 || manual.docs.some(doc => (doc.data().workspaceId ?? WORKSPACE_ID) === scope.workspaceId
        && doc.data().status !== "cancelled" && !doc.data().sourceSettlement)) {
        fail("MANUAL_CANDIDATE", `Já há uma despesa de ${(item.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} neste mês e centro. Confira se a ${item.label.toLowerCase()} não foi lançada manualmente.`);
      }
    }
    const at = Timestamp.fromDate(now);
    const day = Timestamp.fromDate(new Date(`${range.through}T12:00:00Z`));
    const items: RecordItem[] = planned.map(item => {
      const expense = {
        workspaceId: scope.workspaceId, kioskId: scope.kioskId,
        description: `${FEE_EXPENSE_LABEL[item.kind]} — Stone ${scope.stoneCode} — ${input.month.slice(5, 7)}/${input.month.slice(0, 4)}`,
        totalValue: item.amountCents / 100, competenceDate: day, dueDate: day,
        ...financialExpenseAccountingFields({ competenceMonth: input.month }),
        accountPlan: catalog.accountPlanId, accountId: catalog.accountPlanId, accountPlanName: catalog.accountPlanName,
        resultCenterId: catalog.resultCenterId, resultCenter: catalog.resultCenterName, resultCenterName: catalog.resultCenterName,
        referenceResultCenterId: catalog.resultCenterId, referenceResultCenterName: catalog.resultCenterName,
        status: "paid", paidAt: day, paymentState: "paid", cashEffectIncludedInNetReceivable: true,
        settlementSummary: sourceSettlementSummary(item.amountCents),
        sourceSettlement: { version: 1, kind: "stone_fee_month", sourceId: id, kindDetail: item.kind, amountCents: item.amountCents,
          competenceMonth: input.month, settledOn: range.through, workspaceId: scope.workspaceId, unitId: scope.kioskId },
        paymentMethod: "single", isApportioned: false, hasAccountAllocations: false, hasPersonAllocations: false,
        originModule: "stone_fee_month", createdAt: at, createdBy: actor.uid, updatedAt: at,
      };
      tx.set(db.collection("expenses").doc(item.expenseId), expense);
      return { kind: item.kind, amountCents: item.amountCents, expenseId: item.expenseId, expenseGuard: sourceExpenseGuard(expense) };
    });
    const record: RecordData = {
      workspaceId: scope.workspaceId, mappingId: scope.mappingId, kioskId: scope.kioskId, stoneCode: scope.stoneCode, month: input.month,
      active: true, revision, fingerprint: plan.fingerprint, items,
      accountPlanId: catalog.accountPlanId, resultCenterId: catalog.resultCenterId, resultCenterName: catalog.resultCenterName,
      actorId: actor.uid, actorNamespace: "main.users", launchedAt: now.toISOString(), cancelledAt: null, cancelReason: null, cancelledBy: null,
    };
    tx.set(ref, record);
    tx.create(events().doc(randomUUID()), { recordId: id, type: "launched", revision, workspaceId: scope.workspaceId, stoneCode: scope.stoneCode,
      month: input.month, items: record.items.map(({ kind, amountCents, expenseId }) => ({ kind, amountCents, expenseId })),
      actorId: actor.uid, actorNamespace: "main.users", at: now.toISOString(), reason: null });
    return { record: view(record), idempotent: false };
  });
}

export async function cancelFeeMonthExpense(scope: Scope, input: { month: string; reason: string }, actor: Actor, now = new Date()) {
  const id = recordId(scope, input.month);
  const ref = records().doc(id);
  return db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!current.exists) fail("NOT_FOUND", "Não há lançamento deste mês.");
    const record = current.data() as RecordData;
    if (record.workspaceId !== scope.workspaceId || record.stoneCode !== scope.stoneCode || record.kioskId !== scope.kioskId) fail("SCOPE", "Lançamento fora do vínculo selecionado.");
    if (!record.active) return { record: view(record), idempotent: true };
    const expenses = await Promise.all(record.items.map(item => tx.get(db.collection("expenses").doc(item.expenseId))));
    for (const [index, expense] of expenses.entries()) {
      if (!expense.exists || sourceExpenseGuard(expense.data()!) !== record.items[index].expenseGuard) {
        fail("CHANGED", "Uma das despesas foi alterada depois do lançamento. Não é seguro desfazer automaticamente.");
      }
      await assertNoOtherSettlement(tx, expense.id, expense.data()!);
    }
    const at = Timestamp.fromDate(now);
    for (const expense of expenses) tx.update(expense.ref, { status: "cancelled", updatedAt: at, sourceSettlementReversal: { reason: input.reason, reversedAt: at, reversedBy: actor.uid } });
    const next: RecordData = { ...record, active: false, cancelledAt: now.toISOString(), cancelReason: input.reason, cancelledBy: actor.uid };
    tx.set(ref, next);
    tx.create(events().doc(randomUUID()), { recordId: id, type: "cancelled", revision: record.revision, workspaceId: scope.workspaceId, stoneCode: scope.stoneCode,
      month: input.month, items: record.items.map(({ kind, amountCents, expenseId }) => ({ kind, amountCents, expenseId })),
      actorId: actor.uid, actorNamespace: "main.users", at: now.toISOString(), reason: input.reason });
    return { record: view(next), idempotent: false };
  });
}
