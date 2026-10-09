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

export type ManagementWidgetId = (typeof MANAGEMENT_WIDGET_IDS)[number];
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
