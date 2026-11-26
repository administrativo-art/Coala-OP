import assert from "node:assert/strict";
import test from "node:test";

import { inboxDareExpenseFingerprint, inboxDareExpenseSchema } from "../../src/features/financial/inbox/expense-create-contract";

const source = {
  sourceAttachmentId: "pdf-1",
  sourceAttachmentSha256: "a".repeat(64),
  accountPlanId: "dare-icms-antecipado",
  referenceResultCenterId: "renascenca",
  apportionments: [
    { resultCenterId: "tirirical", percentage: 33.34 },
    { resultCenterId: "joao-paulo", percentage: 33.33 },
    { resultCenterId: "shopping", percentage: 33.33 },
  ],
  documentConfirmation: {
    amountCents: 104_999,
    dueDate: "2026-11-23",
    competence: "2026-10",
    barcode: "858900000107499903852637230716263100518788193907",
    supplierName: "Secretaria da Fazenda",
    supplierTaxId: null,
    fiscalIdentity: { documentKind: "dare", collectorName: "Secretaria da Fazenda",
      taxpayerName: "CT Sorvetes", taxpayerTaxId: "05.695.860/0001-00" },
  },
};

test("manifesto DARE exige guia, PDF e rateio fechado", () => {
  const parsed = inboxDareExpenseSchema.parse(source);
  assert.equal(parsed.documentConfirmation.fiscalIdentity.taxpayerTaxId, "05695860000100");
  assert.equal(inboxDareExpenseSchema.safeParse({ ...source, sourceAttachmentSha256: "x" }).success, false);
  assert.equal(inboxDareExpenseSchema.safeParse({ ...source, apportionments: source.apportionments.slice(1) }).success, false);
  assert.equal(inboxDareExpenseSchema.safeParse({ ...source, apportionments: [
    { resultCenterId: "tirirical", percentage: 50 },
    { resultCenterId: "joao-paulo", percentage: 25 },
    { resultCenterId: "shopping", percentage: 25 },
  ] }).success, false);
  assert.equal(inboxDareExpenseSchema.safeParse({ ...source, documentConfirmation: {
    ...source.documentConfirmation, fiscalIdentity: { ...source.documentConfirmation.fiscalIdentity, documentKind: "das" },
  } }).success, false);
});

test("fingerprint é estável para ordem do rateio e muda com valor ou PDF", () => {
  const parsed = inboxDareExpenseSchema.parse(source);
  const fingerprint = inboxDareExpenseFingerprint(parsed);
  assert.equal(fingerprint, inboxDareExpenseFingerprint({ ...parsed, apportionments: [...parsed.apportionments].reverse() }));
  assert.notEqual(fingerprint, inboxDareExpenseFingerprint({ ...parsed, documentConfirmation: {
    ...parsed.documentConfirmation, amountCents: parsed.documentConfirmation.amountCents + 1,
  } }));
  assert.notEqual(fingerprint, inboxDareExpenseFingerprint({ ...parsed, sourceAttachmentSha256: "b".repeat(64) }));
});
