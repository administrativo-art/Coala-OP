import assert from "node:assert/strict";
import test from "node:test";

import { Timestamp } from "firebase/firestore";

import { parseUserDateInput } from "../../src/features/hr/lib/user-date-input";

test("parseUserDateInput aceita datas de formulário e rejeita datas de calendário inválidas", () => {
  assert.equal(parseUserDateInput("2026-07-08")?.toISOString(), "2026-07-08T12:00:00.000Z");
  assert.equal(parseUserDateInput("2026-02-30"), null);
  assert.equal(parseUserDateInput("08/07/2026"), null);
});

test("parseUserDateInput recupera Timestamp serializado pelo cliente Firebase", () => {
  const parsed = parseUserDateInput({
    type: "firestore/timestamp/1.0",
    seconds: 1_723_982_400,
    nanoseconds: 123_000_000,
  });

  assert.equal(parsed?.toISOString(), "2024-08-18T12:00:00.123Z");
});

test("parseUserDateInput aceita Timestamp nativo e formato legado do Admin SDK", () => {
  const native = Timestamp.fromDate(new Date("2024-09-11T15:00:00.000Z"));

  assert.equal(parseUserDateInput(native)?.toISOString(), "2024-09-11T15:00:00.000Z");
  assert.equal(
    parseUserDateInput({ _seconds: 1_726_056_000, _nanoseconds: 0 })?.toISOString(),
    "2024-09-11T12:00:00.000Z",
  );
});

test("parseUserDateInput rejeita objetos incompletos e nanossegundos fora do contrato", () => {
  assert.equal(parseUserDateInput({ nanoseconds: 0 }), null);
  assert.equal(parseUserDateInput({ seconds: 1_723_982_400, nanoseconds: 1_000_000_000 }), null);
});
