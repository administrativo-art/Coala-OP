import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAccountantReadiness,
  calculateMaterialDeadline,
  calculateNoticeDates,
  calculateTerminationHealth,
  calculateTerminationProgress,
  createInitialTerminationSteps,
  patchStep,
} from "../../src/features/hr/termination/core";
import type { CltTerminationProcess } from "../../src/features/hr/termination/types";

test("aviso trabalhado exclui o dia da comunicação e termina no trigésimo dia", () => {
  assert.deepEqual(calculateNoticeDates("2026-07-10"), {
    noticeStartDate: "2026-07-11",
    contractEndDate: "2026-08-09",
  });
});

test("prazo material conta dez dias e prorroga vencimento no fim de semana", () => {
  assert.equal(calculateMaterialDeadline("2026-09-09"), "2026-09-21");
});

test("feriado no vencimento prorroga ao próximo dia útil", () => {
  assert.equal(calculateMaterialDeadline("2026-04-11", ["2026-04-21"]), "2026-04-22");
});

test("progresso considera somente etapas obrigatórias concluídas ou dispensadas", () => {
  const initial = createInitialTerminationSteps("2026-07-22T12:00:00.000Z");
  const signed = patchStep(initial, "identity_signature", { status: "completed" });
  assert.equal(calculateTerminationProgress(signed), 18);
});

function processFixture(overrides: Partial<CltTerminationProcess> = {}): CltTerminationProcess {
  const now = "2026-07-23T12:00:00.000Z";
  return {
    id: "termination-test",
    processType: "clt_employee_resignation",
    employeeId: "employee-test",
    employeeName: "Pessoa Teste",
    employeeEmail: "pessoa@example.com",
    employmentRelationshipType: "clt",
    status: "active",
    health: "on_track",
    progress: 0,
    currentSummary: "",
    source: "hr_manual",
    request: {
      noticePreference: "work",
      submittedAt: now,
      protocol: "PD-TEST",
      identityStatus: "manual_verified",
    },
    accountant: { status: "not_started" },
    documents: [],
    steps: createInitialTerminationSteps(now),
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("contabilidade fica bloqueada enquanto aviso e ASO não estiverem concluídos", () => {
  const result = applyAccountantReadiness(processFixture());
  const accountant = result.steps.find((step) => step.id === "accountant");
  assert.equal(accountant?.status, "blocked");
  assert.match(accountant?.blockedReason ?? "", /aviso-prévio e conclusão do ASO/);
  assert.equal(result.accountant?.status, "not_started");
  assert.equal(calculateTerminationHealth(result, new Date("2026-07-23T13:00:00.000Z")), "on_track");
});

test("contabilidade é liberada somente com aviso definido e ASO aprovado", () => {
  const base = processFixture({
    notice: {
      decision: "worked",
      communicationDate: "2026-07-23",
      noticeStartDate: "2026-07-24",
      contractEndDate: "2026-08-22",
      legalPaymentDueDate: "2026-09-01",
      decidedAt: "2026-07-23T12:00:00.000Z",
      decidedBy: "hr-test",
    },
  });
  base.steps = patchStep(base.steps, "aso", { status: "completed" });
  const result = applyAccountantReadiness(base);
  assert.equal(result.steps.find((step) => step.id === "accountant")?.status, "in_progress");
  assert.equal(result.accountant?.status, "ready_to_send");
});
