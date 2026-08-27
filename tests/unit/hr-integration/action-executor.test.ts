import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeIntegrationActions, type IntegrationActionAdapter } from "../../../src/features/hr/integration/action-executor";
import { createIntegrationExecution } from "../../../src/features/hr/integration/process";
import { DEFAULT_INTEGRATION_COMMUNICATIONS, type IntegrationTemplateVersion } from "../../../src/features/hr/integration/schemas";

const template: IntegrationTemplateVersion = { schemaVersion: "coala-integration-v1", templateId: "t", version: 1, name: "Teste", roleId: "r", functionId: null, createdAt: new Date(0).toISOString(), createdBy: "u", publishedAt: new Date(0).toISOString(), stages: [{ id: "s", label: "S", order: 0, required: true, skippable: false, dueDays: null, dueDateSource: "stage_entry" }], blocks: [{ id: "b", stageId: "s", order: 0, type: "text", label: "B", required: false, readOnly: false, active: true, writePolicy: "process_only", hiddenAnswerPolicy: "exclude", config: {} }], rules: [{ id: "r1", label: "R", active: true, priority: 0, condition: { kind: "predicate", source: "context", key: "ok", operator: "equals", value: true }, actions: [{ id: "set", type: "set_value", targetId: "b", config: { value: "preenchido" } }, { id: "task", type: "create_task", config: { title: "Tarefa" } }] }], completionRules: [], communications: DEFAULT_INTEGRATION_COMMUNICATIONS.map(item => ({ ...item })) };

describe("executor operacional de ações", () => {
  it("executa efeitos e garante idempotência", async () => {
    let calls = 0; const adapter: IntegrationActionAdapter = { createTask: async () => { calls += 1; return { taskId: "1" }; }, notify: async () => ({}), requestSignature: async () => ({}), generateDocument: async () => ({}), updateProfile: async () => ({}) };
    const execution = createIntegrationExecution({ mode: "import", snapshot: template, now: new Date(0).toISOString() });
    const simulation = { visibleStageIds: ["s"], skippedStageIds: [], visibleBlockIds: ["b"], hiddenBlockIds: [], requiredBlockIds: [], effectiveAnswers: {}, triggeredRuleIds: ["r1"], blockedReasons: [], actions: [{ ruleId: "r1", actionId: "set", type: "set_value", targetId: "b" }, { ruleId: "r1", actionId: "task", type: "create_task" }] };
    const first = await executeIntegrationActions({ execution, simulation, adapter, processContext: {}, now: "2026-01-01T00:00:00.000Z" });
    const second = await executeIntegrationActions({ execution: first, simulation, adapter, processContext: {}, now: "2026-01-01T00:01:00.000Z" });
    assert.equal(second.answers.b, "preenchido"); assert.equal(calls, 1); assert.equal(second.actionResults?.["r1:task"].output?.taskId, "1");
  });
});
