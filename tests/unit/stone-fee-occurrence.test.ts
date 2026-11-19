import assert from "node:assert/strict";
import test from "node:test";
import {
  OCCURRENCE_MAX_CONTACTS, applyOccurrenceAction, feeOccurrenceActionSchema, occurrenceStatus, type FeeOccurrenceContact,
} from "../../src/features/financial/receipts-reconciliation/fee-occurrence";
import { HISTORY_PERIODS, feeDecisionInputSchema, feeHistoryDaily, feeSales } from "../../src/features/financial/receipts-reconciliation/fee-review";
import type { ReceiptParcel } from "../../src/features/financial/receipts-reconciliation/stone-account";

const base = { kioskId: "k1", stoneCode: "123", month: "2026-11" };
const occurrenceId = "a".repeat(64);
const contact = (protocol: string | null = null): FeeOccurrenceContact => ({ at: "2026-11-12T10:00:00.000Z", contactDate: "2026-11-12", channel: "phone", protocol, note: null, actorId: "u1" });
const now = new Date("2026-11-19T12:00:00Z");

test("status da ocorrência: aberta sem contato, em andamento com contato, finalizada com resultado", () => {
  assert.equal(occurrenceStatus({ contacts: [], outcome: null }), "open");
  assert.equal(occurrenceStatus({ contacts: [contact()], outcome: null }), "in_progress");
  assert.equal(occurrenceStatus({ contacts: [contact()], outcome: "kept" }), "closed");
});

test("contestar aceita motivo e protocolo; outras decisões os recusam", () => {
  const contested = { ...base, kind: "sale_fee", itemKey: "Visa|credit:s1", decision: "contested", fingerprint: "sale:1:2:3", reason: "above_contract", protocol: "20261105-48213" };
  assert.equal(feeDecisionInputSchema.safeParse(contested).success, true);
  assert.equal(feeDecisionInputSchema.safeParse({ ...contested, decision: "accepted" }).success, false);
  assert.equal(feeDecisionInputSchema.safeParse({ ...contested, protocol: "x" }).success, false);
  assert.equal(feeDecisionInputSchema.safeParse({ ...contested, reason: "inventado" }).success, false);
});

test("ação de contato exige data e canal; finalizar exige resultado e data e recusa campos de contato", () => {
  assert.equal(feeOccurrenceActionSchema.safeParse({ ...base, occurrenceId, action: "contact", contactDate: "2026-11-13", channel: "phone" }).success, true);
  assert.equal(feeOccurrenceActionSchema.safeParse({ ...base, occurrenceId, action: "contact", channel: "phone" }).success, false);
  assert.equal(feeOccurrenceActionSchema.safeParse({ ...base, occurrenceId, action: "contact", contactDate: "2026-02-30", channel: "phone" }).success, false);
  assert.equal(feeOccurrenceActionSchema.safeParse({ ...base, occurrenceId, action: "close", outcome: "kept", resolvedOn: "2026-11-14" }).success, true);
  assert.equal(feeOccurrenceActionSchema.safeParse({ ...base, occurrenceId, action: "close", outcome: "refunded", resolvedOn: "2026-11-14" }).success, false);
  assert.equal(feeOccurrenceActionSchema.safeParse({ ...base, occurrenceId, action: "close", outcome: "refunded", refundedCents: 1460, resolvedOn: "2026-11-14" }).success, true);
  assert.equal(feeOccurrenceActionSchema.safeParse({ ...base, occurrenceId, action: "close", outcome: "kept", refundedCents: 100, resolvedOn: "2026-11-14" }).success, false);
  assert.equal(feeOccurrenceActionSchema.safeParse({ ...base, occurrenceId, action: "close", outcome: "kept", resolvedOn: "2026-11-14", channel: "phone" }).success, false);
  assert.equal(feeOccurrenceActionSchema.safeParse({ ...base, occurrenceId: "curto", action: "contact", contactDate: "2026-11-13", channel: "phone" }).success, false);
});

test("registrar contato acrescenta ao histórico e guarda o protocolo informado", () => {
  const input = feeOccurrenceActionSchema.parse({ ...base, occurrenceId, action: "contact", contactDate: "2026-11-13", channel: "chat", protocol: "20261105-48213" });
  const result = applyOccurrenceAction({ contacts: [], protocol: null, status: "open" }, input, "u2", now);
  assert.ok(result.ok);
  assert.equal(result.protocol, "20261105-48213");
  assert.equal(result.contacts.length, 1);
  assert.deepEqual([result.contacts[0].actorId, result.contacts[0].channel, result.contacts[0].protocol], ["u2", "chat", "20261105-48213"]);
  assert.equal(result.closed, null);
});

test("finalizar exige protocolo (já registrado ou informado agora) e ocorrência ainda não finalizada", () => {
  const close = feeOccurrenceActionSchema.parse({ ...base, occurrenceId, action: "close", outcome: "refunded", refundedCents: 1460, resolvedOn: "2026-11-14" });
  assert.deepEqual(applyOccurrenceAction({ contacts: [contact()], protocol: null, status: "in_progress" }, close, "u1", now), { ok: false, code: "PROTOCOL_REQUIRED" });
  const withProtocol = applyOccurrenceAction({ contacts: [contact()], protocol: "20261105-48213", status: "in_progress" }, close, "u1", now);
  assert.ok(withProtocol.ok && withProtocol.closed?.outcome === "refunded" && withProtocol.closed.refundedCents === 1460);
  const informedNow = applyOccurrenceAction({ contacts: [], protocol: null, status: "open" }, { ...close, protocol: "ABC-123" }, "u1", now);
  assert.ok(informedNow.ok && informedNow.protocol === "ABC-123");
  assert.deepEqual(applyOccurrenceAction({ contacts: [], protocol: "ABC-123", status: "closed" }, close, "u1", now), { ok: false, code: "CLOSED" });
});

test("limite de contatos por ocorrência", () => {
  const input = feeOccurrenceActionSchema.parse({ ...base, occurrenceId, action: "contact", contactDate: "2026-11-13", channel: "email" });
  const full = Array.from({ length: OCCURRENCE_MAX_CONTACTS }, () => contact());
  assert.deepEqual(applyOccurrenceAction({ contacts: full, protocol: null, status: "in_progress" }, input, "u1", now), { ok: false, code: "TOO_MANY_CONTACTS" });
});

let seq = 0;
const parcel = (date: string, gross: number, fee: number): ReceiptParcel => ({
  id: `t${++seq}:1`, saleId: `t${seq}`, source: "card", installment: 1, installmentCount: 1, brandCode: "1", brand: "Visa", modality: "credit",
  saleDate: date, saleTime: "10:00:00", grossCents: gross, feeCents: fee, feeSource: "stone", anticipationCents: null,
  expectedNetCents: gross - fee, expectedDate: date, paidDate: date, paidNetCents: gross - fee, status: "paid",
});

test("períodos do histórico: mês, trimestre, semestre, ano e desde o início", () => {
  assert.deepEqual(HISTORY_PERIODS, { month: 1, quarter: 3, semester: 6, year: 12, all: 36 });
});

test("histórico do mês é por dia, com a taxa mais frequente de cada dia, e ignora outros meses", () => {
  const sales = feeSales([parcel("2026-11-03", 10000, 289), parcel("2026-11-03", 10000, 289), parcel("2026-11-05", 10000, 309), parcel("2026-10-30", 10000, 250)]);
  const [series] = feeHistoryDaily(sales, "2026-11");
  assert.deepEqual(series.months.map(item => [item.month, item.rate, item.sales]), [["2026-11-03", 0.0289, 2], ["2026-11-05", 0.0309, 1]]);
});
