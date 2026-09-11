import "server-only";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type {
  FinancialInboxAutomationMode,
  FinancialInboxAutomationSettings,
} from "./types";

export const FINANCIAL_INBOX_AUTOMATION_POLICY_VERSION = 1;
const COLLECTION = "financialInboxSettings";

export function defaultFinancialInboxAutomationSettings(): FinancialInboxAutomationSettings {
  return {
    mode: "manual",
    policyVersion: FINANCIAL_INBOX_AUTOMATION_POLICY_VERSION,
    updatedAt: null,
    updatedBy: null,
  };
}

export async function getFinancialInboxAutomationSettings(
  workspaceId: string,
): Promise<FinancialInboxAutomationSettings> {
  const snapshot = await financialDbAdmin.collection(COLLECTION).doc(workspaceId).get();
  if (!snapshot.exists) return defaultFinancialInboxAutomationSettings();
  const data = snapshot.data() ?? {};
  return {
    mode: data.mode === "document_identity" ? "document_identity" : "manual",
    policyVersion: FINANCIAL_INBOX_AUTOMATION_POLICY_VERSION,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
  };
}

export async function updateFinancialInboxAutomationSettings(params: {
  workspaceId: string;
  mode: FinancialInboxAutomationMode;
  actorId: string;
  actorEmail?: string | null;
}) {
  const reference = financialDbAdmin.collection(COLLECTION).doc(params.workspaceId);
  const eventReference = reference.collection("events").doc();
  const updatedAt = new Date().toISOString();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const previousMode: FinancialInboxAutomationMode = current.get("mode") === "document_identity"
      ? "document_identity"
      : "manual";
    const settings: FinancialInboxAutomationSettings = {
      mode: params.mode,
      policyVersion: FINANCIAL_INBOX_AUTOMATION_POLICY_VERSION,
      updatedAt,
      updatedBy: params.actorId,
    };
    transaction.set(reference, settings, { merge: true });
    transaction.create(eventReference, {
      type: "FINANCIAL_INBOX_AUTOMATION_MODE_CHANGED",
      at: updatedAt,
      actorId: params.actorId,
      actorEmail: params.actorEmail ?? null,
      previousMode,
      nextMode: params.mode,
      policyVersion: FINANCIAL_INBOX_AUTOMATION_POLICY_VERSION,
    });
    return settings;
  });
}
