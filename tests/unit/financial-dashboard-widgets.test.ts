import assert from "node:assert/strict";
import test from "node:test";

import { FINANCIAL_WIDGET_CATALOG, MANAGEMENT_WIDGET_CATALOG, WIDGET_CATALOG_BY_SCOPE } from "../../src/features/management-dashboard/catalog";
import { createDefaultManagementLayout } from "../../src/features/management-dashboard/default-layout";
import { buildFinancialDashboard } from "../../src/features/management-dashboard/financial/data";
import { dashboardLayoutInputSchema } from "../../src/features/management-dashboard/layout-policy";

const day = (offset: number, base = new Date("2026-10-10T12:00:00")) => new Date(base.getTime() + offset * 86_400_000);

test("o painel financeiro oferece ao menos doze widgets, todos do escopo financeiro", () => {
  assert.ok(FINANCIAL_WIDGET_CATALOG.length >= 12);
  assert.ok(FINANCIAL_WIDGET_CATALOG.every((widget) => widget.scope === "financial" && widget.id.startsWith("fin-")));
  assert.ok(MANAGEMENT_WIDGET_CATALOG.every((widget) => widget.scope === "management"));
  assert.equal(WIDGET_CATALOG_BY_SCOPE.financial, FINANCIAL_WIDGET_CATALOG);
});

test("layout padrão do financeiro inclui todos os widgets e é aceito pelo schema", () => {
  const layout = createDefaultManagementLayout("uid", "Ana", "ws", "financial");
  assert.equal(layout.scope, "financial");
  assert.equal(layout.widgets.length, FINANCIAL_WIDGET_CATALOG.length);
  const parsed = dashboardLayoutInputSchema.parse({ name: layout.name, description: layout.description, visibility: layout.visibility, scope: layout.scope, targetProfileIds: [], lockedWidgetIds: [], widgets: layout.widgets, filters: layout.filters });
  assert.equal(parsed.scope, "financial");
});

test("painéis sem escopo continuam sendo da gestão", () => {
  const layout = createDefaultManagementLayout("uid", "Ana");
  const parsed = dashboardLayoutInputSchema.parse({ name: layout.name, description: "", visibility: "personal", targetProfileIds: [], lockedWidgetIds: [], widgets: layout.widgets, filters: layout.filters });
  assert.equal(parsed.scope, "management");
});

test("agregação do painel financeiro separa vencidos, semana, auditoria e competência", () => {
  const now = day(0);
  const data = buildFinancialDashboard({
    now,
    unitNames: ["Quiosque A"],
    accountPlans: [{ id: "p1", name: "Aluguel" }],
    bankAccounts: [{ id: "b1", name: "Inter", active: true }],
    transactions: [
      { id: "t1", direction: "in", type: "revenue", amount: 1000, date: day(-2), accountId: "b1" },
      { id: "t2", direction: "out", type: "expense_payment", amount: 400, date: day(-1), accountId: "b1" },
      { id: "t3", direction: "out", type: "transfer_out", amount: 999, date: day(-1), accountId: "b1" },
    ],
    expenses: [
      { id: "e1", status: "pending", totalValue: 100, dueDate: day(-3), competenceDate: day(-3), supplier: "Forn A", accountId: "p1", resultCenter: "Quiosque A" },
      { id: "e2", status: "pending", totalValue: 50, dueDate: day(2), competenceDate: day(2), supplier: "Forn B", accountId: "p1", resultCenter: "Quiosque A" },
      { id: "e3", status: "pending", totalValue: 70, dueDate: day(-1), originModule: "purchasing", originStatus: "pending_audit", competenceDate: day(-1) },
      { id: "e4", status: "paid", totalValue: 200, dueDate: day(-5), competenceDate: day(-5), supplier: "Forn A", accountId: "p1", resultCenter: "Quiosque A" },
      { id: "e5", status: "partially_paid", totalValue: 300, dueDate: day(10), settlementSummary: { balanceAmountCents: 12000 } },
    ],
  });
  assert.equal(data.overdue.count, 1);
  assert.equal(data.overdue.total, 100);
  assert.equal(data.dueWeek.count, 1);
  assert.equal(data.pendingAudit.count, 1);
  assert.equal(data.competence.paid, 200);
  assert.equal(data.cashMonth.income, 1000);
  assert.equal(data.cashMonth.outcome, 400, "transferências não entram no fluxo");
  assert.equal(data.bankAccounts[0]?.balance, 1000 - 400 - 999);
  assert.equal(data.topCategories[0]?.label, "Aluguel");
  assert.equal(data.forecast[2]?.total, 120, "saldo da baixa parcial cai na semana 2");
  assert.equal(data.units[0]?.label, "Quiosque A");
});
