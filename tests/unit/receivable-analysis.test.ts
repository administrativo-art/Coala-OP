import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseStoneAgendaXml } from "../../src/lib/integrations/stone/agenda-parser";
import { reviewReceivablePeriod, type ReceivablePeriodResult } from "../../src/features/financial/receivables/period-review";
import { receivableAnswer, receivableQuestions, receivableRowMatches, type ReceivableQuestion } from "../../src/features/financial/receivables/analysis";
import { navigationActiveHref } from "../../src/lib/navigation-active-href";

const period = { kioskId: "unit", stoneCode: "123", from: "2026-09-20", through: "2026-09-21" };
function transaction(id: string, due = "20261020", paid = false, cancelled = false) {
  return `<Transaction><AcquirerTransactionKey>${id}</AcquirerTransactionKey><CaptureLocalDateTime>20260920120000</CaptureLocalDateTime><AuthorizationCurrencyCode>986</AuthorizationCurrencyCode><Events><Captures>${paid ? 0 : 1}</Captures><Payments>${paid ? 1 : 0}</Payments><Cancellations>${cancelled ? 1 : 0}</Cancellations><CancellationCharges>0</CancellationCharges><Chargebacks>0</Chargebacks><ChargebackRefunds>0</ChargebackRefunds></Events><Installments><Installment><InstallmentNumber>1</InstallmentNumber><GrossAmount>2</GrossAmount><NetAmount>1.005</NetAmount><MdrAmount>0.995</MdrAmount>${paid ? `<PaymentId>payment-${id}</PaymentId><PaymentDate>20260921</PaymentDate><AdvancedReceivableOriginalPaymentDate>${due}</AdvancedReceivableOriginalPaymentDate>` : `<PrevisionPaymentDate>${due}</PrevisionPaymentDate>`}</Installment></Installments></Transaction>`;
}
function file(date: string, captures = "", payments = "") {
  return parseStoneAgendaXml(`<Conciliation><Header><StoneCode>123</StoneCode><ReferenceDate>${date.replaceAll("-", "")}</ReferenceDate><LayoutVersion>2.2</LayoutVersion><FileId>file-${date}</FileId><GenerationDateTime>20260922060000</GenerationDateTime></Header><FinancialTransactions>${captures}</FinancialTransactions><FinancialTransactionsAccounts>${payments}</FinancialTransactionsAccounts></Conciliation>`, { stoneCode: "123", referenceDate: date });
}
function result(captures = "", payments = "", missing = false): ReceivablePeriodResult {
  return { ...reviewReceivablePeriod(period, [file(period.from, captures), ...missing ? [] : [file(period.through, "", payments)]]),
    collectedAt: "2026-09-22T12:00:00Z", scope: { kioskId: "unit", stoneCode: "123", mappingId: "mapping", accountId: "account" } };
}

test("análise usa o total exato do recorte, exclui pagas e não subtrai MDR novamente", () => {
  const data = result(transaction("first") + transaction("second") + transaction("paid"), transaction("paid", "20261020", true));
  const response = receivableAnswer(data, "future");
  assert.match(response.answer, /R\$ 2,01, em 2 parcela/);
  assert.match(response.answer, /não desconte o MDR novamente/);
  assert.deepEqual(data.rows.filter(row => receivableRowMatches(row, response.filter)).map(row => row.transactionId), ["first", "second"]);
});

test("zero projetado após pagamento integral é distinto de arquivo vazio", () => {
  const paid = receivableAnswer(result(transaction("paid"), transaction("paid", "20261020", true)), "future");
  assert.match(paid.answer, /R\$ 0,00/);
  const empty = receivableAnswer(result(), "future");
  assert.match(empty.answer, /não foi apurada/);
  assert.doesNotMatch(empty.answer, /R\$/);
  assert.match(empty.answer, /Não interprete isso como saldo zero/);
});

test("pendência ou arquivo faltante bloqueia total do agente mesmo com outras parcelas", () => {
  for (const data of [result(transaction("ok") + transaction("cancelled", "20261020", false, true)), result(transaction("ok"), "", true)]) {
    const response = receivableAnswer(data, "future");
    assert.match(response.answer, /não foi apurada/);
    assert.doesNotMatch(response.answer, /R\$/);
    assert.equal(response.filter, "all");
  }
});

test("vencimentos só consideram parcelas futuras elegíveis e avisam cobertura parcial", () => {
  const data = result(transaction("later", "20261201") + transaction("earlier", "20261001") + transaction("paid", "20261101") + transaction("overdue", "20260921"), transaction("paid", "20261101", true));
  const response = receivableAnswer(data, "dates");
  assert.match(response.answer, /2 parcela\(s\).*01\/10\/2026 a 01\/12\/2026/);
  assert.match(response.answer, /pagamentos posteriores a esse dia não foram consultados/);
  const partial = result(transaction("ok") + transaction("cancelled", "20261020", false, true));
  assert.match(receivableAnswer(partial, "dates").answer, /total permanece não apurado/);
  assert.match(receivableAnswer(result(), "dates").answer, /não comprova ausência/);
});

test("evidência dos pagamentos exclui parcelas incompatíveis e pagamentos fora da captura", () => {
  const data = result(transaction("early") + transaction("normal", "20260921") + transaction("partial"),
    transaction("early", "20261020", true) + transaction("normal", "20260921", true) +
    transaction("partial", "20261020", true).replace("<GrossAmount>2", "<GrossAmount>1") + transaction("outside", "20261020", true));
  const response = receivableAnswer(data, "excluded");
  assert.match(response.answer, /1 parcela\(s\) paga\(s\) antes.*1 outro\(s\) pagamento/);
  assert.match(response.answer, /1 parcela\(s\) de pagamento sem captura/);
  assert.deepEqual(data.rows.filter(row => receivableRowMatches(row, response.filter)).map(row => row.transactionId).sort(), ["early", "normal"]);
});

test("conferência reúne vencidas e pendentes, sem perder lacunas que não têm linha", () => {
  const data = result(transaction("overdue", "20260921") + transaction("cancelled", "20261020", false, true) + transaction("future"));
  const response = receivableAnswer(data, "pending");
  assert.match(response.answer, /1 parcela\(s\) pendente\(s\), 1 vencida/);
  assert.deepEqual(data.rows.filter(row => receivableRowMatches(row, response.filter)).map(row => row.transactionId).sort(), ["cancelled", "overdue"]);
  assert.match(receivableAnswer(result(transaction("sale"), "", true), "pending").answer, /1 arquivo\(s\) indisponível/);
});

test("todas as perguntas preservam data de corte, limites e evidência original", () => {
  const data = result(transaction("one"));
  const original = structuredClone(data);
  for (const question of Object.keys(receivableQuestions) as ReceivableQuestion[]) {
    const response = receivableAnswer(data, question);
    assert.match(response.answer, /20\/09\/2026 a 21\/09\/2026/);
    assert.match(response.answer, /eventos conferidos até 21\/09\/2026/);
    assert.match(response.answer, /Não representa a carteira completa nem saldo disponível/);
    assert.match(response.answer, /não confirma crédito bancário/);
  }
  assert.deepEqual(data, original);
});

test("recebíveis e agente preservam destinos, proteção e uma única consulta compartilhada", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const root = "/dashboard/financial/cash-flow";
  assert.equal(navigationActiveHref([root, `${root}/receivables`, `${root}/agent`], `${root}/agent`, "topic=receivables"), `${root}/agent`);
  assert.equal(navigationActiveHref([root, `${root}/receivables`, `${root}/agent`], `${root}/receivables`, ""), `${root}/receivables`);
  assert.match(read("src/components/sidebar.tsx"), /label: "Recebíveis".*cash-flow\/receivables.*show: isDefaultAdmin/);
  for (const route of ["receivables", "agent"]) assert.match(read(`src/app/dashboard/financial/cash-flow/${route}/page.tsx`), /ReceivablesPage/);
  const page = read("src/features/financial/receivables/receivables-page.tsx");
  assert.match(page, /if \(!isDefaultAdmin\)/);
  assert.match(page, /data\.scope\.mappingId !== mapping\.id/);
  assert.match(page, /data\.period\.through !== through/);
  assert.match(page, /ReceivableAnalysisPanel result=\{result\}/);
  assert.match(page, /setFilter\(value\); setPage\(0\)/);
  const panel = read("src/features/financial/receivables/analysis-panel.tsx");
  assert.doesNotMatch(panel, /useAuthenticatedApi|fetch\(|setInterval|onSnapshot/);
});
