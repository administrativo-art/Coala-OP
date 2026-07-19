import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addCalendarDays,
  buildProbationSchedule,
  validateProbationConfig,
} from "../../../src/features/hr/integration/probation";

describe("período de experiência", () => {
  test("calcula 45 + 45 e as janelas inclusivas de 10 dias", () => {
    const schedule = buildProbationSchedule("2026-07-17", {
      firstPeriodDays: 45,
      secondPeriodDays: 45,
      evaluationWindowDays: 10,
    });

    assert.deepEqual(schedule, {
      admissionDate: "2026-07-17",
      totalDays: 90,
      firstPeriod: {
        days: 45,
        startDate: "2026-07-17",
        endDate: "2026-08-30",
        evaluationStartDate: "2026-08-21",
        evaluationEndDate: "2026-08-30",
      },
      secondPeriod: {
        days: 45,
        startDate: "2026-08-31",
        endDate: "2026-10-14",
        evaluationStartDate: "2026-10-05",
        evaluationEndDate: "2026-10-14",
      },
      finalEndDate: "2026-10-14",
    });
  });

  test("suporta integração sem segundo período", () => {
    const schedule = buildProbationSchedule("2026-01-01", {
      firstPeriodDays: 30,
      secondPeriodDays: 0,
      evaluationWindowDays: 5,
    });
    assert.equal(schedule.firstPeriod.endDate, "2026-01-30");
    assert.equal(schedule.firstPeriod.evaluationStartDate, "2026-01-26");
    assert.equal(schedule.secondPeriod, null);
    assert.equal(schedule.finalEndDate, "2026-01-30");
  });

  test("trabalha com datas civis em ano bissexto", () => {
    assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addCalendarDays("2028-02-29", 1), "2028-03-01");
  });

  test("rejeita soma acima de 90 e janela maior que o período", () => {
    assert.throws(
      () => validateProbationConfig({ firstPeriodDays: 60, secondPeriodDays: 31, evaluationWindowDays: 10 }),
      /90 dias/,
    );
    assert.throws(
      () => validateProbationConfig({ firstPeriodDays: 5, secondPeriodDays: 5, evaluationWindowDays: 10 }),
      /primeiro período/,
    );
  });

  test("rejeita datas civis inexistentes", () => {
    assert.throws(
      () => buildProbationSchedule("2026-02-30", { firstPeriodDays: 45, secondPeriodDays: 45, evaluationWindowDays: 10 }),
      /data civil existente/,
    );
  });
});

