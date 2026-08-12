import assert from "node:assert/strict";
import test from "node:test";

import { managedTerminationCreateSchema, pjTerminationAgreementGenerateSchema } from "../../src/features/hr/termination/schemas";

test("contrato de criação gerenciada aceita desligamento CLT válido", () => {
  const result = managedTerminationCreateSchema.parse({
    source: "hr_manual",
    employeeId: "employee-1",
    employerUnitId: "employer-unit-1",
    terminationDate: "2026-08-01",
    terminationReason: "Dispensa sem justa causa",
    terminationInternalReason: "Reorganização interna da operação.",
    communicationConfirmed: true,
    communicationAt: "2026-08-01T17:00:00.000Z",
    communicationLocation: "Sala administrativa",
    communicationParticipants: ["Gestora da unidade"],
    noticeType: "indemnified",
  });
  assert.equal(result.employeeId, "employee-1");
});

test("dispensa sem justa causa exige confirmação da comunicação presencial", () => {
  const result = managedTerminationCreateSchema.safeParse({
    source: "hr_manual",
    employeeId: "employee-1",
    employerUnitId: "employer-unit-1",
    terminationDate: "2026-08-01",
    terminationReason: "Dispensa sem justa causa",
  });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues.map((issue) => issue.message).join(" "), /comunicada presencialmente/);
});

test("contrato exige subtipo na dispensa por justa causa", () => {
  const result = managedTerminationCreateSchema.safeParse({
    source: "hr_manual",
    employeeId: "employee-1",
    employerUnitId: "employer-unit-1",
    terminationDate: "2026-08-01",
    terminationReason: "Dispensa por justa causa",
  });
  assert.equal(result.success, false);
});

test("contrato rejeita datas fora do formato canônico", () => {
  const result = managedTerminationCreateSchema.safeParse({
    source: "hr_manual",
    employeeId: "employee-1",
    employerUnitId: "employer-unit-1",
    terminationDate: "01/08/2026",
    terminationReason: "Dispensa sem justa causa",
  });
  assert.equal(result.success, false);
});

test("contrato exige a seleção explícita do CNPJ empregador", () => {
  const result = managedTerminationCreateSchema.safeParse({
    source: "hr_manual",
    employeeId: "employee-1",
    terminationDate: "2026-08-01",
    terminationReason: "Rescisão por acordo entre as partes",
  });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues.map((issue) => issue.message).join(" "), /CNPJ empregador/);
});

test("distrato PJ exige pagamento confirmado e duas testemunhas", () => {
  const valid = pjTerminationAgreementGenerateSchema.parse({
    daysWorked: 10,
    invoiceNumber: "123",
    invoiceDate: "2026-08-10",
    paymentConfirmed: true,
    paymentDate: "2026-08-10",
    signatureCity: "São Luís/MA",
    forumCity: "São Luís/MA",
    witnesses: [
      { name: "Ana Testemunha", email: "ana@example.com", cpf: "529.982.247-25" },
      { name: "Bruno Testemunha", email: "bruno@example.com", cpf: "168.995.350-09" },
    ],
  });
  assert.equal(valid.witnesses[0].cpf, "52998224725");
  assert.equal(valid.paymentConfirmed, true);

  const missingPayment = pjTerminationAgreementGenerateSchema.safeParse({ ...valid, paymentConfirmed: false });
  assert.equal(missingPayment.success, false);
});
