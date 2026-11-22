import assert from "node:assert/strict";
import test from "node:test";

import { cardPixSourceMonths, evaluateCardInstallmentsFlow, evaluateCardPixFlow, splitReceiptParcels, type StoneReceiptParcelInput, type CardPixParcelInput, type CardPixSourceInput, type CardPixUnitInput } from "../../src/features/financial/month-closing/card-pix-flow";
import { dependsOnYou } from "../../src/features/financial/month-closing/presentation";

const source = (month: string, ready = true, complete = true): CardPixSourceInput => ({ month, ready, complete });
const parcel = (id: string, status: CardPixParcelInput["status"], expectedDate = "2026-10-15", netCents = 1000, kind: CardPixParcelInput["source"] = "card"): CardPixParcelInput => ({ id, source: kind, status, expectedDate, netCents });
const unit = (parcels: CardPixParcelInput[], sources = [source("2026-10")]): CardPixUnitInput => ({ key: "u", label: "Tiririca", href: "/origem", sources, parcels });
const flow = (units: CardPixUnitInput[], canViewItems = true) => evaluateCardPixFlow({ units, canViewItems, originHref: "/stone?month=2026-10" });
const check = (result: ReturnType<typeof flow>, id: string) => result.checks.find((entry) => entry.id === id)!;

test("Cartão e Pix fecham quando toda parcela das vendas do mês prevista nele foi paga", () => {
  const result = flow([unit([parcel("a", "paid"), parcel("b", "paid_early", "2026-10-15", 1000, "pix"), parcel("c", "paid", "2026-10-31")])]);
  assert.equal(result.key, "card_pix");
  assert.equal(result.state, "ok");
  assert.deepEqual([check(result, "card_pix.card").done, check(result, "card_pix.card").total], [2, 2]);
  assert.deepEqual([check(result, "card_pix.pix").done, check(result, "card_pix.pix").total], [1, 1]);
  assert.equal(result.items.length, 0);
});

test("o que falta aparece por unidade, cartão ou Pix e situação, com valor e datas", () => {
  const result = flow([unit([
    parcel("a", "paid"),
    parcel("b", "unpaid", "2026-10-20", 2500),
    parcel("c", "unpaid", "2026-10-05", 500),
    parcel("d", "chargeback", "2026-10-21", 700),
    parcel("e", "review", "2026-10-22", 900, "pix"),
  ])]);
  assert.equal(result.state, "pending");
  assert.equal(check(result, "card_pix.card").state, "pending");
  assert.equal(check(result, "card_pix.pix").state, "pending");
  assert.deepEqual([check(result, "card_pix.card").done, check(result, "card_pix.card").total], [1, 4]);
  const unpaid = result.items.find((entry) => entry.kind === "card_pix_unpaid")!;
  assert.equal(unpaid.amountCents, 3000);
  assert.equal(unpaid.checkId, "card_pix.card");
  assert.match(unpaid.detail, /2 parcelas de cartão não recebidas · previstas de 05\/10 a 20\/10/);
  assert.equal(dependsOnYou(unpaid), true);
  assert.equal(result.items.find((entry) => entry.kind === "card_pix_chargeback")!.amountCents, 700);
  const review = result.items.find((entry) => entry.kind === "card_pix_review")!;
  assert.match(review.detail, /1 parcela de Pix em revisão · prevista em 22\/10/);
  assert.equal(review.checkId, "card_pix.pix");
});

test("parcela ainda dentro do prazo da Stone não depende de ninguém e define até quando espera", () => {
  const result = flow([unit([parcel("a", "to_receive", "2026-10-30", 700), parcel("b", "to_receive", "2026-10-31", 300, "pix")])]);
  assert.equal(result.state, "pending");
  assert.equal(result.readyFrom, "2026-10-31");
  const item = result.items.find((entry) => entry.kind === "card_pix_awaiting" && entry.checkId === "card_pix.card")!;
  assert.equal(item.amountCents, 700);
  assert.equal(dependsOnYou(item), false);
});

test("sem a conferência salva de um mês de venda nada é dado como recebido", () => {
  const result = flow([unit([], [source("2026-10"), source("2026-09", false, false)])]);
  assert.equal(check(result, "card_pix.sources").state, "pending");
  assert.equal(check(result, "card_pix.card").state, "pending");
  assert.equal(check(result, "card_pix.card").done, null);
  assert.match(result.items[0].detail, /09\/2026 ainda não foi salva/);
});

test("conferência salva antes de o mês fechar não vale", () => {
  const result = flow([unit([parcel("a", "paid")], [source("2026-10"), source("2026-09", true, false)])]);
  assert.equal(result.state, "pending");
  assert.match(result.items[0].detail, /antes de o mês fechar/);
});

test("toda conferência informada precisa ser válida para a unidade fechar", () => {
  const sources = [source("2026-10"), source("2026-09"), source("2026-08", false, false)];
  const result = flow([unit([parcel("12x-3", "paid", "2026-10-05")], sources)]);
  assert.equal(check(result, "card_pix.sources").state, "pending");
  assert.equal(result.state, "pending");
});

test("o fechamento lê só o mês da competência, sem setembro nem meses anteriores", () => {
  assert.deepEqual(cardPixSourceMonths("2026-10", "2026-09-20", "2026-10-31"), ["2026-10"]);
  assert.deepEqual(cardPixSourceMonths("2026-10", "2026-11-01", "2026-10-31"), []);
});

test("Pix sem arquivo processado da Stone não é dado como recebido nem como conferido", () => {
  const result = flow([unit([parcel("a", "paid")], [{ ...source("2026-10"), pixUnavailableDays: 31 }])]);
  assert.equal(check(result, "card_pix.pix").state, "unavailable");
  assert.equal(check(result, "card_pix.card").state, "ok");
  assert.notEqual(result.state, "ok");
  assert.match(check(result, "card_pix.pix").note ?? "", /31 dias/);
});

test("sem permissão os itens ficam ocultos e sem vínculo o fluxo fica indisponível", () => {
  const hidden = flow([unit([parcel("a", "unpaid")])], false);
  assert.equal(hidden.items.length, 0);
  assert.equal(hidden.itemsHidden, true);
  const empty = flow([]);
  assert.equal(check(empty, "card_pix.sources").state, "unavailable");
  assert.equal(empty.state, "unavailable");
});

const raw = (id: string, saleDate: string, expectedDate: string, installmentCount = 1, source: StoneReceiptParcelInput["source"] = "card", status: StoneReceiptParcelInput["status"] = "paid"): StoneReceiptParcelInput =>
  ({ id, source, status, expectedDate, netCents: 1000, saleDate, installmentCount });

test("à vista conta no mês da venda, mesmo pago depois; parcelado conta no mês em que a parcela vence", () => {
  const { cashSale, installment } = splitReceiptParcels([
    raw("vista-out-vence-nov", "2026-10-20", "2026-11-19"),
    raw("vista-out-vence-out", "2026-10-02", "2026-10-02"),
    raw("vista-set-vence-out", "2026-09-25", "2026-10-25"),
    raw("pix-out", "2026-10-10", "2026-10-10", 1, "pix"),
    raw("12x-set-vence-out", "2026-09-25", "2026-10-25", 12),
    raw("12x-out-vence-nov", "2026-10-05", "2026-11-05", 12),
    raw("12x-out-vence-out", "2026-10-05", "2026-10-05", 12),
    raw("sem-data-venda", "", "2026-10-15"),
  ].map((parcel) => (parcel.id === "sem-data-venda" ? { ...parcel, saleDate: null } : parcel)), "2026-10");
  assert.deepEqual(cashSale.map((parcel) => parcel.id), ["vista-out-vence-nov", "vista-out-vence-out", "pix-out", "sem-data-venda"]);
  assert.deepEqual(installment.map((parcel) => parcel.id), ["12x-set-vence-out", "12x-out-vence-out"]);
});

test("crédito à vista de outubro ainda a receber em novembro mantém o fluxo pendente até a data prevista", () => {
  const result = flow([unit([parcel("a", "paid", "2026-10-02"), parcel("b", "paid", "2026-11-17"), parcel("c", "to_receive", "2026-11-30", 787), parcel("d", "review", "2026-11-19", 84)], [source("2026-10")])]);
  assert.equal(result.name, "Recebimento · Cartão e Pix");
  assert.equal(result.state, "pending");
  assert.equal(check(result, "card_pix.card").done, 2);
  assert.equal(check(result, "card_pix.card").total, 4);
  assert.equal(result.readyFrom, "2026-11-30");
  assert.ok(result.items.some((item) => item.kind === "card_pix_review"));
});

test("sem venda parcelada no mês, o fluxo de parcelado confere sem inventar pendência", () => {
  const result = evaluateCardInstallmentsFlow({ units: [unit([], [source("2026-10")])], canViewItems: true, originHref: "/stone?month=2026-10" });
  assert.equal(result.key, "card_installments");
  assert.equal(result.name, "Recebimento · Cartão parcelado");
  assert.equal(result.state, "ok");
  assert.match(check(result, "card_installments.card").note ?? "", /Nenhuma parcela de venda parcelada/);
  assert.equal(result.checks.length, 2);
});

test("parcelado sem conferência salva do mês não é dado como recebido", () => {
  const result = evaluateCardInstallmentsFlow({ units: [unit([], [source("2026-10", false, false)])], canViewItems: true, originHref: "/stone" });
  assert.equal(result.state, "pending");
  assert.equal(check(result, "card_installments.card").done, null);
});

test("parcela vencida e não paga no parcelado trava o mês, parcela futura não", () => {
  const unpaid = evaluateCardInstallmentsFlow({ units: [unit([parcel("a", "paid"), parcel("b", "unpaid", "2026-10-20")], [source("2026-10")])], canViewItems: true, originHref: "/stone" });
  assert.equal(unpaid.state, "pending");
  assert.equal(check(unpaid, "card_installments.card").done, 1);
});
