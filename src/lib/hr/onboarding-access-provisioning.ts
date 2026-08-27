import "server-only";

import { hrDbAdmin } from "@/lib/firebase-rh-admin";

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function maybeAdvanceAfterFirstAccess(onboardingId: string) {
  const ref = hrDbAdmin.collection("onboardingProcesses").doc(onboardingId);
  return hrDbAdmin.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return { advanced: false as const, reason: "not_found" as const };

    const process = snap.data() ?? {};
    if (["cancelled", "completed"].includes(String(process.status ?? ""))) {
      return { advanced: false as const, reason: "closed" as const };
    }

    const accessProvisioning = asRecord(process.accessProvisioning);
    const email = asRecord(accessProvisioning.email);
    const firstAccess = asRecord(process.firstAccess);
    const userCreated = Boolean(asString(process.collaboratorUserId));
    const emailDelivered = email.status === "delivered";
    const passwordCreated = firstAccess.status === "used";

    if (!userCreated || !emailDelivered || !passwordCreated) {
      const status = !userCreated
        ? "pending"
        : ["failed", "bounced", "complained", "suppressed"].includes(String(email.status ?? ""))
          ? "failed"
          : !emailDelivered
            ? "awaiting_delivery"
            : "awaiting_password";
      transaction.set(ref, {
        accessProvisioning: {
          ...accessProvisioning,
          status,
        },
      }, { merge: true });
      return { advanced: false as const, reason: status };
    }

    if (process.currentStage !== "formalization_validation") {
      return { advanced: false as const, reason: "already_advanced" as const };
    }

    const completedAt = new Date().toISOString();
    transaction.set(ref, {
      status: "active",
      currentStage: "integration",
      currentStageStartedAt: completedAt,
      formalizationCompletedAt: completedAt,
      accessProvisioning: {
        ...accessProvisioning,
        status: "completed",
        completedAt,
      },
      updatedAt: completedAt,
    }, { merge: true });
    return { advanced: true as const, completedAt };
  });
}
