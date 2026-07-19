import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { advanceIntegrationExecution, createIntegrationExecution, updateIntegrationExecution } from "../../../src/features/hr/integration/process";
import { simulateIntegrationTemplate } from "../../../src/features/hr/integration/engine";
import { DEFAULT_INTEGRATION_COMMUNICATIONS, type IntegrationTemplateVersion } from "../../../src/features/hr/integration/schemas";

const snapshot: IntegrationTemplateVersion = {
  schemaVersion: "coala-integration-v1", templateId: "model", version: 3, name: "Modelo", roleId: "role", functionId: null,
  createdAt: new Date(0).toISOString(), createdBy: "user", publishedAt: new Date(0).toISOString(),
  stages: [{ id: "one", label: "Um", order: 0, required: true, skippable: false, dueDays: null, dueDateSource: "stage_entry" }, { id: "two", label: "Dois", order: 1, required: true, skippable: false, dueDays: null, dueDateSource: "stage_entry" }],
  blocks: [{ id: "name", stageId: "one", order: 0, type: "text", label: "Nome", required: true, readOnly: false, active: true, writePolicy: "process_only", hiddenAnswerPolicy: "exclude", config: {} }], rules: [], completionRules: [], communications: DEFAULT_INTEGRATION_COMMUNICATIONS.map(item => ({ ...item })),
};

describe("execução da integração", () => {
  it("mantém snapshot e avança somente após campos obrigatórios", () => {
    let execution = createIntegrationExecution({ mode: "import", snapshot, now: "2026-01-01T00:00:00.000Z" });
    assert.throws(() => advanceIntegrationExecution(execution, "2026-01-01T00:01:00.000Z"), /Nome/);
    execution = updateIntegrationExecution(execution, { answers: { name: "Maria" } }, "2026-01-01T00:01:00.000Z");
    const advanced = advanceIntegrationExecution(execution, "2026-01-01T00:02:00.000Z");
    assert.equal(advanced.currentStageId, "two");
    assert.equal(advanced.templateVersion, 3);
  });

  it("valida campos obrigatórios dentro de repetíveis e subformulários", () => {
    const structured: IntegrationTemplateVersion = {
      ...snapshot,
      blocks: [
        {
          id: "dependents",
          stageId: "one",
          order: 0,
          type: "repeatable_group",
          label: "Dependentes",
          required: true,
          readOnly: false,
          active: true,
          writePolicy: "process_only",
          hiddenAnswerPolicy: "exclude",
          fields: [
            { id: "name", type: "text", label: "Nome", required: true, readOnly: false, config: {} },
            { id: "birth", type: "date", label: "Nascimento", required: true, readOnly: false, config: {} },
          ],
          config: {},
        },
        {
          id: "address",
          stageId: "one",
          order: 1,
          type: "subform",
          label: "Endereço",
          required: false,
          readOnly: false,
          active: true,
          writePolicy: "process_only",
          hiddenAnswerPolicy: "exclude",
          fields: [
            { id: "street", type: "text", label: "Rua", required: true, readOnly: false, config: {} },
          ],
          config: {},
        },
      ],
    };

    const missing = simulateIntegrationTemplate(structured, { answers: { dependents: [{ name: "Ana" }], address: {} } });
    assert.match(missing.blockedReasons.join(" "), /Nascimento/);
    const ok = simulateIntegrationTemplate(structured, { answers: { dependents: [{ name: "Ana", birth: "2020-01-01" }], address: { street: "Rua A" } } });
    assert.deepEqual(ok.blockedReasons, []);
  });
});
