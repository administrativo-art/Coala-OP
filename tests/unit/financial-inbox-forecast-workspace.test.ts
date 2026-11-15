import assert from "node:assert/strict";
import test from "node:test";

import { forecastWorkspaceMatches } from "../../src/features/financial/inbox/forecast-workspace";
import { WORKSPACE_ID } from "../../src/lib/workspace";

test("previsão recorrente legada da matriz pode ser conciliada no workspace original", () => {
  const bizneo = { sourceType: "recurring_expense_forecast", unitId: "matriz" };
  assert.equal(forecastWorkspaceMatches(bizneo, WORKSPACE_ID, false), true);
  assert.equal(forecastWorkspaceMatches(bizneo, "outro-workspace", false), false);
  assert.equal(forecastWorkspaceMatches({ ...bizneo, workspaceId: "outro-workspace" }, WORKSPACE_ID, false), false);
  assert.equal(forecastWorkspaceMatches({ ...bizneo, sourceType: "manual" }, WORKSPACE_ID, false), false);
  assert.equal(forecastWorkspaceMatches({ ...bizneo, unitId: "" }, WORKSPACE_ID, false), false);
  assert.equal(forecastWorkspaceMatches({ ...bizneo, workspaceId: WORKSPACE_ID }, WORKSPACE_ID, false), true);
});

test("exceção de identidade de telefonia legada permanece restrita à prova da linha", () => {
  assert.equal(forecastWorkspaceMatches({}, WORKSPACE_ID, false), false);
  assert.equal(forecastWorkspaceMatches({}, WORKSPACE_ID, true), true);
});

test("previsão DAS legada requer série exata e guia DAS confirmada no workspace original", () => {
  const das = { sourceType: "das_forecast", provisionSeriesKey: "das-simples-nacional" };
  assert.equal(forecastWorkspaceMatches(das, WORKSPACE_ID, false, "das"), true);
  assert.equal(forecastWorkspaceMatches(das, WORKSPACE_ID, false, "dare"), false);
  assert.equal(forecastWorkspaceMatches(das, "outro-workspace", false, "das"), false);
  assert.equal(forecastWorkspaceMatches({ ...das, provisionSeriesKey: "outro" }, WORKSPACE_ID, false, "das"), false);
  assert.equal(forecastWorkspaceMatches({ ...das, workspaceId: "outro-workspace" }, WORKSPACE_ID, false, "das"), false);
});
