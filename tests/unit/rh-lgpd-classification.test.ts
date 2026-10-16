import assert from "node:assert/strict";
import test from "node:test";

import { defaultFieldLgpd } from "../../src/features/hr/lib/collaborator-system-fields";

test("visibilidade restrita não transforma dado pessoal comum em sensível", () => {
  assert.equal(defaultFieldLgpd("Dados bancários", "confidential").category, "personal");
  assert.equal(defaultFieldLgpd("Dados contratuais", "restricted_total").category, "personal");
});

test("natureza sensível independe da visibilidade configurada", () => {
  assert.equal(defaultFieldLgpd("Saúde e segurança", "public").category, "sensitive");
  assert.equal(defaultFieldLgpd("Biometria", "restricted_partial").category, "sensitive");
  assert.equal(defaultFieldLgpd("Saúde e segurança", "confidential").category, "sensitive");
});
