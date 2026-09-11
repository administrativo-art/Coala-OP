import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/features/financial/inbox/financial-inbox-page.tsx", "utf8");
const repository = readFileSync("src/features/financial/inbox/repository.server.ts", "utf8");
const bulkRoute = readFileSync("src/app/api/financial/inbox/bulk-review/route.ts", "utf8");
const listRoute = readFileSync("src/app/api/financial/inbox/route.ts", "utf8");
const linkRoute = readFileSync("src/app/api/financial/inbox/[id]/link/route.ts", "utf8");
const settingsRoute = readFileSync("src/app/api/financial/inbox/settings/route.ts", "utf8");

test("preparação de pagamento declara que autorização, agendamento e execução são etapas posteriores", () => {
  assert.match(page, /Preparar não autoriza, agenda nem executa pagamento\./);
  assert.match(page, /Nenhum pagamento foi autorizado, agendado ou executado\./);
  assert.match(page, /A autorização no sistema e a aprovação no Banco Inter continuam sendo etapas separadas\./);
});

test("interface separa itens no banco de cobranças efetivamente conciliadas", () => {
  assert.match(page, /title="No banco"/);
  assert.match(page, /acompanhamento bancário/);
  assert.match(page, /Cobranças identificadas/);
  assert.match(page, /A conciliação só ocorre depois da liquidação encontrada no extrato\./);
});

test("interface separa a caixa operacional da auditoria de cobranças identificadas", () => {
  assert.match(page, /Caixa de cobranças/);
  assert.match(page, /Cobranças identificadas/);
  assert.match(page, /Para confirmar/);
  assert.match(page, /Confirmar como já registrada/);
  assert.match(page, /A despesa, o agendamento e o pagamento não serão alterados\./);
  assert.doesNotMatch(page, /const STAGE_OPTIONS/);
});

test("mostra o lançamento sugerido antes da decisão e explicita a substituição da previsão", () => {
  assert.ok(page.indexOf("1. Lançamento sugerido") < page.indexOf("2. Próxima decisão"));
  assert.match(page, /Previsão a substituir/);
  assert.match(page, /Substituir esta previsão pela cobrança/);
  assert.match(page, /Previsão substituída/);
  assert.match(page, /Uma única despesa de/);
});

test("documento fiscal separa remetente, arrecadador, contribuinte e composição", () => {
  assert.match(page, /Remetente do e-mail:/);
  assert.match(page, /Beneficiário \/ arrecadador/);
  assert.match(page, /Contribuinte/);
  assert.match(page, /Composição da guia/);
});

test("descarte em lote é limitado, validado e auditado dentro de uma transação", () => {
  assert.match(bulkRoute, /z\.array\(z\.string\(\)\.min\(1\)\)\.min\(1\)\.max\(50\)/);
  assert.match(bulkRoute, /inbox\?\.discard/);
  assert.match(repository, /runTransaction\(async \(transaction\) =>/);
  assert.match(repository, /transaction\.getAll\(\.\.\.references\)/);
  assert.match(repository, /isFinancialInboxBulkDiscardEligible/);
  assert.match(repository, /transaction\.create\(eventReferences\[index\]/);
  assert.match(repository, /batchSize: ids\.length/);
});

test("links externos ficam limitados a provedores e rotas verificados", () => {
  assert.match(page, /trustedFinancialDocumentProvider/);
  assert.match(page, /Destino não verificado — abertura bloqueada/);
  assert.match(page, /Abrir documento externo verificado\?/);
  assert.match(page, /Essa validação não substitui a conferência do conteúdo/);
});

test("automação é opt-in, auditada e reutiliza a permissão de vinculação", () => {
  assert.match(page, /Vinculação automática por identidade documental/);
  assert.match(page, /mode: enabled \? "document_identity" : "manual"/);
  assert.match(settingsRoute, /inbox\?\.link/);
  assert.match(settingsRoute, /updateFinancialInboxAutomationSettings/);
  assert.doesNotMatch(settingsRoute, /error instanceof Error \? error\.message/);
});

test("listagem usa o contrato seguro de erros sem expor a falha interna do Firestore", () => {
  assert.match(listRoute, /withApiErrorHandling/);
  assert.match(listRoute, /FINANCIAL_INBOX_LIST_FORBIDDEN/);
  assert.doesNotMatch(listRoute, /error instanceof Error \? error\.message/);
});

test("identificação valida entrada e autorização no servidor sem expor erro interno", () => {
  assert.match(linkRoute, /resolutionOnly: z\.boolean\(\)\.optional\(\)/);
  assert.match(linkRoute, /input\.resolutionOnly !== true \|\| Boolean\(input\.expenseId\)/);
  assert.match(linkRoute, /inbox\?\.link/);
  assert.match(linkRoute, /input\.resolutionOnly !== true/);
  assert.match(linkRoute, /withApiErrorHandling/);
  assert.doesNotMatch(linkRoute, /error instanceof Error \? error\.message/);
});
