import assert from "node:assert/strict";
import test from "node:test";

import {
  isPdvCouponFullyCancelled,
  isPdvItemCancelled,
  pdvCouponTimestamp,
} from "../../src/lib/integrations/pdv-coupon-ingestion";

test("cancelamento total e parcial usam a mesma regra de ingestão", () => {
  assert.equal(isPdvCouponFullyCancelled({ iscancelado: true, itens: [{ iscancelado: false }] }), true);
  assert.equal(isPdvCouponFullyCancelled({ status: "cancelado", Itens: [{ IsCancelado: "true" }] }), false);
  assert.equal(isPdvItemCancelled({ IsCancelado: "1" }), true);
});

test("data do item é fallback quando o cupom não informa recebimento ou abertura", () => {
  assert.equal(
    pdvCouponTimestamp({ itens: [{ dtmovimento: "2026-07-07 23:50:00" }] }),
    "2026-07-07 23:50:00",
  );
});
