import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): value is string => typeof value === "string" && Boolean(value) && !/[/\\\u0000]/.test(value);
const signed = (value: unknown) => ["signed", "archived"].includes(String(value));
/** Finalization and its final signed artifact are both required. No person inference. */
export async function admissionArchiveReady(id: string, process: Record<string, unknown>, db: Firestore = hrDbAdmin) {
  if (process.status !== "completed" || process.currentStage !== "done" || !process.completedAt || process.documentDiscard) return false;
  if (process.employmentRelationshipType === "pj") {
    const workflow = object(process.pjWorkflow), contract = object(workflow.contract);
    if (object(object(workflow.steps).provider_activation).status !== "completed" || contract.status !== "signed" || !text(contract.signatureRequestId) || !Number.isSafeInteger(contract.version) || Number(contract.version) < 1) return false;
    const path = `hr/onboarding/${id}/pj-contracts/v${contract.version}/contrato-assinado.pdf`;
    if (contract.signedStoragePath !== path) return false;
    const request = await db.collection("hrSignatureRequests").doc(contract.signatureRequestId).get();
    return request.exists && request.get("source") === "pj_onboarding_contract" && request.get("onboardingId") === id && signed(request.get("status")) && request.get("signedStoragePath") === path;
  }
  const request = await db.collection("hrSignatureRequests").doc(`signature_bundle_${id}`).get();
  const archiveId = request.get("archivedDocumentId");
  if (!request.exists || request.get("onboardingId") !== id || !signed(request.get("status")) || !text(archiveId) || !request.get("signedStoragePath") || !/^[a-f0-9]{64}$/i.test(String(request.get("signedHash")))) return false;
  const archive = await db.collection("employeeDocuments").doc(archiveId).get();
  return archive.exists && !archive.get("deletedAt") && archive.get("documentTypeCode") === "ADMISSION_PACKAGE" && archive.get("sourceOnboardingId") === id && archive.get("signatureRequestId") === request.id && archive.get("signatureStatus") === "signed" && archive.get("storagePath") === request.get("signedStoragePath") && archive.get("contentHash") === request.get("signedHash");
}
export function admissionRecordVisibility(db: Firestore = hrDbAdmin) {
  const cache = new Map<string, Promise<boolean>>();
  return async (record: Record<string, unknown>) => {
    const id = record.sourceOnboardingId ?? record.onboardingId;
    if (id == null || id === "") return true;
    if (!text(id) || id === "." || id === "..") return false;
    if (!cache.has(id)) cache.set(id, db.collection("onboardingProcesses").doc(id).get().then((snapshot) => snapshot.exists && admissionArchiveReady(id, snapshot.data() ?? {}, db)));
    return cache.get(id)!;
  };
}
