import assert from "node:assert/strict";
import test from "node:test";

import {
  jobRoleCreateSchema,
  normalizeJobRoleInput,
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
