import assert from "node:assert/strict";
import test from "node:test";
import { formatStoneReportMoney, parseStoneReceivablesReportCsv } from "../../src/features/financial/receivables/stone-report-csv";

const header = "DOCUMENTO;STONECODE;CATEGORIA;DATA DA VENDA;DATA DE VENCIMENTO;STONE ID;Nº DA PARCELA;VALOR BRUTO;VALOR LÍQUIDO;ÚLTIMO STATUS";
const row = (values: { code?: string; id?: string; due?: string; net?: string; status?: string; category?: string; installment?: string } = {}) =>
  ["12345678000199", values.code ?? "123", values.category ?? "Venda", "20/09/2026 10:00:00", values.due ?? "22/10/2026",
    values.id ?? "1001", values.installment ?? "1", "21,000000", values.net ?? "20,533800", values.status ?? "Aberto"].join(";");
const report = (...rows: string[]) => `\uFEFF${header}\n${rows.join("\n")}\n`;

test("Stone report includes only open installments and preserves micro-unit totals", () => {
  const parsed = parseStoneReceivablesReportCsv(report(
    row(), row({ id: "1002", due: "24/09/2026", net: "0,004999" }), row({ id: "1003", status: "Pago", net: "10,000000" }),
  ), "000123");
  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.paidRows, 1);
  assert.equal(parsed.openRows.length, 2);
  assert.deepEqual(parsed.byDueDate.map(value => value.date), ["2026-09-24", "2026-10-22"]);
  assert.equal(parsed.totalOpenMicros, BigInt(20_538_799));
  assert.equal(formatStoneReportMoney(parsed.totalOpenMicros), "R$ 20,54");
  assert.equal(formatStoneReportMoney(parsed.totalOpenMicros, 6), "R$ 20,538799");
});

test("Stone report fails closed on a different account, duplicate or unrecognized open row", () => {
  assert.throws(() => parseStoneReceivablesReportCsv(report(row(), row({ code: "456", id: "1002" })), "123"), /StoneCode diferente/);
  assert.throws(() => parseStoneReceivablesReportCsv(report(row(), row()), "123"), /duplicada/);
  assert.throws(() => parseStoneReceivablesReportCsv(report(row({ category: "Cobrança" })), "123"), /categoria não reconhecida/);
  assert.throws(() => parseStoneReceivablesReportCsv(report(row({ due: "31/09/2026" })), "123"), /Data de vencimento inválida/);
  assert.throws(() => parseStoneReceivablesReportCsv(report(row({ status: "Pendente" })), "123"), /Situação não reconhecida/);
});
