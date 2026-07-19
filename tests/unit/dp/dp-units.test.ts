import assert from "node:assert/strict";
import test from "node:test";

import {
  activeOperationalUnits,
  canonicalOperationalUnitId,
  isActiveOperationalUnit,
} from "../../../src/lib/dp-units";

test("unidades arquivadas permanecem resolvíveis, mas não entram em seleções ativas", () => {
  const active = { id: "matrix", name: "Matriz/CD" };
  const archived = {
    id: "administrative",
    name: "Administrativo/CTA",
    isArchived: true,
    mergedIntoUnitId: "matrix",
  };

  assert.equal(isActiveOperationalUnit(active), true);
  assert.equal(isActiveOperationalUnit(archived), false);
  assert.deepEqual(activeOperationalUnits([archived, active]), [active]);
  assert.equal(canonicalOperationalUnitId("administrative", [archived, active]), "matrix");
  assert.equal(canonicalOperationalUnitId("matrix", [archived, active]), "matrix");
});
