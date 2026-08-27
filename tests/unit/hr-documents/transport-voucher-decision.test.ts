import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTransportVoucherEffectiveDate,
  transportVoucherDecisionKey,
  transportVoucherDecisionMode,
  transportVoucherDocumentKind,
} from "../../../src/features/hr/lib/transport-voucher-decision";

test("solicitação e renúncia são documentos diferentes", () => {
  assert.equal(transportVoucherDocumentKind(transportVoucherDecisionMode(true)), "transport_voucher_request");
  assert.equal(transportVoucherDocumentKind(transportVoucherDecisionMode(false)), "transport_voucher_waiver");
});

test("idempotência inclui versão, vigência e modalidade", () => {
  const base = {
    employeeId: "employee-1",
    decisionVersion: 2,
    effectiveDate: "2026-08-01",
    mode: "requested" as const,
  };
  assert.equal(transportVoucherDecisionKey(base), transportVoucherDecisionKey(base));
  assert.notEqual(
    transportVoucherDecisionKey(base),
    transportVoucherDecisionKey({ ...base, effectiveDate: "2026-09-01" }),
  );
  assert.notEqual(
    transportVoucherDecisionKey(base),
    transportVoucherDecisionKey({ ...base, mode: "waived" }),
  );
});

test("vigência inválida usa data de fallback", () => {
  assert.equal(
    normalizeTransportVoucherEffectiveDate("amanhã", "2026-07-28T12:00:00.000Z"),
    "2026-07-28",
  );
});
