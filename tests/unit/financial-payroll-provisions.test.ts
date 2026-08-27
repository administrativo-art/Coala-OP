import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePayrollFgts,
  calculatePayrollInss2026,
  consultPayrollProvision,
  payrollSalaryProvisionSeriesKey,
} from "../../src/features/financial/lib/payroll-provisions";

test("reproduz INSS e FGTS observados nos recibos de julho", () => {
  assert.equal(calculatePayrollInss2026(1_268.60), 95.14);
  assert.equal(calculatePayrollInss2026(2_251.88), 178.34);
  assert.equal(calculatePayrollInss2026(3_070.35), 257.03);
  assert.equal(calculatePayrollFgts(3_070.35), 245.62);
});

test("calcula o cenário fixo aprovado", () => {
  assert.equal(calculatePayrollInss2026(1_787.30), 136.53);
  assert.equal(calculatePayrollInss2026(2_448.60), 196.05);
  assert.equal(calculatePayrollFgts(1_787.30), 142.98);
  assert.equal(calculatePayrollFgts(2_448.60), 195.88);
});

test("encontra a provisão de salário pela série e competência", () => {
  const series = payrollSalaryProvisionSeriesKey("employee-1");
  const provision = {
    id: "forecast",
    provisionSeriesKey: series,
    provisionType: "forecast",
    provisionCompetence: "2026-08",
    status: "provisioned",
    totalValue: 1_787.30,
  };
  assert.deepEqual(
    consultPayrollProvision({
      id: "actual",
      provisionSeriesKey: series,
      provisionType: "actual",
      provisionCompetence: "2026-08",
      totalValue: 1_900,
    }, [provision]),
    {
      status: "matched",
      competence: "2026-08",
      provision,
      actualValue: 1_900,
      provisionedValue: 1_787.30,
      variance: 112.70,
    },
  );
});
