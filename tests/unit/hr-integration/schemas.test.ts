import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  integrationConditionSchema,
  integrationProcessCreateSchema,
  probationConfigSchema,
} from "../../../src/features/hr/integration/schemas";

describe("schemas da integração", () => {
  test("aceita cascata profunda sem limite funcional de quatro níveis", () => {
    let condition: unknown = {
      kind: "predicate",
      source: "answer",
      key: "answer.root",
      operator: "equals",
      value: true,
    };
    for (let index = 0; index < 12; index += 1) {
      condition = { kind: "group", operator: "and", conditions: [condition] };
    }
    assert.equal(integrationConditionSchema.safeParse(condition).success, true);
  });

  test("exige modelo no modo importar e proíbe modelo no modo do zero", () => {
    const base = {
      candidateName: "Maria da Silva",
      candidateEmail: "maria@example.com",
      roleId: "role-1",
    };
    assert.equal(integrationProcessCreateSchema.safeParse({ ...base, mode: "import" }).success, false);
    assert.equal(integrationProcessCreateSchema.safeParse({ ...base, mode: "import", templateId: "tpl-1" }).success, true);
    assert.equal(integrationProcessCreateSchema.safeParse({ ...base, mode: "blank", templateId: "tpl-1" }).success, false);
    assert.equal(integrationProcessCreateSchema.safeParse({ ...base, mode: "blank" }).success, true);
  });

  test("valida período e janela da avaliação", () => {
    assert.equal(probationConfigSchema.safeParse({ firstPeriodDays: 45, secondPeriodDays: 45, evaluationWindowDays: 10 }).success, true);
    assert.equal(probationConfigSchema.safeParse({ firstPeriodDays: 45, secondPeriodDays: 46, evaluationWindowDays: 10 }).success, false);
    assert.equal(probationConfigSchema.safeParse({ firstPeriodDays: 5, secondPeriodDays: 5, evaluationWindowDays: 10 }).success, false);
  });
});

