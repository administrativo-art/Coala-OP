import assert from "node:assert/strict";
import test from "node:test";

import { OPERATIONS_WIDGET_CATALOG, WIDGET_CATALOG_BY_SCOPE } from "../../src/features/management-dashboard/catalog";
import { createDefaultManagementLayout } from "../../src/features/management-dashboard/default-layout";
import { dashboardLayoutInputSchema } from "../../src/features/management-dashboard/layout-policy";
import { defaultAdminPermissions, defaultGuestPermissions } from "../../src/types";

test("o painel de operações tem widgets próprios, todos do escopo operations", () => {
  assert.ok(OPERATIONS_WIDGET_CATALOG.length >= 6);
  assert.ok(OPERATIONS_WIDGET_CATALOG.every((widget) => widget.scope === "operations" && widget.id.startsWith("ops-")));
  assert.equal(WIDGET_CATALOG_BY_SCOPE.operations, OPERATIONS_WIDGET_CATALOG);
});

test("layout padrão da operação inclui todos os widgets e é aceito pelo schema", () => {
  const layout = createDefaultManagementLayout("uid", "Ana", "ws", "operations");
  assert.equal(layout.widgets.length, OPERATIONS_WIDGET_CATALOG.length);
  const parsed = dashboardLayoutInputSchema.parse({ name: layout.name, description: layout.description, visibility: layout.visibility, scope: layout.scope, targetProfileIds: [], lockedWidgetIds: [], widgets: layout.widgets, filters: layout.filters });
  assert.equal(parsed.scope, "operations");
});

test("o widget só aparece para quem tem a permissão correspondente", () => {
  const visible = (permissions: typeof defaultGuestPermissions) => OPERATIONS_WIDGET_CATALOG.filter((widget) => widget.canView(permissions)).map((widget) => widget.id);
  const guest = structuredClone(defaultGuestPermissions);
  guest.stock.view = false;
  guest.stock.purchasing.view = false;
  guest.stock.analysis.restock = false;
  guest.stock.audit.view = false;
  guest.stock.stockCount.view = false;
  guest.tasks.view = false;
  assert.deepEqual(visible(guest), []);
  const tasksOnly = structuredClone(guest);
  tasksOnly.tasks.view = true;
  assert.deepEqual(visible(tasksOnly), ["ops-tasks"]);
  assert.equal(visible(defaultAdminPermissions).length, OPERATIONS_WIDGET_CATALOG.length);
});
