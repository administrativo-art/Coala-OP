import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectCardStatementCsv,
  normalizeCardStatementImportLines,
  parseCardStatementCsv,
  resolveCardStatementOfficialTotal,
  resolveCardStatementCsvAnalysisLines,
} from "../../src/features/financial/lib/card-statement-import";

const context = { accountId: "inter", paymentMethodId: "card-1127", monthKey: "2026-08" };

test("interpreta CSV de fatura com valores brasileiros", () => {
  const parsed = parseCardStatementCsv(
    "Data;Descrição;Estabelecimento;Valor\n14/07/2026;COMPRA 01/03;LOJA TESTE;1.234,56\n15/07/2026;ASSINATURA;SERVICO;99,90",
    context,
  );
  assert.equal(parsed.transactions.length, 2);
  assert.equal(parsed.transactions[0]?.date, "2026-07-14");
  assert.equal(parsed.transactions[0]?.amount, 1234.56);
  assert.equal(parsed.transactions[0]?.supplier, "LOJA TESTE");
});

test("preserva duas cobranças iguais como ocorrências distintas", () => {
  const lines = normalizeCardStatementImportLines([
    { date: "14/07/2026", description: "Loja", amount: 10 },
    { date: "2026-07-14", description: "Loja", amount: "10,00" },
  ], context);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!.fingerprint, /^card-/);
  assert.notEqual(lines[0]!.fingerprint, lines[1]!.fingerprint);
});

const interCsv = [
  '\ufeff"Descricao","Data","Cartao","Lançamento","Categoria","Tipo","Valor"',
  '"Cartão Principal","•••• •••• •••• 3366","","","","",""',
  '"Vencimento","12/09","","","","",""',
  '"","","","","","",""',
  '"","18/08/2026","•••• 1127","Vindi Tartuservice","OUTROS","Compra à vista","-R$ 189,47"',
  '"","18/08/2026","•••• 1127","Vindi Tartuservice","OUTROS","Compra à vista","-R$ 189,47"',
  '"","14/08/2026","•••• 1127","PAGAMENTO ON LINE","OUTROS","Compra à vista","R$ 6.137,84"',
  '"","30/07/2026","•••• 3366","MERCADOLIVRE","OUTROS","Parcela 2/8","-R$ 54,87"',
  '"Total","","","","","","R$ 4.538,84"',
].join("\n");

test("estrutura o CSV do Inter como evidência para o copiloto", () => {
  const inspection = inspectCardStatementCsv(interCsv, { ...context, monthKey: "2026-09" });
  assert.equal(inspection.detectedFormat, "CSV Banco Inter");
  assert.equal(inspection.issuer, "Banco Inter");
  assert.equal(inspection.cardLastDigits, "3366");
  assert.equal(inspection.dueDate, "2026-09-12");
  assert.equal(inspection.officialTotal, null);
  assert.equal(inspection.sourceRows.length, 4);
  assert.equal(inspection.sourceRows[0]?.description, "Vindi Tartuservice");
  assert.equal(inspection.sourceRows[0]?.signedAmount, -189.47);
});

test("importa compras negativas do Inter, ignora o pagamento e mantém duplicadas", () => {
  const parsed = parseCardStatementCsv(interCsv, { ...context, monthKey: "2026-09" });
  assert.equal(parsed.transactions.length, 3);
  assert.deepEqual(parsed.transactions.map((line) => line.amount), [189.47, 189.47, 54.87]);
  assert.equal(parsed.officialTotal, 433.81);
  assert.equal(parsed.transactions[2]?.installmentNumber, 2);
  assert.equal(parsed.transactions[2]?.installmentTotal, 8);
  assert.notEqual(parsed.transactions[0]?.fingerprint, parsed.transactions[1]?.fingerprint);
});

test("calcula o total do Inter pelas compras e ignora pagamento de fatura anterior", () => {
  const inspection = inspectCardStatementCsv(interCsv, { ...context, monthKey: "2026-09" });
  const total = resolveCardStatementOfficialTotal({
    inspection,
    transactions: [{ amount: 189.47 }],
    excludedEntries: [{ kind: "payment", amount: 6137.84 }],
    aiOfficialTotal: 4538.84,
  });
  assert.equal(total, 433.81);
});

test("a decisão do copiloto referencia linhas existentes e mantém os valores do CSV", () => {
  const inspection = inspectCardStatementCsv(interCsv, { ...context, monthKey: "2026-09" });
  const lines = resolveCardStatementCsvAnalysisLines([
    {
      sourceReference: "csv-line-5",
      date: "2099-01-01",
      description: "valor inventado",
      amount: 9999,
      confidence: "high",
      reviewNotes: [],
    },
  ], inspection, { ...context, monthKey: "2026-09" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.date, "2026-08-18");
  assert.equal(lines[0]?.description, "Vindi Tartuservice");
  assert.equal(lines[0]?.amount, 189.47);
});
