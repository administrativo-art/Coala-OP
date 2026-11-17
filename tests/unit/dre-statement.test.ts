import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dreHorizontalVariation,
  dreRevenueComposition,
  dreVariationTone,
  previousDreMonthKey,
} from "../../src/features/financial/lib/dre-statement";

test("competência anterior respeita o início da DRE", () => {
  assert.equal(previousDreMonthKey("2026-11", "2026-01"), "2026-10");
  assert.equal(previousDreMonthKey("2026-01", "2025-06"), "2025-12");
  assert.equal(previousDreMonthKey("2026-06", "2026-06"), null);
  assert.equal(previousDreMonthKey("inválido", "2026-01"), null);
});

test("análise horizontal não transforma indisponível ou base zero em 0%", () => {
  assert.equal(dreHorizontalVariation(110, 100), 10);
  assert.equal(dreHorizontalVariation(-50, -100), 50);
  assert.equal(dreHorizontalVariation(Number.NaN, 100), null);
  assert.equal(dreHorizontalVariation(100, Number.NaN), null);
  assert.equal(dreHorizontalVariation(100, 0), null);
  assert.equal(dreHorizontalVariation(100, null), null);
});

test("tom da variação inverte para custos", () => {
  assert.equal(dreVariationTone(5, "result"), "good");
  assert.equal(dreVariationTone(5, "cost"), "bad");
  assert.equal(dreVariationTone(-5, "cost"), "good");
  assert.equal(dreVariationTone(0.01, "cost"), "neutral");
  assert.equal(dreVariationTone(null, "cost"), null);
});

test("composição da receita só existe com todos os valores disponíveis", () => {
  const slices = dreRevenueComposition(1000, [
    { key: "cmv", label: "CMV", value: 300 },
    { key: "pessoal", label: "Pessoal", value: 250 },
    { key: "zero", label: "Zero", value: 0 },
  ]);
  assert.ok(slices);
  assert.deepEqual(slices.map((slice) => [slice.key, slice.share]), [["cmv", 30], ["pessoal", 25], ["remainder", 45]]);
  assert.equal(slices.at(-1)?.label, "Sobra");
  assert.equal(dreRevenueComposition(1000, [{ key: "x", label: "X", value: Number.NaN }]), null);
  assert.equal(dreRevenueComposition(0, []), null);
  const loss = dreRevenueComposition(100, [{ key: "cmv", label: "CMV", value: 130 }]);
  assert.equal(loss?.at(-1)?.label, "Falta");
  assert.equal(loss?.at(-1)?.share, 30);
});
