import test from "node:test";
import assert from "node:assert/strict";
import { autoModeSchema, autoWindow, decideAutoBatches, pendingReview, settableAutoModeSchema } from "../../src/features/financial/acquirer-fees/auto-recognition";
import type { FeeRecognitionBatch, FeeRecognitionPreview, FeeRecognitionRecord } from "../../src/features/financial/acquirer-fees/recognition-contracts";

const batch = (over: Partial<FeeRecognitionBatch> = {}): FeeRecognitionBatch => ({ id: "a".repeat(64), fingerprint: "b".repeat(64), kind: "pix", soldOn: "2026-11-03", dueOn: "2026-11-03",
  amountCents: 317, grossCents: 44150, expectedNetCents: 43833, measurement: "assessed", members: [], ...over });
const policy = { version: 2, enabled: true, variableAccountId: "v", financialAccountId: "f", closedThroughMonth: null, closedPeriods: [], contracts: [] };
const preview = (over: Partial<FeeRecognitionPreview> = {}): FeeRecognitionPreview => ({ request: { mappingId: "m", kioskId: "k", stoneCode: "1", referenceDate: "2026-11-03", source: "pix" },
  batches: [batch()], records: [], pending: [], policy, referenceFingerprint: "r", centers: [{ id: "c1", name: "Quiosque" }], sourceStatus: "ok", ...over });
const record = (over: Partial<FeeRecognitionRecord> = {}) => ({ id: "a".repeat(64), active: true, policyVersion: 2, batch: batch(), ...over }) as FeeRecognitionRecord;

test("taxa apurada, sem registro anterior e com um centro exclusivo é elegível", () => {
  const decision = decideAutoBatches(preview());
  assert.equal(decision.eligible.length, 1);
  assert.deepEqual(decision.pending, []);
});
test("sem política habilitada ou sem centro único nada é elegível e o motivo aparece", () => {
  assert.equal(decideAutoBatches(preview({ policy: { ...policy, enabled: false } })).eligible.length, 0);
  assert.equal(decideAutoBatches(preview({ policy: null })).eligible.length, 0);
  const none = decideAutoBatches(preview({ centers: [] }));
  assert.equal(none.eligible.length, 0); assert.match(none.pending[0], /Nenhum centro/);
  const many = decideAutoBatches(preview({ centers: [{ id: "1", name: "a" }, { id: "2", name: "b" }] }));
  assert.equal(many.eligible.length, 0); assert.match(many.pending[0], /Mais de um centro/);
});
test("taxa estimada e antecipação ficam para revisão manual; taxa zero é ignorada sem pendência", () => {
  const decision = decideAutoBatches(preview({ batches: [batch({ measurement: "estimated" }), batch({ id: "c".repeat(64), kind: "anticipation" }), batch({ id: "d".repeat(64), amountCents: 0 })] }));
  assert.equal(decision.eligible.length, 0);
  assert.equal(decision.pending.length, 2);
});
test("já reconhecido igual conta como feito; origem mudada ou estornada nunca é refeita sozinha", () => {
  assert.equal(decideAutoBatches(preview({ records: [record()] })).alreadyDone, 1);
  const changed = decideAutoBatches(preview({ records: [record({ batch: batch({ fingerprint: "e".repeat(64) }) })] }));
  assert.equal(changed.eligible.length, 0); assert.match(changed.pending[0], /revisar manualmente/);
  const reversed = decideAutoBatches(preview({ records: [record({ active: false })] }));
  assert.equal(reversed.eligible.length, 0); assert.equal(reversed.alreadyDone, 0);
});
test("pendências da prévia são repassadas ao relatório", () => {
  assert.deepEqual(decideAutoBatches(preview({ pending: ["Conciliação pendente"] })).pending, ["Conciliação pendente"]);
});
test("janela cobre D-3 a D-1 em ordem e nunca inclui hoje", () => {
  assert.deepEqual(autoWindow("2026-11-18"), ["2026-11-15", "2026-11-16", "2026-11-17"]);
  assert.deepEqual(autoWindow("2026-03-02", 2), ["2026-02-28", "2026-03-01"]);
});
test("a API oferece ativação explícita, simulação e desligamento", () => {
  assert.equal(autoModeSchema.safeParse("active").success, true);
  assert.equal(settableAutoModeSchema.safeParse("active").success, true);
  assert.equal(settableAutoModeSchema.safeParse("simulation").success, true);
});


test("cada pendência conserva a data e o meio fora do resumo da rodada", () => {
  const date = "2026-11-03";
  const source = "pix";
  const item = { date, source, reason: "Conciliação pendente" } as const;
  const review = pendingReview([item, item], date, source, "2026-11-04T09:00:00.000Z");
  assert.deepEqual(review.reasons, ["Conciliação pendente"]);
  assert.equal(review.date, date);
  assert.equal(review.source, source);
  assert.equal(review.truncated, false);
});

test("a ausência de origem de taxa lançada exige conferência", () => {
  const decision = decideAutoBatches(preview({ batches: [], records: [record()] }));
  assert.equal(decision.eligible.length, 0);
  assert.match(decision.pending[0], /não aparece mais/);
});

test("competência impedida pelo servidor também bloqueia a simulação", () => {
  const decision = decideAutoBatches(preview({ autoBlockedReason: "Competência bloqueada." }));
  assert.equal(decision.eligible.length, 0);
  assert.deepEqual(decision.pending, ["Competência bloqueada."]);
});
