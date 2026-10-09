import type { PermissionSet } from "@/types";

import type { DashboardBreakpoint, ManagementWidgetId, WidgetRect } from "./types";

export type ManagementWidgetDefinition = {
  id: ManagementWidgetId;
  title: string;
  description: string;
  module: "Comercial" | "Trabalho" | "Estoque" | "Pessoas" | "Financeiro" | "Operações" | "IA e custos";
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
  { id: "goals-revenue", title: "Metas e faturamento", description: "Faturamento, projeção e metas por unidade.", module: "Comercial", preview: "Receita e progresso das metas no período.", href: "/dashboard/goals/tracking", defaultLayouts: full(), allowedSizes: standardSizes, canView: (p) => p.pricing.view || !!p.goals?.view || p.dashboard.technicalSheets },
  { id: "pending-tasks", title: "Tarefas pendentes", description: "Demandas, prazos e aprovações.", module: "Trabalho", preview: "Pendentes, vencidas e aguardando aprovação.", href: "/dashboard/tasks", defaultLayouts: full(), allowedSizes: standardSizes, canView: (p) => p.tasks.view || p.dashboard.view },
  { id: "critical-restock", title: "Reposição crítica", description: "Rupturas previstas e necessidade de compra.", module: "Estoque", preview: "Itens abaixo do mínimo e prazo de reposição.", href: "/dashboard/stock/analysis/restock", defaultLayouts: full(6, 4), allowedSizes: standardSizes, canView: (p) => p.dashboard.operational && p.stock.analysis.restock },
  { id: "best-sellers", title: "Mercadorias mais vendidas", description: "Ranking e comparação entre períodos.", module: "Comercial", preview: "Top mercadorias por quantidade e evolução.", href: "/dashboard/stock/analysis/sales", defaultLayouts: full(), allowedSizes: standardSizes, canView: (p) => p.pricing.view || !!p.goals?.view || p.dashboard.technicalSheets },
  { id: "weekly-schedule", title: "Escala da semana", description: "Turnos e cobertura das unidades.", module: "Pessoas", preview: "Visão semanal da escala selecionada.", href: "/dashboard/dp/schedules", defaultLayouts: full(12, 3), allowedSizes: standardSizes, canView: (p) => p.dp.view || p.dp.schedules.view },
  { id: "vacation-calendar", title: "Calendário de ausências", description: "Férias e ausências previstas.", module: "Pessoas", preview: "Próximas ausências e seus status.", href: "/dashboard/dp/ferias", defaultLayouts: full(), allowedSizes: standardSizes, canView: (p) => p.dp.view },
  { id: "pending-payments", title: "Pagamentos", description: "Vencidos e a vencer no mês.", module: "Financeiro", preview: "Quantidade e valor das obrigações pendentes.", href: "/dashboard/financial/expenses", defaultLayouts: full(), allowedSizes: standardSizes, canView: (p) => !!p.financial?.view },
  { id: "financial-shortcuts", title: "Central financeira", description: "Atalhos para caixa, despesas, DRE e conciliação.", module: "Financeiro", preview: "Acesso rápido aos fluxos financeiros permitidos.", href: "/dashboard/financial", defaultLayouts: full(3, 2), allowedSizes: standardSizes, canView: (p) => !!p.financial?.view },
  { id: "stock-shortcuts", title: "Central de estoque", description: "Estoque, compras, contagem e movimentações.", module: "Estoque", preview: "Acesso rápido aos fluxos de estoque permitidos.", href: "/dashboard/stock", defaultLayouts: full(3, 2), allowedSizes: standardSizes, canView: (p) => p.stock.view },
  { id: "people-shortcuts", title: "Central de pessoas", description: "Colaboradores, escalas, férias e documentos.", module: "Pessoas", preview: "Acesso rápido aos fluxos de pessoas permitidos.", href: "/dashboard/dp", defaultLayouts: full(3, 2), allowedSizes: standardSizes, canView: (p) => p.dp.view },
  { id: "operations-shortcuts", title: "Central de operações", description: "Tarefas, formulários, processos e checklists.", module: "Operações", preview: "Acesso rápido à rotina operacional.", href: "/dashboard/operations", defaultLayouts: full(3, 2), allowedSizes: standardSizes, canView: (p) => p.dashboard.operational },
  { id: "ai-costs-shortcuts", title: "IA e infraestrutura", description: "Custos, limites e alertas de consumo.", module: "IA e custos", preview: "OpenAI, Google Cloud e alertas de franquia.", href: "/dashboard/settings", defaultLayouts: full(3, 2), allowedSizes: standardSizes, canView: (p) => p.settings.viewAiCosts === true },
] as const;

export const MANAGEMENT_WIDGET_BY_ID = new Map(MANAGEMENT_WIDGET_CATALOG.map((widget) => [widget.id, widget]));
