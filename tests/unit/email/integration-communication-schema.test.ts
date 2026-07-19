import assert from "node:assert/strict";
import test from "node:test";

import {
  integrationTemplateContentSchema,
} from "../../../src/features/hr/integration/schemas";

function minimumContent() {
  return {
    stages: [{
      id: "integration",
      label: "Integração",
      order: 0,
      required: true,
      skippable: false,
      dueDays: null,
      dueDateSource: "stage_entry",
    }],
    blocks: [],
    rules: [],
    completionRules: [],
  };
}

test("modelos antigos recebem as duas comunicações padrão", () => {
  const parsed = integrationTemplateContentSchema.parse(minimumContent());
  assert.deepEqual(parsed.communications.map((item) => item.event), [
    "formalization_started",
    "first_access",
  ]);
  assert.match(parsed.communications[1].subject, /Coala One/);
});

test("personalizações de comunicação permanecem no modelo versionado", () => {
  const parsed = integrationTemplateContentSchema.parse({
    ...minimumContent(),
    communications: [{
      event: "formalization_started",
      enabled: true,
      subject: "Assunto do cargo",
      title: "Boas-vindas",
      message: "Olá, {{employee.name}}!",
      buttonLabel: "Preencher agora",
    }],
  });
  assert.equal(parsed.communications[0].subject, "Assunto do cargo");
  assert.equal(parsed.communications[0].message, "Olá, {{employee.name}}!");
});
