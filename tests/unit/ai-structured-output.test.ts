import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { parseStructuredOutput, renderPromptTemplate } from "../../src/ai/structured-output";

test("renderPromptTemplate renders nested values and conditions", () => {
  const rendered = renderPromptTemplate(
    "{{name}}:{{#each values}} {{this}}{{/each}}{{#if optional}} / {{optional}}{{/if}}",
    { name: "Coala", values: [1, 2], optional: "ativo" },
  );
  assert.equal(rendered, "Coala: 1 2 / ativo");
});

test("renderPromptTemplate treats input as data instead of executable template", () => {
  const rendered = renderPromptTemplate("Nome: {{name}}", { name: "{{dangerous.path}}" });
  assert.equal(rendered, "Nome: {{dangerous.path}}");
});

test("parseStructuredOutput parses and validates JSON", () => {
  const schema = z.object({ status: z.literal("ok"), count: z.number().int() }).strict();
  assert.deepEqual(parseStructuredOutput(schema, '{"status":"ok","count":2}'), { status: "ok", count: 2 });
  assert.throws(() => parseStructuredOutput(schema, "not-json"), /JSON válido/);
  assert.throws(() => parseStructuredOutput(schema, '{"status":"ok","count":"2"}'), /formato esperado/);
});
