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
const closuresOverviewSource = readFileSync(
  path.join(process.cwd(), "src/features/financial/cash-closures/components/cash-closures-overview-page.tsx"),
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

test("modal mostra todos os canais, fluxo das divergências e justificativa somente do Financeiro", () => {
  assert.match(countingDialogSource, /manualLines\.map/);
  assert.match(countingDialogSource, /automaticLines\.map/);
  assert.doesNotMatch(countingDialogSource, /Justificativa do Caixa/);
  assert.match(countingDialogSource, /Justificativa do Financeiro/);
  assert.match(countingDialogSource, /PDV esperado/);
  assert.match(countingDialogSource, /Caixa informado/);
  assert.match(countingDialogSource, /Financeiro contado/);
  assert.match(countingDialogSource, /Resultado final/);
  assert.match(countingDialogSource, /ETAPA 3 DE 4 · CONFERÊNCIA/);
  assert.match(countingDialogSource, /CashWithdrawalsPanel[\s\S]*operatorId=\{activeGroup\.operatorId\}/);
  assert.doesNotMatch(countingDialogSource, /Classifique sangrias/);
});

test("operadores usam mestre-detalhe e canais automáticos ficam resumidos", () => {
  assert.match(countingDialogSource, /aria-label="Operadores do malote"/);
  assert.match(countingDialogSource, /groups\.map\(\(group, index\)/);
  assert.match(countingDialogSource, /Conferidos automaticamente pelo PDV/);
  assert.match(countingDialogSource, /automaticChannelsExpanded/);
  assert.match(countingDialogSource, /Canal manual/);
});

test("classificação da sangria mostra a justificativa informada no PDV", () => {
  assert.match(withdrawalsPanelSource, /Justificativa informada no PDV/);
  assert.match(withdrawalsPanelSource, /setDescription\(selectedSource\?\.pdvReason \?\? ""\)/);
  assert.match(withdrawalsPanelSource, /isWithdrawalClassifiableAccount/);
  assert.match(withdrawalsPanelSource, /Esta sangria sempre cria uma nova despesa já quitada em espécie/);
  assert.match(withdrawalsPanelSource, /action: "create"/);
  assert.doesNotMatch(withdrawalsPanelSource, /Vincular despesa|Buscar despesas em aberto|existingExpenseId|mode === "link"/);
});

test("modal de contagem respeita a viewport e o fluxo interno usa o retorno canônico", () => {
  assert.match(countingDialogSource, /max-w-\[min\(1180px,calc\(100vw-2rem\)\)\]/);
  assert.match(countingDialogSource, /md:grid-cols-\[minmax\(240px,300px\)_minmax\(0,1fr\)\]/);
  assert.match(countingDialogSource, /bg-ds-dark[\s\S]*Contar malote/);
  assert.match(countingDialogSource, /lg:grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)_auto_minmax\(0,1fr\)_auto_minmax\(0,1\.1fr\)\]/);
  assert.match(countingDialogSource, /overflow-x-auto/);
  assert.match(cashControlNavigationSource, /<BackButton/);
  assert.match(cashControlNavigationSource, /fallbackHref/);
  assert.doesNotMatch(cashControlNavigationSource, /Depósitos|Coala · Financeiro/);
});

test("contagem usa Inter Tight e reserva JetBrains Mono para dados operacionais", () => {
  assert.match(countingDialogSource, /font-ds/);
  assert.match(countingDialogSource, /font-ds-mono/);
  assert.match(withdrawalsPanelSource, /font-ds text-ds-ink/);
  assert.match(withdrawalsPanelSource, /font-ds-mono/);
  assert.doesNotMatch(countingDialogSource, /font-mono|font-black/);
  assert.doesNotMatch(withdrawalsPanelSource, /font-mono|font-black/);
});

test("seletor do malote usa calendário próprio e bloqueia datas futuras", () => {
  assert.match(countingDialogSource, /<Calendar mode="single" locale=\{ptBR\}/);
  assert.match(countingDialogSource, /disabled=\{dateUnavailable \? true : \{ after: today \}\}/);
  assert.match(countingDialogSource, /toMonth=\{today\}/);
  assert.match(countingDialogSource, /formatTypedDate/);
  assert.match(countingDialogSource, /dateKeyFromTypedDate/);
  assert.match(countingDialogSource, /modifiersClassNames=\{\{ lastBag:/);
  assert.match(countingDialogSource, /table: "w-full border-collapse"/);
  assert.doesNotMatch(countingDialogSource, /captionLayout=/);
  assert.match(countingDialogSource, /"Hoje"[\s\S]*"Ontem"[\s\S]*"Há 7 dias"[\s\S]*"Último malote"/);
  assert.doesNotMatch(countingDialogSource, /type="date"/);
});

test("emissão sugere D+7 e permite vencimento personalizado em calendário limitado", () => {
  assert.match(depositsPageSource, /D\+\{inter\.issueSettings\?\.dueBusinessDays \?\? 7\}/);
  assert.match(depositsPageSource, /Personalizado/);
  assert.match(depositsPageSource, /maximumDueDate/);
  assert.match(depositsPageSource, /customDueDateEnabled \? \{ dueDate: customDueDate \} : \{\}/);
  assert.doesNotMatch(depositsPageSource, /type="date"/);
});

test("nova sessão escolhe somente unidades", () => {
  assert.match(sessionNewPageSource, /json: \{ kioskIds: selectedUnits \}/);
  assert.doesNotMatch(sessionNewPageSource, /periods:|Competências|selectorYear/);
});

test("sessão e composição física exigem permissões e responsabilidade explícitas", () => {
  assert.doesNotMatch(sessionPageSource, /ID da sessão:/);
  assert.match(sessionPageSource, /Responsável: \{session\.openedByName\}/);
  assert.match(closuresOverviewSource, /Responsável: <span className="ml-1 truncate">\{session\.openedByName\}/);
  assert.match(countingDialogSource, /Responsável pela sessão:/);
  assert.match(countingDialogSource, /session\.openedByName/);
  assert.match(sessionPageSource, /cashClosures\.approve && canManageSession/);
  assert.match(sessionPageSource, /cashDeposits\.view\s*&& permissions\.financial\.cashDeposits\.issue\s*&& canManageSession/);
  assert.match(depositsPageSource, /cashDeposits\.view && permissions\.financial\.cashDeposits\.issue && countingSessions\.length/);
});

test("sessão de contagem mantém o cabeçalho, etapas horizontais e colunas anteriores", () => {
  assert.match(sessionPageSource, /<PageHero/);
  assert.match(sessionPageSource, /<CashFlowStepper scope="counting"/);
  assert.match(sessionPageSource, /Sessão de contagem finalizada/);
  assert.match(sessionPageSource, /Ir para depósitos/);
  assert.match(sessionPageSource, /xl:grid-cols-\[minmax\(320px,.9fr\)_minmax\(0,1.35fr\)\]/);
  assert.match(sessionPageSource, /Unidades da sessão/);
  assert.match(sessionPageSource, /Contagens por turno/);
  assert.match(sessionPageSource, /finalizedByDate\.map/);
  assert.match(sessionPageSource, /Malote de \{closureDate\.split/);
  assert.match(sessionPageSource, /Só aparecem as contagens finalizadas nesta sessão/);
  assert.doesNotMatch(sessionPageSource, /xl:grid-cols-\[240px_minmax\(0,1fr\)\]/);
});

test("redirecionamento para depósitos preserva a sessão mesmo com fila paginada", () => {
  assert.match(depositsPageSource, /params\.set\("sessionId", focusSessionId\)/);
  assert.match(depositsRouteSource, /getCashCountingSessionSummary\(focusSessionId\)/);
  assert.match(depositsRouteSource, /visibleCountingSessions\.unshift\(focusSession\)/);
});

test("malote mostra quantidades por cédula e reserva de moedas da sessão", () => {
  assert.match(depositsPageSource, /Quantidade de cédulas para fechar o malote/);
  assert.match(depositsPageSource, /cashDepositDenominationRows\(selected\.denominations, "note"\)/);
  assert.match(depositsPageSource, /Moedas reservadas no caixa \/ troca/);
  assert.match(depositsPageSource, /reservedCoinDenominations/);
  assert.doesNotMatch(sessionPageSource, /Composição da sessão/);
});
