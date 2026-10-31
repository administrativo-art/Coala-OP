import assert from "node:assert/strict";
import test from "node:test";

import {
  canConfigureFieldVisibility,
  diffVisibility,
  keysOverriddenBy,
  summarizeVisibility,
} from "../../../src/features/rh/lib/field-visibility";

test("o nível do bloco é calculado: todos iguais → esse nível; qualquer diferença → misto", () => {
  const uniform = summarizeVisibility(["restricted_partial", "restricted_partial"]);
  assert.equal(uniform.level, "restricted_partial");
  assert.equal(uniform.mixed, false);

  const mixed = summarizeVisibility(["restricted_partial", "public", "restricted_partial"]);
  assert.equal(mixed.level, null);
  assert.equal(mixed.mixed, true);
  assert.deepEqual(mixed.counts, { public: 1, restricted_partial: 2, restricted_total: 0, confidential: 0 });
  assert.equal(mixed.total, 3);
});

test("mudar a exceção para o nível dos demais faz o bloco deixar de ser misto", () => {
  assert.equal(summarizeVisibility(["restricted_partial", "restricted_partial", "restricted_partial"]).mixed, false);
});

test("níveis legados são normalizados antes de comparar", () => {
  const summary = summarizeVisibility(["sensitive", "restricted_total", "internal"]);
  assert.equal(summary.counts.restricted_total, 2);
  assert.equal(summary.counts.confidential, 1);
});

test("bloco vazio não é misto e não tem nível", () => {
  const summary = summarizeVisibility([]);
  assert.equal(summary.mixed, false);
  assert.equal(summary.level, null);
});

test("aplicar a todos só sobrescreve quem difere do nível escolhido", () => {
  const entries = [
    { key: "a", visibility: "restricted_partial" },
    { key: "b", visibility: "public" },
    { key: "c", visibility: "restricted_partial" },
  ];
  assert.deepEqual(keysOverriddenBy(entries, "restricted_partial"), ["b"]);
  assert.deepEqual(keysOverriddenBy(entries, "confidential"), ["a", "b", "c"]);
});

test("diffVisibility ignora o que não mudou e chaves desconhecidas", () => {
  const base = { a: "restricted_partial", b: "public" };
  const draft = { a: "restricted_partial", b: "restricted_total", novo: "public" };
  assert.deepEqual(diffVisibility(base, draft), { b: "restricted_total" });
});

test("somente administrador padrão ou a permissão própria configuram a visibilidade", () => {
  assert.equal(canConfigureFieldVisibility(null), false);
  assert.equal(canConfigureFieldVisibility({ isDefaultAdmin: true }), true);
  assert.equal(canConfigureFieldVisibility({ permissions: { dp: { settings: { manageFieldVisibility: true } } } }), true);
  assert.equal(canConfigureFieldVisibility({ permissions: { dp: { settings: {} } } }), false);
  // Permissões vizinhas, antes usadas como atalho, não bastam mais.
  assert.equal(canConfigureFieldVisibility({ permissions: { dp: { settings: { manageFieldVisibility: false } } } }), false);
});
