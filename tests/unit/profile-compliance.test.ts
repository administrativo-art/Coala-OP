import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateProfileCompliance,
  isProfileReviewDue,
  profileReviewCycle,
} from "../../src/features/hr/profile-compliance";

const completeFields = {
  "employee.pix_key_type": { value_text: "cpf" },
  "employee.pix_key": { value_text: "123.456.789-01" },
  "employee.address_zipcode": { value_text: "65010-000" },
  "employee.address_street": { value_text: "Rua das Flores" },
  "employee.address_number": { value_text: "120" },
  "employee.address_neighborhood": { value_text: "Centro" },
  "employee.city": { value_text: "São Luís" },
  "employee.state": { value_text: "MA" },
  "employee.emergency_name": { value_text: "Maria da Silva" },
  "employee.emergency_relation": { value_text: "Mãe/Pai" },
  "employee.emergency_phone": { value_text: "(98) 98888-7777" },
};

test("aplica os mesmos campos obrigatórios sem considerar cargo ou perfil", () => {
  const result = evaluateProfileCompliance({
    user: {
      email: "diretor@empresa.com",
      phone: "(98) 99999-8888",
      birthDate: "1980-01-10",
    },
    fieldValues: completeFields,
    reviewDue: false,
  });
  assert.equal(result.complete, true);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.missingFields, []);
});

test("lista campos ausentes e rejeita um segundo e-mail armazenado no RH", () => {
  const result = evaluateProfileCompliance({
    user: { email: "", phone: "", birthDate: null },
    fieldValues: {
      "employee.personal_email": { value_text: "legado@pessoal.com" },
    },
  });
  assert.equal(result.complete, false);
  assert.ok(result.missingFields.includes("access_email"));
  assert.ok(result.missingFields.includes("pix_key"));
  assert.ok(result.missingFields.includes("emergency_relation"));
});

test("aceita endereço sem número somente quando a marcação foi explícita", () => {
  const result = evaluateProfileCompliance({
    user: { email: "pessoa@empresa.com", phone: "98999998888", birthDate: "1990-05-20" },
    fieldValues: {
      ...completeFields,
      "employee.address_number": { value_text: "" },
      "employee.address_no_number": { value_boolean: true },
    },
  });
  assert.equal(result.missingFields.includes("address_number"), false);
});

test("ciclo trimestral começa em janeiro, abril, julho e outubro", () => {
  const cycle = profileReviewCycle(new Date("2026-07-31T12:00:00-03:00"));
  assert.equal(cycle.currentStart.getMonth(), 6);
  assert.equal(cycle.nextStart.getMonth(), 9);
  assert.equal(cycle.currentStart.toISOString(), "2026-07-01T03:00:00.000Z");
  assert.equal(isProfileReviewDue("2026-07-01T12:00:00-03:00", new Date("2026-07-31T12:00:00-03:00")), false);
  assert.equal(isProfileReviewDue("2026-06-30T23:59:59-03:00", new Date("2026-07-31T12:00:00-03:00")), true);
  assert.equal(isProfileReviewDue("2026-07-01T00:00:00-03:00", new Date("2026-10-01T02:59:59.999Z")), false);
  assert.equal(isProfileReviewDue("2026-07-01T00:00:00-03:00", new Date("2026-10-01T03:00:00.000Z")), true);
});
