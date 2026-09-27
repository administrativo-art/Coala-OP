import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository", databaseId: "coala-financeiro" });
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { WORKSPACE_ID } = await import("../../src/lib/workspace.ts");
const { Timestamp } = await import("firebase-admin/firestore");
const { upsertClosureFromPdv, getCashClosure, saveCashClosureDraft, finalizeCashClosure, finalizeCashClosureOperator } = await import("../../src/features/financial/cash-closures/repository.server.ts");
const { reopenCashClosureWithDepositHandling } = await import("../../src/features/financial/cash-deposits/repository.server.ts");
const { classifyCashWithdrawal, listWithdrawalClassifications, listWithdrawalExpenseCandidates } = await import("../../src/features/financial/cash-closures/withdrawal-classification.server.ts");
const { registerReportedPayment, queueMatchedBankPayment } = await import("../../src/features/financial/obligations/service.server.ts");

const prefix = "withdrawal-integration";
const actor = { userId: prefix, userName: "Teste sangrias" };
const context = { decoded: { uid: prefix }, userDoc: { username: "Teste sangrias" }, workspace_id: WORKSPACE_ID, isDefaultAdmin: true, permissions: {} };
const accountId = `${prefix}-account`;
const centerId = `${prefix}-center`;
const unit = `${prefix}-unit`;
const ownedRefs = new Map();
const own = ref => { ownedRefs.set(ref.path, ref); return ref; };
const rejectedCode = code => error => error.code === `CASH_WITHDRAWAL_${code}`;

function built(date, amountCents = 1000, extra = {}) {
  const [year, month, day] = date.split("-").map(Number);
  const movements = amountCents ? [{ id: `${prefix}-${date}`, identitySource: "provider", kind: "withdrawal", amountCents,
    date, occurredAt: `${date}T12:00:00-03:00`, operatorId: "op", terminalId: "terminal", paymentMethodId: "cash", paymentMethodName: "DINHEIRO", isCash: true, cancelled: false }] : [];
  return { workspaceId: WORKSPACE_ID, kioskId: unit, kioskName: "Unidade teste", pdvFilialId: `${prefix}-pdv`, date, year, month, day, status: "draft",
    expectedTotalCents: 10000 - amountCents, expectedByChannelCents: { cash: 10000 - amountCents }, operatorCount: 1,
    pdvSales: { version: 1, amountCents: 10000 },
    lines: [{ operatorId: "op", operatorName: "Operador", channel: "cash", channelLabel: "Dinheiro", expectedAmountCents: 10000 - amountCents,
      pdvSales: { version: 1, amountCents: 10000 }, reportedAmountCents: null, reportedDifferenceAmountCents: null, countedAmountCents: null, differenceAmountCents: null,
      status: "pending", rawPaymentNames: ["DINHEIRO"], metadata: { paymentRowCount: 1, grossCashCents: 10000, changeCents: 0, supplyCents: 0, withdrawalCents: amountCents, cashMovements: movements }, note: null }],
    source: { provider: "pdvlegal", endpoint: "cupom/get", couponCount: 1, validCouponCount: 1, ignoredCancelledCouponCount: 0, estornadoCouponCount: 0,
      itemCount: 1, paymentRowCount: 1, rawPaymentNames: ["DINHEIRO"], unknownPaymentNames: [], integrityWarnings: [], unassignedMovementCount: 0 }, ...extra };
}
async function setup(date, amount = 1000) {
  const payload = built(date, amount);
  const result = await upsertClosureFromPdv(payload, actor);
  const id = result.closure.id;
  own(db.collection("cashClosures").doc(id));
  const initial = await getCashClosure(id);
  await saveCashClosureDraft(id, [{ id: initial.lines[0].id, reportedCents: 10000 - amount, countedCents: 10000 - amount }], actor, { editReported: true, editCounted: true });
  return { id, source: (await listWithdrawalClassifications(id, context)).sources[0] };
}
const createInput = source => ({ action: "create", sourceId: source.sourceId, fingerprint: source.fingerprint, accountPlanId: accountId, resultCenterId: centerId, description: "Material de limpeza" });
async function classify(id, input, ctx = context) {
  const result = await classifyCashWithdrawal(id, input, ctx);
  own(db.collection("expenses").doc(result.classification.expenseId));
  own(db.collection("financialSourceSettlements").doc(input.sourceId));
  return result;
}

test.before(async () => {
  await own(db.collection("accounts").doc(accountId)).set({ name: "Limpeza", active: true, isGroup: false, dre_position: "despesas_operacionais", is_dre_account: true });
  await own(db.collection("resultCenters").doc(centerId)).set({ name: "Centro exclusivo", active: true, unitIds: [unit] });
});
test.after(async () => {
  // Only documents created by these tests, never real/whole financial collections.
  for (const ref of ownedRefs.values()) await db.recursiveDelete(ref);
  for (const name of ["cashClosureAuditLogs", "cashClosureMonthlySummaries", "cashClosureUnitSummaries", "cashDepositQueues"]) {
    const snapshot = await db.collection(name).where(name === "cashClosureAuditLogs" ? "userId" : "kioskId", "==", name === "cashClosureAuditLogs" ? prefix : unit).limit(500).get();
    for (const doc of snapshot.docs) await db.recursiveDelete(doc.ref);
  }
});

test("bloqueia finalização legada sem classificação e cria apenas uma despesa sob concorrência/retry", async () => {
  const { id, source } = await setup("2035-08-01");
  await assert.rejects(finalizeCashClosure(id, actor), rejectedCode("CLASSIFICATION_REQUIRED"));
  const results = await Promise.all([classify(id, createInput(source)), classify(id, createInput(source))]);
  assert.equal(results[0].classification.expenseId, results[1].classification.expenseId);
  assert.equal(results.filter(row => row.idempotent).length, 1);
  const expense = (await db.collection("expenses").doc(results[0].classification.expenseId).get()).data();
  assert.equal(expense.status, "paid");
  assert.equal(expense.totalValue, 10);
  assert.equal(expense.competenceMonth, "2035-08");
  assert.equal(expense.paidAt.toDate().toISOString().slice(0, 10), "2035-08-01");
  assert.equal(expense.settlementSummary.balanceAmountCents, 0);
  assert.equal((await db.collection("payments").where("expenseId", "==", results[0].classification.expenseId).get()).empty, true);
  await finalizeCashClosure(id, actor);
  assert.equal((await getCashClosure(id)).closure.status, "approved");
  await assert.rejects(classifyCashWithdrawal(id, { action: "unlink", sourceId: source.sourceId, reason: "Correção" }, context), rejectedCode("REOPEN_REQUIRED"));
  await assert.rejects(registerReportedPayment(results[0].classification.expenseId, { idempotencyKey: "x" }, { uid: prefix }), error => error.code === "EXPENSE_SETTLED_AT_SOURCE");
  await assert.rejects(queueMatchedBankPayment({ batch: db.batch(), expenseId: results[0].classification.expenseId, expense, bankTransactionId: "none", principalAmount: 10, cashAmount: 10, paidAt: Timestamp.now(), actor: { uid: prefix } }), error => error.code === "EXPENSE_SETTLED_AT_SOURCE");
});

test("vincula avulsa real sem workspace e parcela única, preserva notas, restaura sem nova despesa", async () => {
  const { id, source } = await setup("2035-08-02");
  const ref = own(db.collection("expenses").doc(`${prefix}-manual`));
  const dueDate = Timestamp.fromDate(new Date("2035-08-05T12:00:00Z"));
  const original = { obligationId: `obl_${ref.id}`, totalValue: 10, description: "Compra avulsa", status: "pending", paymentMethod: "single",
    competenceMonth: "2035-08", competenceDate: dueDate, dueDate, accountPlan: accountId, accountId, accountPlanName: "Limpeza",
    resultCenterId: centerId, resultCenter: "Centro exclusivo", resultCenterName: "Centro exclusivo",
    installments: [{ number: 1, dueDate, value: 10, status: "pending" }], plannedBankAccountId: null, plannedPaymentMethodType: null,
    hasAccountAllocations: false, accountAllocations: null, hasPersonAllocations: false, personAllocations: null, isApportioned: false, apportionments: null, notes: "Original" };
  await ref.set(original);
  const candidates = await listWithdrawalExpenseCandidates(id, source.sourceId, centerId, undefined, context);
  assert.ok(candidates.candidates.some(row => row.id === ref.id));
  const input = { action: "link", sourceId: source.sourceId, fingerprint: source.fingerprint, existingExpenseId: ref.id };
  assert.equal((await classify(id, input)).classification.expenseId, ref.id);
  assert.equal((await classify(id, input)).idempotent, true);
  const paid = (await ref.get()).data();
  assert.equal(paid.workspaceId, WORKSPACE_ID);
  assert.equal(paid.installments[0].status, "paid");
  assert.equal(paid.installments[0].paidAt.toMillis(), paid.paidAt.toMillis());
  await ref.update({ notes: "Anotação posterior" });
  await assert.rejects(classifyCashWithdrawal(id, { action: "unlink", sourceId: source.sourceId }, context), rejectedCode("INPUT_INVALID"));
  await classify(id, { action: "unlink", sourceId: source.sourceId, reason: "Vínculo incorreto" });
  const restored = (await ref.get()).data();
  assert.equal(restored.sourceSettlement, undefined);
  assert.equal(restored.workspaceId, undefined);
  assert.deepEqual(restored.installments, original.installments);
  assert.equal(restored.status, "pending");
  assert.equal(restored.notes, "Anotação posterior");
});

test("resync/reabertura não duplica; origem alterada exige correção e recertifica a contagem", async () => {
  const { id, source } = await setup("2035-08-03");
  const first = await classify(id, createInput(source));
  await finalizeCashClosure(id, actor);
  await upsertClosureFromPdv(built("2035-08-03", 2000), actor);
  assert.equal((await getCashClosure(id)).closure.pdvChangedAfterApproval, true);
  await reopenCashClosureWithDepositHandling({ closureId: id, workspaceId: WORKSPACE_ID, reason: "Conferir origem alterada", actor, operatorId: "op" });
  await assert.rejects(finalizeCashClosure(id, actor), rejectedCode("CLASSIFICATION_REQUIRED"));
  await classify(id, { action: "unlink", sourceId: source.sourceId, reason: "Valor corrigido pelo PDV" });
  assert.equal((await db.collection("expenses").doc(first.classification.expenseId).get()).data().status, "cancelled");
  const changed = (await listWithdrawalClassifications(id, context)).sources[0];
  await assert.rejects(classify(id, createInput(changed)), rejectedCode("REASON_REQUIRED"));
  const replacement = await classify(id, { ...createInput(changed), reason: "Valor corrigido pelo PDV" });
  assert.notEqual(replacement.classification.expenseId, first.classification.expenseId);
  const current = await getCashClosure(id);
  await saveCashClosureDraft(id, [{ id: current.lines[0].id, reportedCents: 8000, countedCents: 8000 }], actor, { editReported: true, editCounted: true });
  await finalizeCashClosure(id, actor);
  assert.equal((await getCashClosure(id)).closure.pdvChangedAfterApproval, false);
  await upsertClosureFromPdv(built("2035-08-03", 2000), actor);
  assert.equal((await classify(id, { ...createInput(changed), reason: "Retry" })).idempotent, true);
});

test("dois operadores recertificam fonte nova antes de liberar as diferenças da DRE", async () => {
  const date = "2035-08-08";
  function twoOperators(amount) {
    const payload = built(date, 0);
    payload.lines = ["op", "op2"].map(operatorId => ({ ...payload.lines[0], operatorId, operatorName: operatorId,
      expectedAmountCents: amount, pdvSales: { version: 1, amountCents: amount },
      metadata: { ...payload.lines[0].metadata, grossCashCents: amount } }));
    return { ...payload, operatorCount: 2, expectedTotalCents: amount * 2, expectedByChannelCents: { cash: amount * 2 }, pdvSales: { version: 1, amountCents: amount * 2 } };
  }
  const result = await upsertClosureFromPdv(twoOperators(10000), actor), id = result.closure.id;
  own(db.collection("cashClosures").doc(id));
  const initial = await getCashClosure(id);
  await saveCashClosureDraft(id, initial.lines.map(line => ({ id: line.id, reportedCents: 10000, countedCents: 10000 })), actor, { editReported: true, editCounted: true });
  await finalizeCashClosure(id, actor);
  await upsertClosureFromPdv(twoOperators(11000), actor);
  assert.equal((await getCashClosure(id)).closure.pdvChangedAfterApproval, true);
  for (const operatorId of ["op", "op2"]) {
    await reopenCashClosureWithDepositHandling({ closureId: id, workspaceId: WORKSPACE_ID, reason: "Revisão da fonte", actor, operatorId });
    const current = await getCashClosure(id), line = current.lines.find(row => row.operatorId === operatorId);
    await saveCashClosureDraft(id, [{ id: line.id, reportedCents: 11000, countedCents: 11000 }], actor, { editReported: true, editCounted: true });
    await finalizeCashClosureOperator(id, operatorId, actor, { legacyImmediateAllocation: true });
    assert.equal((await getCashClosure(id)).closure.pdvChangedAfterApproval, operatorId === "op");
  }
});

test("scope, permissões, conta-grupo, centro compartilhado e PDV sem identidade são barrados", async () => {
  const { id, source } = await setup("2035-08-04");
  await assert.rejects(classify(id, createInput(source), { ...context, workspace_id: "foreign" }), rejectedCode("WORKSPACE"));
  await assert.rejects(classify(id, createInput(source), { ...context, isDefaultAdmin: false }), rejectedCode("FORBIDDEN"));
  const group = own(db.collection("accounts").doc(`${prefix}-group`));
  const child = own(db.collection("accounts").doc(`${prefix}-child`));
  await group.set({ name: "Grupo", active: true, isGroup: false, dre_position: "despesas_operacionais" });
  await child.set({ parentId: group.id });
  await assert.rejects(classify(id, { ...createInput(source), accountPlanId: group.id }), rejectedCode("ACCOUNT_INVALID"));
  const center = own(db.collection("resultCenters").doc(`${prefix}-shared`));
  await center.set({ active: true, name: "Compartilhado", unitIds: [unit, "foreign"] });
  await assert.rejects(classify(id, { ...createInput(source), resultCenterId: center.id }), rejectedCode("CENTER_INVALID"));
  const unverified = built("2035-08-04");
  delete unverified.lines[0].metadata.cashMovements[0].identitySource;
  await upsertClosureFromPdv(unverified, actor);
  await assert.rejects(classify(id, createInput(source)), rejectedCode("IDENTITY_UNVERIFIED"));
});

test("sem sangrias permite finalizar; contagem alterada revalida autorização sênior na transação", async () => {
  const { id } = await setup("2035-08-05", 0);
  const current = await getCashClosure(id);
  await saveCashClosureDraft(id, [{ id: current.lines[0].id, reportedCents: 7000, countedCents: 7000, note: "Falta", reportedNote: "Falta" }], actor, { editReported: true, editCounted: true });
  const restricted = { ...context, isDefaultAdmin: false, userDoc: { ...context.userDoc, unitAccessScope: "all" }, permissions: { financial: { view: true, cashClosures: { approve: true } } } };
  await assert.rejects(finalizeCashClosureOperator(id, "op", actor, { legacyImmediateAllocation: true, authorizationContext: restricted }), /perfil sênior/);
  await finalizeCashClosure(id, actor);
  assert.equal((await getCashClosure(id)).closure.status, "approved");
});

test("sangria retirada pelo PDV exige desfazer a despesa, mesmo quando a linha contada é preservada", async () => {
  const { id, source } = await setup("2035-08-06");
  const first = await classify(id, createInput(source));
  const removed = built("2035-08-06", 0, { lines: [], expectedTotalCents: 0, expectedByChannelCents: {}, operatorCount: 0, pdvSales: { version: 1, amountCents: 0 } });
  await upsertClosureFromPdv(removed, actor);
  assert.equal((await listWithdrawalClassifications(id, context)).sources.length, 0);
  await assert.rejects(finalizeCashClosure(id, actor), rejectedCode("ORPHAN_CLASSIFICATION"));
  await classify(id, { action: "unlink", sourceId: source.sourceId, reason: "Sangria cancelada no PDV" });
  assert.equal((await db.collection("expenses").doc(first.classification.expenseId).get()).data().status, "cancelled");
  await upsertClosureFromPdv(built("2035-08-06"), actor);
  assert.equal((await listWithdrawalClassifications(id, context)).sources.length, 1);
});

test("batch bancário preparado antes da classificação não pode sobrescrever quitação na origem", async () => {
  const { id, source } = await setup("2035-08-07");
  const ref = own(db.collection("expenses").doc(`${prefix}-bank-race`));
  const expense = { workspaceId: WORKSPACE_ID, totalValue: 10, description: "Despesa avulsa", status: "pending", paymentMethod: "single", competenceMonth: "2035-08", accountId, accountPlan: accountId, resultCenterId: centerId };
  await ref.set(expense);
  const batch = db.batch();
  const match = await queueMatchedBankPayment({ batch, expenseId: ref.id, expense, bankTransactionId: `${prefix}-statement`, principalAmount: 10, cashAmount: 10, paidAt: Timestamp.now(), actor: { uid: prefix } });
  batch.update(ref, match.expensePatch);
  await classify(id, { action: "link", sourceId: source.sourceId, fingerprint: source.fingerprint, existingExpenseId: ref.id });
  await assert.rejects(batch.commit(), error => error.code === 9);
  assert.equal((await db.collection("payments").doc(match.paymentId).get()).exists, false);
  assert.equal((await ref.get()).data().sourceSettlement.sourceId, source.sourceId);

  // Ordinary matching still commits with the optimistic precondition in place.
  const control = own(db.collection("expenses").doc(`${prefix}-ordinary-bank`));
  await control.set(expense);
  const ordinaryBatch = db.batch();
  const ordinary = await queueMatchedBankPayment({ batch: ordinaryBatch, expenseId: control.id, expense, bankTransactionId: `${prefix}-control`, principalAmount: 10, cashAmount: 10, paidAt: Timestamp.now(), actor: { uid: prefix } });
  own(db.collection("payments").doc(ordinary.paymentId));
  own(db.collection("financialObligations").doc(ordinary.obligationId));
  own(db.collection("obligationPaymentLinks").doc(ordinary.linkId));
  ordinaryBatch.update(control, ordinary.expensePatch);
  await ordinaryBatch.commit();
  assert.equal((await control.get()).data().status, "paid");
});
