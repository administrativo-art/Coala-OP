import assert from "node:assert/strict";
import test from "node:test";

import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository" });
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { createInboxDareExpense } = await import("../../src/features/financial/inbox/create-dare-expense.server.ts");
const { inboxDareExpenseSchema } = await import("../../src/features/financial/inbox/expense-create-contract.ts");

const inboxId = "dare-expense-emulator-1";
const code = "858900000107499903852637230716263100518788193907";
const attachmentHash = "a".repeat(64);
const actor = { uid: "test-operator", email: "operator@example.test" };
const input = inboxDareExpenseSchema.parse({
  sourceAttachmentId: "dare-pdf",
  sourceAttachmentSha256: attachmentHash,
  accountPlanId: "dare-icms-antecipado-test",
  referenceResultCenterId: "dare-admin-test",
  apportionments: [
    { resultCenterId: "dare-tirirical-test", percentage: 33.34 },
    { resultCenterId: "dare-joaopaulo-test", percentage: 33.33 },
    { resultCenterId: "dare-shopping-test", percentage: 33.33 },
  ],
  documentConfirmation: {
    amountCents: 104999, dueDate: "2026-11-23", competence: "2026-10", barcode: code,
    supplierName: "Secretaria da Fazenda", supplierTaxId: null,
    fiscalIdentity: { documentKind: "dare", collectorName: "Secretaria da Fazenda",
      taxpayerName: "CT Sorvetes", taxpayerTaxId: "05.695.860/0001-00" },
  },
});

test("DARE cria uma despesa pendente e repete sem duplicar", async () => {
  await db.collection("financialInboxMessages").doc(inboxId).set({
    workspaceId: "coala", status: "document_pending", subject: "Documentos fiscais",
    attachments: [{ id: "dare-pdf", filename: "dare.pdf", contentType: "application/pdf",
      archiveStatus: "stored", storagePath: "test/dare.pdf", sha256: attachmentHash }],
    classification: { documentType: "other", financeLikely: true, confidence: "medium",
      supplierName: null, competence: null, dueDate: null, amountCents: null, barcode: null,
      barcodeMasked: null, links: [], billingIdentity: null, fiscalIdentity: null },
  });
  await db.collection("accounts").doc(input.accountPlanId).set({ workspaceId: "coala", name: "ICMS antecipado", active: true, isGroup: false });
  await Promise.all([
    [input.referenceResultCenterId, "Centro administrativo - Renascença"],
    [input.apportionments[0].resultCenterId, "Tirirical"],
    [input.apportionments[1].resultCenterId, "João Paulo"],
    [input.apportionments[2].resultCenterId, "Shopping"],
  ].map(([id, name]) => db.collection("resultCenters").doc(id).set({ workspaceId: "coala", name, active: true })));

  const first = await createInboxDareExpense({ inboxId, workspaceId: "coala", actor, input });
  const second = await createInboxDareExpense({ inboxId, workspaceId: "coala", actor, input });
  assert.equal(first.expenseId, `inbox_${inboxId}`);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  const expense = (await db.collection("expenses").doc(first.expenseId).get()).data();
  assert.equal(expense.status, "pending");
  assert.equal(expense.totalValue, 1049.99);
  assert.equal(expense.accountPlan, input.accountPlanId);
  assert.deepEqual(expense.apportionments.map((entry) => entry.percentage), [33.34, 33.33, 33.33]);
  assert.equal((await db.collection("financialInboxMessages").doc(inboxId).collection("events").get()).size, 1);
  await assert.rejects(createInboxDareExpense({ inboxId, workspaceId: "coala", actor,
    input: { ...input, accountPlanId: "other-account" } }));
});
