import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSplitPercentagesFromValues,
  calculateSplitValuesFromPercentages,
} from "../../src/features/financial/lib/split-allocation";

test("calcula valores por percentual e fecha o centavo residual no último item", () => {
  const entries = calculateSplitValuesFromPercentages([
    { id: "a", percentage: 33.33, value: 0 },
    { id: "b", percentage: 33.33, value: 0 },
    { id: "c", percentage: 33.34, value: 0 },
  ], 6_137.84);

  assert.equal(entries.reduce((sum, entry) => sum + entry.value, 0), 6_137.84);
  assert.deepEqual(entries.map((entry) => entry.value), [2_045.74, 2_045.74, 2_046.36]);
});

test("calcula percentuais por valor e mantém o total em cem por cento", () => {
  const entries = calculateSplitPercentagesFromValues([
    { id: "a", percentage: 0, value: 400 },
    { id: "b", percentage: 0, value: 600 },
  ], 1_000);

  assert.deepEqual(entries.map((entry) => entry.percentage), [40, 60]);
  assert.equal(entries.reduce((sum, entry) => sum + entry.percentage, 0), 100);
});
