import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { planPaidBeneficiaryReview } from "../../src/features/financial/payment-requests/beneficiary-review";
import { matchesPaymentRequestFilter } from "../../src/features/financial/payment-requests/presentation";
import { reviewRequest as request, reviewStatement as statement } from "../helpers/payment-beneficiary-review";

const input = { request, statement, statementTransactionId: "test-statement", observedAt: "2026-09-26T15:00:00.000Z" };

test("favorecido comprovado pelo extrato remove apenas o alerta e registra a evidência", () => {
  const plan = planPaidBeneficiaryReview(input);
  assert.ok(plan);
  assert.equal(plan.patch.beneficiaryVerificationStatus, "verified");
  assert.equal(plan.patch.beneficiaryVerificationWarning, null);
  assert.equal(plan.patch.bankReconciliationDivergenceField, null);
  assert.equal(plan.event.previousWarning, request.beneficiaryVerificationWarning);
  assert.equal(plan.event.statementTransactionId, input.statementTransactionId);
  const updated = { ...request, ...plan.patch };
  for (const key of ["status", "paidAt", "amount", "proofStoragePath", "sourceCompletedAt", "postPaymentProcessingStatus", "interRequestId"] as const) {
    assert.equal(updated[key], request[key]);
  }
  assert.equal(matchesPaymentRequestFilter(updated, "risk"), false);
  assert.equal(matchesPaymentRequestFilter(updated, "done"), true);
  assert.equal(planPaidBeneficiaryReview({ ...input, request: updated }), null);
  assert.ok(!JSON.stringify(plan).includes("12345678901"));
  assert.ok(!JSON.stringify(plan).includes(request.beneficiarySnapshot.documentHash!));
});

test("documento ausente, mascarado, parcial, inválido ou diferente preserva a revisão", () => {
  for (const cpfCnpjRecebedor of [undefined, null, "", "***.***.***-01", "8901", 12345678901, "outro 12345678901", "10987654321"]) {
    const raw = { ...statement, bankStatementData: { ...statement.bankStatementData,
      detalhes: { ...statement.bankStatementData.detalhes, cpfCnpjRecebedor } } };
    assert.equal(planPaidBeneficiaryReview({ ...input, statement: raw }), null);
  }
  for (const documentHash of [undefined, "", "hash"]) {
    assert.equal(planPaidBeneficiaryReview({ ...input, request: { ...request,
      beneficiarySnapshot: { ...request.beneficiarySnapshot, documentHash } } }), null);
  }
});

test("CNPJ completo também pode confirmar a identidade, incluindo Pix legado sem trilho", () => {
  const document = "12345678000190";
  assert.ok(planPaidBeneficiaryReview({ ...input,
    request: { ...request, paymentRail: undefined, beneficiarySnapshot: { ...request.beneficiarySnapshot,
      documentHash: createHash("sha256").update(document).digest("hex") } },
    statement: { ...statement, bankStatementData: { ...statement.bankStatementData,
      detalhes: { ...statement.bankStatementData.detalhes, cpfCnpjRecebedor: "12.345.678/0001-90" } } },
  }));
});

test("vínculos, identificação bancária, origem, direção e valor precisam coincidir", () => {
  for (const patch of [
    { expenseId: "other" }, { linkedExpenseId: "other" }, { amount: 15.96 }, { amount: NaN },
    { amount: -15.95 }, { type: "income" }, { direction: "in" }, { importSource: "manual" },
    { importedFrom: "manual" }, { auditStatus: "pending" }, { reversed: true }, { bankStatementData: null },
  ]) assert.equal(planPaidBeneficiaryReview({ ...input, statement: { ...statement, ...patch } }), null);
  assert.equal(planPaidBeneficiaryReview({ ...input, statementTransactionId: "other" }), null);
  for (const patch of [{ codigoSolicitacao: "other" }, { codigoSolicitacao: undefined }, { endToEndId: "other" }, { endToEndId: undefined }]) {
    assert.equal(planPaidBeneficiaryReview({ ...input, statement: { ...statement,
      bankStatementData: { ...statement.bankStatementData, detalhes: { ...statement.bankStatementData.detalhes, ...patch } } } }), null);
  }
  for (const patch of [{ tipoOperacao: "C" }, { tipoTransacao: "BOLETO" }]) {
    assert.equal(planPaidBeneficiaryReview({ ...input, statement: { ...statement,
      bankStatementData: { ...statement.bankStatementData, ...patch } } }), null);
  }
});

test("não resolve divergência cadastral, de valor, desconhecida ou pagamento não conciliado", () => {
  for (const bankReconciliationDivergenceField of ["beneficiary_source", "amount", null, undefined] as const) {
    assert.equal(planPaidBeneficiaryReview({ ...input, request: { ...request, bankReconciliationDivergenceField } }), null);
  }
  for (const status of ["failed", "scheduled", "ready_to_submit"] as const) {
    assert.equal(planPaidBeneficiaryReview({ ...input, request: { ...request, status } }), null);
  }
  for (const statementReconciliationStatus of ["expected", "divergent", "not_expected", undefined] as const) {
    assert.equal(planPaidBeneficiaryReview({ ...input, request: { ...request, statementReconciliationStatus } }), null);
  }
  assert.equal(planPaidBeneficiaryReview({ ...input, request: { ...request, amount: NaN } }), null);
  assert.equal(planPaidBeneficiaryReview({ ...input, statement: undefined }), null);
});
