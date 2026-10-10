import assert from "node:assert/strict";
import test from "node:test";
import { Fragment, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GoalsWidget } from "../../src/features/management-dashboard/widgets/goals-widget";
import { HubWidget } from "../../src/features/management-dashboard/widgets/hub-widget";
import { widgetIcons } from "../../src/features/management-dashboard/widgets/icons";
import { WidgetDensityOverride } from "../../src/features/management-dashboard/widgets/kit";
import { PaymentsWidget } from "../../src/features/management-dashboard/widgets/payments-widget";
import { RestockWidget } from "../../src/features/management-dashboard/widgets/restock-widget";
import { SalesWidget } from "../../src/features/management-dashboard/widgets/sales-widget";
import { ScheduleWidget } from "../../src/features/management-dashboard/widgets/schedule-widget";
import { TasksWidget } from "../../src/features/management-dashboard/widgets/tasks-widget";
import { VacationsWidget } from "../../src/features/management-dashboard/widgets/vacations-widget";
import { densityFromWidth, type WidgetDensity } from "../../src/features/management-dashboard/widgets/density";

const densities: WidgetDensity[] = ["compact", "medium", "wide"];
const money = (value: number) => `R$ ${value.toFixed(2)}`;
const noop = () => undefined;

const task = (id: string, overdue = false) => ({ id, title: `Tarefa ${id}`, statusLabel: "Pendente", dueLabel: "10/10", overdue });
const shift = (id: string) => ({ id, name: `Pessoa ${id}`, time: "07:00 - 14:00", initials: "PA" });

function render(element: ReactElement, density: WidgetDensity) {
  // O tsx compila JSX no modo clássico; mesmo recurso usado em client-observability.test.ts.
  Object.assign(globalThis, { React: { createElement, Fragment } });
  return renderToStaticMarkup(createElement(WidgetDensityOverride.Provider, { value: density }, element));
}

const widgets: Array<{ name: string; element: () => ReactElement; mustContain: string }> = [
  {
    name: "metas",
    mustContain: "Tirirical",
    element: () => createElement(GoalsWidget, { revenue: 21975, targetTotal: 77000, projected: { value: 75692, detail: "projeção" }, rows: [{ kioskId: "t", name: "Tirirical", current: 11274.5, target: 29000, progress: 0.389 }, { kioskId: "j", name: "João Paulo", current: 7089, target: 24000, progress: 0.295 }], goalCount: 2, loading: false, monthProgress: 0.29, monthLabel: "outubro de 2026", formatMoney: money, formatCompact: money, onDetails: noop }),
  },
  {
    name: "tarefas",
    mustContain: "Tarefa 1",
    element: () => createElement(TasksWidget, { loading: false, pendingCount: 8, overdueCount: 2, approvalCount: 3, dueTodayCount: 1, taskCount: 6, receiptCount: 2, pending: [task("1"), task("2", true)], approvals: [task("3")], overdue: [task("2", true)] }),
  },
  {
    name: "reposição",
    mustContain: "Copo",
    element: () => createElement(RestockWidget, { unitName: "CD", unavailableReason: null, items: [{ id: "1", name: "Copo 300 ml", current: 40, minimumLabel: "600", leadTime: 5, daysUntilRupture: 0, ruptureLabel: "09/10", orderLimitLabel: "04/10", coverage: 0.07 }, { id: "2", name: "Leite", current: 18, minimumLabel: "48", leadTime: 2, daysUntilRupture: null, ruptureLabel: "sem consumo médio", orderLimitLabel: "sem data", coverage: null }] }),
  },
  {
    name: "mais vendidas",
    mustContain: "Casquinha Mista",
    element: () => createElement(SalesWidget, { items: [{ name: "Casquinha Mista", quantity: 9931, previous: 9000, sameElapsedCurrent: 3000, sameElapsedPrevious: 2800 }, { name: "Cascão Misto", quantity: 4453, previous: 4000, sameElapsedCurrent: 1500, sameElapsedPrevious: 1600 }], totalQuantity: 34024, periodLabel: "outubro/2026", unitFilter: null, onDetails: noop }),
  },
  {
    name: "escala",
    mustContain: "Pessoa 1",
    element: () => createElement(ScheduleWidget, { days: [{ key: "2026-10-09", weekday: "sex", dateLabel: "09/10", isToday: true, shifts: [shift("1")] }, { key: "2026-10-10", weekday: "sáb", dateLabel: "10/10", isToday: false, shifts: [] }], emptyMessage: null, unitFilter: null, unitLabel: "Tirirical", onMonth: noop }),
  },
  {
    name: "ausências",
    mustContain: "Colaboradora A",
    element: () => createElement(VacationsWidget, { loading: false, items: [{ id: "1", name: "Colaboradora A", initials: "CA", rangeLabel: "12/10 a 26/10", status: "APPROVED", statusLabel: "Aprovada", startDay: 12, endDay: 26 }, { id: "2", name: "Colaboradora B", initials: "CB", rangeLabel: "19/10 a 31/10", status: "PENDING", statusLabel: "Pendente", startDay: 19, endDay: 31 }], monthLabel: "outubro de 2026", monthDays: 31, todayDay: 9, onDetails: noop }),
  },
  {
    name: "pagamentos",
    mustContain: "Energia",
    element: () => createElement(PaymentsWidget, { loading: false, overdueTotal: 2310, upcomingTotal: 6850, overdueCount: 3, upcomingCount: 4, rows: [{ id: "1", description: "Aluguel", dueDay: "05", dueLabel: "out", value: "R$ 1.600,00", overdue: true, daysLabel: "Venceu há 4 dia(s)" }, { id: "2", description: "Energia", dueDay: "12", dueLabel: "out", value: "R$ 1.180,00", overdue: false, daysLabel: "Vence em 3 dia(s)" }], formatMoney: money, onDetails: noop }),
  },
  {
    name: "central",
    mustContain: "Despesas",
    element: () => createElement(HubWidget, {
      widgetId: "financial-shortcuts", title: "Central financeira", subtitle: "Caixa", href: "/dashboard/financial", icon: widgetIcons.financeHub, tone: "ok",
      links: [{ label: "Despesas", description: "d", href: "/a", icon: widgetIcons.expenses, tone: "danger", badge: 3 }, { label: "Caixa", description: "d", href: "/b", icon: widgetIcons.cash, tone: "ok" }],
      kpis: [{ label: "Vencidos", value: "R$ 1,00", tone: "danger" }],
      attention: [{ title: "Pagamentos vencidos", text: "3", href: "/a", tone: "danger", icon: widgetIcons.alerts }],
      status: { tone: "danger", label: "3 vencido(s)" },
    }),
  },
];

for (const widget of widgets) {
  for (const density of densities) {
    test(`widget ${widget.name} renderiza em ${density}`, () => {
      const html = render(widget.element(), density);
      assert.match(html, new RegExp(`data-density="${density}"`));
      assert.ok(html.includes(widget.mustContain), `esperava "${widget.mustContain}" em ${density}`);
      assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
    });
  }
}

test("densidade segue a largura do cartão", () => {
  assert.equal(densityFromWidth(288), "compact");
  assert.equal(densityFromWidth(600), "medium");
  assert.equal(densityFromWidth(1224), "wide");
});

test("estados vazios não quebram nenhum tamanho", () => {
  for (const density of densities) {
    const html = render(createElement(RestockWidget, { unitName: null, unavailableReason: "Política indisponível.", items: [] }), density);
    assert.ok(html.includes("Política indisponível."));
    const goals = render(createElement(GoalsWidget, { revenue: 0, targetTotal: 0, projected: { value: 0, detail: "" }, rows: [], goalCount: 0, loading: false, monthProgress: 0, monthLabel: "", formatMoney: money, formatCompact: money, onDetails: noop }), density);
    assert.ok(goals.includes("Nenhuma meta neste mês"));
  }
});

function permissionsWith(granted: Record<string, boolean>) {
  const build = (path: string): unknown => new Proxy({}, {
    get: (_target, key) => {
      if (typeof key !== "string") return undefined;
      const next = path ? `${path}.${key}` : key;
      return next in granted ? granted[next] : build(next);
    },
  });
  return build("") as never;
}

test("cada widget só aparece para quem tem o módulo de origem", async () => {
  const { MANAGEMENT_WIDGET_CATALOG } = await import("../../src/features/management-dashboard/catalog");
  const visibleFor = (granted: Record<string, boolean>) =>
    MANAGEMENT_WIDGET_CATALOG.filter((widget) => widget.canView(permissionsWith(granted))).map((widget) => widget.id);

  // Sem nenhuma permissão, nenhum widget; o proxy "vazio" é truthy, então fixamos os módulos como falsos.
  const none = Object.fromEntries(["financial.view", "stock.view", "stock.analysis.restock", "stock.analysis.consumption", "dp.view", "dp.schedules.view", "dp.vacation.viewAll", "goals.view", "tasks.view", "dashboard.operational", "settings.viewAiCosts"].map((key) => [key, false]));
  assert.deepEqual(visibleFor(none), []);
  assert.deepEqual(visibleFor({ ...none, "financial.view": true }).sort(), ["financial-shortcuts", "pending-payments"]);
  assert.deepEqual(visibleFor({ ...none, "goals.view": true }), ["goals-revenue"]);
  assert.deepEqual(visibleFor({ ...none, "stock.analysis.consumption": true }), ["best-sellers"]);
});
