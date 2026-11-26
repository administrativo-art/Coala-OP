import "server-only";
import type { DocumentReference } from "firebase-admin/firestore";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { AppError } from "@/lib/observability/app-error";
export async function submitOpenOnboardingProcess(ref: DocumentReference, update: Record<string, unknown>, token: string) {
  await hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.get("publicToken") !== token || current.get("publicTokenClosedAt") || current.get("documentDiscard") || ["cancelled", "completed"].includes(String(current.get("status")))) throw new AppError({ code: "ONBOARDING_SUBMISSION_CLOSED", kind: "CONFLICT", safeMessage: "O processo foi encerrado e não aceita mais documentos." });
    tx.set(ref, update, { merge: true });
  });
}
