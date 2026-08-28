import assert from "node:assert/strict";
import test from "node:test";

import {
  employeeForecastSeriesKeys,
  isForecastAfterTermination,
  terminationCompetence,
} from "../../src/features/financial/employee-provisions/termination";

test("gera as séries financeiras individuais canceláveis", () => {
  assert.deepEqual(employeeForecastSeriesKeys("employee-1"), [
    "payroll-salary:employee-1",
    "recurring:vale-transporte:employee-1",
  ]);
});

test("preserva a competência do desligamento e cancela apenas as posteriores", () => {
  assert.equal(terminationCompetence("2026-08-24"), "2026-08");
  assert.equal(isForecastAfterTermination("2026-08", "2026-08-24"), false);
  assert.equal(isForecastAfterTermination("2026-09", "2026-08-24"), true);
  assert.equal(isForecastAfterTermination("2026-07", "2026-08-24"), false);
});

test("rejeita datas de desligamento inexistentes", () => {
  assert.throws(() => terminationCompetence("2026-02-30"), /inválida/);
});
