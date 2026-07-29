import assert from "node:assert/strict";
import test from "node:test";

import { managedTerminationCreateSchema } from "../../src/features/hr/termination/schemas";

test("contrato de criação gerenciada aceita desligamento CLT válido", () => {
  const result = managedTerminationCreateSchema.parse({
    source: "hr_manual",
    employeeId: "employee-1",
    terminationDate: "2026-08-01",
    terminationReason: "Dispensa sem justa causa",
  });
  assert.equal(result.employeeId, "employee-1");
});

test("contrato exige subtipo na dispensa por justa causa", () => {
  const result = managedTerminationCreateSchema.safeParse({
    source: "hr_manual",
    employeeId: "employee-1",
    terminationDate: "2026-08-01",
    terminationReason: "Dispensa por justa causa",
  });
  assert.equal(result.success, false);
});

test("contrato rejeita datas fora do formato canônico", () => {
  const result = managedTerminationCreateSchema.safeParse({
    source: "hr_manual",
    employeeId: "employee-1",
    terminationDate: "01/08/2026",
    terminationReason: "Dispensa sem justa causa",
  });
  assert.equal(result.success, false);
});
