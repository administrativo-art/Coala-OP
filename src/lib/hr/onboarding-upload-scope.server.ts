import "server-only";
import { processSubjectRef } from "@/features/privacy/onboarding-person";
import { subjectKey } from "@/features/privacy/person-subject";
import { createHash } from "node:crypto";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { AppError } from "@/lib/observability/app-error";
export const onboardingObjectKey = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = () => new AppError({ code: "ONBOARDING_UPLOAD_CLOSED", kind: "CONFLICT", safeMessage: "O processo não aceita mais documentos." });
const tokenPattern = /^[A-Za-z0-9_-]{16,200}$/;
export async function registerOnboardingUpload(token: string, path: string, slotId: string, hash: string) {
  if (!tokenPattern.test(token)) throw fail();
  const matches = await hrDbAdmin.collection("onboardingProcesses").where("publicToken", "==", token).limit(2).get();
  if (matches.size !== 1) throw fail();
  const parent = matches.docs[0].ref, file = parent.collection("documentFiles").doc(onboardingObjectKey(path));
  await hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(parent);
    if (!current.exists || current.get("publicToken") !== token || current.get("publicTokenClosedAt") || current.get("documentDiscard") || ["cancelled", "completed"].includes(String(current.get("status")))) throw fail();
    const subject = processSubjectRef({ ...current.data(), id: parent.id });
    const subjectKeys = subject ? [subjectKey(subject)] : [];
    tx.set(parent.collection("documentStorageScopes").doc(onboardingObjectKey(token)), { subjectKeys, prefix: `hr/onboarding/${token}/`, onboardingId: parent.id, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(file, { subjectKeys, onboardingId: parent.id, path, slotId, sha256: hash, status: "uploading", createdAt: FieldValue.serverTimestamp() });
  });
  return { parent, file };
}
export async function finishOnboardingUpload(claim: { parent: DocumentReference; file: DocumentReference }) {
  return hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(claim.parent);
    if (!current.exists || ["cancelled", "completed"].includes(String(current.get("status"))) || current.get("documentDiscard")) return false;
    tx.update(claim.file, { status: "stored", storedAt: FieldValue.serverTimestamp() });
    return true;
  });
}
/** Resolve a closed public scope only through a durable server registration or submission audit. */
export async function confirmedOnboardingPublicPrefix(id: string, process: Record<string, unknown>, path: string) {
  const parts = path.split("/");
  if (parts.length !== 4 || parts[0] !== "hr" || parts[1] !== "onboarding" || !tokenPattern.test(parts[2]) || !parts[3]) return null;
  const token = parts[2], parent = hrDbAdmin.collection("onboardingProcesses").doc(id), digest = onboardingObjectKey(token), prefix = `hr/onboarding/${token}/`;
  const registered = await parent.collection("documentStorageScopes").doc(digest).get();
  if (registered.exists && registered.get("onboardingId") === id && registered.get("prefix") === prefix) return prefix;
  if (process.publicToken === token) {
    const matches = await hrDbAdmin.collection("onboardingProcesses").where("publicToken", "==", token).select().limit(2).get();
    if (matches.size === 1 && matches.docs[0].id === id) return prefix;
  }
  const submissions = await parent.collection("audit").where("tokenHash", "==", digest).limit(25).get();
  return submissions.docs.some((entry) => ["PUBLIC_FORM_SUBMITTED", "PJ_PROVIDER_REGISTRATION_SUBMITTED"].includes(String(entry.get("action")))) ? prefix : null;
}
