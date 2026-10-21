import assert from "node:assert/strict";
import test from "node:test";

import { localPurchaseUnitRefs } from "../../src/features/purchasing/local-purchase-units";

test("local purchase units use the explicit structural hierarchy", () => {
  const result = localPurchaseUnitRefs(
    [{ id: "kiosk-a", name: "Tirirical", structuralUnitId: "unit-a" }],
    [{ id: "unit-a", groupId: "group-a" }],
    [{ id: "group-a", name: "Quiosques", organizationId: "org-a" }],
    [{ id: "org-a", name: "Coala Shakes" }],
  );

  assert.deepEqual(result, [{
    id: "kiosk-a",
    name: "Tirirical",
    groupId: "group-a",
    groupName: "Quiosques",
    organizationId: "org-a",
    organizationName: "Coala Shakes",
  }]);
});

test("local purchase units do not guess missing or incomplete hierarchy", () => {
  const result = localPurchaseUnitRefs(
    [
      { id: "kiosk-b", name: "Centro", structuralUnitId: "missing" },
      { id: "kiosk-a", name: "Matriz", structuralUnitId: "unit-a" },
    ],
    [{ id: "unit-a", groupId: "missing-group", organizationId: "missing-org" }],
    [],
    [],
  );

  assert.deepEqual(result, [
    { id: "kiosk-b", name: "Centro" },
    { id: "kiosk-a", name: "Matriz" },
  ]);
});
