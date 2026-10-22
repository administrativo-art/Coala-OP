import { financialDbAdmin } from "@/lib/firebase-financial-admin";

import { buildFinancialInboxSearchTerms, FINANCIAL_INBOX_SEARCH_INDEX_VERSION } from "./search-index";
import { buildFinancialInboxExpenseContext, relatedExpenseIdentity } from "./charge-case";
import { getFinancialInboxMessage } from "./repository.server";
import type { FinancialInboxMessage } from "./types";

export type FinancialInboxChargeCorrection = {
  supplierName: string | null;
  supplierTaxId: string | null;
  documentReference: string | null;
  competence: string | null;
  dueDate: string | null;
  amountCents: number | null;
};

export async function getFinancialInboxChargeCase(id: string, workspaceId: string) {
  const message = await getFinancialInboxMessage(id);
  if (message.workspaceId !== workspaceId) throw new Error("Cobrança não encontrada.");
  return getFinancialInboxChargeCaseForMessage(message, workspaceId);
}

export async function getFinancialInboxChargeCaseForMessage(message: FinancialInboxMessage, workspaceId: string) {
  const identity = relatedExpenseIdentity(message);
  if (!identity) return { message, expense: null };
  const snapshot = await financialDbAdmin.collection("expenses").doc(identity.id).get();
  if (!snapshot.exists) return { message, expense: null };
  const data = snapshot.data() ?? {};
  if (String(data.workspaceId ?? data.workspace_id ?? "") !== workspaceId) {
    throw new Error("Cobrança não encontrada.");
  }
  return {
    message,
    expense: buildFinancialInboxExpenseContext(snapshot.id, identity.source, data),
  };
}

export async function correctFinancialInboxCharge(params: {
  id: string;
  workspaceId: string;
  actorId: string;
  actorEmail?: string | null;
  correction: FinancialInboxChargeCorrection;
}) {
  const reference = financialDbAdmin.collection("financialInboxMessages").doc(params.id);
  const now = new Date().toISOString();
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.get("workspaceId") !== params.workspaceId) {
      throw new Error("Cobrança não encontrada.");
    }
    const current = { id: snapshot.id, ...snapshot.data() } as FinancialInboxMessage;
    const billingIdentity = current.classification.billingIdentity ?? {
      supplierTaxId: null,
      customerAccount: null,
      contractNumber: null,
      serviceType: null,
      serviceNumbers: [],
    };
    const classification = {
      ...current.classification,
      supplierName: params.correction.supplierName,
      competence: params.correction.competence,
      dueDate: params.correction.dueDate,
      amountCents: params.correction.amountCents,
      documentReferences: params.correction.documentReference ? [params.correction.documentReference] : [],
      billingIdentity: { ...billingIdentity, supplierTaxId: params.correction.supplierTaxId },
    };
    const next = { ...current, classification };
    transaction.set(reference, {
      classification,
      searchTerms: buildFinancialInboxSearchTerms(next),
      searchIndexVersion: FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
      searchIndexedAt: now,
      updatedAt: now,
    }, { merge: true });
    transaction.create(reference.collection("events").doc(), {
      type: "CHARGE_READING_CORRECTED",
      at: now,
      actorId: params.actorId,
      actorEmail: params.actorEmail ?? null,
      changedFields: Object.keys(params.correction),
      before: {
        supplierName: current.classification.supplierName ?? null,
        supplierTaxId: current.classification.billingIdentity?.supplierTaxId ?? null,
        documentReference: current.classification.documentReferences?.[0] ?? null,
        competence: current.classification.competence ?? null,
        dueDate: current.classification.dueDate ?? null,
        amountCents: current.classification.amountCents ?? null,
      },
      after: params.correction,
    });
  });
  return getFinancialInboxChargeCase(params.id, params.workspaceId);
}
