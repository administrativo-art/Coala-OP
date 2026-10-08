import assert from "node:assert/strict";
import test from "node:test";

import { canViewAiCosts } from "../../src/features/ai-management/access-policy";

test("AI billing allows the default admin or both settings permissions", () => {
  assert.equal(canViewAiCosts({ isDefaultAdmin: true }), true);
  assert.equal(canViewAiCosts({ isDefaultAdmin: false, permissions: { settings: { view: true, viewAiCosts: true } } }), true);
  assert.equal(canViewAiCosts({ isDefaultAdmin: false, permissions: { settings: { view: true, viewAiCosts: false } } }), false);
  assert.equal(canViewAiCosts({ isDefaultAdmin: false, permissions: { settings: { view: false, viewAiCosts: true } } }), false);
  assert.equal(canViewAiCosts({ isDefaultAdmin: false }), false);
});
