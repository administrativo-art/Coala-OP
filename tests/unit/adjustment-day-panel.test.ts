import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const review = readFileSync("src/features/dp/time-adjustments/review-section.tsx", "utf8");
const panel = readFileSync("src/features/dp/time-adjustments/adjustment-panel.tsx", "utf8");
const view = readFileSync("src/features/dp/time-adjustments/adjustment-day-view.tsx", "utf8");
const route = readFileSync("src/app/api/dp/time-recording/adjustments/[adjustmentId]/day/route.ts", "utf8");
const server = readFileSync("src/features/dp/time-adjustments/day-context.server.ts", "utf8");

test("a análise abre o dia inteiro do pedido e, se a leitura falhar, volta ao comparativo da batida", () => {
  assert.match(review, /\/api\/dp\/time-recording\/adjustments\/\$\{selectedId\}\/day/);
  assert.match(review, /<AdjustmentReport adjustment=\{selected\} names=\{names\} day=\{day\} dayLoading=\{!day && !dayError\}/);
  assert.match(review, /Mostrando só a batida do pedido/);
  assert.match(panel, /day \? <AdjustmentDayOverview adjustment=\{adjustment\} day=\{day\} \/> : dayLoading/);
  assert.match(panel, /<PanelSection title="Antigo × novo">/);
});

test("o painel traz a linha do dia, o resultado antes e depois, as batidas e a trilha recolhida", () => {
  assert.match(view, /title="O dia em uma linha"/);
  assert.match(view, /<DayLine title="Como está"/);
  assert.match(view, /<DayLine title="Se aprovar"/);
  assert.match(view, /title="Resultado do dia"/);
  assert.match(view, /title="Batidas do dia" aside="a original sempre fica guardada"/);
  assert.match(panel, /Ver trilha e verificação/);
  assert.doesNotMatch(view, /#[0-9a-fA-F]{6}/);
  assert.match(view, /summary\.notice \? <p role="status"/);
  assert.match(view, /band=\{summary\.scaleBand\}/);
});

test("o seletor compartilhado corta o texto longo com reticências em vez de sair da caixa", () => {
  const select = readFileSync("src/components/ui/select.tsx", "utf8");
  assert.match(select, /\[&>span:first-child\]:line-clamp-1/);
});

test("a leitura do dia é só de consulta, exige quem analisa e nunca serve o próprio pedido", () => {
  assert.match(route, /action: 'dp\.requests\.review'/);
  assert.match(route, /effects: \{ mode: 'read', audit: 'none' \}/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
  assert.match(route, /export const GET = secureRoute/);
  assert.doesNotMatch(route, /export const (POST|PATCH|PUT|DELETE)/);
  assert.match(server, /canReview\(context\)/);
  const service = readFileSync("src/features/dp/time-adjustments/service.server.ts", "utf8");
  assert.match(service, /const database = scope === 'pilot' \? deps\.hrDb : deps\.repDb;/);
  assert.match(server, /PTRP_ADJUSTMENT_SELF_DECISION/);
  assert.match(server, /canAccessUnit\(context\.userDoc, unitId/);
  assert.doesNotMatch(server, /\.(set|update|delete|create)\(/);
});
