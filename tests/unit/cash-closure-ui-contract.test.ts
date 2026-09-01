import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const dayPageSource = readFileSync(
  path.join(process.cwd(), "src/features/financial/cash-closures/components/cash-closure-day-page.tsx"),
  "utf8",
);
const countingDialogSource = readFileSync(
  path.join(process.cwd(), "src/features/financial/cash-counting-sessions/components/cash-counting-dialog.tsx"),
  "utf8",
);
const sessionNewPageSource = readFileSync(
  path.join(process.cwd(), "src/features/financial/cash-counting-sessions/components/cash-counting-session-new-page.tsx"),
  "utf8",
);
const sessionPageSource = readFileSync(
  path.join(process.cwd(), "src/features/financial/cash-counting-sessions/components/cash-counting-session-page.tsx"),
  "utf8",
);
const depositsPageSource = readFileSync(
  path.join(process.cwd(), "src/features/financial/cash-deposits/cash-deposits-page.tsx"),
  "utf8",
);
const depositsRouteSource = readFileSync(
  path.join(process.cwd(), "src/app/api/financial/cash-deposits/route.ts"),
  "utf8",
);

test("contagem do Caixa não oferece atalho para copiar o esperado do PDV", () => {
  assert.doesNotMatch(dayPageSource, /Usar esperado/);
  assert.doesNotMatch(dayPageSource, /reportedCents:\s*line\.expectedCents/);
});

test("modal de contagem salva rascunho sem polling nem refresh durante a digitação", () => {
  assert.match(countingDialogSource, /persistLatestDraft/);
  assert.match(countingDialogSource, /isCurrentDraftLoad/);
  assert.match(countingDialogSource, /setTimeout\(.*800/);
  assert.doesNotMatch(countingDialogSource, /setInterval|router\.refresh|window\.location\.reload/);
  assert.match(countingDialogSource, /dirtyLineIds\.current\.size > 0 \|\| saveInFlight\.current/);
  assert.match(countingDialogSource, /draft\.lines\.filter\(\(line\) => dirtyIds\.has\(line\.id\)\)/);
});

test("modal mostra todos os canais, as duas origens de justificativa e as três divergências", () => {
  assert.match(countingDialogSource, /group\.lines\.map/);
  assert.match(countingDialogSource, /reportedNote/);
  assert.match(countingDialogSource, /Justificativa do Caixa/);
  assert.match(countingDialogSource, /Justificativa do Financeiro/);
  assert.match(countingDialogSource, /Caixa × PDV/);
  assert.match(countingDialogSource, /Financeiro × Caixa/);
  assert.match(countingDialogSource, /Financeiro × PDV/);
});

test("nova sessão escolhe somente unidades", () => {
  assert.match(sessionNewPageSource, /json: \{ kioskIds: selectedUnits \}/);
  assert.doesNotMatch(sessionNewPageSource, /periods:|Competências|selectorYear/);
});

test("sessão e composição física exigem permissões e responsabilidade explícitas", () => {
  assert.match(sessionPageSource, /cashClosures\.approve && canManageSession/);
  assert.match(sessionPageSource, /cashDeposits\.view\s*&& permissions\.financial\.cashDeposits\.issue\s*&& canManageSession/);
  assert.match(depositsPageSource, /cashDeposits\.view && permissions\.financial\.cashDeposits\.issue && countingSessions\.length/);
});

test("redirecionamento para depósitos preserva a sessão mesmo com fila paginada", () => {
  assert.match(depositsPageSource, /params\.set\("sessionId", focusSessionId\)/);
  assert.match(depositsRouteSource, /getCashCountingSessionSummary\(focusSessionId\)/);
  assert.match(depositsRouteSource, /visibleCountingSessions\.unshift\(focusSession\)/);
});
