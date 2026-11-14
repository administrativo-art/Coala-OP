import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDecisions, confirmedReferences, detectRateChanges, feeDecisionInputSchema, feeExceptions, feeGroups, feeHistory, feeSales, otherCharges,
  type FeeDecision,
} from "../../src/features/financial/receipts-reconciliation/fee-review";
import type { ReceiptParcel } from "../../src/features/financial/receipts-reconciliation/stone-account";

let seq = 0;
const parcel = (date: string, gross: number, fee: number, extra: Partial<ReceiptParcel> = {}): ReceiptParcel => ({
  id: `t${++seq}:1`, saleId: `t${seq}`, source: "card", installment: 1, installmentCount: 1, brandCode: "1", brand: "Visa", modality: "credit",
  saleDate: date, saleTime: "10:00:00", grossCents: gross, feeCents: fee, feeSource: "stone", anticipationCents: null,
  expectedNetCents: gross - fee, expectedDate: date, paidDate: date, paidNetCents: gross - fee, status: "paid", ...extra,
});
const days = (from: string, count: number) => [...Array(count)].map((_, i) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });

test("taxa atual sugerida pela recorrência; grupo com poucas vendas fica sem referência", () => {
  const sales = feeSales([...days("2026-10-01", 8).map(d => parcel(d, 10000, 289)), parcel("2026-10-02", 10000, 349, { brand: "Elo", brandCode: "171" })]);
  const groups = feeGroups(sales, new Map(), "2026-11-13");
  const visa = groups.find(g => g.key === "Visa|credit")!;
  assert.equal(visa.reference?.rate, 0.0289);
  assert.equal(visa.reference?.status, "suggested");
  assert.equal(groups.find(g => g.key === "Elo|credit")!.reference, null);
});

test("venda fora da taxa vira exceção com diferença em centavos; arredondamento não", () => {
  const base = days("2026-10-01", 8).map(d => parcel(d, 10000, 289));
  const rounding = parcel("2026-11-03", 1237, 36); // 2,89% de 12,37 = 35,7 → 36
  const above = parcel("2026-11-04", 10000, 320);
  const sales = feeSales([...base, rounding, above]);
  const groups = feeGroups(sales, new Map(), "2026-11-13");
  const exceptions = feeExceptions(sales, groups, [], "2026-11");
  assert.deepEqual(exceptions.map(e => [e.saleId, e.differenceCents, e.reason]), [[above.saleId, 31, "above"]]);
});

test("taxa nova repetida vira uma mudança a confirmar, não dezenas de exceções", () => {
  const base = days("2026-10-01", 10).map(d => parcel(d, 10000, 289));
  const changed = days("2026-11-05", 6).map(d => parcel(d, 10000, 309));
  const sales = feeSales([...base, ...changed]);
  const references = new Map([["Visa|credit", { rate: 0.0289, since: "2026-09-20", status: "confirmed" as const }]]);
  const groups = feeGroups(sales, references, "2026-11-13");
  const changes = detectRateChanges(sales, groups);
  assert.equal(changes.length, 1);
  assert.deepEqual([changes[0].from, changes[0].to, changes[0].since, changes[0].saleCount, changes[0].impactCents], [0.0289, 0.0309, "2026-11-05", 6, 120]);
  assert.deepEqual(feeExceptions(sales, groups, changes, "2026-11"), []);
});

test("decisão tira o item da fila; evidência diferente reabre", () => {
  const items = [{ key: "a", fingerprint: "f1", reopened: false }, { key: "b", fingerprint: "f2", reopened: false }];
  const decision = (itemKey: string, fingerprint: string): FeeDecision => ({ kind: "sale_fee", itemKey, decision: "accepted", fingerprint, groupKey: null, rate: null, since: null, actorId: "u1", decidedAt: "2026-11-14T10:00:00Z", note: null });
  const out = applyDecisions(items, "sale_fee", [decision("a", "f1"), decision("b", "old")]);
  assert.deepEqual(out, [{ key: "b", fingerprint: "f2", reopened: true }]);
});

test("referência confirmada vem da última decisão do grupo (confirmar ou nova taxa)", () => {
  const refs = confirmedReferences([
    { kind: "group_rate", itemKey: "Visa|credit", decision: "confirmed", fingerprint: "x", groupKey: "Visa|credit", rate: 0.0289, since: "2026-09-20", actorId: "u", decidedAt: "2026-11-01T10:00:00Z", note: null },
    { kind: "rate_change", itemKey: "Visa|credit:0.0309", decision: "new_rate", fingerprint: "y", groupKey: "Visa|credit", rate: 0.0309, since: "2026-11-05", actorId: "u", decidedAt: "2026-11-14T10:00:00Z", note: null },
  ]);
  assert.deepEqual(refs.get("Visa|credit"), { rate: 0.0309, since: "2026-11-05", status: "confirmed" });
});

test("pedido de decisão: tipo e decisão precisam combinar; campo extra é recusado", () => {
  const base = { kioskId: "k", stoneCode: "123", month: "2026-11", kind: "sale_fee", itemKey: "Visa|credit:t1", decision: "accepted", fingerprint: "sale:1:2:0.0289" };
  assert.ok(feeDecisionInputSchema.safeParse(base).success);
  assert.ok(!feeDecisionInputSchema.safeParse({ ...base, kind: "group_rate" }).success);
  assert.ok(!feeDecisionInputSchema.safeParse({ ...base, actorId: "x" }).success);
});

test("chargeback aparece em outras cobranças; histórico mensal por grupo", () => {
  const cb = parcel("2026-11-06", 5000, 145, { status: "chargeback", paidNetCents: 0 });
  assert.deepEqual(otherCharges([cb], "2026-11").map(item => [item.saleId, item.amountCents]), [[cb.saleId, 4855]]);
  const oct = feeSales(days("2026-10-01", 3).map(d => parcel(d, 10000, 289)));
  const nov = feeSales(days("2026-11-01", 3).map(d => parcel(d, 10000, 309)));
  const history = feeHistory([{ month: "2026-10", sales: oct }, { month: "2026-11", sales: nov }]);
  assert.deepEqual(history[0].months.map(m => m.rate), [0.0289, 0.0309]);
});

test("acesso à rota de Taxas: só administrador padrão, no vínculo do próprio workspace", async () => {
  const { authorizeStoneFeeActor, assertStoneFeeScope } = await import("../../src/features/financial/receipts-reconciliation/fee-review-access");
  assert.doesNotThrow(() => authorizeStoneFeeActor({ isDefaultAdmin: true }));
  assert.throws(() => authorizeStoneFeeActor({ isDefaultAdmin: false }), { code: "STONE_FEES_FORBIDDEN" });
  const mapping = { workspaceId: "w1", kioskId: "k1", stoneCodes: ["123"] };
  assert.doesNotThrow(() => assertStoneFeeScope({ workspace_id: "w1" }, { kioskId: "k1", stoneCode: "123" }, mapping));
  assert.throws(() => assertStoneFeeScope({ workspace_id: "w2" }, { kioskId: "k1", stoneCode: "123" }, mapping), { code: "STONE_FEES_SCOPE" });
  assert.throws(() => assertStoneFeeScope({ workspace_id: "w1" }, { kioskId: "k2", stoneCode: "123" }, mapping), { code: "STONE_FEES_SCOPE" });
  assert.throws(() => assertStoneFeeScope({ workspace_id: "w1" }, { kioskId: "k1", stoneCode: "999" }, mapping), { code: "STONE_FEES_SCOPE" });
});
