import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completeProbationEvaluation, createProbationProcess, decideProbation, refreshProbationProcess } from "../../../src/features/hr/integration/probation-process";

describe("acompanhamento da experiência", () => {
  it("abre avaliações somente dentro da janela e gera alertas", () => {
    const created = createProbationProcess("2026-01-01", undefined, "2026-01-01T10:00:00.000Z");
    assert.equal(created.evaluations[0].windowStartDate, "2026-02-05");
    assert.equal(created.alerts.length, 6);
    const available = refreshProbationProcess(created, "2026-02-05");
    assert.equal(available.evaluations[0].status, "available");
  });
  it("registra resultado e exige termo antes da decisão final", () => {
    let state = createProbationProcess("2026-01-01", undefined, "2026-01-01T10:00:00.000Z");
    state = completeProbationEvaluation(state, { evaluationId: "first", result: "approved", actorId: "manager", now: "2026-02-05T10:00:00.000Z" });
    assert.equal(state.evaluations[0].status, "completed");
    assert.throws(() => decideProbation(state, { result: "effective", actorId: "rh", now: "2026-03-31T10:00:00.000Z" }), /termo/i);
  });
});
