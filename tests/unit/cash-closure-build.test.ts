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

test("Pix e cartões são conferidos automaticamente e guardam o intervalo do operador", () => {
  const closure = buildCashClosureFromPdv(
    [
      coupon({
        codcupom: "10",
        dtrecebimento: "2026-07-07 08:05:00",
        valortotal: 40,
        formaPgtos: [{ nome: "PIX", valortotal: 40 }],
      }),
      coupon({
        codcupom: "11",
        dtrecebimento: "2026-07-07 18:42:00",
        valortotal: 60,
        formaPgtos: [{ nome: "CARTAO CREDITO", valortotal: 60 }],
      }),
    ],
    BASE_CTX,
  );

  assert.equal(closure.lines.length, 2);
  for (const line of closure.lines) {
    assert.equal(line.reportedAmountCents, line.expectedAmountCents);
    assert.equal(line.reportedDifferenceAmountCents, 0);
    assert.equal(line.countedAmountCents, line.expectedAmountCents);
    assert.equal(line.differenceAmountCents, 0);
    assert.equal(line.status, "matched");
    assert.equal(line.metadata.firstCouponAt, "2026-07-07 08:05:00");
    assert.equal(line.metadata.lastCouponAt, "2026-07-07 18:42:00");
  }
});

test("dinheiro esperado inclui suprimentos e subtrai sangrias do mesmo operador", () => {
  const closure = buildCashClosureFromPdv(
    [
      coupon({
        codcupom: "12",
        usuariorecebimento_id: "10",
        valortotal: 100,
        formaPgtos: [{ nome: "DINHEIRO", valortotal: 100 }],
      }),
    ],
    {
      ...BASE_CTX,
      operatorNameById: { "10": "Maria" },
      cashMovements: [
        {
          id: "supply-1",
          kind: "supply",
          amountCents: 4_000,
          occurredAt: "2026-07-07 09:00:00",
          date: "2026-07-07",
          operatorId: "10",
          terminalId: "1",
          paymentMethodId: "1",
          paymentMethodName: "Dinheiro",
          isCash: false,
          cancelled: false,
        },
        {
          id: "withdrawal-1",
          kind: "withdrawal",
          amountCents: 2_000,
          occurredAt: "2026-07-07 15:00:00",
          date: "2026-07-07",
          operatorId: "10",
          terminalId: "1",
          paymentMethodId: "1",
          paymentMethodName: "Dinheiro",
          isCash: true,
          cancelled: false,
        },
      ],
    },
  );

  const [cashLine] = closure.lines;
  assert.equal(cashLine.calculatedExpectedAmountCents, 12_000);
  assert.equal(cashLine.expectedAmountCents, 12_000);
  assert.equal(cashLine.metadata.grossCashCents, 10_000);
  assert.equal(cashLine.metadata.supplyCents, 4_000);
  assert.equal(cashLine.metadata.withdrawalCents, 2_000);
  assert.equal(cashLine.metadata.cashMovements?.length, 2);
  assert.equal(closure.expectedTotalCents, 12_000);
});

test("movimento sem operador reconhecido vira pendência e não altera o esperado", () => {
  const closure = buildCashClosureFromPdv([], {
    ...BASE_CTX,
    cashMovements: [{
      id: "withdrawal-unassigned",
      kind: "withdrawal",
      amountCents: 2_000,
      occurredAt: "2026-07-07 15:00:00",
      date: "2026-07-07",
      operatorId: "999",
      terminalId: "1",
      paymentMethodId: "1",
      paymentMethodName: "Dinheiro",
      isCash: true,
      cancelled: false,
    }],
  });

  assert.equal(closure.lines.length, 0);
  assert.equal(closure.source.unassignedMovementCount, 1);
  assert.match(closure.source.integrityWarnings[0], /operador não reconhecido/);
});
