import assert from "node:assert/strict";
import test from "node:test";
import { mapInterPixStatus } from "../../../src/lib/integrations/inter/pix-payments.server";

test("maps confirmed Inter statuses to paid", () => {
  for (const status of ["PROCESSADO", "PAGO", "EFETIVADO", "CONCLUIDO", "LIQUIDADO"]) {
    assert.equal(mapInterPixStatus(status), "paid");
  }
});

test("maps approval, rejection and expiration without inventing paid", () => {
  assert.equal(mapInterPixStatus("AGUARDANDO_APROVACAO"), "awaiting_bank_approval");
  assert.equal(mapInterPixStatus("REJEITADO"), "rejected");
  assert.equal(mapInterPixStatus("EXPIRADO"), "approval_expired");
  assert.equal(mapInterPixStatus("STATUS_NOVO_DO_BANCO"), "processing");
  assert.notEqual(mapInterPixStatus(undefined), "paid");
});
