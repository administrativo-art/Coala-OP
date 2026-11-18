import assert from "node:assert/strict";
import test from "node:test";

import { authorizeCashFlowStudyActor } from "../../src/features/financial/cash-flow-study/access";
import {
  addDays, addMonths, backtestSalesAccuracy, buildCashFlowStudy, cashLagByUnit, DEFAULT_CASH_LAG_DAYS, horizonEndFor, monthEnd, projectRecurringOutflows,
  weekStart, weekdaySalesAverage,
  type StudyAccount, type StudyBatch, type StudyClosure, type StudyExpense, type StudyInputs, type StudyRealized,
} from "../../src/features/financial/cash-flow-study/model";
import { parseInterBalanceCents } from "../../src/lib/integrations/inter/balance";

const TODAY = "2026-11-15"; // domingo
const inter = (cents: number | null = 1_840_000): StudyAccount => ({ id: "inter", name: "Inter · conta corrente", kind: "operating", cents, at: cents === null ? null : "2026-11-15T09:00:00.000Z" });
const reserve = (cents = 2_000_000): StudyAccount => ({ id: "cdb", name: "Inter · CDB", kind: "reserve", cents, at: "2026-11-15T09:00:00.000Z" });
const closure = (date: string, partial: Partial<StudyClosure> = {}): StudyClosure => ({
  kioskId: "k1", kioskName: "Quiosque Tirirical", date, status: "approved",
  byChannelCents: { cash: 10_000, pix: 20_000, debit_card: 15_000, credit_card: 5_000 },
  depositStatus: "issued", depositEligibleCents: 10_000, ...partial,
});
const batch = (id: string, partial: Partial<StudyBatch> = {}): StudyBatch => ({
  id, kioskId: "k1", kioskName: "Quiosque Tirirical", status: "paid", totalCents: 100_000,
  periodStartDate: "2026-09-01", periodEndDate: "2026-09-21", issuedAt: "2026-09-25T12:00:00.000Z", paidAt: "2026-09-28T12:00:00.000Z", ...partial,
});
const expense = (id: string, partial: Partial<StudyExpense> = {}): StudyExpense => ({
  id, description: id, supplier: null, date: "2026-12-05", amountCents: 100_000, provisioned: false, category: null, ...partial,
});
const out = (date: string, amountCents: number, category: StudyRealized["category"] = { id: "folha", name: "Folha" }, extra: Partial<StudyRealized> = {}): StudyRealized =>
  ({ date, direction: "out", amountCents, category, transfer: false, ...extra });
const base = (partial: Partial<StudyInputs> = {}): StudyInputs => ({
  today: TODAY, accounts: [inter()], stone: [], batches: [], closures: [], expenses: [], realized: [], ...partial,
});

test("semanas começam na segunda; o estudo vai até o fim do sexto mês seguinte", () => {
  assert.equal(weekStart("2026-11-15"), "2026-11-09");
  assert.equal(weekStart("2026-11-16"), "2026-11-16");
  assert.equal(horizonEndFor("2026-11-15"), "2027-05-31");
  assert.equal(horizonEndFor("2026-08-31"), "2027-02-28");
  assert.equal(addMonths("2026-11", 3), "2027-02");
  assert.equal(monthEnd("2028-02"), "2028-02-29");
  assert.equal(buildCashFlowStudy(base()).horizonEnd, "2027-05-31");
});

test("boleto emitido cai 3 dias após a emissão; vencido conta hoje e fica marcado como atrasado", () => {
  const result = buildCashFlowStudy(base({ batches: [
    batch("b1", { status: "issued", issuedAt: "2026-11-13T15:00:00.000Z", paidAt: null, totalCents: 1_012_000 }),
    batch("b2", { status: "issued", issuedAt: "2026-11-01T15:00:00.000Z", paidAt: null, totalCents: 50_000 }),
  ] }));
  const b1 = result.entries.find(entry => entry.id === "batch:b1")!;
  const b2 = result.entries.find(entry => entry.id === "batch:b2")!;
  assert.equal(b1.date, "2026-11-16");
  assert.equal(b1.certainty, "guaranteed");
  assert.equal(b1.stage, "boleto");
  assert.equal(b1.detail, "Espécie · vendas de 01/09/2026 a 21/09/2026");
  assert.equal(b1.lateFrom, undefined, "no prazo não é atrasado");
  assert.equal(b2.date, TODAY, "boleto atrasado conta hoje");
  assert.equal(b2.lateFrom, "2026-11-04", "e guarda a data em que devia ter caído");
  assert.equal(b2.unit?.name, "Quiosque Tirirical");
  assert.equal(result.units[0].boletoCents, 1_062_000);
});

test("lote aberto e fechamento aprovado sem lote viram 'contado' em hoje + 10 dias, sem contar em dobro, com a data de origem", () => {
  const result = buildCashFlowStudy(base({
    batches: [batch("open", { status: "open", paidAt: null, issuedAt: null, totalCents: 30_000, periodEndDate: "2026-11-09" })],
    closures: [
      closure("2026-11-10", { depositStatus: "allocated", depositEligibleCents: 30_000 }),
      closure("2026-11-11", { depositStatus: "not_allocated", depositEligibleCents: 12_000 }),
    ],
  }));
  const counted = result.entries.filter(entry => entry.source === "deposit_counted");
  assert.deepEqual(counted.map(entry => entry.amountCents).sort(), [12_000, 30_000]);
  assert.ok(counted.every(entry => entry.date === addDays(TODAY, 10) && entry.stage === "counted"));
  assert.deepEqual(counted.map(entry => entry.sinceDate).sort(), ["2026-11-09", "2026-11-11"]);
  assert.equal(result.units[0].countedCents, 42_000);
});

test("espécie de dia sem contagem usa o prazo padrão até a unidade ter 4 lotes pagos e guarda desde quando espera", () => {
  const open = closure("2026-11-14", { status: "draft", depositStatus: "not_eligible" });
  const without = buildCashFlowStudy(base({ closures: [open] }));
  const entry = without.entries.find(item => item.source === "cash_open")!;
  assert.equal(entry.date, addDays("2026-11-14", DEFAULT_CASH_LAG_DAYS));
  assert.equal(entry.stage, "cash_open");
  assert.equal(entry.sinceDate, "2026-11-14");
  assert.equal(entry.detail, "Vendas de 14/11/2026");
  assert.match(entry.label, /aguardando contagem/);
  // 4 lotes pagos, meio do período em 11/09 e pagamento em 28/09 = 17 dias.
  const paid = ["p1", "p2", "p3", "p4"].map(id => batch(id));
  assert.deepEqual(cashLagByUnit(paid).of("k1"), { days: 17, fromHistory: true });
  assert.deepEqual(cashLagByUnit(paid).units, [{ kioskId: "k1", kioskName: "Quiosque Tirirical", paidBatches: 4, avgDays: 17, maxDays: 17 }]);
  const withHistory = buildCashFlowStudy(base({ closures: [open], batches: paid }));
  assert.equal(withHistory.entries.find(item => item.source === "cash_open")!.date, "2026-12-01");
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
  assert.equal(pix.stage, "projected");
  assert.equal(pix.label, "Venda futura · Pix");
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
    expense("e1", { description: "Aluguel", supplier: "Shopping", date: "2026-11-05", amountCents: 600_000 }),
    expense("e2", { description: "Folha", date: "2026-12-05", amountCents: 960_000, provisioned: true }),
    expense("e3", { description: "Sem data", date: null, amountCents: 1_000 }),
    expense("e4", { description: "Fora do horizonte", date: "2027-08-01", amountCents: 1_000 }),
  ] }));
  const e1 = result.entries.find(entry => entry.id === "expense:e1")!;
  assert.equal(e1.date, TODAY);
  assert.equal(e1.overdue, true);
  assert.equal(result.entries.find(entry => entry.id === "expense:e2")!.certainty, "provisioned");
  assert.ok(!result.entries.some(entry => entry.id === "expense:e4"));
  assert.ok(result.gaps.some(gap => gap.includes("sem vencimento")));
});

test("saídas recorrentes: média de 3 meses por categoria, só no que ainda não está lançado nem pago", () => {
  const realized = ["2026-08", "2026-09", "2026-10"].flatMap(month => [out(`${month}-05`, 1_000_000), out(`${month}-10`, 400_000, { id: "aluguel", name: "Aluguel" })]);
  const entries = projectRecurringOutflows({ today: TODAY, realized, expenses: [] }, "2027-02-28");
  const folha = entries.filter(entry => entry.label === "Folha");
  assert.deepEqual(folha.map(entry => entry.date), ["2026-11-15", "2026-12-05", "2027-01-05", "2027-02-05"], "novembro já passou do dia 5 e não tem folha lançada: entra hoje");
  assert.ok(folha.every(entry => entry.certainty === "recurring" && entry.source === "expense_recurring" && entry.direction === "out" && entry.amountCents === 1_000_000));
  // novembro: o dia típico (5) já passou e nada foi pago nem lançado, então o resíduo cai hoje
  assert.equal(entries.find(entry => entry.id === "recurring:folha:2026-11")!.date, TODAY);

  // despesa lançada da mesma categoria em dezembro cobre a média daquele mês
  const covered = projectRecurringOutflows({ today: TODAY, realized, expenses: [expense("f", { date: "2026-12-05", amountCents: 1_000_000, category: { id: "folha", name: "Folha" } })] }, "2027-02-28");
  assert.ok(!covered.some(entry => entry.id === "recurring:folha:2026-12"));
  // lançamento parcial deixa só o resíduo
  const partial = projectRecurringOutflows({ today: TODAY, realized, expenses: [expense("f", { date: "2026-12-05", amountCents: 600_000, category: { id: "folha", name: "Folha" } })] }, "2027-02-28");
  assert.equal(partial.find(entry => entry.id === "recurring:folha:2026-12")!.amountCents, 400_000);
  // já pago neste mês (novembro) também cobre
  const paid = projectRecurringOutflows({ today: TODAY, realized: [...realized, out("2026-11-05", 1_000_000)], expenses: [] }, "2027-02-28");
  assert.ok(!paid.some(entry => entry.id === "recurring:folha:2026-11"));
  // diferença pequena (menos de 20% da média) é ruído
  const noise = projectRecurringOutflows({ today: TODAY, realized: [...realized, out("2026-11-05", 900_000)], expenses: [] }, "2027-02-28");
  assert.ok(!noise.some(entry => entry.id === "recurring:folha:2026-11"));
});

test("saídas recorrentes ignoram transferências e categoria que apareceu em um só mês", () => {
  const realized = [
    out("2026-08-05", 1_000_000), out("2026-09-05", 1_000_000),
    out("2026-10-02", 900_000, { id: "aplicacao", name: "Aplicação" }, { transfer: true }),
    out("2026-10-03", 900_000, { id: "unica", name: "Compra única" }),
  ];
  const entries = projectRecurringOutflows({ today: TODAY, realized, expenses: [] }, "2027-02-28");
  assert.ok(entries.some(entry => entry.label === "Folha"));
  assert.ok(!entries.some(entry => entry.label === "Aplicação"), "transferência entre contas não é saída");
  assert.ok(!entries.some(entry => entry.label === "Compra única"), "uma só ocorrência não é recorrente");
});

test("categoria com muitos lançamentos vira média semanal; sem classificação entra num grupo próprio", () => {
  const realized = ["2026-08", "2026-09", "2026-10"].flatMap(month =>
    Array.from({ length: 8 }, (_, index) => out(`${month}-${String(index * 3 + 2).padStart(2, "0")}`, 52_000, { id: "insumos", name: "Insumos" })));
  const entries = projectRecurringOutflows({ today: TODAY, realized, expenses: [] }, "2026-12-31");
  const weekly = entries.filter(entry => entry.label === "Insumos");
  assert.ok(weekly.length >= 6, "uma por semana até o fim do horizonte");
  assert.equal(weekly[0].amountCents, Math.round(8 * 52_000 / (52 / 12)));
  assert.ok(weekly.every(entry => entry.id.startsWith("recurring:insumos:")));
  const none = projectRecurringOutflows({ today: TODAY, realized: ["2026-09", "2026-10"].map(month => out(`${month}-12`, 300_000, null)), expenses: [] }, "2026-12-31");
  assert.equal(none[0].label, "Saídas sem classificação");
});

test("conta de investimento fica fora do saldo; saldo ilegível vira lacuna", () => {
  const result = buildCashFlowStudy(base({ accounts: [inter(1_000_000), reserve(2_500_000)] }));
  assert.equal(result.startBalanceCents, 1_000_000);
  assert.equal(result.reserveCents, 2_500_000);
  assert.equal(result.accounts.length, 2);
  const unreadable = buildCashFlowStudy(base({ accounts: [inter(null)] }));
  assert.equal(unreadable.startBalanceCents, null);
  assert.ok(unreadable.gaps.some(gap => gap.includes("saldo do Inter")));
  const partial = buildCashFlowStudy(base({ accounts: [inter(1_000_000), { ...inter(null), id: "outra" }] }));
  assert.equal(partial.startBalanceCents, 1_000_000);
  assert.ok(partial.gaps.some(gap => gap.includes("Nem todas as contas")));
});

test("saúde: mínimo de caixa, meses, saldo no fim do mês e fôlego sem e com a reserva; transferência não é entrada nem saída", () => {
  const realized: StudyRealized[] = [
    ...["2026-08", "2026-09", "2026-10"].flatMap(month => [
      { date: `${month}-10`, direction: "in" as const, amountCents: 5_000_000, category: null, transfer: false },
      out(`${month}-20`, 4_334_000),
    ]),
    { date: "2026-10-02", direction: "out", amountCents: 500_000, category: null, transfer: true },
    { date: "2026-11-03", direction: "in", amountCents: 200_000, category: null, transfer: false },
  ];
  const result = buildCashFlowStudy(base({ realized, accounts: [inter(1_840_000), reserve(2_000_000)], batches: ["p1", "p2"].map(id => batch(id)) }));
  const { health } = result;
  assert.equal(health.months.length, 7);
  assert.equal(health.months.at(-1)!.partial, true);
  assert.equal(health.months.find(month => month.month === "2026-10")!.outCents, 4_334_000, "transferência fora");
  assert.equal(result.minimumCents, Math.round(4_334_000 / (52 / 12)) * 2);
  assert.equal(health.weeklyOutCents, Math.round(4_334_000 / (52 / 12)));
  // saldo no fim de outubro = saldo hoje − tudo que aconteceu depois (a entrada de 03/11)
  assert.equal(health.months.find(month => month.month === "2026-10")!.endBalanceCents, 1_840_000 - 200_000);
  assert.ok(Math.abs(health.runwayWeeks! - 1_840_000 / health.weeklyOutCents!) < 1e-9);
  assert.ok(health.runwayWithReserveWeeks! > health.runwayWeeks!);
  assert.equal(health.surplusCents, Math.round((5_000_000 - 4_334_000)));
  assert.ok(health.outInRatio! < 0.9);
  assert.equal(health.cashLagDays, 17);
});

test("saúde: acerto da média compara o previsto com as vendas das semanas passadas", () => {
  const history = Array.from({ length: 200 }, (_, index) => closure(addDays(TODAY, -200 + index)));
  const accuracy = backtestSalesAccuracy(history, TODAY);
  assert.ok(accuracy.length >= 6);
  assert.ok(accuracy.every(week => week.predictedCents === week.actualCents), "vendas constantes: a média acerta");
  const result = buildCashFlowStudy(base({ closures: history }));
  assert.equal(result.health.accuracyAvg, 0);
  // semana fraca aparece como desvio negativo
  const weak = history.map(item => (item.date >= "2026-11-02" && item.date <= "2026-11-08" ? { ...item, byChannelCents: { cash: 5_000, pix: 10_000, debit_card: 7_500, credit_card: 2_500 } } : item));
  const week = backtestSalesAccuracy(weak, TODAY).find(item => item.weekStart === "2026-11-02")!;
  assert.ok(week.actualCents < week.predictedCents);
  // sem 28 dias de histórico antes da semana, ela não entra
  assert.equal(backtestSalesAccuracy(history.slice(-20), TODAY).length, 0);
});

test("saúde: participação, taxa e prazo de cada forma de pagamento", () => {
  const history = Array.from({ length: 90 }, (_, index) => closure(addDays(TODAY, -90 + index)));
  const { payments, feeRate, monthlySalesCents } = buildCashFlowStudy(base({ closures: history })).health;
  const share = (channel: string) => payments.find(item => item.channel === channel)!.shareRatio;
  assert.equal(Math.round(share("pix") * 100), 40);
  assert.equal(payments.find(item => item.channel === "credit_card")!.settlementDays, 30);
  assert.equal(payments.find(item => item.channel === "cash")!.feeRate, 0);
  assert.equal(monthlySalesCents, Math.round(90 * 50_000 / 3));
  assert.ok(Math.abs(feeRate! - (0.4 * 0.0075 + 0.3 * 0.0146 + 0.1 * 0.0222)) < 1e-9);
});

test("parcelas Stone do mesmo dia viram uma linha com a contagem", () => {
  const result = buildCashFlowStudy(base({ stone: [
    { dueDate: "2026-11-17", grossCents: 10_000, netCents: 9_800, feeCents: 200 },
    { dueDate: "2026-11-17", grossCents: 5_000, netCents: 4_900, feeCents: 100 },
  ] }));
  const stone = result.entries.filter(entry => entry.source === "stone");
  assert.equal(stone.length, 1);
  assert.equal(stone[0].amountCents, 14_700);
  assert.equal(stone[0].stage, "stone");
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
