import type { PermissionSet } from "@/types";

import type { DashboardBreakpoint, DashboardScope, ManagementWidgetId, WidgetRect } from "./types";

export type ManagementWidgetDefinition = {
  id: ManagementWidgetId;
  title: string;
  description: string;
  module: "Comercial" | "Trabalho" | "Estoque" | "Pessoas" | "Financeiro" | "Operações" | "IA e custos" | "Contas a pagar" | "Caixa e resultado" | "Conciliação" | "Atalhos";
  scope: DashboardScope;
  preview: string;
  href: string;
  defaultLayouts: Record<DashboardBreakpoint, WidgetRect>;
  allowedSizes: Array<{ w: number; h: number; label: string }>;
  canView: (permissions: PermissionSet) => boolean;
};

const full = (w = 6, h = 3): Record<DashboardBreakpoint, WidgetRect> => ({
  desktop: { x: 0, y: 0, w, h },
  tablet: { x: 0, y: 0, w: Math.min(6, w), h },
  mobile: { x: 0, y: 0, w: 1, h: Math.max(2, h) },
});

const standardSizes = [
  { w: 3, h: 2, label: "Compacto" },
  { w: 6, h: 3, label: "Médio" },
  { w: 12, h: 4, label: "Amplo" },
];

export const MANAGEMENT_WIDGET_CATALOG: readonly ManagementWidgetDefinition[] = [
  { id: "goals-revenue", title: "Faturamento e metas", description: "Faturamento, projeção e metas por unidade.", module: "Comercial", scope: "management", preview: "Receita e progresso das metas no período.", href: "/dashboard/goals/tracking", defaultLayouts: full(), allowedSizes: standardSizes, canView: (p) => !!p.goals?.view },
  { id: "pending-tasks", title: "Tarefas pendentes", description: "Demandas, prazos e aprovações.", module: "Trabalho", scope: "management", preview: "Pendentes, vencidas e aguardando aprovação.", href: "/dashboard/tasks", defaultLayouts: full(), allowedSizes: standardSizes, canView: (p) => p.tasks.view },
  { id: "critical-restock", title: "Reposição crítica", description: "Rupturas previstas e necessidade de compra.", module: "Estoque", scope: "management", preview: "Itens abaixo do mínimo e prazo de reposição.", href: "/dashboard/stock/analysis/restock", defaultLayouts: full(6, 4), allowedSizes: standardSizes, canView: (p) => p.stock.analysis.restock },
  { id: "best-sellers", title: "Mercadorias mais vendidas", description: "Ranking e comparação entre períodos.", module: "Comercial", scope: "management", preview: "Top mercadorias por quantidade e evolução.", href: "/dashboard/stock/analysis/sales", defaultLayouts: full(), allowedSizes: standardSizes, canView: (p) => p.stock.analysis.consumption },
  { id: "weekly-schedule", title: "Escala da semana", description: "Turnos e cobertura das unidades.", module: "Pessoas", scope: "management", preview: "Visão semanal da escala selecionada.", href: "/dashboard/dp/schedules", defaultLayouts: full(12, 3), allowedSizes: standardSizes, canView: (p) => !!p.dp.schedules?.view },
  { id: "vacation-calendar", title: "Calendário de ausências", description: "Férias e ausências previstas.", module: "Pessoas", scope: "management", preview: "Próximas ausências e seus status.", href: "/dashboard/dp/ferias", defaultLayouts: full(), allowedSizes: standardSizes, canView: (p) => !!p.dp.vacation?.viewAll },
  { id: "pending-payments", title: "Pagamentos", description: "Vencidos e a vencer no mês.", module: "Financeiro", scope: "management", preview: "Quantidade e valor das obrigações pendentes.", href: "/dashboard/financial/expenses", defaultLayouts: full(), allowedSizes: standardSizes, canView: (p) => !!p.financial?.view },
  { id: "financial-shortcuts", title: "Central financeira", description: "Atalhos para caixa, despesas, DRE e conciliação.", module: "Financeiro", scope: "management", preview: "Acesso rápido aos fluxos financeiros permitidos.", href: "/dashboard/financial", defaultLayouts: full(3, 2), allowedSizes: standardSizes, canView: (p) => !!p.financial?.view },
  { id: "stock-shortcuts", title: "Central de estoque", description: "Estoque, compras, contagem e movimentações.", module: "Estoque", scope: "management", preview: "Acesso rápido aos fluxos de estoque permitidos.", href: "/dashboard/stock", defaultLayouts: full(3, 2), allowedSizes: standardSizes, canView: (p) => p.stock.view },
  { id: "people-shortcuts", title: "Central de pessoas", description: "Colaboradores, escalas, férias e documentos.", module: "Pessoas", scope: "management", preview: "Acesso rápido aos fluxos de pessoas permitidos.", href: "/dashboard/dp", defaultLayouts: full(3, 2), allowedSizes: standardSizes, canView: (p) => p.dp.view },
  { id: "operations-shortcuts", title: "Central de operações", description: "Tarefas, formulários, processos e checklists.", module: "Operações", scope: "management", preview: "Acesso rápido à rotina operacional.", href: "/dashboard/operations", defaultLayouts: full(3, 2), allowedSizes: standardSizes, canView: (p) => p.dashboard.operational },
  { id: "ai-costs-shortcuts", title: "IA e infraestrutura", description: "Custos, limites e alertas de consumo.", module: "IA e custos", scope: "management", preview: "OpenAI, Google Cloud e alertas de franquia.", href: "/dashboard/settings", defaultLayouts: full(3, 2), allowedSizes: standardSizes, canView: (p) => p.settings.viewAiCosts === true },
] as const;

export const FINANCIAL_WIDGET_CATALOG: readonly ManagementWidgetDefinition[] = [
  { id: "fin-summary", title: "Resumo financeiro", description: "Em aberto, vencimentos de 30 dias, caixa e resultado.", module: "Caixa e resultado", scope: "financial", preview: "Os quatro indicadores principais do financeiro.", href: "/dashboard/financial/dre", defaultLayouts: full(12, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.dashboard },
  { id: "fin-overdue", title: "Vencidos", description: "Despesas pendentes cujo vencimento já passou.", module: "Contas a pagar", scope: "financial", preview: "Valor e lista das despesas em atraso.", href: "/dashboard/financial/expenses?status=overdue", defaultLayouts: full(6, 4), allowedSizes: standardSizes, canView: (p) => !!p.financial?.expenses?.view },
  { id: "fin-due-week", title: "A vencer em 7 dias", description: "Compromissos da semana, do mais próximo ao mais distante.", module: "Contas a pagar", scope: "financial", preview: "O que precisa ser pago nesta semana.", href: "/dashboard/financial/expenses", defaultLayouts: full(6, 4), allowedSizes: standardSizes, canView: (p) => !!p.financial?.expenses?.view },
  { id: "fin-pending-audit", title: "Pendentes de auditoria", description: "Despesas de compras que exigem revisão financeira.", module: "Contas a pagar", scope: "financial", preview: "Fila de despesas aguardando auditoria.", href: "/dashboard/financial/expenses/pending-audit", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.expenses?.view },
  { id: "fin-competence", title: "Competência do mês", description: "Provisionado, pago e em aberto na competência atual.", module: "Contas a pagar", scope: "financial", preview: "Quanto do mês já foi pago.", href: "/dashboard/financial/expenses", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.expenses?.view },
  { id: "fin-cash-month", title: "Entradas e saídas do mês", description: "Movimento realizado do mês e comparação com o anterior.", module: "Caixa e resultado", scope: "financial", preview: "Entradas, saídas e saldo do mês.", href: "/dashboard/financial/cash-flow", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.cashFlow?.view },
  { id: "fin-forecast", title: "Previsão de pagamentos", description: "O que vence por semana nas próximas quatro semanas.", module: "Caixa e resultado", scope: "financial", preview: "Barras por semana com o total a pagar.", href: "/dashboard/financial/cash-flow", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.cashFlow?.view },
  { id: "fin-top-categories", title: "Maiores categorias", description: "Plano de contas com mais despesa na competência.", module: "Caixa e resultado", scope: "financial", preview: "Ranking de categorias do mês.", href: "/dashboard/financial/dre", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.dre },
  { id: "fin-top-suppliers", title: "Maiores fornecedores", description: "Fornecedores com mais despesa na competência.", module: "Contas a pagar", scope: "financial", preview: "Ranking de fornecedores do mês.", href: "/dashboard/financial/expenses", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.expenses?.view },
  { id: "fin-units", title: "Despesas por unidade", description: "Rateio da competência entre as unidades.", module: "Caixa e resultado", scope: "financial", preview: "Quanto cada unidade pesa nas despesas.", href: "/dashboard/financial/dre", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.dre },
  { id: "fin-bank-accounts", title: "Contas bancárias", description: "Saldo lançado em cada conta ativa.", module: "Caixa e resultado", scope: "financial", preview: "Saldos por conta.", href: "/dashboard/financial/cash-flow", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.cashFlow?.view },
  { id: "fin-payables-hub", title: "Central de pagamentos", description: "Despesas, autorizações, caixa de cobranças e patrimônio.", module: "Atalhos", scope: "financial", preview: "Atalhos do contas a pagar.", href: "/dashboard/financial/expenses", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.view },
  { id: "fin-reconciliation-hub", title: "Central de conciliação", description: "Extratos, faturas de cartão, vendas e recebimentos.", module: "Conciliação", scope: "financial", preview: "Atalhos das conciliações.", href: "/dashboard/financial/sales-reconciliation", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.view },
  { id: "fin-cash-control-hub", title: "Controle de caixa", description: "Fechamento, contagem e depósitos em dinheiro.", module: "Atalhos", scope: "financial", preview: "Atalhos do caixa físico.", href: "/dashboard/financial/cash-closures", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.view },
  { id: "fin-planning-hub", title: "Planejamento e resultado", description: "DRE, orçamento, fluxo de caixa e configurações.", module: "Atalhos", scope: "financial", preview: "Atalhos de análise e planejamento.", href: "/dashboard/financial/dre", defaultLayouts: full(6, 3), allowedSizes: standardSizes, canView: (p) => !!p.financial?.view },
] as const;

export const WIDGET_CATALOG_BY_SCOPE: Record<DashboardScope, readonly ManagementWidgetDefinition[]> = {
  management: MANAGEMENT_WIDGET_CATALOG,
  financial: FINANCIAL_WIDGET_CATALOG,
};

export const MANAGEMENT_WIDGET_BY_ID = new Map([...MANAGEMENT_WIDGET_CATALOG, ...FINANCIAL_WIDGET_CATALOG].map((widget) => [widget.id, widget]));
