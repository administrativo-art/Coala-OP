import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { AppError } from "@/lib/observability/app-error";
import { FEE_ACCOUNTS } from "../agent/management";
import { sourceExpenseGuard } from "../cash-closures/withdrawal-classification";
import { assertNoOtherSettlement } from "../cash-closures/withdrawal-classification.server";
import { buildFeeReview } from "./fee-review.server";
import { planFeeMonthExpense, type FeeExpenseKind, type FeeExpensePlan, type FeeExpenseRecordView, type FeeExpenseStatus } from "./fee-month-expense";
import { readStoneReceiptSnapshot } from "./stone-account-snapshot.server";
import { receiptGroupKey } from "./stone-account";

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

export async function launchFeeMonthExpense(_scope: Scope, _input: { month: string; fingerprint: string; resultCenterId: string }, _actor: Actor, _now = new Date()) {
  void _now;
  return fail("RECOGNITION_REQUIRED", "O lançamento mensal que marcava todas as taxas como pagas foi substituído. Use a prévia por data da venda para reconhecer antes do crédito, sem repetir taxas do histórico.");
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
