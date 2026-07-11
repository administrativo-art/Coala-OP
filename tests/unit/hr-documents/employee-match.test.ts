import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isValidCpf,
  normalizeCpf,
  normalizePersonName,
  matchEmployeeAgainstExpected,
  type ExpectedEmployeeIdentity,
} from "../../../src/lib/hr/employee-document-match";

// CPFs válidos distintos (dois "colaboradores").
const MARIA_CPF = "111.444.777-35"; // 11144477735
const CARLA_CPF = "529.982.247-25"; // 52998224725

const maria: ExpectedEmployeeIdentity = {
  employeeId: "uid-maria",
  cpf: MARIA_CPF,
  registrationNumber: "1024",
  name: "Maria Joana Barbosa Pereira",
  birthDate: "1990-05-10",
  admissionDate: "2024-07-01",
};

describe("CPF helpers", () => {
  test("normalizeCpf mantém apenas dígitos", () => {
    assert.equal(normalizeCpf("111.444.777-35"), "11144477735");
    assert.equal(normalizeCpf(null), "");
  });

  test("isValidCpf aceita CPF correto e rejeita inválidos", () => {
    assert.equal(isValidCpf(MARIA_CPF), true);
    assert.equal(isValidCpf(CARLA_CPF), true);
    assert.equal(isValidCpf("111.444.777-00"), false);
    assert.equal(isValidCpf("00000000000"), false);
    assert.equal(isValidCpf("123"), false);
  });
});

describe("normalizePersonName", () => {
  test("remove acentos sem inserir espaços no meio da palavra", () => {
    assert.equal(normalizePersonName("João Antônio"), "joao antonio");
  });
});

describe("matchEmployeeAgainstExpected", () => {
  test("CPF correto → MATCH", () => {
    const r = matchEmployeeAgainstExpected({ extracted: { cpf: MARIA_CPF }, expected: maria });
    assert.equal(r.status, "MATCH");
    assert.equal(r.matchedBy, "CPF");
  });

  test("CPF de outro colaborador → MISMATCH (bloqueia)", () => {
    const r = matchEmployeeAgainstExpected({ extracted: { cpf: CARLA_CPF }, expected: maria });
    assert.equal(r.status, "MISMATCH");
  });

  test("somente matrícula coincidente → MATCH", () => {
    const r = matchEmployeeAgainstExpected({ extracted: { registrationNumber: "1024" }, expected: maria });
    assert.equal(r.status, "MATCH");
    assert.equal(r.matchedBy, "REGISTRATION");
  });

  test("somente nome completo (sem corroborante) → POSSIBLE_MATCH", () => {
    const r = matchEmployeeAgainstExpected({ extracted: { name: "Maria Joana Barbosa Pereira" }, expected: maria });
    assert.equal(r.status, "POSSIBLE_MATCH");
  });

  test("nome completo + data de admissão corroborante → MATCH", () => {
    const r = matchEmployeeAgainstExpected({
      extracted: { name: "maria joana barbosa pereira", admissionDate: "2024-07-01" },
      expected: maria,
    });
    assert.equal(r.status, "MATCH");
    assert.equal(r.matchedBy, "NAME_CORROBORATED");
  });

  test("homônimo (mesmo nome, datas diferentes) não confirma sozinho", () => {
    const r = matchEmployeeAgainstExpected({
      extracted: { name: "Maria Joana Barbosa Pereira", birthDate: "1985-01-01" },
      expected: maria,
    });
    assert.equal(r.status, "POSSIBLE_MATCH");
  });

  test("sem identificadores → UNKNOWN", () => {
    const r = matchEmployeeAgainstExpected({ extracted: {}, expected: maria });
    assert.equal(r.status, "UNKNOWN");
  });

  test("nome parcialmente semelhante → POSSIBLE_MATCH (nunca MATCH sozinho)", () => {
    const r = matchEmployeeAgainstExpected({ extracted: { name: "Maria Joana Barbosa" }, expected: maria });
    assert.equal(r.status, "POSSIBLE_MATCH");
  });

  test("CPF inválido não força MISMATCH; cai para outras regras", () => {
    const r = matchEmployeeAgainstExpected({
      extracted: { cpf: "000.000.000-00", registrationNumber: "1024" },
      expected: maria,
    });
    assert.equal(r.status, "MATCH");
    assert.equal(r.matchedBy, "REGISTRATION");
  });
});
