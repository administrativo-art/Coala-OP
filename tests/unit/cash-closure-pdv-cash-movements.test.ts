import assert from "node:assert/strict";
import test from "node:test";

import { parsePdvCashMovements } from "../../src/features/financial/cash-closures/pdv-cash-movements";

test("normaliza sangrias e suprimentos, filtra filial e classifica dinheiro pelo catálogo", () => {
  const movements = parsePdvCashMovements({
    date: "2026-08-28",
    filialId: "10",
    paymentMethods: [
      { codigo: 1, nome: "Dinheiro" },
      { codigo: 2, nome: "Cartão" },
    ],
    withdrawals: [
      {
        codigo: 101,
        valor: "21,20",
        data: "28/08/2026 15:00:00",
        codFilial: 10,
        codUsuario: 7,
        codFormaPagamento: 1,
        cancelado: false,
      },
      {
        codigo: 102,
        valor: 10,
        data: "2026-08-28 16:00:00",
        codFilial: 11,
        codUsuario: 7,
        codFormaPagamento: 1,
      },
    ],
    supplies: [
      {
        codigo: 201,
        valor: 40,
        dataMovimento: "2026-08-28 09:00:00",
        codFilial: "10",
        usuario: { codigo: "7" },
        formaPagamento: { codigo: 2, nome: "Cartão" },
      },
    ],
  });

  assert.equal(movements.length, 2);
  assert.deepEqual(movements.map((movement) => movement.id), ["201", "101"]);
  assert.equal(movements[0].kind, "supply");
  assert.equal(movements[0].amountCents, 4_000);
  assert.equal(movements[0].isCash, false);
  assert.equal(movements[1].kind, "withdrawal");
  assert.equal(movements[1].amountCents, 2_120);
  assert.equal(movements[1].operatorId, "7");
  assert.equal(movements[1].isCash, true);
});

test("preserva movimento cancelado para o motor contabilizar a exclusão", () => {
  const [movement] = parsePdvCashMovements({
    date: "2026-08-28",
    filialId: "10",
    paymentMethods: [{ codigo: 1, nome: "Dinheiro" }],
    withdrawals: [{
      codigo: 101,
      valor: 5,
      data: "2026-08-28",
      codFilial: 10,
      codUsuario: 7,
      codFormaPagamento: 1,
      isCancelado: true,
    }],
    supplies: [],
  });

  assert.equal(movement.cancelled, true);
});

test("reconhece os nomes de campo observados no payload real do PDV", () => {
  const movements = parsePdvCashMovements({
    date: "2026-08-07",
    filialId: "17343",
    paymentMethods: [{ codigo: 1, descr: "DINHEIRO" }],
    withdrawals: [{
      codigo: 301,
      codloja: 17343,
      codusuario: 184256,
      codformapgto: 1,
      dtmovimento: "2026-08-07T20:50:39",
      valor: 20,
      isCancelado: false,
    }],
    supplies: [{
      codigo: 302,
      codloja: 17343,
      codusuario: 449572,
      codformapgto: 0,
      dtmovimento: "2026-08-07T15:56:46",
      valor: 40,
      isCancelado: false,
    }],
  });

  assert.deepEqual(movements.map((movement) => ({
    id: movement.id,
    operatorId: movement.operatorId,
    paymentMethodId: movement.paymentMethodId,
    isCash: movement.isCash,
  })), [
    { id: "302", operatorId: "449572", paymentMethodId: "0", isCash: false },
    { id: "301", operatorId: "184256", paymentMethodId: "1", isCash: true },
  ]);
});
