import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
import { enableServerOnlyTestImports } from "../helpers/server-only-runtime.mjs";
assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository", databaseId: "coala-financeiro" });
enableServerOnlyTestImports("demo-coala-repository");
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { WORKSPACE_ID } = await import("../../src/lib/workspace.ts");
const { FEE_ACCOUNTS } = await import("../../src/features/financial/agent/management.ts");
const { saveStoneReceiptSnapshot } = await import("../../src/features/financial/receipts-reconciliation/stone-account-snapshot.server.ts");
const { resolveCardFee } = await import("../../src/features/financial/receipts-reconciliation/stone-account.ts");
const service = await import("../../src/features/financial/receipts-reconciliation/fee-month-expense.server.ts");

const prefix = "stone-fee-month";
const month = "2026-10";
const now = new Date("2026-11-15T12:00:00Z");
const scope = { workspaceId: WORKSPACE_ID, mappingId: `${prefix}-mapping`, kioskId: `${prefix}-unit`, stoneCode: "778899" };
const centerId = `${prefix}-center`;
const actor = { uid: `${prefix}-admin` };
const code = expected => error => error.code === expected;

const pix = (id, grossCents, feeCents) => ({ id: `pix:${id}`, saleId: id, source: "pix", installment: 1, installmentCount: 1, brandCode: null, brand: null,
  modality: "pix", saleDate: "2026-10-05", saleTime: "10:00:00", grossCents, feeCents, feeSource: "stone", feeRate: null, anticipationCents: null,
  expectedNetCents: grossCents - feeCents, expectedDate: "2026-10-05", paidDate: "2026-10-05", paidNetCents: grossCents - feeCents, status: "paid" });
const card = (id, brand, modality, gross, net) => {
  const grossCents = Math.round(Number(gross) * 100);
  return { id: `${id}:1`, saleId: id, source: "card", installment: 1, installmentCount: 1, brandCode: "1", brand, modality,
    saleDate: "2026-10-05", saleTime: "10:00:00", grossCents, ...resolveCardFee({ gross, net }), anticipationCents: null,
    expectedNetCents: grossCents, expectedDate: "2026-10-06", paidDate: "2026-10-06", paidNetCents: grossCents, status: "paid" };
};
const parcels = [pix("p1", 1000, 7), pix("p2", 500, 3), card("d1", "Visa", "debit", "20.000000", "19.708000"), card("c1", "Mastercard", "credit", "50.000000", "48.890000")];
const groupKeys = { pix: 0.0075, "Visa|debit": 0.0146, "Mastercard|credit": 0.0222 };

async function cleanup() {
  for (const name of ["stoneFeeMonthExpenses", "stoneFeeMonthExpenseEvents", "stoneReceiptDecisions", "stoneReceiptMonthSnapshots"]) {
    const rows = await db.collection(name).where("stoneCode", "==", scope.stoneCode).get();
    await Promise.all(rows.docs.map(doc => doc.ref.delete()));
  }
  const expenses = await db.collection("expenses").where("kioskId", "==", scope.kioskId).get();
  await Promise.all(expenses.docs.map(doc => doc.ref.delete()));
  const manual = await db.collection("expenses").where("resultCenterId", "==", centerId).get();
  await Promise.all(manual.docs.map(doc => doc.ref.delete()));
  await Promise.all([db.collection("resultCenters").doc(centerId).delete(), db.collection("accounts").doc(FEE_ACCOUNTS.mdr).delete()]);
}
test.after(cleanup);

async function confirmGroups() {
  for (const [groupKey, rate] of Object.entries(groupKeys)) {
    await db.collection("stoneReceiptDecisions").doc(`${prefix}-${groupKey.replace("|", "-")}`).set({
      workspaceId: WORKSPACE_ID, stoneCode: scope.stoneCode, mappingId: scope.mappingId, kioskId: scope.kioskId,
      kind: "group_rate", itemKey: groupKey, decision: "confirmed", fingerprint: `group:${rate}`, groupKey, rate, since: "2026-09-01",
      actorId: actor.uid, actorNamespace: "main.users", decidedAt: "2026-11-01T10:00:00.000Z", note: null, revision: 1, month });
  }
}

test("taxas do mês: bloqueia pendência, lança uma despesa por tipo, é idempotente e desfaz com motivo", { timeout: 120_000 }, async () => {
  await cleanup();
  await db.collection("accounts").doc(FEE_ACCOUNTS.mdr).set({ name: "Taxas de cartão", active: true, isGroup: false, is_dre_account: true, dre_position: "despesas_financeiras", workspaceId: WORKSPACE_ID });
  await db.collection("resultCenters").doc(centerId).set({ name: "Centro da unidade", active: true, unitIds: [scope.kioskId], workspaceId: WORKSPACE_ID });
  const result = { scope: { workspaceId: WORKSPACE_ID, mappingId: scope.mappingId, kioskId: scope.kioskId, stoneCode: scope.stoneCode },
    period: { from: "2026-10-01", through: "2026-10-31" }, latestPublished: "2026-10-31", collectedAt: "2026-11-01T09:00:00.000Z", parcels };
  await saveStoneReceiptSnapshot({ ...scope, month }, result, now);

  // Sem taxa atual confirmada: bloqueado e nada é gravado.
  const blocked = await service.feeMonthExpenseStatus(scope, month, now);
  assert.match(blocked.plan.blockers.join(" "), /Confirme a taxa atual/);
  await assert.rejects(service.launchFeeMonthExpense(scope, { month, fingerprint: blocked.plan.fingerprint, resultCenterId: centerId }, actor, now), code("STONE_FEE_EXPENSE_BLOCKED"));

  await confirmGroups();
  const status = await service.feeMonthExpenseStatus(scope, month, now);
  assert.deepEqual(status.plan.blockers, []);
  assert.deepEqual(status.plan.items.map(item => [item.kind, item.amountCents]), [["pix", 10], ["debit", 29], ["credit", 111]]);
  assert.deepEqual(status.centers, [{ id: centerId, name: "Centro da unidade" }]);

  await assert.rejects(service.launchFeeMonthExpense(scope, { month, fingerprint: "2026-10|pix:1", resultCenterId: centerId }, actor, now), code("STONE_FEE_EXPENSE_STALE"));

  // Lançamento manual do mesmo valor, mês e centro impede duplicar.
  const manual = db.collection("expenses").doc(`${prefix}-manual`);
  await manual.set({ workspaceId: WORKSPACE_ID, competenceMonth: month, resultCenterId: centerId, totalValue: 0.29, status: "pending" });
  await assert.rejects(service.launchFeeMonthExpense(scope, { month, fingerprint: status.plan.fingerprint, resultCenterId: centerId }, actor, now), code("STONE_FEE_EXPENSE_MANUAL_CANDIDATE"));
  await manual.delete();

  const launched = await service.launchFeeMonthExpense(scope, { month, fingerprint: status.plan.fingerprint, resultCenterId: centerId }, actor, now);
  assert.equal(launched.idempotent, false);
  assert.equal(launched.record.items.length, 3);
  for (const item of launched.record.items) {
    const expense = (await db.collection("expenses").doc(item.expenseId).get()).data();
    assert.equal(expense.status, "paid");
    assert.equal(expense.totalValue, item.amountCents / 100);
    assert.equal(expense.accountId, FEE_ACCOUNTS.mdr);
    assert.equal(expense.resultCenterId, centerId);
    assert.equal(expense.competenceMonth, month);
    assert.equal(expense.sourceSettlement.kind, "stone_fee_month");
    assert.equal(expense.createdBy, actor.uid);
  }
  const again = await service.launchFeeMonthExpense(scope, { month, fingerprint: status.plan.fingerprint, resultCenterId: centerId }, actor, now);
  assert.equal(again.idempotent, true);
  assert.equal((await db.collection("expenses").where("kioskId", "==", scope.kioskId).get()).size, 3);

  const cancelled = await service.cancelFeeMonthExpense(scope, { month, reason: "Teste de desfazer" }, actor, now);
  assert.equal(cancelled.record.active, false);
  for (const item of launched.record.items) assert.equal((await db.collection("expenses").doc(item.expenseId).get()).get("status"), "cancelled");

  // Depois de desfazer, um novo lançamento gera a revisão 2 com despesas novas.
  const relaunched = await service.launchFeeMonthExpense(scope, { month, fingerprint: status.plan.fingerprint, resultCenterId: centerId }, actor, now);
  assert.equal(relaunched.record.revision, 2);
  assert.ok(relaunched.record.items.every(item => item.expenseId.endsWith("_r2")));
  const events = await db.collection("stoneFeeMonthExpenseEvents").where("stoneCode", "==", scope.stoneCode).get();
  assert.deepEqual(events.docs.map(doc => doc.get("type")).sort(), ["cancelled", "launched", "launched"]);
  assert.ok(events.docs.every(doc => doc.get("actorId") === actor.uid && doc.get("actorNamespace") === "main.users"));
});
