import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePdvCouponRevenue, PdvRevenueError } from '../../functions/src/pdv-revenue';

test('cupom real: item bruto 15, desconto 3, cobrança 12', () => {
  const result = normalizePdvCouponRevenue({ valortotal: 12, itens: [{ valortotal: 15, valordesconto: 3 }] });
  assert.equal(result.revenueCents, 1200);
  assert.deepEqual(result.itemRevenueCents, [1200]);
});
test('desconto no cupom é rateado em centavos, sem perder valor por arredondamento', () => {
  const result = normalizePdvCouponRevenue({ valortotal: 0.02, valordesconto: 0.01, itens: [{ valortotal: 0.01 }, { valortotal: 0.01 }, { valortotal: 0.01 }] });
  assert.deepEqual(result.itemRevenueCents, [1, 1, 0]);
});
test('descontos no item e no cabeçalho compõem a cobrança', () => {
  const result = normalizePdvCouponRevenue({ valortotal: 21, valordesconto: 3, itens: [{ valortotal: 15, valordesconto: 3 }, { valortotal: 15, valordesconto: 3 }] });
  assert.deepEqual(result.itemRevenueCents, [1050, 1050]);
});
test('não desconta novamente um valor que já veio líquido', () => {
  assert.deepEqual(normalizePdvCouponRevenue({ valortotal: 12, valordesconto: 3, itens: [{ valortotal: 12, valordesconto: 3 }] }).itemRevenueCents, [1200]);
});
test('itens cancelados não participam do rateio', () => {
  assert.deepEqual(normalizePdvCouponRevenue({ valortotal: 12, itens: [{ valortotal: 15, valordesconto: 3 }, { valortotal: 20, iscancelado: true }] }).itemRevenueCents, [1200, 0]);
});
test('total não explicado e valores inválidos bloqueiam a importação', () => {
  for (const coupon of [
    { valortotal: 10, itens: [{ valortotal: 15 }] },
    { valortotal: 10, itens: [{ valortotal: 'inválido' }] },
    { valortotal: 10, itens: [{ valortotal: -10 }] },
    { valortotal: 10, itens: [{ valortotal: 0 }] },
  ]) assert.throws(() => normalizePdvCouponRevenue(coupon), PdvRevenueError);
});
test('total zero e fallback têm origem explícita', () => {
  assert.deepEqual(normalizePdvCouponRevenue({ valortotal: 0, itens: [{ valortotal: 15, valordesconto: 15 }] }).itemRevenueCents, [0]);
  const result = normalizePdvCouponRevenue({ itens: [{ valortotal: 15, valordesconto: 3 }] });
  assert.equal(result.source, 'items_fallback');
  assert.equal(result.revenueCents, 1200);
});
