import assert from "node:assert/strict";
import test from "node:test";
import { parseStoneAgendaXml } from "../../src/lib/integrations/stone/agenda-parser";
import { projectStonePortfolio } from "../../src/features/financial/receivables/portfolio-projection";

const scope = { stoneCode: "113654392", firstCaptureDate: "2026-09-01", asOf: "2026-09-03" };
const events = (captures: number, payments: number) => `<Events><Captures>${captures}</Captures><Payments>${payments}</Payments><Cancellations>0</Cancellations><CancellationCharges>0</CancellationCharges><Chargebacks>0</Chargebacks><ChargebackRefunds>0</ChargebackRefunds></Events>`;
const capture = (id: string, due: string, net = "9.800001") => `<Transaction><AcquirerTransactionKey>${id}</AcquirerTransactionKey><CaptureLocalDateTime>20260901120000</CaptureLocalDateTime>${events(1, 0)}<Installments><Installment><InstallmentNumber>1</InstallmentNumber><GrossAmount>10.00</GrossAmount><NetAmount>${net}</NetAmount><PrevisionPaymentDate>${due}</PrevisionPaymentDate></Installment></Installments></Transaction>`;
const payment = (id: string) => `<Transaction><AcquirerTransactionKey>${id}</AcquirerTransactionKey>${events(0, 1)}<Installments><Installment><InstallmentNumber>1</InstallmentNumber><GrossAmount>10.00</GrossAmount><NetAmount>9.10</NetAmount><PaymentDate>20260902</PaymentDate><PaymentId>p1</PaymentId></Installment></Installments></Transaction>`;
function file(day: string, captured = "", paid = "") {
  const xml = `<Conciliation><Header><StoneCode>113654392</StoneCode><ReferenceDate>${day.replaceAll("-", "")}</ReferenceDate><LayoutVersion>2.2</LayoutVersion><FileId>${day}</FileId><GenerationDateTime>20260904060000</GenerationDateTime></Header><FinancialTransactions>${captured}</FinancialTransactions><FinancialTransactionsAccounts>${paid}</FinancialTransactionsAccounts></Conciliation>`;
  return parseStoneAgendaXml(xml, { stoneCode: scope.stoneCode, referenceDate: day });
}

test("reconstrói a carteira aberta a partir de capturas e tira parcelas pagas", () => {
  const result = projectStonePortfolio(scope, [
    file("2026-09-01", capture("paid", "20261001") + capture("open", "20261003")),
    file("2026-09-02", "", payment("paid")), file("2026-09-03"),
  ]);
  assert.equal(result.summary.openCount, 1);
  assert.equal(result.summary.openNet, "9.800001000000");
  assert.equal(result.summary.paidCount, 1);
  assert.equal(result.rows.find(row => row.transactionId === "paid")?.status, "paid");
  assert.equal(result.bankReceiptConfirmed, false);
});

test("lacuna diária e ocorrência ambígua impedem publicar total como completo", () => {
  const missing = projectStonePortfolio(scope, [file("2026-09-01", capture("open", "20261003")), file("2026-09-03")]);
  assert.deepEqual(missing.missingDates, ["2026-09-02"]);
  assert.equal(missing.summary.openNet, null);
  const changed = file("2026-09-02", "", payment("open").replace("<Cancellations>0", "<Cancellations>1"));
  const review = projectStonePortfolio(scope, [file("2026-09-01", capture("open", "20261003")), changed, file("2026-09-03")]);
  assert.equal(review.summary.reviewCount, 1);
  assert.equal(review.summary.openNet, null);
});

test("pagamento parcial ou sem parcela não desaparece silenciosamente da carteira", () => {
  const origin = file("2026-09-01", capture("open", "20261003"));
  const partial = file("2026-09-02", "", payment("open").replace("<GrossAmount>10.00", "<GrossAmount>5.00"));
  const first = projectStonePortfolio(scope, [origin, partial, file("2026-09-03")]);
  assert.equal(first.summary.reviewCount, 1);
  assert.equal(first.summary.openNet, null);
  const noDetail = file("2026-09-02", "", payment("open").replace(/<Installments>.*<\/Installments>/, ""));
  const second = projectStonePortfolio(scope, [origin, noDetail, file("2026-09-03")]);
  assert.equal(second.summary.reviewCount, 1);
  assert.equal(second.summary.openNet, null);
});

test("arquivo de outro StoneCode e revisão conflitante são rejeitados", () => {
  const first = file("2026-09-01", capture("open", "20261003"));
  assert.throws(() => projectStonePortfolio(scope, [{ ...first, stoneCode: "999" }]), { code: "STONE_PORTFOLIO_SCOPE" });
  const revised = { ...first, fileId: "revision" };
  assert.throws(() => projectStonePortfolio(scope, [first, revised]), { code: "STONE_PORTFOLIO_REVISION_CONFLICT" });
});
