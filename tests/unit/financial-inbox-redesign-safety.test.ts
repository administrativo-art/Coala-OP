import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/features/financial/inbox/financial-inbox-page.tsx", "utf8");
const repository = readFileSync("src/features/financial/inbox/repository.server.ts", "utf8");
const bulkRoute = readFileSync("src/app/api/financial/inbox/bulk-review/route.ts", "utf8");
const listRoute = readFileSync("src/app/api/financial/inbox/route.ts", "utf8");

test("preparação de pagamento declara que autorização, agendamento e execução são etapas posteriores", () => {
  assert.match(page, /Preparar não autoriza, agenda nem executa pagamento\./);
  assert.match(page, /Nenhum pagamento foi autorizado, agendado ou executado\./);
  assert.match(page, /A autorização no sistema e a aprovação no Banco Inter continuam sendo etapas separadas\./);
});

test("interface separa itens no banco de cobranças efetivamente conciliadas", () => {
  assert.match(page, /title="No banco"/);
  assert.match(page, /conciliadas à parte/);
  assert.match(page, /A conciliação só ocorre depois da liquidação encontrada no extrato\./);
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

test("links externos exigem HTTPS e confirmação do domínio", () => {
  assert.match(page, /parsed\.protocol !== "https:"/);
  assert.match(page, /Abrir site externo\?/);
  assert.match(page, /Confirme o domínio antes de continuar\./);
});

test("listagem usa o contrato seguro de erros sem expor a falha interna do Firestore", () => {
  assert.match(listRoute, /withApiErrorHandling/);
  assert.match(listRoute, /FINANCIAL_INBOX_LIST_FORBIDDEN/);
  assert.doesNotMatch(listRoute, /error instanceof Error \? error\.message/);
});
