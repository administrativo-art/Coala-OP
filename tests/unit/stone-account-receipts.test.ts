import assert from "node:assert/strict";
import test from "node:test";
import { parseStoneAgendaXml } from "../../src/lib/integrations/stone/agenda-parser";
import { stoneAccountKind, stoneBrandName } from "../../src/lib/integrations/stone/stone-codes";
import {
  buildStoneAccountParcels,
  groupReceiptWeeks,
  cardSaleInstallments,
  receiptGroupKey,
  saleAuditChecks,
  saleAuditVerdict,
  stoneAccountRequestSchema,
  stoneDecimalCents,
  summarizeReceiptDays,
  summarizeReceiptGroups,
  usualRate,
  type SaleAudit,
} from "../../src/features/financial/receipts-reconciliation/stone-account";

const events = (values: Partial<Record<string, number>> = {}) => `<Events>${["Captures", "Payments", "Cancellations", "CancellationCharges", "Chargebacks", "ChargebackRefunds"]
  .map(name => `<${name}>${values[name] ?? 0}</${name}>`).join("")}</Events>`;

type Installment = { n: number; gross: string; net: string; mdr?: string; prevision?: string; payment?: string; original?: string; advance?: string; paymentId?: string };
function transaction(id: string, options: { capture?: string; brand?: string; account?: string; count?: number; captured?: string; events?: Partial<Record<string, number>>; installments: Installment[] }) {
  const installments = options.installments.map(row => `<Installment><InstallmentNumber>${row.n}</InstallmentNumber><GrossAmount>${row.gross}</GrossAmount><NetAmount>${row.net}</NetAmount>`
    + `${row.prevision ? `<PrevisionPaymentDate>${row.prevision}</PrevisionPaymentDate>` : ""}${row.payment ? `<PaymentDate>${row.payment}</PaymentDate>` : ""}`
    + `${row.original ? `<AdvancedReceivableOriginalPaymentDate>${row.original}</AdvancedReceivableOriginalPaymentDate>` : ""}${row.advance ? `<AdvanceRateAmount>${row.advance}</AdvanceRateAmount>` : ""}`
    + `${row.paymentId ? `<PaymentId>${row.paymentId}</PaymentId>` : ""}${row.mdr ? `<MdrAmount>${row.mdr}</MdrAmount>` : ""}</Installment>`).join("");
  return `<Transaction><AcquirerTransactionKey>${id}</AcquirerTransactionKey><CaptureLocalDateTime>${options.capture ?? "20261103101500"}</CaptureLocalDateTime>`
    + `<AccountType>${options.account ?? "2"}</AccountType><BrandId>${options.brand ?? "1"}</BrandId><NumberOfInstallments>${options.count ?? options.installments.length}</NumberOfInstallments>`
    + `<AuthorizationCurrencyCode>986</AuthorizationCurrencyCode><CapturedAmount>${options.captured ?? "100.00"}</CapturedAmount><CanceledAmount>0.00</CanceledAmount>`
    + `${events(options.events ?? { Captures: 1 })}<Installments>${installments}</Installments></Transaction>`;
}
const xml = (date: string, captures = "", payments = "") => `<Conciliation><Header><StoneCode>123</StoneCode><ReferenceDate>${date.replaceAll("-", "")}</ReferenceDate><LayoutVersion>2.2</LayoutVersion><FileId>file-${date}</FileId><GenerationDateTime>20261114051200</GenerationDateTime></Header><FinancialTransactions>${captures}</FinancialTransactions><FinancialTransactionsAccounts>${payments}</FinancialTransactionsAccounts></Conciliation>`;
const file = (date: string, captures = "", payments = "") => parseStoneAgendaXml(xml(date, captures, payments), { stoneCode: "123", referenceDate: date });

const period = { from: "2026-11-01", through: "2026-11-05", latestPublished: "2026-11-05" };

test("códigos oficiais da Stone: bandeira e tipo de conta; código desconhecido não é inventado", () => {
  assert.equal(stoneBrandName("171"), "Elo");
  assert.equal(stoneBrandName("0002"), "Mastercard");
  assert.equal(stoneBrandName("77"), "Bandeira código 77");
  assert.equal(stoneAccountKind("3"), "debit");
  assert.equal(stoneAccountKind("4"), "credit");
  assert.equal(stoneAccountKind("10"), "other");
});

test("decimal Stone vira centavos sem erro de ponto flutuante", () => {
  assert.equal(stoneDecimalCents("81.750000000000"), 8175);
  assert.equal(stoneDecimalCents("2.365"), 237);
  assert.equal(stoneDecimalCents("-1.005"), -101);
  assert.equal(stoneDecimalCents("abc"), null);
});

test("pedido aceita mês até 31 dias e auditoria de venda; rejeita campo extra", () => {
  assert.ok(stoneAccountRequestSchema.safeParse({ kioskId: "k", stoneCode: "123", from: "2026-11-01", through: "2026-11-30" }).success);
  assert.ok(!stoneAccountRequestSchema.safeParse({ kioskId: "k", stoneCode: "123", from: "2026-10-01", through: "2026-11-30" }).success);
  assert.ok(stoneAccountRequestSchema.safeParse({ view: "sale", kioskId: "k", stoneCode: "123", saleDate: "2026-11-03", source: "card", saleId: "abc" }).success);
  assert.ok(!stoneAccountRequestSchema.safeParse({ view: "sale", kioskId: "k", stoneCode: "123", saleDate: "2026-11-03", source: "card", saleId: "abc", accountId: "x" }).success);
});

function scenario() {
  const visaCredit = transaction("visa-credit", { brand: "1", account: "2", captured: "100.00",
    installments: [{ n: 1, gross: "100.00", net: "97.11", mdr: "2.89", prevision: "20261203" }] });
  const visaDebit = transaction("visa-debit", { brand: "1", account: "1", captured: "50.00",
    installments: [{ n: 1, gross: "50.00", net: "49.46", mdr: "0.545", prevision: "20261104" }] });
  const eloInstallment = transaction("elo-3x", { brand: "171", account: "2", count: 3, captured: "300.00", installments: [
    { n: 1, gross: "100.00", net: "95.66", mdr: "4.34", prevision: "20261203" },
    { n: 2, gross: "100.00", net: "95.66", mdr: "4.34", prevision: "20270102" },
    { n: 3, gross: "100.00", net: "95.66", mdr: "4.34", prevision: "20270201" }] });
  const debitPaid = transaction("visa-debit", { brand: "1", account: "1", events: { Payments: 1 },
    installments: [{ n: 1, gross: "50.00", net: "49.46", mdr: "0.545", prevision: "20261104", payment: "20261104", paymentId: "p-1" }] });
  const oldAnticipated = transaction("old-credit", { capture: "20261010090000", brand: "2", account: "2", events: { Payments: 1 },
    installments: [{ n: 1, gross: "80.00", net: "76.00", mdr: "2.31", advance: "1.69", original: "20261109", payment: "20261102", paymentId: "p-2" }] });
  const files = [
    file("2026-11-01"),
    file("2026-11-02", "", oldAnticipated),
    file("2026-11-03", visaCredit + visaDebit + eloInstallment),
    file("2026-11-04", "", debitPaid),
  ];
  const portfolio = [
    { transactionId: "old-debit", installment: 1, saleDate: "2026-10-31", dueDate: "2026-11-01", gross: "40.00", net: "39.56", status: "open" as const, paymentDate: null },
    { transactionId: "old-late", installment: 1, saleDate: "2026-10-04", dueDate: "2026-11-03", gross: "20.00", net: "19.42", status: "open" as const, paymentDate: null },
  ];
  const pix = [
    { eventId: "evt-1", e2eId: "E1", soldOn: "2026-11-03", settledOn: "2026-11-03", feeCents: 15, grossCents: 2000, soldAt: "2026-11-03T15:27:00Z" },
    { eventId: "evt-2", e2eId: "E2", soldOn: "2026-11-04", settledOn: "2026-11-04", feeCents: 30, grossCents: 4000, soldAt: "2026-11-04T17:00:00Z" },
  ];
  return buildStoneAccountParcels({ ...period, files, missingDates: ["2026-11-05"], portfolio, pix });
}

test("parcelas: pagamento na conta Stone, previsão da carteira, vendas do período e Pix", () => {
  const { parcels, conflictCount } = scenario();
  const byId = new Map(parcels.map(parcel => [parcel.id, parcel]));
  assert.equal(conflictCount, 0);
  assert.equal(byId.get("visa-debit:1")?.status, "paid");
  assert.equal(byId.get("visa-debit:1")?.paidNetCents, 4946);
  assert.equal(byId.get("visa-debit:1")?.brand, "Visa");
  assert.equal(byId.get("visa-debit:1")?.modality, "debit");
  const anticipated = byId.get("old-credit:1");
  assert.equal(anticipated?.status, "paid_early");
  assert.equal(anticipated?.expectedDate, "2026-11-09");
  assert.equal(anticipated?.expectedNetCents, 7769, "líquido previsto = pago + antecipação");
  assert.equal(byId.get("elo-3x:2")?.status, "to_receive");
  assert.equal(byId.get("elo-3x:2")?.modality, "installment");
  assert.equal(byId.get("old-debit:1")?.status, "unpaid", "previsto pela carteira e não pago");
  assert.equal(byId.get("old-debit:1")?.brand, null, "bandeira desconhecida não é inventada");
  assert.equal(byId.get("pix:evt-1")?.status, "paid");
  assert.equal(byId.get("pix:evt-1")?.paidNetCents, 1985);
});

test("dia a dia: previsto × pago com a diferença explicada; arquivo faltante não vira zero", () => {
  const { parcels } = scenario();
  const days = summarizeReceiptDays(parcels, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"], ["2026-11-05"]);
  const first = days[0];
  assert.equal(first.expectedCents, 3956);
  assert.equal(first.paidCents, 0);
  assert.deepEqual(first.reasons.map(reason => [reason.kind, reason.cents]), [["unpaid", -3956]]);
  const second = days[1];
  assert.equal(second.paidCents, 7600);
  assert.deepEqual(second.reasons.map(reason => [reason.kind, reason.cents]), [["early", 7600]]);
  const fourth = days[3];
  assert.equal(fourth.expectedCents, 4946 + 3970);
  assert.equal(fourth.differenceCents, 0);
  assert.deepEqual(fourth.reasons, []);
  assert.equal(days[4].missingFile, true);
  assert.equal(days[4].paidCents, null);
});

test("por cartão: bandeira × modalidade, parcelado por nº de parcelas, taxa praticada e taxa habitual", () => {
  const { parcels } = scenario();
  const groups = summarizeReceiptGroups(parcels, period.from, period.through, period.latestPublished);
  const keys = groups.map(group => group.key);
  assert.deepEqual(keys, ["pix", "Elo|installment", "Elo|installment|3", "Visa|debit", "Visa|credit"]);
  const credit = groups.find(group => group.key === "Visa|credit")!;
  assert.equal(credit.grossCents, 10000);
  assert.equal(credit.feeCents, 289);
  assert.equal(credit.rate, 0.0289);
  assert.equal(credit.toReceiveCents, 9711);
  const installment = groups.find(group => group.key === "Elo|installment|3")!;
  assert.equal(installment.saleCount, 1);
  assert.equal(installment.parentKey, "Elo|installment");
  const pix = groups.find(group => group.key === "pix")!;
  assert.equal(pix.rate, 45 / 6000);
  assert.equal(groups.some(group => group.parcelIds.includes("old-credit:1")), false, "venda de outro mês fica fora do resumo por cartão");
  assert.equal(receiptGroupKey(parcels.find(parcel => parcel.id === "elo-3x:1")!), "Elo|installment|3");
});

test("taxa habitual: mais frequente, empate pela menor", () => {
  assert.equal(usualRate([0.0289, 0.0289, 0.0319]), 0.0289);
  assert.equal(usualRate([0.0319, 0.0289]), 0.0289);
  assert.equal(usualRate([]), null);
});

function audit(overrides: Partial<SaleAudit> = {}): SaleAudit {
  const origin = file("2026-11-03", transaction("visa-credit", { brand: "2", account: "2", captured: "81.75",
    installments: [{ n: 1, gross: "81.75", net: "79.39", mdr: "2.36", prevision: "20261203" }] })).transactions[0];
  const payment = file("2026-12-03", "", transaction("visa-credit", { brand: "2", account: "2", events: { Payments: 1 },
    installments: [{ n: 1, gross: "81.75", net: "79.39", mdr: "2.36", prevision: "20261203", payment: "20261203", paymentId: "108" }] }));
  return {
    source: "card", saleId: "visa-credit", saleDate: "2026-11-03", kioskId: "k", stoneCode: "123",
    stone: { transactionId: "visa-credit", e2eId: null, eventId: null, captureLocalDateTime: "20261103101500", saleTime: "10:15:00",
      authorizationDateTimeUtc: null, brandCode: "2", brand: "Mastercard", accountTypeCode: "2", feeTypeCode: null, modality: "credit",
      installmentCount: 1, capturedCents: 8175, canceledCents: 0, events: { Captures: 1 }, originFile: null },
    installments: cardSaleInstallments({ origin, payments: [{ file: payment, transaction: payment.transactions[0], installment: payment.transactions[0].installments[0] }],
      portfolio: [], latestPublished: "2026-12-05", missingDates: [] }),
    pdv: { review: "recorded", reviewStatus: "closed", caseKind: "matched", matchBasis: "provider_transaction_id", confidence: "high",
      coupons: [{ couponId: "48242", soldAt: "2026-11-03T10:15:03-03:00", channel: "credit_card", grossCents: 8175, status: "pending", nsu: "323868", authorizationCode: "978008", terminalId: null, merchantOrderId: null }] },
    ...overrides,
  };
}

test("auditoria: 12 cruzamentos conferem numa venda limpa", () => {
  const checks = saleAuditChecks(audit(), 0.0289);
  assert.equal(checks.length, 12);
  assert.deepEqual(checks.filter(check => check.result !== "ok").map(check => check.title), []);
  assert.equal(saleAuditVerdict(checks).label, "Conferida");
});

test("auditoria: sem cupom, valor diferente, taxa fora do grupo e dia não fechado", () => {
  const noCoupon = saleAuditChecks(audit({ pdv: { ...audit().pdv, caseKind: "stone_only", matchBasis: "unmatched", confidence: "none", coupons: [] } }), 0.0289);
  assert.equal(noCoupon[0].result, "bad");
  assert.equal(saleAuditVerdict(noCoupon).label, "Com divergência");

  const base = audit();
  const amount = saleAuditChecks(audit({ pdv: { ...base.pdv, caseKind: "amount_mismatch", coupons: [{ ...base.pdv.coupons[0], grossCents: 8675 }] } }), 0.0289);
  assert.equal(amount[2].result, "bad");
  assert.match(amount[2].note ?? "", /Diferença/);

  const fee = saleAuditChecks(audit(), 0.0259);
  assert.equal(fee[8].result, "warn");
  assert.match(fee[8].note ?? "", /não dá para afirmar cobrança a maior/);

  const notRecorded = saleAuditChecks(audit({ pdv: { review: "not_recorded", reviewStatus: null, caseKind: null, matchBasis: null, confidence: null, coupons: [] } }), 0.0289);
  assert.equal(notRecorded[0].result, "wait");
  assert.equal(saleAuditVerdict(notRecorded).label, "Em andamento");
});

test("auditoria: chargeback e líquido incoerente aparecem como divergência", () => {
  const base = audit();
  const chargeback = saleAuditChecks(audit({ stone: { ...base.stone, events: { Captures: 1, Chargebacks: 1 } } }), 0.0289);
  assert.equal(chargeback[5].result, "bad");
  const net = saleAuditChecks(audit({ installments: [{ ...base.installments[0], netCents: 7000 }] }), 0.0289);
  assert.equal(net[9].result, "bad");
});

test("semanas de segunda a domingo; dia sem arquivo não entra na diferença", () => {
  const { parcels } = scenario();
  const dates = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
  const weeks = groupReceiptWeeks(summarizeReceiptDays(parcels, dates, ["2026-11-05"]));
  assert.deepEqual(weeks.map(week => [week.index, week.from, week.through]), [[1, "2026-11-01", "2026-11-01"], [2, "2026-11-02", "2026-11-05"]]);
  assert.equal(weeks[0].differenceCents, -3956);
  assert.equal(weeks[0].daysWithDifference, 1);
  assert.equal(weeks[1].daysMissingFile, 1);
  assert.equal(weeks[1].paidCents, 7600 + 4946 + 3970 + 1985, "pagos dos dias com arquivo");
});
