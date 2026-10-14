import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createDefaultManagementLayout } from "../../src/features/management-dashboard/default-layout";
import { cloneLayout, dashboardLayoutInputSchema } from "../../src/features/management-dashboard/layout-policy";

test("dashboard layout accepts the complete responsive personal layout", () => {
  const layout = createDefaultManagementLayout("uid-a", "Ana", "workspace-a");
  const parsed = dashboardLayoutInputSchema.parse({
    name: layout.name,
    description: layout.description,
    visibility: layout.visibility,
    targetProfileIds: layout.targetProfileIds,
    lockedWidgetIds: layout.lockedWidgetIds,
    widgets: layout.widgets,
    filters: layout.filters,
  });

  assert.equal(parsed.widgets.length, 12);
  assert.equal(parsed.visibility, "personal");
});

test("dashboard layout rejects duplicate instances and grid overflow", () => {
  const layout = createDefaultManagementLayout("uid-a", "Ana");
  layout.widgets[1]!.instanceId = layout.widgets[0]!.instanceId;
  layout.widgets[0]!.layouts.tablet = { x: 5, y: 0, w: 2, h: 2 };

  const result = dashboardLayoutInputSchema.safeParse({
    name: layout.name,
    description: layout.description,
    visibility: layout.visibility,
    targetProfileIds: [],
    lockedWidgetIds: [],
    widgets: layout.widgets,
    filters: layout.filters,
  });

  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /instância única/);
  assert.match(JSON.stringify(result.error?.issues), /ultrapassa o grid tablet/);
});

test("customizing a published layout creates an isolated personal copy", () => {
  const source = createDefaultManagementLayout("admin-uid", "Admin");
  source.id = "template-company";
  source.visibility = "template";
  source.targetProfileIds = ["management"];
  source.lockedWidgetIds = [source.widgets[0]!.instanceId];

  const copy = cloneLayout(source, "user-uid", "Usuário");

  assert.notEqual(copy.id, source.id);
  assert.equal(copy.ownerId, "user-uid");
  assert.equal(copy.visibility, "personal");
  assert.deepEqual(copy.targetProfileIds, []);
  assert.deepEqual(copy.lockedWidgetIds, []);
  assert.equal(source.ownerId, "admin-uid");
});

test("server persistence is scoped to the authenticated UID", () => {
  const source = readFileSync("src/features/management-dashboard/layouts.server.ts", "utf8");
  assert.match(source, /where\("ownerId", "==", actor\.decoded\.uid\)/);
  assert.match(source, /collection\(PREFERENCES\)\.doc\(actor\.decoded\.uid\)/);
  assert.match(source, /input\.visibility !== "personal" && !canManageTemplates/);
  assert.match(source, /ownerId !== actor\.decoded\.uid && \(currentVisibility === "personal" \|\| !canManageTemplates\)/);
});
