import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync("src/features/ai-management/google-cloud-billing.server.ts", "utf8");
const panel = readFileSync("src/components/ai-management/ai-billing-settings.tsx", "utf8");

test("Google billing remains scoped to the Coala project instead of the whole billing account", () => {
  assert.match(server, /WHERE project\.id = @projectId/);
  assert.match(server, /name: "projectId"/);
  assert.match(panel, /Somente o projeto:/);
  assert.match(panel, /outros projetos da conta de faturamento não são incluídos/);
});

test("incomplete exports cannot present partial totals as consolidated", () => {
  assert.match(server, /exportIsCurrent \? rounded\(currentMonth\) : null/);
  assert.match(server, /exportIsCurrent \? rounded\(previousMonth\) : null/);
  assert.match(panel, /Export do projeto ainda em preenchimento/);
  assert.match(panel, /valor parcial como consolidado/);
});

test("project report mirrors the billing report structure without adding other projects", () => {
  assert.match(panel, /Resumo do projeto/);
  assert.match(panel, /Custo acumulado no mês/);
  assert.match(panel, /Estimativa até o fim do mês/);
  assert.match(panel, /Coala ERP Estoque/);
  assert.match(panel, /O projeto Getaloo permanece fora deste painel/);
});
