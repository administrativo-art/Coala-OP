import assert from "node:assert/strict";
import test from "node:test";

import {
  collectiveAgreementInputSchema,
  collectiveAgreementPeriodsOverlap,
} from "../../../src/features/hr/documents/collective-agreement";

test("vigências inclusivas sobrepostas são detectadas", () => {
  assert.equal(collectiveAgreementPeriodsOverlap(
    { validFrom: "2026-01-01", validUntil: "2026-12-31" },
    { validFrom: "2026-12-31", validUntil: "2027-12-31" },
  ), true);
  assert.equal(collectiveAgreementPeriodsOverlap(
    { validFrom: "2026-01-01", validUntil: "2026-12-30" },
    { validFrom: "2026-12-31", validUntil: "2027-12-31" },
  ), false);
});

test("cadastro rejeita período invertido", () => {
  assert.throws(() => collectiveAgreementInputSchema.parse({
    unitId: "unit-1",
    registryNumber: "PA0001/2026",
    validFrom: "2026-12-31",
    validUntil: "2026-01-01",
    employeeUnion: "Sindicato profissional",
    employerUnion: "Sindicato patronal",
  }));
});
