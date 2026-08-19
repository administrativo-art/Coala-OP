import assert from "node:assert/strict";
import test from "node:test";

import {
  getActiveSystemPrompt,
  getSystemPrompt,
  listSystemPrompts,
  renderSystemPrompt,
} from "@/ai/prompts/registry";

test("registra prompts do sistema com IDs e versões únicos", () => {
  const prompts = listSystemPrompts();
  assert.equal(prompts.length, 10);
  assert.equal(new Set(prompts.map((prompt) => prompt.id)).size, prompts.length);
  assert.equal(new Set(prompts.map((prompt) => `${prompt.id}@${prompt.version}`)).size, prompts.length);
  assert.ok(prompts.every((prompt) => prompt.version.length > 0));
  assert.ok(prompts.every((prompt) => prompt.rulesBoundary.length > 20));
});

test("segmenta o catálogo global por módulo e status", () => {
  const financial = listSystemPrompts({ module: "financial" });
  assert.deepEqual(
    financial.map((prompt) => prompt.id),
    [
      "financial.card.statement-extraction",
      "financial.payroll.guide-extraction",
      "financial.payroll.payslip-extraction",
      "financial.provision.document-extraction",
      "financial.tax.das-extraction",
    ],
  );
  assert.equal(financial.find((prompt) => prompt.id === "financial.card.statement-extraction")?.status, "active");
  assert.ok(financial.filter((prompt) => prompt.id !== "financial.card.statement-extraction").every((prompt) => prompt.status === "draft"));
  assert.equal(listSystemPrompts({ status: "active" }).length, 6);
});

test("renderiza o prompt ativo de RH pelo registro central", () => {
  const prompt = getSystemPrompt("hr.employee-document-analysis");
  const rendered = renderSystemPrompt("hr.employee-document-analysis", {
    expectedEmployeeName: "Heucilene Oliveira Ribeiro",
  });
  assert.equal(prompt.version, "employee-document-v5");
  assert.equal(prompt.schemaVersion, "employee-document-analysis-v5");
  assert.match(rendered, /Heucilene Oliveira Ribeiro/);
  assert.match(rendered, /não force correspondência/i);
});

test("prompts financeiros proíbem decisões contábeis e bancárias pela IA", () => {
  const prompts = listSystemPrompts({ module: "financial" });
  for (const metadata of prompts) {
    const rendered = getSystemPrompt(metadata.id as any).render({});
    assert.match(`${metadata.rulesBoundary}\n${rendered}`, /não (decide|decida|escolhe|escolha)|nunca são decididos/i);
    assert.match(`${metadata.rulesBoundary}\n${rendered}`, /pagamento|pagar/i);
  }
});

test("bloqueia o uso operacional de um prompt financeiro ainda em draft", () => {
  assert.throws(
    () => getActiveSystemPrompt("financial.payroll.payslip-extraction"),
    /Prompt não está ativo/,
  );
  assert.throws(
    () => renderSystemPrompt("financial.tax.das-extraction", {}),
    /Prompt não está ativo/,
  );
});
