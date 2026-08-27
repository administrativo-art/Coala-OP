import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  evaluateIntegrationCondition,
  simulateIntegrationTemplate,
  validateIntegrationTemplate,
} from "../../../src/features/hr/integration/engine";
import { integrationTemplateVersionSchema } from "../../../src/features/hr/integration/schemas";

function template(input?: { cycle?: boolean }) {
  return integrationTemplateVersionSchema.parse({
    templateId: "template-1",
    version: 1,
    name: "Integração de teste",
    roleId: "role-1",
    functionId: null,
    createdAt: "2026-07-17T12:00:00.000Z",
    createdBy: "admin-1",
    publishedAt: null,
    stages: [
      { id: "data", label: "Dados", order: 0 },
      { id: "documents", label: "Documentos", order: 1 },
    ],
    blocks: [
      { id: "has_cnh", stageId: "data", order: 0, type: "yes_no", label: "Possui CNH?", required: true },
      {
        id: "cnh_number",
        stageId: "data",
        order: 1,
        type: "text",
        label: "Número da CNH",
        variableKey: "employee.cnh_number",
        required: true,
        visibilityCondition: {
          kind: "predicate",
          source: "answer",
          key: input?.cycle ? "cnh_category" : "has_cnh",
          operator: "equals",
          value: true,
        },
      },
      {
        id: "cnh_category",
        stageId: "data",
        order: 2,
        type: "text",
        label: "Categoria",
        visibilityCondition: input?.cycle ? {
          kind: "predicate",
          source: "answer",
          key: "cnh_number",
          operator: "is_not_empty",
        } : undefined,
      },
    ],
    rules: [
      {
        id: "skip-documents",
        label: "Pular documentos sem CNH",
        priority: 1,
        condition: { kind: "predicate", source: "answer", key: "has_cnh", operator: "equals", value: false },
        actions: [{ id: "skip", type: "skip_stage", targetId: "documents" }],
      },
    ],
    completionRules: [],
  });
}

describe("motor condicional da integração", () => {
  test("avalia grupos E, OU e NÃO aninhados", () => {
    const condition = {
      kind: "group" as const,
      operator: "and" as const,
      conditions: [
        { kind: "predicate" as const, source: "answer" as const, key: "active", operator: "equals" as const, value: true },
        {
          kind: "group" as const,
          operator: "not" as const,
          conditions: [{ kind: "predicate" as const, source: "answer" as const, key: "blocked", operator: "equals" as const, value: true }],
        },
      ],
    };
    assert.equal(evaluateIntegrationCondition(condition, { answers: { active: true, blocked: false } }), true);
    assert.equal(evaluateIntegrationCondition(condition, { answers: { active: true, blocked: true } }), false);
  });

  test("remove respostas ocultas da resposta efetiva", () => {
    const result = simulateIntegrationTemplate(template(), {
      answers: { has_cnh: false, cnh_number: "123456", cnh_category: "B" },
    });
    assert.deepEqual(result.effectiveAnswers, { has_cnh: false, cnh_category: "B" });
    assert.ok(result.hiddenBlockIds.includes("cnh_number"));
    assert.ok(result.skippedStageIds.includes("documents"));
    assert.ok(result.triggeredRuleIds.includes("skip-documents"));
  });

  test("torna campo condicional obrigatório somente quando visível", () => {
    const hidden = simulateIntegrationTemplate(template(), { answers: { has_cnh: false } });
    assert.equal(hidden.blockedReasons.some((reason) => reason.includes("Número da CNH")), false);

    const visible = simulateIntegrationTemplate(template(), { answers: { has_cnh: true } });
    assert.equal(visible.blockedReasons.some((reason) => reason.includes("Número da CNH")), true);
  });

  test("detecta dependência circular antes da publicação", () => {
    const issues = validateIntegrationTemplate(template({ cycle: true }));
    assert.ok(issues.some((issue) => issue.code === "conditional_cycle"));
  });

  test("rejeita variável de destino desconhecida", () => {
    const invalid = template();
    invalid.blocks[0].variableKey = "employee.nao_existe";
    const issues = validateIntegrationTemplate(invalid);
    assert.ok(issues.some((issue) => issue.code === "unknown_variable"));
  });
});

