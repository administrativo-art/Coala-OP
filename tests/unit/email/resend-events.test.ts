import assert from "node:assert/strict";
import test from "node:test";

import { deliveryStatusFromResendEvent, isDeliveryFailure } from "../../../src/lib/email/resend-events";

test("mapeia os eventos de entrega do Resend", () => {
  assert.equal(deliveryStatusFromResendEvent("email.sent"), "accepted");
  assert.equal(deliveryStatusFromResendEvent("email.delivered"), "delivered");
  assert.equal(deliveryStatusFromResendEvent("email.delivery_delayed"), "delayed");
  assert.equal(deliveryStatusFromResendEvent("email.bounced"), "bounced");
  assert.equal(deliveryStatusFromResendEvent("email.failed"), "failed");
  assert.equal(deliveryStatusFromResendEvent("email.complained"), "complained");
  assert.equal(deliveryStatusFromResendEvent("email.suppressed"), "suppressed");
  assert.equal(deliveryStatusFromResendEvent("email.opened"), null);
});

test("distingue falhas definitivas de atraso e entrega", () => {
  assert.equal(isDeliveryFailure("bounced"), true);
  assert.equal(isDeliveryFailure("failed"), true);
  assert.equal(isDeliveryFailure("complained"), true);
  assert.equal(isDeliveryFailure("suppressed"), true);
  assert.equal(isDeliveryFailure("delayed"), false);
  assert.equal(isDeliveryFailure("delivered"), false);
});
