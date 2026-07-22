import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateMaterialDeadline,
  calculateNoticeDates,
  calculateTerminationProgress,
  createInitialTerminationSteps,
  patchStep,
} from "../../src/features/hr/termination/core";

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
