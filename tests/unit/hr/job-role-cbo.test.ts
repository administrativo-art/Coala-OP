import assert from "node:assert/strict";
import test from "node:test";

import {
  jobRoleCreateSchema,
  jobRolePatchSchema,
  normalizeJobRoleInput,
  normalizeJobRolePatch,
} from "../../../src/features/hr/lib/schemas";

test("cargo aceita e preserva CBO no formato oficial", () => {
  const parsed = jobRoleCreateSchema.parse({
    name: "Atendente",
    cbo: "5134-15",
  });

  assert.equal(normalizeJobRoleInput(parsed).cbo, "5134-15");
});

test("cargo rejeita CBO fora do formato 0000-00", () => {
  assert.throws(
    () => jobRoleCreateSchema.parse({ name: "Atendente", cbo: "513415" }),
    /Informe o CBO no formato 0000-00/,
  );
});

test("criação de cargo mantém parentId e reportsTo sincronizados", () => {
  const parsed = jobRoleCreateSchema.parse({
    name: "Diretor financeiro",
    parentId: "vice-diretor",
  });

  const normalized = normalizeJobRoleInput(parsed);
  assert.equal(normalized.parentId, "vice-diretor");
  assert.equal(normalized.reportsTo, "vice-diretor");
});

test("alteração de qualquer referência de chefia sincroniza as duas", () => {
  const parsed = jobRolePatchSchema.parse({ reportsTo: "vice-diretor" });
  const normalized = normalizeJobRolePatch(parsed);

  assert.equal(normalized.parentId, "vice-diretor");
  assert.equal(normalized.reportsTo, "vice-diretor");
});
