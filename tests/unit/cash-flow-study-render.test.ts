import { CashOperationsPanel } from "../../src/features/financial/cash-flow-study/cash-operations-panel";
import type { CashOperation } from "../../src/features/financial/cash-flow-study/cash-stages";
import { issuedCashEvidence } from "../helpers/cash-flow-study-fixtures";
import assert from "node:assert/strict";
import test from "node:test";
import * as ReactNamespace from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BudgetPaceSummary } from "../../src/features/financial/components/budget-comparison-summary";
import { KpiFlowStrip } from "../../src/features/financial/components/expenses/kpi-flow-strip";
import type { FinancialBudgetSummary } from "../../src/features/financial/budgets/types";
import { MovementsTab } from "../../src/features/financial/components/cash-flow/movements-tab";
import type { CashMovement } from "../../src/features/financial/components/cash-flow/movements-model";
import type { CashFlowStudyPayload, StudyControls } from "../../src/features/financial/cash-flow-study/cash-flow-study-view";
import { EntriesTab } from "../../src/features/financial/cash-flow-study/entries-tab";
import { HealthTab } from "../../src/features/financial/cash-flow-study/health-tab";
import { addDays, buildCashFlowStudy, type StudyBatch, type StudyClosure, type StudyRealized, type StudyInputs } from "../../src/features/financial/cash-flow-study/model";
import { autoGranularity, futurePresetRange, type Granularity } from "../../src/features/financial/cash-flow-study/periods";
import { WeeksTab } from "../../src/features/financial/cash-flow-study/weeks-tab";

// O tsx compila o JSX no modo clássico (o Next usa o automático): o teste entrega `React` como global.
Object.assign(globalThis, { React: ReactNamespace });

const TODAY = "2026-11-17";
const closure = (date: string, partial: Partial<StudyClosure> = {}): StudyClosure => ({
  kioskId: "k1", kioskName: "Quiosque Iguatemi", date, status: "approved",
  byChannelCents: { cash: 10_000, pix: 20_000, debit_card: 15_000, credit_card: 5_000 }, depositStatus: "issued", depositEligibleCents: 10_000, ...partial,
});
const batch = (id: string, partial: Partial<StudyBatch> = {}): StudyBatch => ({
  id, workspaceId: "coala", interCobrancaId: `${id}_bill`, kioskId: "k1", kioskName: "Quiosque Iguatemi", status: "paid", totalCents: 100_000, periodStartDate: "2026-09-01", periodEndDate: "2026-09-21",
  issuedAt: "2026-09-25T12:00:00.000Z", paidAt: "2026-09-28T12:00:00.000Z", ...partial,
});
const realized: StudyRealized[] = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].flatMap(month => [
  { date: `${month}-10`, direction: "in" as const, amountCents: 5_000_000, category: null, transfer: false },
  { date: `${month}-05`, direction: "out" as const, amountCents: 1_800_000, category: { id: "folha", name: "Folha" }, transfer: false },
  { date: `${month}-20`, direction: "out" as const, amountCents: 2_400_000, category: { id: "fornecedores", name: "Fornecedores" }, transfer: false },
]);
const studyInput: StudyInputs = {
  today: TODAY,
  accounts: [{ id: "inter", name: "Inter · conta corrente", kind: "operating", cents: 1_658_143, at: "2026-11-17T21:55:00.000Z" }, { id: "cdb", name: "Inter · CDB", kind: "reserve", cents: 2_000_000, at: null }],
  stone: [{ dueDate: "2026-11-18", grossCents: 30_000, netCents: 29_000, feeCents: 1_000 }],
  batches: [
    ...["p1", "p2", "p3", "p4"].map(id => batch(id)),
    batch("late", { status: "issued", issuedAt: "2026-11-10T12:00:00.000Z", paidAt: null, totalCents: 380_000 }),
    batch("ok", { status: "issued", issuedAt: "2026-11-16T12:00:00.000Z", paidAt: null, totalCents: 840_000, kioskId: "k2", kioskName: "Quiosque Riomar" }),
  ],
  closures: [...Array.from({ length: 200 }, (_, index) => closure(addDays(TODAY, -200 + index))), closure("2026-11-14", { status: "draft", depositStatus: "not_eligible" })],
  expenses: [{ id: "e1", description: "FGTS - 11/2026", supplier: null, date: "2026-11-20", amountCents: 312_000, provisioned: false, category: { id: "fgts", name: "FGTS" } }],
  realized,
};
const study = buildCashFlowStudy({ ...studyInput, cashEvidence: issuedCashEvidence(studyInput.batches) });
const payload: CashFlowStudyPayload = { ...study, generatedAt: "2026-11-17T21:55:00.000Z" };

const controls = (range: { from: string; to: string }, granularity: Granularity, projection: boolean, includeReserve = false): StudyControls => ({
  today: TODAY, range, preset: "next_month", granularity, projection, includeReserve,
  setGranularity: () => undefined, setProjection: () => undefined, setIncludeReserve: () => undefined, applyRange: () => undefined,
});

const ranges = [futurePresetRange("this_month", TODAY), futurePresetRange("next_month", TODAY), futurePresetRange("three_months", TODAY), { from: "2027-01-01", to: "2027-03-31" }];

test("Próximas semanas e Entradas renderizam em todos os períodos, agrupamentos e modos de projeção", () => {
  for (const range of ranges) {
    for (const granularity of ["day", "week", "month"] as Granularity[]) {
      for (const projection of [false, true]) {
        const state = controls(range, granularity, projection, projection);
        const weeks = renderToStaticMarkup(createElement(WeeksTab, { data: payload, controls: state }));
        assert.match(weeks, /Quanto vai ter nas contas/);
        assert.match(weeks, /Entradas e saídas/);
        const entries = renderToStaticMarkup(createElement(EntriesTab, { data: payload, controls: state }));
        assert.match(entries, /Aguardando contagem/);
        assert.match(entries, projection ? /Vendas futuras/ : /Fora da conta/);
      }
    }
  }
  assert.equal(autoGranularity(ranges[1]), "week");
});

test("sem projeção não aparece nenhuma venda futura nem saída recorrente; com projeção aparecem", () => {
  const range = futurePresetRange("next_month", TODAY);
  const without = renderToStaticMarkup(createElement(WeeksTab, { data: payload, controls: controls(range, "day", false) }));
  assert.doesNotMatch(without, /Venda futura/);
  assert.doesNotMatch(without, /Média 3 meses/);
  const withProjection = renderToStaticMarkup(createElement(WeeksTab, { data: payload, controls: controls(range, "day", true) }));
  assert.match(withProjection, /Venda futura/);
  assert.match(withProjection, /Média 3 meses/);
});

test("Entradas mostra a pendência com o próximo passo e o boleto vencido", () => {
  const html = renderToStaticMarkup(createElement(EntriesTab, { data: payload, controls: controls(futurePresetRange("next_month", TODAY), "day", false) }));
  assert.match(html, /Precisa de ação/);
  assert.match(html, /Boleto vencido/);
  assert.match(html, /Ir para Depósitos|Ver depósito/);
  assert.match(html, /Numerário: acompanhamento operacional/);
  assert.match(html, /não somam entradas nem saldo previsto/);
  assert.doesNotMatch(html, /1 parado · até 3 dias/, "pendência de espécie saiu do total bancário");
});

test("Saúde do negócio renderiza com dados e com histórico vazio", () => {
  const html = renderToStaticMarkup(createElement(HealthTab, { data: payload }));
  assert.match(html, /Fôlego/);
  assert.match(html, /Sobra do mês/);
  assert.match(html, /Acerto da projeção/);
  assert.match(html, /Custo de receber/);
  const empty = buildCashFlowStudy({ today: TODAY, accounts: [{ id: "inter", name: "Inter", kind: "operating", cents: null, at: null }], stone: [], batches: [], closures: [], expenses: [], realized: [] });
  const emptyHtml = renderToStaticMarkup(createElement(HealthTab, { data: { ...empty, generatedAt: "x" } }));
  assert.match(emptyHtml, /Indisponível/);
});

test("Movimentações renderiza vazio e com pendência", () => {
  const range = { from: "2026-11-01", to: TODAY };
  const empty = renderToStaticMarkup(createElement(MovementsTab, { movements: [], range, granularity: "day", onGranularity: () => undefined, loading: false, today: TODAY }));
  assert.match(empty, /Extrato das contas/);
  const movements: CashMovement[] = [
    { id: "a", date: new Date("2026-11-12T12:00:00"), description: "Pix enviado", direction: "out", status: "realized", amount: 84, accountName: "Inter" },
    { id: "b", date: new Date("2026-11-14T12:00:00"), description: "Venda", direction: "in", status: "realized", amount: 1_000, accountName: "Inter" },
  ];
  const html = renderToStaticMarkup(createElement(MovementsTab, { movements, range, granularity: "day", onGranularity: () => undefined, loading: false, today: TODAY }));
  assert.match(html, /Sem despesa vinculada/);
  assert.match(html, /Vincular despesa/);
  assert.match(html, /Pix enviado/);
});

test("Despesas: a faixa mostra o provisionado × pago por competência e marca a selecionada", () => {
  const kpis = { open: 100_000, launchedOpen: 60_000, reconciledProvisionOpen: 0, auditOpen: 0, overdue: 10_000, paid: 400_000, dueSoon: 20_000, pendingAudit: 0 };
  const points = [{ key: "2026-10", month: "out/26", provisioned: 5_710_000, paid: 5_620_000 }, { key: "2026-11", month: "nov/26", provisioned: 5_830_000, paid: 2_950_000 }];
  const html = renderToStaticMarkup(createElement(KpiFlowStrip, {
    kpis, openCount: 3, auditCount: 0, onAuditClick: () => undefined, periodLabel: "Competência 11/2026", competences: points, selectedCompetence: "2026-11", onCompetenceSelect: () => undefined,
  }));
  assert.match(html, /Por competência/);
  assert.match(html, /out\/26/);
  assert.match(html, /98%/);
  assert.match(html, /aria-pressed="true"[^>]*aria-label="nov\/26/);
  const without = renderToStaticMarkup(createElement(KpiFlowStrip, { kpis, openCount: 3, auditCount: 0, onAuditClick: () => undefined, periodLabel: "x" }));
  assert.doesNotMatch(without, /Por competência/);
});

test("Orçamento × despesas: o card mostra o ritmo, o livre e a curva", () => {
  const budget: FinancialBudgetSummary = {
    id: "b", name: "Embalagens e copos", competenceMonth: "2026-11", accountPlanIds: ["x"], budgetedAmountCents: 350_000, active: true, source: "manual", ruleId: null,
    calculationMode: "manual", calculationSnapshot: null, createdBy: "t", createdAt: "", updatedAt: "", consumedAmountCents: 391_000, forecastCoverageAmountCents: 0,
    balanceAmountCents: -41_000, usageRatio: 1.117, residualAmountCents: 0, expenses: [],
    curve: [{ key: "1", day: "01", plannedBalanceCents: 350_000, actualBalanceCents: 350_000 }, { key: "2", day: "02", plannedBalanceCents: 340_000, actualBalanceCents: -41_000 }], issues: [],
  };
  const html = renderToStaticMarkup(createElement(BudgetPaceSummary, { budget, today: "2026-11-17" }));
  assert.match(html, /Estourou/);
  assert.match(html, /acima do previsto/);
  assert.match(html, /Já passou/);
  const calm = renderToStaticMarkup(createElement(BudgetPaceSummary, { budget: { ...budget, consumedAmountCents: 100_000, balanceAmountCents: 250_000, residualAmountCents: 50_000 }, today: "2026-11-17" }));
  assert.match(calm, /No ritmo/);
  assert.match(calm, /livre/);
  assert.match(calm, /Ainda é esperada compra/);
});

test("quadro oculta parcial de setembro, mantém outubro e acesso ao histórico", () => {
 const base = { unitId: "demo", unitName: "Unidade demonstração", stage: "partial" as const, referenceCents: 10000, finalizedOperators: 1, allocatedOperators: 0, receivedOperators: 0, totalOperators: 2, remainingCents: null, outsideDepositPolicy: false };
 const operations: CashOperation[] = [{ ...base, id: "old", originDate: "2026-09-30" }, { ...base, id: "current", originDate: "2026-10-01" }, { ...base, id: "paid-history", originDate: "2026-09-29", stage: "received", finalizedOperators: 2, allocatedOperators: 2, receivedOperators: 2 }];
 const html = renderToStaticMarkup(createElement(CashOperationsPanel, { operations }));
 assert.doesNotMatch(html, /Vendas de 30\/09\/2026/);
 assert.match(html, /Vendas de 01\/10\/2026/);
 assert.match(html, /Pendências · 1/); assert.match(html, /Recebidos · 1/);
 assert.match(html, /href="\/dashboard\/financial\/cash-closures"/);
 assert.equal(operations.length, 3, "dados anteriores preservados");
});
