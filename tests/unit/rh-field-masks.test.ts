import assert from "node:assert/strict";
import test from "node:test";

import { getFieldMask } from "../../src/features/rh/lib/field-masks";

test("CPF aceita só números, exibe com pontos e traço e grava só dígitos", () => {
  const mask = getFieldMask("employee.cpf");
  assert.ok(mask);
  assert.equal(mask.normalize("612.700.503-54abc99"), "61270050354");
  assert.equal(mask.format("61270050354"), "612.700.503-54");
  assert.equal(mask.format("6127"), "612.7");
  assert.equal(mask.format("6127005"), "612.700.5");
  assert.equal(mask.validate("6127005"), "O CPF tem 11 dígitos.");
  assert.equal(mask.validate("61270050354"), null);
  assert.equal(mask.validate(""), null);
});

test("campos sem máscara continuam livres", () => {
  assert.equal(getFieldMask("employee.name"), null);
});
