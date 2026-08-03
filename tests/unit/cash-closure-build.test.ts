import assert from "node:assert/strict";
import test from "node:test";

import { buildCashClosureFromPdv } from "../../src/features/financial/cash-closures/build-cash-closure";
import type { CashClosureBuildContext } from "../../src/features/financial/cash-closures/types";

const BASE_CTX: CashClosureBuildContext = {
  workspaceId: "ws1",
  kioskId: "tirirical",
  kioskName: "Tirirical",
  pdvFilialId: "17343",
  date: "2026-07-07",
};

function coupon(overrides: Record<string, unknown>) {
  return {
    codcupom: "1",
    usuariorecebimento_id: "10",
    dtrecebimento: "2026-07-07 12:00:00",
    iscancelado: false,
    isestornado: false,
    valortotal: 0,
    itens: [],
    formaPgtos: [],
    ...overrides,
  };
}

test("TROCO reduz o dinheiro líquido (401 - 33 = 368)", () => {
  const closure = buildCashClosureFromPdv(
    [
      coupon({
        codcupom: "1",
        valortotal: 368,
        formaPgtos: [
          { nome: "DINHEIRO", valortotal: 401 },
          { nome: "TROCO", valortotal: 33 },
        ],
      }),
    ],
    BASE_CTX,
  );

  assert.equal(closure.lines.length, 1);
  const [cashLine] = closure.lines;
  assert.equal(cashLine.channel, "cash");
  assert.equal(cashLine.expectedAmountCents, 36800);
  assert.equal(cashLine.metadata.grossCashCents, 40100);
  assert.equal(cashLine.metadata.changeCents, 3300);
  assert.equal(closure.expectedTotalCents, 36800);
});

test("forma de pagamento desconhecida vira other e entra em unknownPaymentNames", () => {
  const closure = buildCashClosureFromPdv(
    [
      coupon({
        codcupom: "2",
        valortotal: 50,
        formaPgtos: [{ nome: "VALE REFEICAO XYZ", valortotal: 50 }],
      }),
    ],
    BASE_CTX,
  );

  assert.equal(closure.lines[0].channel, "other");
  assert.deepEqual(closure.source.unknownPaymentNames, ["VALE REFEICAO XYZ"]);
});

test("cupom cancelado sem item explicitamente cancelado é ignorado inteiro", () => {
  const closure = buildCashClosureFromPdv(
    [
      coupon({
        codcupom: "3",
        iscancelado: true,
        valortotal: 100,
        itens: [{ iscancelado: false }],
        formaPgtos: [{ nome: "DINHEIRO", valortotal: 100 }],
      }),
    ],
    BASE_CTX,
  );

  assert.equal(closure.lines.length, 0);
  assert.equal(closure.source.ignoredCancelledCouponCount, 1);
  assert.equal(closure.source.validCouponCount, 0);
});

test("cupom cancelado com item explicitamente cancelado NÃO é ignorado inteiro (cancelamento parcial)", () => {
  const closure = buildCashClosureFromPdv(
    [
      coupon({
        codcupom: "4",
        iscancelado: true,
        valortotal: 75,
        itens: [{ iscancelado: true }],
        formaPgtos: [{ nome: "DINHEIRO", valortotal: 75 }],
      }),
    ],
    BASE_CTX,
  );

  assert.equal(closure.source.ignoredCancelledCouponCount, 0);
  assert.equal(closure.source.validCouponCount, 1);
  assert.equal(closure.lines[0].expectedAmountCents, 7500);
});

test("agrupa por usuariorecebimento_id (cupom), não por usuariooperador_id (item)", () => {
  const closure = buildCashClosureFromPdv(
    [
      coupon({
        codcupom: "5",
        usuariorecebimento_id: "20",
        valortotal: 30,
        itens: [{ usuariooperador_id: "999" }],
        formaPgtos: [{ nome: "PIX", valortotal: 30 }],
      }),
    ],
    BASE_CTX,
  );

  assert.equal(closure.lines[0].operatorId, "20");
});

test("cupom às 23:50 e 00:10 caem no dia correto em America/Belem", () => {
  const coupons = [
    coupon({ codcupom: "6", dtrecebimento: "2026-07-07 23:50:00", valortotal: 10, formaPgtos: [{ nome: "PIX", valortotal: 10 }] }),
    coupon({ codcupom: "7", dtrecebimento: "2026-07-08 00:10:00", valortotal: 20, formaPgtos: [{ nome: "PIX", valortotal: 20 }] }),
  ];

  const day7 = buildCashClosureFromPdv(coupons, { ...BASE_CTX, date: "2026-07-07" });
  assert.equal(day7.source.couponCount, 1);
  assert.equal(day7.expectedTotalCents, 1000);

  const day8 = buildCashClosureFromPdv(coupons, { ...BASE_CTX, date: "2026-07-08" });
  assert.equal(day8.source.couponCount, 1);
  assert.equal(day8.expectedTotalCents, 2000);
});

test("soma das linhas === expectedTotalCents, sem drift de centavos", () => {
  const closure = buildCashClosureFromPdv(
    [
      coupon({
        codcupom: "8",
        usuariorecebimento_id: "10",
        valortotal: 368,
        formaPgtos: [
          { nome: "DINHEIRO", valortotal: 401 },
          { nome: "TROCO", valortotal: 33 },
        ],
      }),
      coupon({
        codcupom: "9",
        usuariorecebimento_id: "11",
        valortotal: 30.3,
        formaPgtos: [{ nome: "CARTAO CREDITO", valortotal: 30.3 }],
      }),
    ],
    BASE_CTX,
  );

  const lineSum = closure.lines.reduce((total, line) => total + line.expectedAmountCents, 0);
  assert.equal(lineSum, closure.expectedTotalCents);
  assert.equal(closure.expectedTotalCents, 36800 + 3030);
});
