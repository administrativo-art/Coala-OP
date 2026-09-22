import assert from "node:assert/strict";
import test from "node:test";
import { parseStoneAgendaXml } from "../../src/lib/integrations/stone/agenda-parser";
import { queryStoneAgenda } from "../../src/lib/integrations/stone/agenda-query";

const scope = { stoneCode: "123456789", referenceDate: "2026-09-20" };
const events = `<Events><Captures>1</Captures><Payments>0</Payments><Cancellations>0</Cancellations><CancellationCharges>0</CancellationCharges><Chargebacks>0</Chargebacks><ChargebackRefunds>0</ChargebackRefunds></Events>`;
const sale = (id = "000123") => `<Transaction>${events}<AcquirerTransactionKey>${id}</AcquirerTransactionKey><CaptureLocalDateTime>20260920102235</CaptureLocalDateTime><AccountType>1</AccountType><BrandId>2</BrandId><NumberOfInstallments>1</NumberOfInstallments><CapturedAmount>6.000000</CapturedAmount><AuthorizationCurrencyCode>986</AuthorizationCurrencyCode><CardNumber>private-card</CardNumber><Installments><Installment><InstallmentNumber>1</InstallmentNumber><GrossAmount>6.000000</GrossAmount><NetAmount>5.853600</NetAmount><PrevisionPaymentDate>20261020</PrevisionPaymentDate></Installment></Installments></Transaction>`;
const file = (sales = sale(), payments = "") => `<Conciliation><Header><StoneCode>123456789</StoneCode><ReferenceDate>20260920</ReferenceDate><LayoutVersion>2.2</LayoutVersion><FileId>0001</FileId><GenerationDateTime>20260921050001</GenerationDateTime></Header><FinancialTransactions>${sales}</FinancialTransactions><FinancialTransactionsAccounts>${payments}</FinancialTransactionsAccounts><Payments><Payment><FavoredBankAccount>private-bank</FavoredBankAccount></Payment></Payments></Conciliation>`;

test("agenda preserves provider precision and leading-zero identifiers, not Pix cent units", () => {
  const result = parseStoneAgendaXml(file(), scope);
  assert.equal(result.fileId, "0001");
  assert.equal(result.transactions[0].transactionId, "000123");
  assert.equal(result.transactions[0].capturedAmount, "6.000000");
  assert.equal(result.transactions[0].installments[0].netAmount, "5.853600");
  assert.equal(result.transactions[0].installments[0].expectedPaymentDate, "2026-10-20");
  assert.equal(result.transactions[0].installments[0].paymentDate, null);
  assert.equal(result.transactions[0].installments[0].mdrAmount, null);
  assert.equal(result.bankReceiptConfirmed, false);
  assert.doesNotMatch(JSON.stringify(result), /private-card|private-bank|CardNumber|FavoredBankAccount/);
});

test("agenda separates scheduled events from provider payment events without bank confirmation", () => {
  const payment = sale().replace("<Captures>1</Captures><Payments>0", "<Captures>0</Captures><Payments>1")
    .replaceAll("PrevisionPaymentDate", "PaymentDate");
  const result = parseStoneAgendaXml(file(sale(), payment), scope);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[1].sourceSection, "FinancialTransactionsAccounts");
  assert.equal(result.transactions[1].installments[0].paymentDate, "2026-10-20");
  assert.equal(result.transactions[1].installments[0].expectedPaymentDate, null);
  assert.equal(result.bankReceiptConfirmed, false);
});

test("agenda refuses another merchant/date, malformed XML, missing sections and duplicate nodes", () => {
  assert.throws(() => parseStoneAgendaXml(file(), { ...scope, stoneCode: "999" }), { code: "STONE_AGENDA_SCOPE_MISMATCH" });
  assert.throws(() => parseStoneAgendaXml(file(), { ...scope, referenceDate: "2026-09-19" }), { code: "STONE_AGENDA_SCOPE_MISMATCH" });
  for (const xml of [
    "<Conciliation>", "<html>unavailable</html>",
    file().replace("<FinancialTransactionsAccounts></FinancialTransactionsAccounts>", ""),
    file().replace("<NetAmount>5.853600</NetAmount>", ""),
    file().replace("5.853600", "NaN"),
    file().replace("20261020", "20260230"),
    file().replace("<LayoutVersion>2.2", "<LayoutVersion>2.4"),
    file().replace("<NetAmount>5.853600</NetAmount>", "<NetAmount>5</NetAmount><NetAmount>6</NetAmount>"),
    file(sale() + sale()),
    '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' + file(),
  ]) assert.throws(() => parseStoneAgendaXml(xml, scope), { code: "STONE_AGENDA_INVALID_FILE" });
});

test("agenda accepts explicit empty sections but never malformed input as zero", () => {
  assert.equal(parseStoneAgendaXml(file(""), scope).transactions.length, 0);
  assert.throws(() => parseStoneAgendaXml("", scope));
  assert.throws(() => parseStoneAgendaXml(file().replace("<FinancialTransactions>", "<FinancialTransactions>invalid"), scope));
});

test("agenda query blocks non-admin before provider and validates parameters", async () => {
  const never = async () => { assert.fail("Provider must not be called"); };
  await assert.rejects(queryStoneAgenda(scope, { isDefaultAdmin: false }, never), { code: "STONE_AGENDA_FORBIDDEN" });
  for (const input of [{...scope, referenceDate: "2026-02-29"}, {...scope, stoneCode: "../secret"},
    {...scope, limit: 201}, {...scope, offset: -1}]) {
    await assert.rejects(queryStoneAgenda(input, { isDefaultAdmin: true }, never), { code: "STONE_AGENDA_QUERY_INVALID" });
  }
});

test("agenda query supports bounded pagination and exact transaction filter", async () => {
  const read = async () => file(sale("first") + sale("second"));
  const page = await queryStoneAgenda({ ...scope, limit: 1 }, { isDefaultAdmin: true }, read);
  assert.equal(page.totalTransactionsInFile, 2);
  assert.equal(page.transactions.length, 1);
  assert.equal(page.nextOffset, 1);
  const filtered = await queryStoneAgenda({ ...scope, transactionId: "second" }, { isDefaultAdmin: true }, read);
  assert.equal(filtered.transactions[0].transactionId, "second");
  assert.equal(filtered.matchedTransactions, 1);
  assert.equal(filtered.nextOffset, null);
});
