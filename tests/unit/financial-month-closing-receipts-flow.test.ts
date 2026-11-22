import assert from "node:assert/strict";
import test from "node:test";

import { dependsOnYou } from "../../src/features/financial/month-closing/presentation";
import { evaluateReceiptsFlow, type ReceiptsParcelInput, type ReceiptsSourceInput, type ReceiptsUnitInput } from "../../src/features/financial/month-closing/receipts-flow";

const source = (month: string, ready = true, complete = true): ReceiptsSourceInput => ({ month, ready, complete });
const parcel = (id: string, status: ReceiptsParcelInput["status"], expectedDate = "2026-10-15", netCents = 1000): ReceiptsParcelInput => ({ id, status, expectedDate, netCents });
const unit = (parcels: ReceiptsParcelInput[], sources = [source("2026-10"), source("2026-09")]): ReceiptsUnitInput => ({ key: "u", label: "Tiririca", href: "/origem", sources, parcels });
const flow = (units: ReceiptsUnitInput[], canViewItems = true) => evaluateReceiptsFlow({ units, canViewItems, originHref: "/stone?month=2026-10" });
const check = (result: ReturnType<typeof flow>, id: string) => result.checks.find((entry) => entry.id === id)!;

test("Pix e cartão fecham quando toda parcela prevista no mês foi paga, de qualquer mês de venda", () => {
  const result = flow([unit([parcel("a", "paid"), parcel("b", "paid_early"), parcel("c", "paid", "2026-10-31")])]);
  assert.equal(check(result, "receipts.sources").state, "ok");
  assert.equal(check(result, "receipts.cards").state, "ok");
  assert.equal(result.items.length, 0);
});

test("parcela não recebida mantém o fluxo pendente e aparece com o valor", () => {
  const result = flow([unit([parcel("a", "paid"), parcel("b", "unpaid", "2026-10-20", 2500), parcel("c", "chargeback", "2026-10-21", 500)])]);
  assert.equal(result.state, "pending");
  assert.equal(check(result, "receipts.cards").state, "pending");
  const item = result.items.find((entry) => entry.kind === "receipts_pending")!;
  assert.equal(item.amountCents, 3000);
  assert.equal(dependsOnYou(item), true);
});

test("parcela ainda dentro do prazo da Stone não depende de ninguém e define até quando espera", () => {
  const result = flow([unit([parcel("a", "to_receive", "2026-10-30", 700), parcel("b", "to_receive", "2026-10-31", 300)])]);
  assert.equal(result.state, "pending");
  assert.equal(result.readyFrom, "2026-10-31");
  const item = result.items.find((entry) => entry.kind === "receipts_awaiting")!;
  assert.equal(item.amountCents, 1000);
  assert.equal(dependsOnYou(item), false);
});

test("sem a conferência salva de um mês de venda nada é dado como recebido", () => {
  const result = flow([unit([], [source("2026-10"), source("2026-09", false, false)])]);
  assert.equal(check(result, "receipts.sources").state, "pending");
  assert.equal(check(result, "receipts.cards").state, "pending");
  assert.match(result.items[0].detail, /09\/2026 ainda não foi salva/);
});

test("conferência salva antes de o mês fechar não vale", () => {
  const result = flow([unit([parcel("a", "paid")], [source("2026-10"), source("2026-09", true, false)])]);
  assert.equal(result.state, "pending");
  assert.match(result.items[0].detail, /antes de o mês fechar/);
});

test("com parcelado, cada parcela conta só no mês da sua data prevista e meses mais antigos também são exigidos", () => {
  const sources = [source("2026-10"), source("2026-09"), source("2026-08", false, false)];
  const result = flow([unit([parcel("12x-3", "paid", "2026-10-05")], sources)]);
  assert.equal(check(result, "receipts.sources").state, "pending");
  assert.equal(result.state, "pending");
});

test("a etapa do dinheiro ainda não está conectada: o fluxo não fecha sozinho", () => {
  const result = flow([unit([parcel("a", "paid")])]);
  assert.equal(check(result, "receipts.cash").state, "unavailable");
  assert.equal(result.state, "unavailable");
});

test("sem permissão os itens ficam ocultos e sem vínculo a etapa fica indisponível", () => {
  const hidden = flow([unit([parcel("a", "unpaid")])], false);
  assert.equal(hidden.items.length, 0);
  assert.equal(hidden.itemsHidden, true);
  const empty = flow([]);
  assert.equal(check(empty, "receipts.sources").state, "unavailable");
});
