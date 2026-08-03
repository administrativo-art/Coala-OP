import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAccountantReadiness,
  calculateMaterialDeadline,
  calculateNoticeDates,
  calculateTerminationHealth,
  calculateTerminationProgress,
  createEmployeeResignationSteps,
  createEmployerDismissalSteps,
  createInitialTerminationSteps,
  patchStep,
  recalculateTermination,
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
  const firstPhaseCompleted = patchStep(initial, "request_validation_notice", { status: "completed" });
  assert.equal(calculateTerminationProgress(firstPhaseCompleted), 10);
});

test("devolução de uniformes é a segunda etapa obrigatória", () => {
  const steps = createInitialTerminationSteps("2026-07-22T12:00:00.000Z");
  assert.equal(steps[0]?.id, "request_validation_notice");
  assert.equal(steps[1]?.id, "uniform_return");
  assert.equal(steps[1]?.required, true);
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

test("contabilidade do desligamento iniciado pelo RH fica bloqueada enquanto aviso e ASO não estiverem concluídos", () => {
  const result = applyAccountantReadiness(processFixture({ processType: "clt_hr_termination" }));
  const accountant = result.steps.find((step) => step.id === "accountant");
  assert.equal(accountant?.status, "blocked");
  assert.match(accountant?.blockedReason ?? "", /aviso-prévio e conclusão do ASO/);
  assert.equal(result.accountant?.status, "not_started");
  assert.equal(calculateTerminationHealth(result, new Date("2026-07-23T13:00:00.000Z")), "on_track");
});

test("contabilidade do desligamento iniciado pelo RH é liberada somente com aviso definido e ASO aprovado", () => {
  const base = processFixture({
    processType: "clt_hr_termination",
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

test("pedido de demissão nasce com nove fases agrupáveis e ASO e uniformes paralelos", () => {
  const steps = createEmployeeResignationSteps("2026-08-02T12:00:00.000Z");
  assert.equal(steps.find((step) => step.id === "request_received")?.status, "completed");
  assert.equal(steps.find((step) => step.id === "letter_review")?.status, "in_progress");
  assert.equal(steps.find((step) => step.id === "identity_signature")?.status, "pending");
  assert.equal(steps.find((step) => step.id === "uniform_return")?.required, false);
  assert.equal(steps.find((step) => step.id === "aso")?.required, false);
  assert.equal(steps.find((step) => step.id === "uniform_return")?.status, "in_progress");
  assert.equal(steps.find((step) => step.id === "aso")?.status, "in_progress");
});

test("dispensa sem justa causa nasce com sete fases e ASO e uniformes paralelos", () => {
  const steps = createEmployerDismissalSteps("2026-08-02T12:00:00.000Z", "2026-08-02", "2026-08-12");
  assert.equal(steps.find((step) => step.id === "request_validation_notice")?.status, "waiting_external");
  assert.equal(steps.find((step) => step.id === "accountant")?.status, "blocked");
  assert.equal(steps.find((step) => step.id === "termination_payment")?.required, true);
  assert.equal(steps.find((step) => step.id === "employee_delivery")?.required, true);
  assert.equal(steps.find((step) => step.id === "uniform_return")?.required, false);
  assert.equal(steps.find((step) => step.id === "aso")?.required, false);
  assert.equal(steps.find((step) => step.id === "uniform_return")?.status, "in_progress");
  assert.equal(steps.find((step) => step.id === "aso")?.status, "in_progress");
});

test("contabilidade da dispensa sem justa causa aguarda comunicado e não depende do ASO", () => {
  const now = "2026-08-02T12:00:00.000Z";
  const steps = createEmployerDismissalSteps(now, "2026-08-02", "2026-08-12");
  const base = processFixture({
    processType: "clt_hr_termination",
    terminationReason: "Dispensa sem justa causa",
    dismissalCommunication: {
      channel: "in_person",
      occurredAt: now,
      location: "Sala administrativa",
      responsibleId: "hr-test",
      responsibleName: "RH Teste",
      participants: [],
      confirmedAt: now,
      confirmedBy: "hr-test",
      officialNoticeStatus: "pending_signature",
    },
    steps,
    notice: {
      decision: "indemnified",
      communicationDate: "2026-08-02",
      contractEndDate: "2026-08-02",
      legalPaymentDueDate: "2026-08-12",
      decidedAt: now,
      decidedBy: "hr-test",
    },
  });
  const waiting = applyAccountantReadiness(base);
  assert.equal(waiting.steps.find((step) => step.id === "accountant")?.status, "blocked");
  const formalized = applyAccountantReadiness({ ...base, dismissalCommunication: { ...base.dismissalCommunication!, officialNoticeStatus: "signed" } });
  assert.equal(formalized.steps.find((step) => step.id === "accountant")?.status, "in_progress");
  assert.equal(formalized.accountant?.status, "ready_to_send");
  assert.equal(formalized.steps.find((step) => step.id === "aso")?.status, "in_progress");
});

test("contabilidade do pedido de demissão é liberada pelo aviso sem depender do ASO", () => {
  const now = "2026-08-02T12:00:00.000Z";
  const base = processFixture({
    source: "employee_self_service",
    steps: createEmployeeResignationSteps(now),
    notice: {
      decision: "worked",
      communicationDate: "2026-08-02",
      noticeStartDate: "2026-08-03",
      contractEndDate: "2026-09-01",
      legalPaymentDueDate: "2026-09-11",
      decidedAt: now,
      decidedBy: "hr-test",
    },
  });
  const result = applyAccountantReadiness(base);
  assert.equal(result.steps.find((step) => step.id === "accountant")?.status, "in_progress");
  assert.equal(result.steps.find((step) => step.id === "aso")?.status, "in_progress");
  assert.equal(result.accountant?.status, "ready_to_send");
});

test("entrega final ao colaborador só é liberada depois de assinatura e pagamento", () => {
  const now = "2026-08-02T12:00:00.000Z";
  const base = processFixture({
    source: "employee_self_service",
    steps: patchStep(patchStep(createEmployeeResignationSteps(now), "signatures", { status: "completed", completedAt: now }), "termination_payment", { status: "waiting_external" }),
    payment: { status: "processing", amount: 1200, dueAt: "2026-09-11" },
    employeeCompletion: { status: "not_started" },
  });
  const beforePayment = recalculateTermination(base, new Date(now));
  assert.equal(beforePayment.steps.find((step) => step.id === "employee_delivery")?.status, "pending");

  const afterPayment = recalculateTermination({ ...base, payment: { ...base.payment!, status: "paid", paidAt: now } }, new Date(now));
  assert.equal(afterPayment.steps.find((step) => step.id === "termination_payment")?.status, "completed");
  assert.equal(afterPayment.steps.find((step) => step.id === "employee_delivery")?.status, "in_progress");
  assert.equal(afterPayment.employeeCompletion?.status, "ready");
});
