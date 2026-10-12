import { MANAGEMENT_WIDGET_BY_ID } from "./catalog";
import type { DashboardScope, DashboardWidgetPlacement, ManagementDashboardLayout, ManagementWidgetId } from "./types";

const FINANCIAL_DEFAULT_WIDGETS: ManagementWidgetId[] = [
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
];

const DEFAULT_WIDGETS: ManagementWidgetId[] = [
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
];

export function createDefaultManagementLayout(ownerId: string, ownerName: string, workspaceId = "coala-one", scope: DashboardScope = "management"): ManagementDashboardLayout {
  const now = new Date().toISOString();
  let desktopX = 0;
  let desktopY = 0;
  const widgets: DashboardWidgetPlacement[] = (scope === "financial" ? FINANCIAL_DEFAULT_WIDGETS : DEFAULT_WIDGETS).map((widgetId, index) => {
    const definition = MANAGEMENT_WIDGET_BY_ID.get(widgetId);
    if (!definition) throw new Error(`Widget desconhecido: ${widgetId}`);
    const layouts = structuredClone(definition.defaultLayouts);
    const width = layouts.desktop.w;
    if (desktopX + width > 12) {
      desktopX = 0;
      desktopY += 4;
    }
    layouts.desktop.x = desktopX;
    layouts.desktop.y = desktopY;
    layouts.tablet.x = 0;
    layouts.tablet.y = index * 3;
    layouts.mobile.x = 0;
    layouts.mobile.y = index * 3;
    desktopX += width;
    return { instanceId: `${widgetId}_${index + 1}`, widgetId, layouts, config: {} };
  });

  return {
    id: "personal",
    name: "Meu painel",
    description: scope === "financial" ? "Visão personalizada do financeiro." : "Visão personalizada da gestão.",
    visibility: "personal",
    ownerId,
    ownerName,
    workspaceId,
    scope,
    targetProfileIds: [],
    lockedWidgetIds: [],
    widgets,
    filters: { unitId: null, period: "current-month" },
    revision: 1,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: ownerId,
  };
}
