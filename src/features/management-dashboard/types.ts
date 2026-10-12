export const MANAGEMENT_WIDGET_IDS = [
  "goals-revenue",
  "pending-tasks",
  "critical-restock",
  "best-sellers",
  "weekly-schedule",
  "vacation-calendar",
  "pending-payments",
  "financial-shortcuts",
  "stock-shortcuts",
  "people-shortcuts",
  "operations-shortcuts",
  "ai-costs-shortcuts",
] as const;

export const FINANCIAL_WIDGET_IDS = [
  "fin-summary",
  "fin-overdue",
  "fin-due-week",
  "fin-pending-audit",
  "fin-competence",
  "fin-cash-month",
  "fin-forecast",
  "fin-top-categories",
  "fin-top-suppliers",
  "fin-units",
  "fin-bank-accounts",
  "fin-payables-hub",
  "fin-reconciliation-hub",
  "fin-cash-control-hub",
  "fin-planning-hub",
] as const;

export const ALL_WIDGET_IDS = [...MANAGEMENT_WIDGET_IDS, ...FINANCIAL_WIDGET_IDS] as const;

export type ManagementWidgetId = (typeof ALL_WIDGET_IDS)[number];
export type FinancialWidgetId = (typeof FINANCIAL_WIDGET_IDS)[number];
/** Cada painel pertence a uma área: o da gestão (início) ou o do financeiro. */
export type DashboardScope = "management" | "financial";
export type DashboardBreakpoint = "desktop" | "tablet" | "mobile";
export type DashboardVisibility = "personal" | "shared" | "template";

export type WidgetRect = { x: number; y: number; w: number; h: number };

export type DashboardWidgetPlacement = {
  instanceId: string;
  widgetId: ManagementWidgetId;
  layouts: Record<DashboardBreakpoint, WidgetRect>;
  config: {
    title?: string;
    unitId?: string;
    period?: "current-month" | "last-30-days" | "current-week";
    compact?: boolean;
  };
};
export type DashboardGlobalFilters = {
  unitId: string | null;
  period: "current-month" | "last-30-days" | "current-week";
};

export type ManagementDashboardLayout = {
  id: string;
  name: string;
  description: string;
  visibility: DashboardVisibility;
  ownerId: string;
  ownerName: string;
  workspaceId: string;
  /** Ausente nos painéis antigos, que são todos da gestão. */
  scope?: DashboardScope;
  targetProfileIds: string[];
  lockedWidgetIds: string[];
  widgets: DashboardWidgetPlacement[];
  filters: DashboardGlobalFilters;
  revision: number;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type DashboardLayoutVersion = {
  revision: number;
  createdAt: string;
  createdBy: string;
  name: string;
  widgets: DashboardWidgetPlacement[];
  filters: DashboardGlobalFilters;
};

export type DashboardLayoutsPayload = {
  layouts: ManagementDashboardLayout[];
  activeLayoutId: string | null;
  canManageTemplates: boolean;
};
