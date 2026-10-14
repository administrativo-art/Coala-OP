import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTransportVoucherActionAvailable,
  calculateTransportVoucherEffect,
  formatBrazilianRequestText,
  normalizeApprovedDailyValue,
  normalizeRequestDetails,
} from "../../src/features/hr/requests/core";

test("vale ativo permite alteração ou suspensão, mas não nova adesão", () => {
  assert.doesNotThrow(() => assertTransportVoucherActionAvailable("change", true));
  assert.doesNotThrow(() => assertTransportVoucherActionAvailable("suspend", true));
  assert.throws(() => assertTransportVoucherActionAvailable("activate", true), /já está ativo/i);
  assert.throws(() => assertTransportVoucherActionAvailable("reactivate", true, true), /já está ativo/i);
});

test("vale nunca configurado permite adesão; vale suspenso exige reativação", () => {
  assert.doesNotThrow(() => assertTransportVoucherActionAvailable("activate", false, false));
  assert.throws(() => assertTransportVoucherActionAvailable("reactivate", false, false), /ainda não foi configurado/i);
  assert.doesNotThrow(() => assertTransportVoucherActionAvailable("reactivate", false, true));
  assert.throws(() => assertTransportVoucherActionAvailable("activate", false, true), /está suspenso/i);
  assert.throws(() => assertTransportVoucherActionAvailable("change", false, true), /não está ativo/i);
  assert.throws(() => assertTransportVoucherActionAvailable("suspend", false, true), /não está ativo/i);
});

test("solicitação até o dia 20 entra em vigor no mês seguinte", () => {
  assert.deepEqual(calculateTransportVoucherEffect("2026-03-18"), {
    requestDate: "2026-03-18",
    cutoffDay: 20,
    requestedAfterCutoff: false,
    processingCompetence: "2026-04",
    effectiveDate: "2026-04-01",
    payslipPaymentDate: "2026-05-07",
  });
  assert.equal(calculateTransportVoucherEffect("2026-03-20").effectiveDate, "2026-04-01");
});

test("solicitação após o dia 20 entra em vigor no segundo mês seguinte", () => {
  assert.deepEqual(calculateTransportVoucherEffect("2026-03-22"), {
    requestDate: "2026-03-22",
    cutoffDay: 20,
    requestedAfterCutoff: true,
    processingCompetence: "2026-05",
    effectiveDate: "2026-05-01",
    payslipPaymentDate: "2026-06-05",
  });
  assert.equal(calculateTransportVoucherEffect("2026-12-21").effectiveDate, "2027-02-01");
  assert.throws(() => calculateTransportVoucherEffect("2026-02-30"), /inválida/i);
});

test("informa o contracheque da competência e sua data de pagamento", () => {
  const result = calculateTransportVoucherEffect("2026-10-13");
  assert.equal(result.processingCompetence, "2026-11");
  assert.equal(result.payslipPaymentDate, "2026-12-07");
});

test("datas e competências persistidas em ISO são apresentadas no padrão brasileiro", () => {
  assert.equal(
    formatBrazilianRequestText("Vigência em 2026-09-01; competência 2026-09; pago em 2026-10-07."),
    "Vigência em 01/09/2026; competência setembro de 2026; pago em 07/10/2026.",
  );
});

test("valor diário do RH é positivo e normalizado em centavos", () => {
  assert.equal(normalizeApprovedDailyValue("12,345", true), 12.35);
  assert.equal(normalizeApprovedDailyValue("", false), null);
  assert.throws(() => normalizeApprovedDailyValue("0", true), /maior que zero/i);
});

test("detalhes são opcionais e, quando informados, exigem contexto mínimo", () => {
  assert.equal(normalizeRequestDetails(""), "");
  assert.equal(normalizeRequestDetails("  Mudança   de trajeto diário  "), "Mudança de trajeto diário");
  assert.throws(() => normalizeRequestDetails("curto"), /10 caracteres/i);
});
