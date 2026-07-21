import assert from "node:assert/strict";
import test from "node:test";

import {
  activeOperationalUnits,
  canonicalOperationalUnitId,
  findOperationalUnitRecord,
  isActiveOperationalUnit,
  operationalUnitIdsMatch,
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
  assert.equal(operationalUnitIdsMatch("administrative", "matrix", [archived, active]), true);
  assert.equal(operationalUnitIdsMatch("administrative", "other", [archived, active]), false);
});

test("a unidade canônica acompanha incorporações sucessivas sem entrar em ciclo", () => {
  const units = [
    { id: "administrative", isArchived: true, mergedIntoUnitId: "matrix" },
    { id: "matrix", isArchived: true, mergedIntoUnitId: "headquarters" },
    { id: "headquarters" },
  ];

  assert.equal(canonicalOperationalUnitId("administrative", units), "headquarters");
  assert.equal(operationalUnitIdsMatch("administrative", "headquarters", units), true);

  const cyclicUnits = [
    { id: "a", isArchived: true, mergedIntoUnitId: "b" },
    { id: "b", isArchived: true, mergedIntoUnitId: "a" },
  ];
  assert.equal(canonicalOperationalUnitId("a", cyclicUnits), "a");
});

test("a continuidade encontra o registro histórico da unidade incorporada e prioriza o destino", () => {
  const units = [
    { id: "administrative", isArchived: true, mergedIntoUnitId: "matrix" },
    { id: "matrix" },
  ];
  const historicalOnly = [{ id: "july-old", unitId: "administrative" }];

  assert.equal(findOperationalUnitRecord(historicalOnly, "matrix", units)?.id, "july-old");

  const withExactTarget = [
    { id: "july-old", unitId: "administrative" },
    { id: "july-current", unitId: "matrix" },
  ];
  assert.equal(findOperationalUnitRecord(withExactTarget, "matrix", units)?.id, "july-current");
});
