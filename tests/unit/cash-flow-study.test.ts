import assert from "node:assert/strict";
import test from "node:test";

import { authorizeCashFlowStudyActor } from "../../src/features/financial/cash-flow-study/access";
import {
  addDays, buildCashFlowStudy, buildWeeks, cashLagByUnit, DEFAULT_CASH_LAG_DAYS, weekStart, weekdaySalesAverage,
  type StudyBatch, type StudyClosure, type StudyInputs,
} from "../../src/features/financial/cash-flow-study/model";
import { parseInterBalanceCents } from "../../src/lib/integrations/inter/balance";

const TODAY = "2026-11-15"; // domingo
const closure = (date: string, partial: Partial<StudyClosure> = {}): StudyClosure => ({
  kioskId: "k1", kioskName: "Quiosque Tirirical", date, status: "approved",
  byChannelCents: { cash: 10_000, pix: 20_000, debit_card: 15_000, credit_card: 5_000 },
  depositStatus: "issued", depositEligibleCents: 10_000, ...partial,
});
const batch = (id: string, partial: Partial<StudyBatch> = {}): StudyBatch => ({
  id, kioskId: "k1", kioskName: "Quiosque Tirirical", status: "paid", totalCents: 100_000,
  periodStartDate: "2026-09-01", periodEndDate: "2026-09-21", issuedAt: "2026-09-25T12:00:00.000Z", paidAt: "2026-09-28T12:00:00.000Z", ...partial,
});
const base = (partial: Partial<StudyInputs> = {}): StudyInputs => ({
  today: TODAY, interBalance: { cents: 1_840_000, at: "2026-11-15T09:00:00.000Z" }, stone: [], batches: [], closures: [], expenses: [], realized: [], ...partial,
});

test("semanas começam na segunda; domingo pertence à semana anterior", () => {
  assert.equal(weekStart("2026-11-15"), "2026-11-09");
  assert.equal(weekStart("2026-11-16"), "2026-11-16");
  const result = buildCashFlowStudy(base());
  assert.equal(result.weekStarts.length, 13);
  assert.equal(result.weekStarts[0], "2026-11-09");
  assert.equal(result.weekStarts[12], "2027-02-01");
});

test("boleto emitido cai 3 dias após a emissão, nunca antes de hoje", () => {
  const result = buildCashFlowStudy(base({ batches: [
    batch("b1", { status: "issued", issuedAt: "2026-11-13T15:00:00.000Z", paidAt: null, totalCents: 1_012_000 }),
    batch("b2", { status: "issued", issuedAt: "2026-11-01T15:00:00.000Z", paidAt: null, totalCents: 50_000 }),
  ] }));
  const b1 = result.entries.find(entry => entry.id === "batch:b1")!;
  const b2 = result.entries.find(entry => entry.id === "batch:b2")!;
  assert.equal(b1.date, "2026-11-16");
  assert.equal(b1.certainty, "guaranteed");
  assert.equal(b2.date, TODAY, "boleto atrasado conta hoje");
  assert.equal(result.stages.find(stage => stage.key === "boleto")!.cents, 1_062_000);
});

test("lote aberto e fechamento aprovado sem lote viram 'contado' em hoje + 10 dias, sem contar em dobro", () => {
  const result = buildCashFlowStudy(base({
    batches: [batch("open", { status: "open", paidAt: null, issuedAt: null, totalCents: 30_000 })],
    closures: [
      closure("2026-11-10", { depositStatus: "allocated", depositEligibleCents: 30_000 }),
      closure("2026-11-11", { depositStatus: "not_allocated", depositEligibleCents: 12_000 }),
    ],
  }));
  const counted = result.entries.filter(entry => entry.source === "deposit_counted");
  assert.deepEqual(counted.map(entry => entry.amountCents).sort(), [12_000, 30_000]);
  assert.ok(counted.every(entry => entry.date === addDays(TODAY, 10)));
  assert.equal(result.stages.find(stage => stage.key === "counted")!.cents, 42_000);
});

test("espécie de dia não fechado usa o prazo padrão até a unidade ter 4 lotes pagos", () => {
  const open = closure("2026-11-14", { status: "draft", depositStatus: "not_eligible" });
  const without = buildCashFlowStudy(base({ closures: [open] }));
  assert.equal(without.entries.find(entry => entry.source === "cash_open")!.date, addDays("2026-11-14", DEFAULT_CASH_LAG_DAYS));
  // 4 lotes pagos, meio do período em 11/09 e pagamento em 28/09 = 17 dias.
  const paid = ["p1", "p2", "p3", "p4"].map(id => batch(id));
  assert.deepEqual(cashLagByUnit(paid).of("k1"), { days: 17, fromHistory: true });
  const withHistory = buildCashFlowStudy(base({ closures: [open], batches: paid }));
  assert.equal(withHistory.entries.find(entry => entry.source === "cash_open")!.date, "2026-12-01");
  assert.equal(withHistory.units[0].lagFromHistory, true);
});

test("vendas projetadas: média por dia da semana dos últimos 90 dias, líquidas e no prazo de cada forma", () => {
  const history = Array.from({ length: 90 }, (_, index) => closure(addDays(TODAY, -90 + index)));
  const average = weekdaySalesAverage(history, TODAY);
  assert.equal(average.days, 90);
  assert.deepEqual(average.of("2026-11-16"), { cash: 10_000, pix: 20_000, debit_card: 15_000, credit_card: 5_000 });
  const result = buildCashFlowStudy(base({ closures: history }));
  const pix = result.entries.find(entry => entry.id === "sales:pix:2026-11-16")!;
  assert.equal(pix.date, "2026-11-16");
  assert.equal(pix.amountCents, 19_850, "Pix líquido de 0,75%");
  assert.equal(result.entries.find(entry => entry.id === "sales:debit_card:2026-11-16")!.date, "2026-11-17");
  assert.equal(result.entries.find(entry => entry.id === "sales:credit_card:2026-11-16")!.date, "2026-12-16");
  assert.ok(!result.entries.some(entry => entry.id === "sales:pix:2026-11-14"), "dias passados não são projetados");
});

test("dia que já tem fechamento não recebe venda projetada", () => {
  const result = buildCashFlowStudy(base({ closures: [closure(TODAY, { status: "draft" })] }));
  assert.ok(!result.entries.some(entry => entry.source === "sales_projected" && entry.id.endsWith(TODAY)));
});

test("despesas: vencida conta hoje, provisionada fica marcada e sem data vira lacuna", () => {
  const result = buildCashFlowStudy(base({ expenses: [
    { id: "e1", description: "Aluguel", supplier: "Shopping", date: "2026-11-05", amountCents: 600_000, provisioned: false },
    { id: "e2", description: "Folha", supplier: null, date: "2026-12-05", amountCents: 960_000, provisioned: true },
    { id: "e3", description: "Sem data", supplier: null, date: null, amountCents: 1_000, provisioned: false },
    { id: "e4", description: "Fora do horizonte", supplier: null, date: "2027-06-01", amountCents: 1_000, provisioned: false },
  ] }));
  const e1 = result.entries.find(entry => entry.id === "expense:e1")!;
  assert.equal(e1.date, TODAY);
  assert.equal(e1.overdue, true);
  assert.equal(result.entries.find(entry => entry.id === "expense:e2")!.certainty, "provisioned");
  assert.ok(!result.entries.some(entry => entry.id === "expense:e4"));
  assert.ok(result.gaps.some(gap => gap.includes("sem vencimento")));
});

test("semanas acumulam o saldo e o cenário só altera o projetado", () => {
  const result = buildCashFlowStudy(base({
    interBalance: { cents: 100_000, at: "x" },
    batches: [batch("b1", { status: "issued", issuedAt: "2026-11-13T00:00:00.000Z", paidAt: null, totalCents: 50_000 })],
    expenses: [{ id: "e1", description: "Folha", supplier: null, date: "2026-11-20", amountCents: 200_000, provisioned: false }],
    closures: Array.from({ length: 90 }, (_, index) => closure(addDays(TODAY, -90 + index), { byChannelCents: { cash: 0, pix: 10_000, debit_card: 0, credit_card: 0 } })),
  }));
  const expected = buildWeeks(result, "expected");
  const pessimistic = buildWeeks(result, "pessimistic");
  assert.equal(expected[0].openingCents, 100_000);
  assert.equal(expected[1].openingCents, expected[0].closingCents);
  assert.equal(expected[0].guaranteedInCents, 0);
  assert.equal(expected[1].guaranteedInCents, 50_000);
  assert.equal(expected[1].outCents, 200_000);
  assert.ok(pessimistic[1].inCents < expected[1].inCents);
  assert.equal(pessimistic[1].guaranteedInCents, expected[1].guaranteedInCents);
});

test("mínimo de caixa = 2 semanas de saídas médias dos meses fechados; indicadores com farol", () => {
  const realized = ["2026-08", "2026-09", "2026-10"].flatMap(month => [
    { date: `${month}-10`, direction: "in" as const, amountCents: 5_000_000 },
    { date: `${month}-20`, direction: "out" as const, amountCents: 4_334_000 },
  ]);
  const result = buildCashFlowStudy(base({ realized, batches: ["p1", "p2"].map(id => batch(id)) }));
  assert.equal(result.months.length, 4);
  assert.equal(result.months[3].partial, true);
  assert.equal(result.minimumCents, Math.round(4_334_000 / (52 / 12) * 2));
  const keys = result.indicators.map(indicator => indicator.key);
  assert.deepEqual(keys, ["runway", "surplus", "ratio", "cash_lag"]);
  assert.equal(result.indicators.find(indicator => indicator.key === "surplus")!.tone, "ok");
  assert.equal(result.indicators.find(indicator => indicator.key === "cash_lag")!.tone, "warn");
});

test("sem saldo do Inter a projeção avisa e o estágio fica nulo", () => {
  const result = buildCashFlowStudy(base({ interBalance: null }));
  assert.equal(result.stages.find(stage => stage.key === "inter")!.cents, null);
  assert.ok(result.gaps.some(gap => gap.includes("saldo do Inter")));
});

test("parcelas Stone do mesmo dia viram uma linha com a contagem", () => {
  const result = buildCashFlowStudy(base({ stone: [
    { dueDate: "2026-11-17", grossCents: 10_000, netCents: 9_800, feeCents: 200 },
    { dueDate: "2026-11-17", grossCents: 5_000, netCents: 4_900, feeCents: 100 },
  ] }));
  const stone = result.entries.filter(entry => entry.source === "stone");
  assert.equal(stone.length, 1);
  assert.equal(stone[0].amountCents, 14_700);
  assert.match(stone[0].detail, /^2 parcela/);
});

test("somente o administrador padrão acessa o estudo", () => {
  assert.throws(() => authorizeCashFlowStudyActor({ isDefaultAdmin: false }), (error: { code?: string }) => error.code === "CASH_FLOW_STUDY_FORBIDDEN");
  assert.doesNotThrow(() => authorizeCashFlowStudyActor({ isDefaultAdmin: true }));
});

test("saldo do Inter vem do campo disponível, em centavos", () => {
  assert.equal(parseInterBalanceCents({ disponivel: 18_432.57 }), 1_843_257);
  assert.equal(parseInterBalanceCents({ disponivel: "120.5" }), 12_050);
  assert.throws(() => parseInterBalanceCents({}));
});
