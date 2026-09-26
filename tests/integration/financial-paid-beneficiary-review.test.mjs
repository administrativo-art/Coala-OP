import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository" });
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { revalidatePaidPaymentBeneficiary } = await import("../../src/features/financial/payment-requests/repository.server.ts");
const { reviewRequest: request, reviewStatement: statement } = await import("../helpers/payment-beneficiary-review.ts");

test("revalidação grava alerta e auditoria atomicamente, sem duplicar sob concorrência", async () => {
  const ref = db.collection("bankPaymentRequests").doc(request.id);
  await ref.set(request);
  await db.collection("transactions").doc(request.statementTransactionId).set(statement);
  await ref.collection("events").doc("original-divergence").set({ type: "BANK_RECONCILIATION_DIVERGENCE", field: "receiver" });
  await Promise.all([revalidatePaidPaymentBeneficiary(request), revalidatePaidPaymentBeneficiary(request)]);
  const updated = (await ref.get()).data();
  assert.equal(updated.beneficiaryVerificationStatus, "verified");
  assert.equal(updated.beneficiaryVerificationWarning, null);
  for (const key of ["status", "amount", "paidAt", "proofStoragePath", "sourceCompletedAt", "postPaymentProcessingStatus"]) {
    assert.equal(updated[key], request[key]);
  }
  await revalidatePaidPaymentBeneficiary(request); // Stale caller must reread persisted status.
  const events = await ref.collection("events").limit(10).get();
  assert.equal(events.size, 2);
  assert.equal(events.docs.filter((doc) => doc.get("type") === "BENEFICIARY_VERIFIED_FROM_STATEMENT").length, 1);
  assert.equal((await ref.collection("events").doc("original-divergence").get()).exists, true);
});

test("persistência alterada desde a leitura e evidência incompleta preservam o alerta", async () => {
  const current = { ...request, id: "beneficiary-review-stale" };
  const ref = db.collection("bankPaymentRequests").doc(current.id);
  await ref.set({ ...current, bankReconciliationDivergenceField: "beneficiary_source" });
  assert.equal((await revalidatePaidPaymentBeneficiary(current)).beneficiaryVerificationStatus, "divergent");
  await ref.set(current);
  await db.collection("transactions").doc(current.statementTransactionId).update({ "bankStatementData.detalhes.cpfCnpjRecebedor": "***.***.***-01" });
  assert.equal((await revalidatePaidPaymentBeneficiary(current)).beneficiaryVerificationStatus, "divergent");
  assert.equal((await ref.get()).get("beneficiaryVerificationWarning"), current.beneficiaryVerificationWarning);
  assert.equal((await ref.collection("events").limit(10).get()).size, 0);
});
