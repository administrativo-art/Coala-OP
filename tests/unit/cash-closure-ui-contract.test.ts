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
const cashControlNavigationSource = readFileSync(
  path.join(process.cwd(), "src/features/financial/cash-closures/components/cash-control-navigation.tsx"),
  "utf8",
);
const withdrawalsPanelSource = readFileSync(
  path.join(process.cwd(), "src/features/financial/cash-closures/components/cash-withdrawals-panel.tsx"),
  "utf8",
);
const suppliesPanelSource = readFileSync(
  path.join(process.cwd(), "src/features/financial/cash-closures/components/cash-supplies-panel.tsx"),
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
  assert.match(countingDialogSource, /activeGroup\.lines\.map/);
  assert.match(countingDialogSource, /reportedNote/);
  assert.match(countingDialogSource, /Justificativa do Caixa/);
  assert.match(countingDialogSource, /Justificativa do Financeiro/);
  assert.match(countingDialogSource, /Caixa × PDV/);
  assert.match(countingDialogSource, /Financeiro × Caixa/);
  assert.match(countingDialogSource, /Financeiro × malote esperado/);
});

test("classificação da sangria mostra a justificativa informada no PDV", () => {
  assert.match(withdrawalsPanelSource, /Justificativa informada no PDV/);
  assert.match(withdrawalsPanelSource, /setDescription\(selectedSource\?\.pdvReason \?\? ""\)/);
  assert.match(withdrawalsPanelSource, /isWithdrawalClassifiableAccount/);
  assert.match(withdrawalsPanelSource, /Sangrias deste operador/);
});

test("modal informa o estado da data e permite selecionar o operador sem paginação manual", () => {
  assert.match(countingDialogSource, /Contagem finalizada/);
  assert.match(countingDialogSource, /Contagem em andamento/);
  assert.match(countingDialogSource, /Contagem ainda não finalizada/);
  assert.match(countingDialogSource, /groups\.map\(\(group, index\)/);
  assert.doesNotMatch(countingDialogSource, /Próximo operador|>Anterior</);
  assert.match(countingDialogSource, /\/reopen`/);
  assert.match(countingDialogSource, /operatorId: target\.operatorId, reason: reopenReason\.trim\(\)/);
});

test("sangrias aparecem junto da contagem e os cards principais não criam divisor vertical", () => {
  assert.match(countingDialogSource, /!\[3, 5\]\.includes\(activeStep\)/);
  assert.match(countingDialogSource, /operatorId=\{activeGroup\.operatorId\}/);
  assert.match(sessionPageSource, /rounded-\[18px\] border-0 bg-ds-warm shadow-none/);
});

test("suprimentos são classificados por operador entre fundo de caixa e suprimento", () => {
  assert.match(countingDialogSource, /<CashSuppliesPanel/);
  assert.match(countingDialogSource, /missingSupplyClassification/);
  assert.match(countingDialogSource, /Financeiro × Caixa após fundo/);
  assert.match(suppliesPanelSource, /Fundo de caixa/);
  assert.match(suppliesPanelSource, /Suprimento/);
  assert.match(suppliesPanelSource, /não vai no malote/);
});

test("modal de contagem respeita a viewport e o fluxo interno usa o retorno canônico", () => {
  assert.match(countingDialogSource, /max-w-\[min\(1080px,calc\(100vw-2rem\)\)\]/);
  assert.match(countingDialogSource, /lg:grid-cols-3/);
  assert.match(countingDialogSource, /overflow-x-auto/);
  assert.match(cashControlNavigationSource, /<BackButton/);
  assert.match(cashControlNavigationSource, /fallbackHref/);
  assert.doesNotMatch(cashControlNavigationSource, /Depósitos|Coala · Financeiro/);
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
