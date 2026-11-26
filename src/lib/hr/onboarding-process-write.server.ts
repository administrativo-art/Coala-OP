import "server-only";
import type { DocumentReference } from "firebase-admin/firestore";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { AppError } from "@/lib/observability/app-error";
export async function submitOpenOnboardingProcess(ref: DocumentReference, update: Record<string, unknown>, token: string, effects: { auditId: string; audit: Record<string, unknown>; relatedWrites?: readonly { ref: DocumentReference; data: Record<string, unknown> }[] }) {
  return hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.get("publicToken") !== token || current.get("publicTokenClosedAt") || current.get("documentDiscard") || ["cancelled", "completed"].includes(String(current.get("status")))) throw new AppError({ code: "ONBOARDING_SUBMISSION_CLOSED", kind: "CONFLICT", safeMessage: "O processo foi encerrado e não aceita mais documentos." });
    if (!effects.auditId || effects.auditId.includes('/')) throw new Error('Invalid server submission audit ID');
    for (const write of effects.relatedWrites ?? []) {
      if (write.ref.firestore !== ref.firestore || write.ref.parent.parent?.path !== ref.path) throw new Error('Invalid related submission write');
      tx.set(write.ref, write.data);
    }
    tx.set(ref, update, { merge: true });
    tx.create(ref.collection('audit').doc(effects.auditId), effects.audit);
    return { ...current.data(), ...update };
  });
}
