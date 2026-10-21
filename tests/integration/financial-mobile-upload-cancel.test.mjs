import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository", databaseId: "coala-financeiro" });
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { WORKSPACE_ID } = await import("../../src/lib/workspace.ts");
const { mobileInboxDocumentId } = await import("../../src/features/financial/inbox/mobile-upload.ts");
const { cancelFinancialMobileUpload } = await import("../../src/features/financial/inbox/mobile-upload.server.ts");

const sender = { decoded: { uid: "cancel-sender-uid", email: null }, userDoc: { id: "cancel-sender" }, workspace_id: WORKSPACE_ID, isDefaultAdmin: false, permissions: {} };
const other = { ...sender, decoded: { uid: "cancel-other-uid", email: null }, userDoc: { id: "cancel-other" } };
const owned = [];
const rejected = code => error => error.code === `FINANCIAL_INBOX_MOBILE_CANCEL_${code}`;

async function seed(submissionId, extra = {}) {
  const ref = db.collection("financialInboxMessages").doc(mobileInboxDocumentId(WORKSPACE_ID, submissionId));
  owned.push(ref);
  await ref.set({ workspaceId: WORKSPACE_ID, provider: "mobile", status: "pending_review", submittedBy: { userId: sender.userDoc.id }, localPurchaseId: null, ...extra });
  return ref;
}

test.after(async () => {
  for (const ref of owned) {
    const events = await ref.collection("events").get();
    await Promise.all(events.docs.map(event => event.ref.delete()));
    await ref.delete();
  }
});

test("sender discards an unconfirmed note once; repeats are harmless", async () => {
  const id = "0b9f8a52-3c51-4c27-9d0e-1d8f6f6f0001";
  const ref = await seed(id);
  await assert.rejects(cancelFinancialMobileUpload({ actor: other, submissionId: id }), rejected("FORBIDDEN"));
  assert.deepEqual(await cancelFinancialMobileUpload({ actor: sender, submissionId: id }), { status: "cancelled" });
  const stored = await ref.get();
  assert.equal(stored.get("status"), "ignored");
  assert.equal(stored.get("resolution.status"), "discarded");
  assert.equal((await ref.collection("events").where("type", "==", "MOBILE_UPLOAD_CANCELLED").get()).size, 1);
  assert.deepEqual(await cancelFinancialMobileUpload({ actor: sender, submissionId: id }), { status: "cancelled" });
  assert.equal((await ref.collection("events").get()).size, 1);
});

test("a note never uploaded only needs the phone to drop it", async () => {
  assert.deepEqual(await cancelFinancialMobileUpload({ actor: sender, submissionId: "0b9f8a52-3c51-4c27-9d0e-1d8f6f6f0002" }), { status: "not_found" });
});

test("a confirmed purchase or a note already handled by finance is never discarded here", async () => {
  const confirmed = "0b9f8a52-3c51-4c27-9d0e-1d8f6f6f0003";
  const confirmedRef = await seed(confirmed, { localPurchaseId: "purchase-1" });
  await assert.rejects(cancelFinancialMobileUpload({ actor: sender, submissionId: confirmed }), rejected("CONFIRMED"));
  assert.equal((await confirmedRef.get()).get("status"), "pending_review");
  const handled = "0b9f8a52-3c51-4c27-9d0e-1d8f6f6f0004";
  await seed(handled, { status: "identified" });
  await assert.rejects(cancelFinancialMobileUpload({ actor: sender, submissionId: handled }), rejected("STATE"));
});
