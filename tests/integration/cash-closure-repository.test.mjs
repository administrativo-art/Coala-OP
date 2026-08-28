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
  getCashClosure,
  listCashClosureAuditLogs,
  listCashClosures,
  saveCashClosureDraft,
  upsertClosureFromPdv,
} = await import("../../src/features/financial/cash-closures/repository.server.ts");
const {
  processCashDepositQueue,
  reopenCashClosureWithDepositHandling,
} = await import("../../src/features/financial/cash-deposits/repository.server.ts");
const { cashClosureId, recalculateCountedLine } = await import("../../src/features/financial/cash-closures/persistence.ts");
const { financialDbAdmin } = await import("../../src/lib/firebase-financial-admin.ts");

const actor = { userId: "integration-user", userName: "Teste de integração" };
const collections = [
  "cashClosures",
  "cashClosureAuditLogs",
  "cashClosureMonthlySummaries",
  "cashClosureUnitSummaries",
  "cashDepositAdjustments",
  "cashDepositBatches",
  "cashDepositQueues",
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
    [{ id: cashLine.id, reportedCents: 9_800, reportedNote: "Diferença informada pelo caixa" }],
    actor,
  );
  assert.equal(drafted.closure.reportedTotalCents, 14_800);
  assert.equal(drafted.closure.reportedDifferenceTotalCents, -200);

  const finalized = await finalizeCashClosure(closureId, actor);
  assert.equal(finalized.status, "approved");
  assert.equal(finalized.countedTotalCents, 14_800);
  assert.equal(finalized.differenceTotalCents, -200);
  assert.equal(finalized.cashDepositEligibleCents, 9_800);
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
  assert.equal(finalizedCashLine.countedCents, finalizedCashLine.reportedCents);
  assert.equal(finalizedCashLine.note, finalizedCashLine.reportedNote);
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
