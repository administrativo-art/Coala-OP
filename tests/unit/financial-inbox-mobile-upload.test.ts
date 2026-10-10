import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  detectMobileInboxFile,
  mobileInboxDocumentId,
  mobileInboxUploadMetadataSchema,
} from "../../src/features/financial/inbox/mobile-upload";
import { defaultAdminPermissions, defaultGuestPermissions } from "../../src/types";

test("mobile inbox upload accepts only strict, bounded metadata", () => {
  assert.equal(mobileInboxUploadMetadataSchema.safeParse({
    submissionId: "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e",
    capturedAt: "2026-10-09T12:30:00.000Z",
    note: "Compra de insumos",
    fundingSource: "cash_withdrawal",
  }).success, true);
  assert.equal(mobileInboxUploadMetadataSchema.safeParse({
    submissionId: "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e",
    linkedExpenseId: "expense-controlled-by-server",
    fundingSource: "cash_withdrawal",
  }).success, false);
  assert.equal(mobileInboxUploadMetadataSchema.safeParse({ submissionId: "not-a-uuid" }).success, false);
  assert.equal(mobileInboxUploadMetadataSchema.safeParse({
    submissionId: "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e",
    note: "x".repeat(241),
    fundingSource: "company_payment",
  }).success, false);
  assert.equal(mobileInboxUploadMetadataSchema.safeParse({
    submissionId: "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e",
    fundingSource: "personal_money",
  }).success, false);
});

test("mobile inbox upload detects content by signature instead of declared MIME", () => {
  assert.deepEqual(detectMobileInboxFile(Buffer.from([0xff, 0xd8, 0xff, 0x00])), { extension: "jpg", contentType: "image/jpeg" });
  assert.deepEqual(detectMobileInboxFile(Buffer.from("%PDF-1.7\nfixture")), { extension: "pdf", contentType: "application/pdf" });
  assert.equal(detectMobileInboxFile(Buffer.from("<script>alert(1)</script>")), null);
});

test("mobile inbox submission identity is deterministic and workspace-bound", () => {
  const submissionId = "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e";
  const first = mobileInboxDocumentId("coala", submissionId);
  assert.equal(first, mobileInboxDocumentId("coala", submissionId));
  assert.notEqual(first, mobileInboxDocumentId("other-workspace", submissionId));
  assert.match(first, /^mobile_[a-f0-9]{40}$/);
});

test("local purchase permission is independent from inbox visibility and route enforces it", () => {
  assert.equal(defaultGuestPermissions.app.localPurchase.register, false);
  assert.equal(defaultAdminPermissions.app.localPurchase.register, true);

  const route = readFileSync("src/app/api/financial/inbox/mobile-upload/route.ts", "utf8");
  assert.match(route, /permissions\.app\?\.localPurchase\?\.register !== true/);
  assert.doesNotMatch(route, /permissions\.financial\?\.view/);
  assert.match(route, /detectMobileInboxFile\(buffer\)/);
  assert.match(route, /PAYMENT_PROOF_REQUIRED/);
  assert.match(route, /PAYMENT_PROOF_UNEXPECTED/);
  assert.match(route, /MOBILE_INBOX_UPLOAD_MAX_TOTAL_BYTES/);
  assert.match(route, /additionalGuarantees: \["replay-protected"\]/);
  assert.match(route, /export const POST = secureRoute/);
  const ingestion = readFileSync("src/features/financial/inbox/mobile-upload.server.ts", "utf8");
  assert.match(ingestion, /submittedBy\.userId/);
  assert.match(ingestion, /FINANCIAL_INBOX_MOBILE_REPLAY_CONFLICT/);
  assert.match(ingestion, /sameHashes\(storedHashes\("receipt-"\)/);
  assert.match(ingestion, /sameHashes\(storedHashes\("payment-proof-"\)/);
  assert.match(route, /MOBILE_INBOX_UPLOAD_MAX_FILES_PER_ROLE/);
  assert.match(route, /FINANCIAL_INBOX_MOBILE_FILE_REPEATED/);
});
