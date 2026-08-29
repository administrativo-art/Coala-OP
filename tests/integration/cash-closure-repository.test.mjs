import assert from "node:assert/strict";
import test from "node:test";

import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const PROJECT_ID = "demo-coala-repository";
const DATABASE_ID = "coala-financeiro";

assertFirestoreEmulatorSafety({ projectId: PROJECT_ID, databaseId: DATABASE_ID });
assert.equal(process.env.FIREBASE_PROJECT_ID, PROJECT_ID);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, PROJECT_ID);

const {
  finalizeCashClosure,
  finalizeCashClosureOperator,
  getCashClosure,
  listCashClosureAuditLogs,
  listCashClosures,
  saveCashClosureDraft,
  upsertClosureFromPdv,
} = await import("../../src/features/financial/cash-closures/repository.server.ts");
const {
  getCashDepositBatch,
  listCashDepositBatches,
  listCashCoinBalances,
  prepareCashDepositCoinHold,
  processCashDepositQueue,
  registerCashCoinExchange,
  reopenCashClosureWithDepositHandling,
} = await import("../../src/features/financial/cash-deposits/repository.server.ts");
const {
  cancelCashCountingSession,
  confirmCashCountingSessionDenominations,
  createCashCountingSession,
  finishCashCountingSession,
  getCashCountingSession,
} = await import("../../src/features/financial/cash-counting-sessions/repository.server.ts");
const { cashClosureId, recalculateCountedLine } = await import("../../src/features/financial/cash-closures/persistence.ts");
const { financialDbAdmin } = await import("../../src/lib/firebase-financial-admin.ts");

const actor = { userId: "integration-user", userName: "Teste de integração" };
const collections = [
  "cashClosures",
  "cashClosureAuditLogs",
  "cashClosureMonthlySummaries",
  "cashClosureUnitSummaries",
  "cashDepositPeriodPolicies",
  "cashDepositAdjustments",
  "cashDepositBatches",
  "cashDepositQueues",
  "cashCoinBalances",
  "cashCoinEvents",
  "cashCountingSessions",
  "cashCountingSessionLocks",
  "cashCountingSessionAuditLogs",
];

function builtClosure({ workspaceId, kioskId, date }) {
  const [year, month, day] = date.split("-").map(Number);
  return {
    workspaceId,
    kioskId,
    kioskName: `Quiosque ${kioskId}`,
    pdvFilialId: `pdv-${kioskId}`,
    date,
    year,
    month,
    day,
    status: "draft",
    expectedTotalCents: 15_000,
    expectedByChannelCents: { cash: 10_000, pix: 5_000 },
    operatorCount: 1,
    lines: [
      {
        operatorId: "operator-1",
        operatorName: "Operadora 1",
        channel: "cash",
        channelLabel: "Dinheiro",
        expectedAmountCents: 10_000,
        reportedAmountCents: null,
        reportedDifferenceAmountCents: null,
        countedAmountCents: null,
        differenceAmountCents: null,
        status: "pending",
        rawPaymentNames: ["DINHEIRO"],
        metadata: { paymentRowCount: 1 },
        note: null,
      },
      {
        operatorId: "operator-1",
        operatorName: "Operadora 1",
        channel: "pix",
        channelLabel: "Pix",
        expectedAmountCents: 5_000,
        reportedAmountCents: 5_000,
        reportedDifferenceAmountCents: 0,
        countedAmountCents: 5_000,
        differenceAmountCents: 0,
        status: "matched",
        rawPaymentNames: ["PIX"],
        metadata: { paymentRowCount: 1 },
        note: null,
      },
    ],
    source: {
      provider: "pdvlegal",
      endpoint: "cupom/get",
      couponCount: 2,
      validCouponCount: 2,
      ignoredCancelledCouponCount: 0,
      estornadoCouponCount: 0,
      itemCount: 2,
      paymentRowCount: 2,
      rawPaymentNames: ["DINHEIRO", "PIX"],
      unknownPaymentNames: [],
      integrityWarnings: [],
    },
  };
}

async function clearTestDatabase() {
  for (const collectionName of collections) {
    await financialDbAdmin.recursiveDelete(financialDbAdmin.collection(collectionName));
  }
}

test.before(clearTestDatabase);
test.after(clearTestDatabase);

test("repository persiste fechamento, linhas, totais, transições e auditoria atomicamente", async () => {
  const workspaceId = "workspace-integration-a";
  const kioskId = "kiosk-integration-a";
  const date = "2035-07-07";
  const closureId = cashClosureId(kioskId, date);

  const created = await upsertClosureFromPdv(builtClosure({ workspaceId, kioskId, date }), actor);
  assert.equal(created.created, true);

  const initial = await getCashClosure(closureId);
  assert.ok(initial);
  assert.equal(initial.lines.length, 2);
  assert.equal(initial.closure.expectedTotalCents, 15_000);
  assert.equal(initial.lines.reduce((sum, line) => sum + line.expectedCents, 0), 15_000);

  const cashLine = initial.lines.find((line) => line.channel === "cash");
  assert.ok(cashLine);
  const drafted = await saveCashClosureDraft(
    closureId,
    [{
      id: cashLine.id,
      reportedCents: 9_800,
      reportedNote: "Diferença informada pelo Caixa",
      countedCents: 9_900,
      note: "Diferença conferida pelo Financeiro",
    }],
    actor,
    { editReported: true, editCounted: true },
  );
  assert.equal(drafted.closure.reportedTotalCents, 14_800);
  assert.equal(drafted.closure.reportedDifferenceTotalCents, -200);
  assert.equal(drafted.closure.countedTotalCents, 14_900);

  const finalized = await finalizeCashClosure(closureId, actor);
  assert.equal(finalized.status, "approved");
  assert.equal(finalized.countedTotalCents, 14_900);
  assert.equal(finalized.differenceTotalCents, -100);
  assert.equal(finalized.cashDepositEligibleCents, 9_900);
  await processCashDepositQueue(workspaceId, kioskId, actor);
  await assert.rejects(
    () => finalizeCashClosure(closureId, actor),
    /approved não pode avançar para approved/,
  );
  await assert.rejects(
    () => saveCashClosureDraft(closureId, [{ id: cashLine.id, reportedCents: 10_000 }], actor),
    /Somente fechamentos ainda não finalizados/,
  );

  const afterFinalization = await getCashClosure(closureId);
  assert.ok(afterFinalization);
  const finalizedCashLine = afterFinalization.lines.find((line) => line.channel === "cash");
  assert.ok(finalizedCashLine);
  assert.equal(finalizedCashLine.reportedCents, 9_800);
  assert.equal(finalizedCashLine.countedCents, 9_900);
  assert.equal(finalizedCashLine.reportedNote, "Diferença informada pelo Caixa");
  assert.equal(finalizedCashLine.note, "Diferença conferida pelo Financeiro");
  assert.equal(finalizedCashLine.countedBy, actor.userId);
  assert.equal(afterFinalization.closure.cashDeposit.status, "allocated");
  assert.ok(afterFinalization.closure.cashDeposit.batchId);

  const reopened = await reopenCashClosureWithDepositHandling({
    workspaceId,
    closureId,
    reason: "Ajuste solicitado",
    actor,
  });
  assert.equal(reopened.closure.status, "reopened");

  const persisted = await getCashClosure(closureId);
  assert.ok(persisted);
  assert.equal(persisted.closure.status, "reopened");
  assert.equal(persisted.closure.expectedTotalCents, persisted.lines.reduce((sum, line) => sum + line.expectedCents, 0));
  assert.equal(persisted.closure.countedTotalCents, persisted.lines.reduce((sum, line) => sum + (line.countedCents ?? 0), 0));

  const audit = await listCashClosureAuditLogs(workspaceId, closureId);
  const actions = new Set(audit.map((entry) => entry.action));
  for (const action of [
    "created_from_pdv",
    "reported_amount_updated",
    "reported_note_updated",
    "counted_amount_updated",
    "note_updated",
    "approved",
    "deposit_allocated",
    "reopened",
  ]) {
    assert.equal(actions.has(action), true, `auditoria ausente: ${action}`);
  }

  await upsertClosureFromPdv(builtClosure({
    workspaceId: "workspace-integration-b",
    kioskId: "kiosk-integration-b",
    date,
  }), actor);
  const workspaceAClosures = await listCashClosures({ workspaceId, limit: 10 });
  assert.deepEqual(workspaceAClosures.map((closure) => closure.id), [closureId]);
});

test("finaliza e aloca cada operador sem aguardar o restante do dia", async () => {
  const workspaceId = "workspace-integration-operators";
  const kioskId = "kiosk-integration-operators";
  const date = "2035-07-10";
  const closureId = cashClosureId(kioskId, date);
  const built = builtClosure({ workspaceId, kioskId, date });
  built.lines.push(
    {
      ...built.lines[0],
      operatorId: "operator-2",
      operatorName: "Operadora 2",
      expectedAmountCents: 7_000,
      calculatedExpectedAmountCents: 7_000,
    },
    {
      ...built.lines[1],
      operatorId: "operator-2",
      operatorName: "Operadora 2",
      expectedAmountCents: 3_000,
      calculatedExpectedAmountCents: 3_000,
      reportedAmountCents: 3_000,
      countedAmountCents: 3_000,
    },
  );
  built.expectedTotalCents = 25_000;
  built.expectedByChannelCents = { cash: 17_000, pix: 8_000 };
  built.operatorCount = 2;

  await upsertClosureFromPdv(built, actor);
  const initial = await getCashClosure(closureId);
  assert.ok(initial);
  assert.equal(initial.operators.length, 2);
  const firstCash = initial.lines.find((line) => line.operatorId === "operator-1" && line.channel === "cash");
  const secondCash = initial.lines.find((line) => line.operatorId === "operator-2" && line.channel === "cash");
  assert.ok(firstCash);
  assert.ok(secondCash);
  await saveCashClosureDraft(closureId, [
    { id: firstCash.id, reportedCents: 10_000, countedCents: 10_000 },
    { id: secondCash.id, reportedCents: 7_000, countedCents: 7_000 },
  ], actor, { editReported: true, editCounted: true });

  const firstFinalized = await finalizeCashClosureOperator(closureId, "operator-1", actor, { legacyImmediateAllocation: true });
  assert.equal(firstFinalized.closure.status, "pending_review");
  assert.equal(firstFinalized.closure.finalizedOperatorCount, 1);
  assert.equal(firstFinalized.closure.cashDepositEligibleCents, 10_000);
  await processCashDepositQueue(workspaceId, kioskId, actor);
  const partial = await getCashClosure(closureId);
  assert.ok(partial);
  assert.equal(partial.operators.find((operator) => operator.operatorId === "operator-1")?.cashDeposit.status, "allocated");
  assert.equal(partial.operators.find((operator) => operator.operatorId === "operator-2")?.status, "draft");
  assert.equal(partial.closure.cashDeposit.allocatedCents, 10_000);
  const reopenedOperator = await reopenCashClosureWithDepositHandling({
    workspaceId,
    closureId,
    operatorId: "operator-1",
    reason: "Recontagem da primeira operadora",
    actor,
  });
  assert.equal(reopenedOperator.closure.status, "reopened");
  const afterOperatorReopen = await getCashClosure(closureId);
  assert.equal(afterOperatorReopen?.operators.find((operator) => operator.operatorId === "operator-1")?.status, "reopened");
  await finalizeCashClosureOperator(closureId, "operator-1", actor, { legacyImmediateAllocation: true });
  await processCashDepositQueue(workspaceId, kioskId, actor);
  await assert.rejects(
    () => saveCashClosureDraft(
      closureId,
      [{ id: firstCash.id, countedCents: 9_999 }],
      actor,
      { editReported: false, editCounted: true },
    ),
    /já foi finalizado/,
  );

  await finalizeCashClosureOperator(closureId, "operator-2", actor, { legacyImmediateAllocation: true });
  await processCashDepositQueue(workspaceId, kioskId, actor);
  const completed = await getCashClosure(closureId);
  assert.ok(completed);
  assert.equal(completed.closure.status, "approved");
  assert.equal(completed.closure.finalizedOperatorCount, 2);
  assert.equal(completed.closure.cashDepositEligibleCents, 17_000);
  assert.equal(completed.closure.cashDeposit.allocatedCents, 17_000);
  const batchId = completed.operators.find((operator) => operator.operatorId === "operator-1")?.cashDeposit.batchId;
  assert.ok(batchId);
  const batch = await getCashDepositBatch(batchId);
  assert.ok(batch);
  assert.equal(batch.items.filter((item) => item.closureId === closureId).length, 2);
  assert.equal(batch.items.filter((item) => item.closureId === closureId).reduce((sum, item) => sum + item.amountCents, 0), 17_000);
});

test("preserva a contagem na DRE sem criar depósito quando o fechamento é somente DRE", async () => {
  const workspaceId = "workspace-integration-dre-only";
  const kioskId = "kiosk-integration-dre-only";
  const date = "2035-08-12";
  const closureId = cashClosureId(kioskId, date);

  await financialDbAdmin.collection("cashDepositPeriodPolicies").doc(`${workspaceId}_2035_08`).set({
    id: `${workspaceId}_2035_08`,
    workspaceId,
    year: 2035,
    month: 8,
    policy: "dre_only",
    reason: "Competência histórica usada somente na DRE",
    createdAt: new Date().toISOString(),
    createdBy: actor.userId,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.userId,
  });
  await upsertClosureFromPdv(builtClosure({ workspaceId, kioskId, date }), actor);
  const initial = await getCashClosure(closureId);
  assert.ok(initial);
  assert.equal(initial.closure.cashDepositPolicy, "dre_only");
  const cashLine = initial.lines.find((line) => line.channel === "cash");
  assert.ok(cashLine);
  await saveCashClosureDraft(
    closureId,
    [{ id: cashLine.id, reportedCents: 9_900, countedCents: 9_900, reportedNote: "Falta apurada", note: "Falta conferida" }],
    actor,
    { editReported: true, editCounted: true },
  );

  const finalized = await finalizeCashClosureOperator(closureId, "operator-1", actor, { legacyImmediateAllocation: true });
  assert.equal(finalized.closure.finalizedCountedCashCents, 9_900);
  assert.equal(finalized.closure.cashDepositEligibleCents, 0);
  assert.equal(finalized.operator.cashDeposit.status, "not_eligible");
  await processCashDepositQueue(workspaceId, kioskId, actor);
  assert.deepEqual(await listCashDepositBatches({ workspaceId, limit: 10 }), []);
});

test("sessão bloqueia escopo, recebe operador sem depósito precoce e cria malote após conferir denominações", async () => {
  const workspaceId = "workspace-integration-counting-session";
  const kioskId = "kiosk-integration-counting-session";
  const date = "2035-09-12";
  const closureId = cashClosureId(kioskId, date);
  const units = [{ id: kioskId, name: "Quiosque sessão" }];
  const periods = [{ year: 2035, month: 9 }];
  const session = await createCashCountingSession({ workspaceId, units, periods, actor });

  await assert.rejects(
    () => createCashCountingSession({ workspaceId, units, periods, actor }),
    /Já existe uma sessão aberta/,
  );
  const parallel = await createCashCountingSession({
    workspaceId,
    units,
    periods: [{ year: 2035, month: 10 }],
    actor,
  });
  await cancelCashCountingSession({
    workspaceId,
    sessionId: parallel.id,
    reason: "Sessão criada apenas para validar escopos independentes",
    actor,
  });

  await upsertClosureFromPdv(builtClosure({ workspaceId, kioskId, date }), actor);
  const initial = await getCashClosure(closureId);
  const cashLine = initial?.lines.find((line) => line.channel === "cash");
  assert.ok(cashLine);
  await saveCashClosureDraft(
    closureId,
    [{ id: cashLine.id, reportedCents: 10_000, countedCents: 10_000 }],
    actor,
    { editReported: true, editCounted: true },
  );
  await finalizeCashClosureOperator(closureId, "operator-1", actor, { countingSessionId: session.id });
  assert.deepEqual(await listCashDepositBatches({ workspaceId, limit: 10 }), []);
  assert.equal((await getCashCountingSession(session.id))?.operators.length, 1);

  await reopenCashClosureWithDepositHandling({
    workspaceId,
    closureId,
    operatorId: "operator-1",
    reason: "Validar retirada atômica da sessão aberta",
    actor,
  });
  assert.equal((await getCashCountingSession(session.id))?.operators.length, 0);
  await finalizeCashClosureOperator(closureId, "operator-1", actor, { countingSessionId: session.id });

  const firstCounted = await finishCashCountingSession({ workspaceId, sessionId: session.id, actor });
  assert.equal(firstCounted.status, "counted");
  await reopenCashClosureWithDepositHandling({
    workspaceId,
    closureId,
    operatorId: "operator-1",
    reason: "Recontagem antes da composição física",
    actor,
  });
  assert.equal((await getCashCountingSession(session.id))?.session.status, "open");
  await finalizeCashClosureOperator(closureId, "operator-1", actor, { countingSessionId: session.id });
  const counted = await finishCashCountingSession({ workspaceId, sessionId: session.id, actor });
  assert.equal(counted.status, "counted");
  assert.equal(counted.depositEligibleCents, 10_000);
  await assert.rejects(
    () => confirmCashCountingSessionDenominations({
      workspaceId,
      sessionId: session.id,
      entries: [{ valueCents: 5_000, quantity: 1 }],
      actor,
    }),
    /total físico informado não confere/,
  );
  const prepared = await confirmCashCountingSessionDenominations({
    workspaceId,
    sessionId: session.id,
    entries: [{ valueCents: 5_000, quantity: 2 }],
    actor,
  });
  assert.equal(prepared.session.status, "deposit_ready");
  assert.equal(prepared.session.coinPendingExchangeCents, 0);
  assert.equal(prepared.batches.length, 1);
  assert.equal(prepared.batches[0].countingSessionId, session.id);
  assert.equal(prepared.batches[0].totalCents, 10_000);
  assert.equal(prepared.batches[0].denominations?.find((entry) => entry.valueCents === 5_000)?.quantity, 2);

  const nextSession = await createCashCountingSession({ workspaceId, units, periods, actor });
  assert.equal(nextSession.status, "open");
});

test("finaliza revisão legada usando a contagem do Financeiro já preenchida", async () => {
  const workspaceId = "workspace-integration-legacy";
  const kioskId = "kiosk-integration-legacy";
  const date = "2035-07-08";
  const closureId = cashClosureId(kioskId, date);

  await upsertClosureFromPdv(builtClosure({ workspaceId, kioskId, date }), actor);
  const initial = await getCashClosure(closureId);
  assert.ok(initial);
  const cashLine = initial.lines.find((line) => line.channel === "cash");
  assert.ok(cashLine);
  await saveCashClosureDraft(
    closureId,
    [{ id: cashLine.id, reportedCents: 9_800, reportedNote: "Contagem enviada pelo Caixa" }],
    actor,
  );
  const submitted = await getCashClosure(closureId);
  assert.ok(submitted);
  const submittedCashLine = submitted.lines.find((line) => line.channel === "cash");
  assert.ok(submittedCashLine);
  await financialDbAdmin.collection("cashClosures").doc(closureId).set({ status: "pending_review" }, { merge: true });
  const legacyFinanceLine = recalculateCountedLine(
    submittedCashLine,
    9_900,
    "Contagem feita pelo Financeiro",
    "finance-user",
    "2035-07-08T20:00:00.000Z",
  );
  await financialDbAdmin.collection("cashClosures").doc(closureId)
    .collection("lines").doc(cashLine.id).set(legacyFinanceLine);

  const finalized = await finalizeCashClosure(closureId, actor);
  await processCashDepositQueue(workspaceId, kioskId, actor);
  const persisted = await getCashClosure(closureId);
  assert.ok(persisted);
  const persistedCashLine = persisted.lines.find((line) => line.channel === "cash");
  assert.ok(persistedCashLine);
  assert.equal(finalized.status, "approved");
  assert.equal(finalized.cashDepositEligibleCents, 9_900);
  assert.equal(persistedCashLine.countedCents, 9_900);
  assert.equal(persistedCashLine.note, "Contagem feita pelo Financeiro");
  assert.equal(persisted.closure.cashDeposit.status, "allocated");
});

test("sobra não exige justificativa e moedas seguem para troca antes do boleto", async () => {
  const workspaceId = "workspace-integration-coins";
  const kioskId = "kiosk-integration-coins";
  const date = "2035-07-09";
  const closureId = cashClosureId(kioskId, date);

  await upsertClosureFromPdv(builtClosure({ workspaceId, kioskId, date }), actor);
  const initial = await getCashClosure(closureId);
  assert.ok(initial);
  const cashLine = initial.lines.find((line) => line.channel === "cash");
  assert.ok(cashLine);
  await saveCashClosureDraft(
    closureId,
    [{ id: cashLine.id, reportedCents: 10_100 }],
    actor,
    { editReported: true, editCounted: false },
  );
  const financeDraft = await saveCashClosureDraft(
    closureId,
    [{ id: cashLine.id, countedCents: 10_050 }],
    actor,
    { editReported: false, editCounted: true },
  );
  const financeCashLine = financeDraft.lines.find((line) => line.channel === "cash");
  assert.equal(financeCashLine.reportedCents, 10_100);
  assert.equal(financeCashLine.countedCents, 10_050);
  assert.equal(financeCashLine.conferenceDifferenceCents, -50);

  const finalized = await finalizeCashClosure(closureId, actor);
  assert.equal(finalized.differenceTotalCents, 50);
  assert.equal(finalized.cashDepositEligibleCents, 10_050);
  await processCashDepositQueue(workspaceId, kioskId, actor);

  const allocated = await getCashClosure(closureId);
  assert.ok(allocated?.closure.cashDeposit.batchId);
  const prepared = await prepareCashDepositCoinHold({
    workspaceId,
    batchId: allocated.closure.cashDeposit.batchId,
    coinCents: 50,
    actor,
  });
  assert.equal(prepared.batch.grossTotalCents, 10_050);
  assert.equal(prepared.batch.coinHoldCents, 50);
  assert.equal(prepared.batch.totalCents, 10_000);
  assert.equal(prepared.balance.pendingExchangeCents, 50);

  const preparedDetail = await getCashDepositBatch(prepared.batch.id);
  assert.ok(preparedDetail);
  assert.equal(preparedDetail.items.reduce((sum, item) => sum + item.amountCents, 0), 10_000);
  assert.equal(preparedDetail.items.some((item) => item.source === "coin_hold" && item.amountCents === -50), true);

  const exchanged = await registerCashCoinExchange({
    workspaceId,
    kioskId,
    amountCents: 50,
    operationId: "d77b2927-91b8-4b9d-a4f5-8131393291fb",
    actor,
  });
  assert.equal(exchanged.idempotent, false);
  assert.equal(exchanged.balance.pendingExchangeCents, 0);
  assert.equal(exchanged.batch.totalCents, 50);
  const idempotent = await registerCashCoinExchange({
    workspaceId,
    kioskId,
    amountCents: 50,
    operationId: "d77b2927-91b8-4b9d-a4f5-8131393291fb",
    actor,
  });
  assert.equal(idempotent.idempotent, true);
  await assert.rejects(
    () => registerCashCoinExchange({
      workspaceId,
      kioskId,
      amountCents: 49,
      operationId: "d77b2927-91b8-4b9d-a4f5-8131393291fb",
      actor,
    }),
    /chave idempotente já foi usada/,
  );
  const balances = await listCashCoinBalances(workspaceId);
  assert.equal(balances.length, 1);
  assert.equal(balances[0].pendingExchangeCents, 0);
});
