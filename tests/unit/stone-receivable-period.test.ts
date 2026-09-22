import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseStoneAgendaXml } from "../../src/lib/integrations/stone/agenda-parser";
import { AppError } from "../../src/lib/observability/app-error";
import { latestPublishedDate, queryReceivablePeriod, receivablePeriodSchema, reviewReceivablePeriod } from "../../src/features/financial/receivables/period-review";

const input = { kioskId: "unit", stoneCode: "123", from: "2026-09-20", through: "2026-09-21" };
const mapping = { id: "m", workspaceId: "coala", kioskId: "unit", accountId: "account", stoneCodes: ["123"], terminalIds: [], status: "active" as const, validFrom: "2026-09-20", validTo: null };
const context = { isDefaultAdmin: true, workspace_id: "coala" };
const now = new Date("2026-09-22T12:00:00Z");
function row(id = "sale", payment = false, extra = "") {
  return `<Transaction><AcquirerTransactionKey>${id}</AcquirerTransactionKey><CaptureLocalDateTime>20260920120000</CaptureLocalDateTime><AuthorizationCurrencyCode>986</AuthorizationCurrencyCode><Events><Captures>${payment ? 0 : 1}</Captures><Payments>${payment ? 1 : 0}</Payments><Cancellations>0</Cancellations><CancellationCharges>0</CancellationCharges><Chargebacks>0</Chargebacks><ChargebackRefunds>0</ChargebackRefunds></Events><Installments><Installment><InstallmentNumber>1</InstallmentNumber><GrossAmount>10.00</GrossAmount><NetAmount>${payment ? "9.50" : "9.800001"}</NetAmount>${payment ? '<PaymentId>p1</PaymentId><PaymentDate>20260921</PaymentDate><AdvancedReceivableOriginalPaymentDate>20261020</AdvancedReceivableOriginalPaymentDate>' : '<PrevisionPaymentDate>20261020</PrevisionPaymentDate>'}${extra}</Installment></Installments></Transaction>`;
}
const xml = (date: string, captures = "", payments = "") => `<Conciliation><Header><StoneCode>123</StoneCode><ReferenceDate>${date.replaceAll("-", "")}</ReferenceDate><LayoutVersion>2.2</LayoutVersion><FileId>file-${date}</FileId><GenerationDateTime>20260922060000</GenerationDateTime></Header><FinancialTransactions>${captures}</FinancialTransactions><FinancialTransactionsAccounts>${payments}</FinancialTransactionsAccounts></Conciliation>`;
const file = (date: string, captures = "", payments = "") => parseStoneAgendaXml(xml(date, captures, payments), { stoneCode: "123", referenceDate: date });
const sourceFiles = () => [file(input.from, row("paid") + row("future")), file(input.through, "", row("paid", true))];

test("antecipadas saem da previsão sem deduzir taxas novamente nem confirmar banco", () => {
  const result = reviewReceivablePeriod(input, sourceFiles());
  assert.equal(result.summary.projectedNet, "9.800001000000");
  assert.equal(result.summary.paidEarlyCount, 1);
  assert.equal(result.rows.find(r => r.transactionId === "paid")?.status, "paid_early");
  assert.equal(result.bankReceiptConfirmed, false);
  assert.equal(result.portfolioBalanceConfirmed, false);
  assert.equal(result.availableBalance, null);
  assert.equal(result.writesPerformed, false);
});
test("arquivos duplicados idênticos não duplicam parcelas e revisões conflitantes bloqueiam", () => {
  const files = sourceFiles();
  assert.equal(reviewReceivablePeriod(input, [...files, files[0]]).rows.length, 2);
  assert.throws(() => reviewReceivablePeriod(input, [...files, file(input.from, row("different"))]), { code: "STONE_PERIOD_REVISION_CONFLICT" });
});
test("data/código fora do recorte bloqueiam antes de somar", () => {
  assert.throws(() => reviewReceivablePeriod(input, [file("2026-09-19")]), { code: "STONE_PERIOD_SCOPE" });
  assert.throws(() => reviewReceivablePeriod(input, [{ ...sourceFiles()[0], stoneCode: "999" }]), { code: "STONE_PERIOD_SCOPE" });
});
test("arquivo faltante não vira zero nem permite total futuro", () => {
  const result = reviewReceivablePeriod(input, [sourceFiles()[0]]);
  assert.deepEqual(result.missingDates, [input.through]);
  assert.equal(result.summary.projectedNet, null);
  assert.equal(result.summary.pendingCount, 2);
});
test("arquivo vazio não prova ausência de carteira", () => {
  const result = reviewReceivablePeriod(input, [file(input.from), file(input.through)]);
  assert.equal(result.summary.projectedNet, null);
  assert.equal(result.rows.length, 0);
});
test("parcial, pagamento duplicado e cancelamento ficam pendentes, nunca somam como futuro", () => {
  for (const changed of [
    row("paid", true).replace("<GrossAmount>10.00", "<GrossAmount>5.00"),
    row("paid", true).replace("<Cancellations>0", "<Cancellations>1"),
    row("paid", true).replace("<PaymentId>p1</PaymentId>", ""),
    row("paid", true).replace("20261020", "20261019"),
  ]) {
    const result = reviewReceivablePeriod(input, [file(input.from, row("paid")), file(input.through, "", changed)]);
    assert.equal(result.summary.pendingCount, 1);
    assert.equal(result.summary.projectedNet, null);
  }
  const duplicate = file(input.through, "", row("paid", true));
  duplicate.transactions.push(structuredClone(duplicate.transactions[0]));
  assert.equal(reviewReceivablePeriod(input, [file(input.from, row("paid")), duplicate]).summary.pendingCount, 1);
});
test("pagamentos sem captura no recorte não alteram o total das vendas selecionadas", () => {
  const result = reviewReceivablePeriod(input, [file(input.from, row()), file(input.through, "", row("outside", true))]);
  assert.equal(result.summary.paymentsOutsideCaptureCohort, 1);
  assert.equal(result.summary.projectedNet, "9.800001000000");
});
test("vencidas são separadas da previsão futura e pagamentos no prazo também são excluídos", () => {
  const capture = row().replace("20261020", "20260921");
  assert.equal(reviewReceivablePeriod(input, [file(input.from, capture), file(input.through)]).summary.overdueUnconfirmedCount, 1);
  const result = reviewReceivablePeriod(input, [file(input.from, capture), file(input.through, "", row("sale", true).replace("20261020", "20260921"))]);
  assert.equal(result.summary.paidCount, 1);
  assert.equal(result.summary.projectedNet, "0.000000000000");
});
test("captura sem parcelas ou moeda ausente impede total aparentemente completo", () => {
  const capture = file(input.from, row());
  capture.transactions[0].installments = [];
  assert.equal(reviewReceivablePeriod(input, [capture, file(input.through)]).summary.unsupportedCaptureCount, 1);
  const missingCurrency = file(input.from, row().replace("<AuthorizationCurrencyCode>986</AuthorizationCurrencyCode>", ""));
  assert.equal(reviewReceivablePeriod(input, [missingCurrency, file(input.through)]).summary.pendingCount, 1);
});
test("quantidade e bruto das parcelas precisam fechar com a captura quando informados", () => {
  for (const field of ["<NumberOfInstallments>2</NumberOfInstallments>", "<CapturedAmount>20</CapturedAmount>"]) {
    const capture = file(input.from, row().replace("<Events>", `${field}<Events>`));
    assert.equal(reviewReceivablePeriod(input, [capture, file(input.through)]).summary.pendingCount, 1);
  }
});
test("sinal de pagamento sem detalhamento nunca mantém a parcela na previsão", () => {
  const payment = file(input.through, "", row("sale", true));
  payment.transactions[0].installments = [];
  assert.equal(reviewReceivablePeriod(input, [file(input.from, row()), payment]).summary.pendingCount, 1);
  const signalOnly = file(input.through, row("sale", true));
  assert.equal(reviewReceivablePeriod(input, [file(input.from, row()), signalOnly]).summary.pendingCount, 1);
});
test("31 dias e janela de publicação são explícitos", () => {
  assert.equal(receivablePeriodSchema.safeParse({ ...input, from: "2026-08-21" }).success, false);
  assert.equal(receivablePeriodSchema.safeParse({ ...input, from: "2026-08-22" }).success, true);
  assert.equal(latestPublishedDate(new Date("2026-09-22T07:59:59Z")), "2026-09-20");
  assert.equal(latestPublishedDate(new Date("2026-09-22T08:00:00Z")), "2026-09-21");
});
test("limite de parcelas rejeita o recorte inteiro em vez de truncar o saldo", () => {
  const capture = file(input.from, row());
  const transaction = capture.transactions[0];
  capture.transactions = Array.from({ length: 5_001 }, (_, index) => ({ ...transaction, transactionId: `sale-${index}` }));
  assert.throws(() => reviewReceivablePeriod(input, [capture, file(input.through)]), { code: "STONE_PERIOD_LIMIT" });
});
test("autorização, período inválido e publicação futura bloqueiam antes das dependências", async () => {
  const never = async (): Promise<never> => { assert.fail("No external call expected"); };
  const deps = { resolveMapping: never, read: never, now };
  await assert.rejects(queryReceivablePeriod(input, { ...context, isDefaultAdmin: false }, deps), { code: "STONE_PERIOD_FORBIDDEN" });
  await assert.rejects(queryReceivablePeriod({ ...input, from: "2026-02-30" }, context, deps), { code: "STONE_PERIOD_INPUT" });
  await assert.rejects(queryReceivablePeriod({ ...input, through: "2026-09-22" }, context, deps), { code: "STONE_PERIOD_NOT_PUBLISHED" });
});
test("vínculo precisa cobrir todo o período e não pode mudar unidade/conta silenciosamente", async () => {
  let reads = 0;
  const deps = { now, resolveMapping: async () => ({ ...mapping, validFrom: input.through }), read: async () => { reads++; return ""; } };
  await assert.rejects(queryReceivablePeriod(input, context, deps), { code: "STONE_PERIOD_MAPPING_RANGE" });
  await assert.rejects(queryReceivablePeriod(input, context, { ...deps, resolveMapping: async () => ({ ...mapping, kioskId: "other" }) }), { code: "FINANCIAL_AGENT_MAPPING_REQUIRED" });
  assert.equal(reads, 0);
});
test("consulta sequencial lê só datas solicitadas, retorna evidências e lacunas transitórias", async () => {
  const calls: string[] = [];
  const result = await queryReceivablePeriod(input, context, { now, resolveMapping: async () => mapping,
    read: async q => { calls.push(q.referenceDate); return xml(q.referenceDate, q.referenceDate === input.from ? row() : ""); } });
  assert.deepEqual(calls, [input.from, input.through]);
  assert.equal(result.scope.accountId, "account");
  assert.equal(result.summary.projectedNet, "9.800001000000");
  const missing = await queryReceivablePeriod(input, context, { now, resolveMapping: async () => mapping,
    read: async q => { if (q.referenceDate === input.through) throw new AppError({ code: "STONE_AGENDA_UNAVAILABLE", kind: "TRANSIENT_EXTERNAL" }); return xml(q.referenceDate, row()); } });
  assert.equal(missing.summary.projectedNet, null);
  await assert.rejects(queryReceivablePeriod(input, context, { now, resolveMapping: async () => mapping,
    read: async () => { throw new AppError({ code: "STONE_AGENDA_CREDENTIAL_REJECTED", kind: "PERMANENT_EXTERNAL" }); } }), { code: "STONE_AGENDA_CREDENTIAL_REJECTED" });
  await assert.rejects(queryReceivablePeriod(input, context, { now, resolveMapping: async () => mapping,
    read: async () => { throw new AppError({ code: "STONE_AGENDA_UPSTREAM_REJECTED", kind: "PERMANENT_EXTERNAL" }); } }), { code: "STONE_AGENDA_UPSTREAM_REJECTED" });
});
test("tela usa transporte autenticado, escopo revalidado, sem polling ou escrita financeira", () => {
  const source = readFileSync(new URL("../../src/app/dashboard/financial/cash-flow/receivables/page.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!isDefaultAdmin\)/);
  assert.match(source, /useAuthenticatedApi/);
  assert.match(source, /data\.scope\.mappingId !== mapping\.id/);
  assert.match(source, /PageContainer variant="wide"/);
  assert.doesNotMatch(source, /setInterval|onSnapshot|addDoc|updateDoc/);
});
