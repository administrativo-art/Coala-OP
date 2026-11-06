import assert from "node:assert/strict";
import test from "node:test";

import {
  activeOperationalUnits,
  canonicalOperationalUnitId,
  findOperationalUnitRecord,
  isActiveOperationalUnit,
  operationalUnitIdsMatch,
  operationalUnitsExistingInPeriod,
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

test("unidade só conta a partir do mês de criação, herdando a história das unidades incorporadas", () => {
  const ts = (iso: string) => ({ _seconds: Math.floor(Date.parse(iso) / 1000) });
  const units = [
    { id: "cta", isArchived: true, mergedIntoUnitId: "matrix", createdAt: ts("2025-12-09T12:00:00Z") },
    { id: "matrix", createdAt: ts("2026-07-04T16:08:29Z") },
    { id: "tirirical", createdAt: ts("2025-12-04T16:22:53Z") },
    { id: "automovel", createdAt: ts("2026-07-04T16:03:51Z") },
    { id: "sem-data" },
  ];
  const active = activeOperationalUnits(units);
  const ids = (year: number, month: number) => operationalUnitsExistingInPeriod(active, units, year, month).map((unit) => unit.id);

  assert.deepEqual(ids(2026, 6), ["matrix", "tirirical", "sem-data"]);
  assert.deepEqual(ids(2026, 7), ["matrix", "tirirical", "automovel", "sem-data"]);
  assert.deepEqual(ids(2025, 11), ["sem-data"]);
});

test("a data de criação usa o fuso de Fortaleza na virada do mês", () => {
  const units = [{ id: "a", createdAt: "2026-08-01T01:00:00Z" }];
  // 01/08 01:00 UTC ainda é 31/07 em Fortaleza.
  assert.equal(operationalUnitsExistingInPeriod(units, units, 2026, 6).length, 0);
  assert.equal(operationalUnitsExistingInPeriod(units, units, 2026, 7).length, 1);
});
