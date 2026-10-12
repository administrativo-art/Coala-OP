import { z } from "zod";

import { ALL_WIDGET_IDS, type DashboardBreakpoint, type DashboardWidgetPlacement, type ManagementDashboardLayout } from "./types";

export const DASHBOARD_COLUMNS: Record<DashboardBreakpoint, number> = { desktop: 12, tablet: 6, mobile: 1 };
export const MAX_DASHBOARD_WIDGETS = 30;
export const MAX_USER_DASHBOARDS = 12;

const rectSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(500),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
}).strict();

export const widgetPlacementSchema = z.object({
  instanceId: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  widgetId: z.enum(ALL_WIDGET_IDS),
  layouts: z.object({ desktop: rectSchema, tablet: rectSchema, mobile: rectSchema }).strict(),
  config: z.object({
    title: z.string().trim().max(80).optional(),
    unitId: z.string().trim().max(160).optional(),
    period: z.enum(["current-month", "last-30-days", "current-week"]).optional(),
    compact: z.boolean().optional(),
  }).strict(),
}).strict();

export const dashboardLayoutInputSchema = z.object({
  id: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).default(""),
  visibility: z.enum(["personal", "shared", "template"]),
  scope: z.enum(["management", "financial"]).default("management"),
  targetProfileIds: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  lockedWidgetIds: z.array(z.string().trim().min(1).max(100)).max(MAX_DASHBOARD_WIDGETS).default([]),
  widgets: z.array(widgetPlacementSchema).min(1).max(MAX_DASHBOARD_WIDGETS),
  filters: z.object({
    unitId: z.string().trim().max(160).nullable(),
    period: z.enum(["current-month", "last-30-days", "current-week"]),
  }).strict(),
  expectedRevision: z.number().int().min(0).optional(),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  for (const widget of value.widgets) {
    if (ids.has(widget.instanceId)) context.addIssue({ code: "custom", path: ["widgets"], message: "Cada widget precisa de uma instância única." });
    ids.add(widget.instanceId);
    for (const breakpoint of ["desktop", "tablet", "mobile"] as const) {
      const rect = widget.layouts[breakpoint];
      if (rect.x + rect.w > DASHBOARD_COLUMNS[breakpoint]) context.addIssue({ code: "custom", path: ["widgets", widget.instanceId, breakpoint], message: `Widget ultrapassa o grid ${breakpoint}.` });
    }
  }
});

export function normalizeWidgetPositions(widgets: DashboardWidgetPlacement[], breakpoint: DashboardBreakpoint) {
  const columns = DASHBOARD_COLUMNS[breakpoint];
  let cursor = 0;
  return widgets.map((widget) => {
    const current = widget.layouts[breakpoint];
    const w = Math.min(columns, Math.max(1, current.w));
    const normalized = { ...current, w, x: cursor % columns };
    if (normalized.x + w > columns) normalized.x = 0;
    normalized.y = Math.floor(cursor / columns) * Math.max(1, normalized.h);
    cursor += w;
    return { ...widget, layouts: { ...widget.layouts, [breakpoint]: normalized } };
  });
}
export function cloneLayout(layout: ManagementDashboardLayout, ownerId: string, ownerName: string): ManagementDashboardLayout {
  const now = new Date().toISOString();
  return {
    ...structuredClone(layout),
    id: `layout_${crypto.randomUUID().replaceAll("-", "")}`,
    name: `${layout.name} — cópia`,
    visibility: "personal",
    ownerId,
    ownerName,
    targetProfileIds: [],
    lockedWidgetIds: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: ownerId,
  };
}
