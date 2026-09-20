import { Timestamp } from "firebase-admin/firestore";

import { calculateFinancialObligationSummary, moneyToCents } from "@/features/financial/obligations/calculations";
import type { FinancialObligationSummary } from "@/features/financial/obligations/types";
import {
  consultExpenseProvision,
  expenseProvisionIdentity,
} from "@/features/financial/lib/expense-provisions";
import { financialExpenseAccountingFields } from "@/features/financial/lib/expense-accounting-contract";
import { inheritExpenseReferenceCenter } from "@/features/financial/lib/expense-reference-center";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability";

type Actor = { uid: string; name?: string | null; email?: string | null };
type RawRecord = Record<string, any>;

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function reconciledSummary(actual: RawRecord, provision: RawRecord): FinancialObligationSummary {
  const forecastAmountCents = moneyToCents(provision.totalValue);
  const actualAmountCents = moneyToCents(actual.totalValue);
  const current = asRecord(actual.settlementSummary);
  if (Object.keys(current).length > 0) {
    return {
      ...current,
      forecastAmountCents,
      actualAmountCents,
      settlementAmountCents: Number.isInteger(current.settlementAmountCents)
        ? current.settlementAmountCents
        : actualAmountCents,
      balanceAmountCents: Number.isInteger(current.balanceAmountCents)
        ? current.balanceAmountCents
        : actualAmountCents,
    } as FinancialObligationSummary;
  }
  return calculateFinancialObligationSummary({
    forecastAmountCents,
    actualAmountCents,
    settlementAmountCents: actualAmountCents,
  });
}

export async function reconcileExpenseProvisionOnServer(
  expenseId: string,
  actor: Actor,
  options: {
    identity?: { provisionSeriesKey: string; provisionCompetence: string; provisionType: "actual" };
    expensePatch?: RawRecord;
    createIfMissing?: RawRecord;
  } = {},
) {
  const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const expenseSnapshot = await transaction.get(expenseRef);
    if (!expenseSnapshot.exists && !options.createIfMissing) {
      throw new AppError({
        code: "EXPENSE_NOT_FOUND",
        kind: "NOT_FOUND",
        safeMessage: "Despesa não encontrada.",
      });
    }
    const initialExpensePatch = expenseSnapshot.exists ? {} : options.createIfMissing ?? {};
    const actual = {
      id: expenseRef.id,
      ...expenseSnapshot.data(),
      ...initialExpensePatch,
      ...options.expensePatch,
    } as RawRecord;
    const identity = options.identity ?? expenseProvisionIdentity(actual);
    if (!identity?.provisionSeriesKey || !identity.provisionCompetence || identity.provisionType !== "actual") {
      return { status: "not_applicable" as const };
    }

    const relatedSnapshot = await transaction.get(
      financialDbAdmin.collection("expenses")
        .where("provisionSeriesKey", "==", identity.provisionSeriesKey)
        .where("provisionCompetence", "==", identity.provisionCompetence)
        .limit(11),
    );
    if (relatedSnapshot.size >= 11) {
      throw new AppError({
        code: "EXPENSE_PROVISION_CANDIDATE_LIMIT_REACHED",
        kind: "DATA_INTEGRITY",
        safeMessage: "Há lançamentos demais com a mesma identidade; a conciliação foi bloqueada para revisão.",
        metadata: {
          provisionSeriesKey: identity.provisionSeriesKey,
          provisionCompetence: identity.provisionCompetence,
        },
      });
    }
    const related = relatedSnapshot.docs.map((document) => (
      { id: document.id, ...document.data() } as RawRecord
    ));
    const existingActual = related.find((candidate) => (
      candidate.id !== expenseId
      && candidate.provisionType === "actual"
      && candidate.status !== "cancelled"
    ));
    if (!expenseSnapshot.exists && existingActual) {
      throw new AppError({
        code: "EXPENSE_ACTUAL_ALREADY_EXISTS",
        kind: "CONFLICT",
        safeMessage: "Já existe uma despesa realizada para esta identidade e competência.",
        metadata: { expenseId, existingExpenseId: existingActual.id },
      });
    }
    const consultation = consultExpenseProvision({ ...actual, ...identity }, related);
    const accountingFields = financialExpenseAccountingFields({ ...actual, ...identity });
    const referenceCenterFields = inheritExpenseReferenceCenter(
      actual,
      "provision" in consultation ? asRecord(consultation.provision) : {},
    );
    const now = Timestamp.now();

    if (consultation.status === "ambiguous") return { status: "ambiguous" as const };
    if (consultation.status === "missing") {
      transaction.set(expenseRef, {
        ...initialExpensePatch,
        ...options.expensePatch,
        ...identity,
        ...accountingFields,
        ...referenceCenterFields,
        provisionReconciliationStatus: "forecast_not_found",
        updatedAt: now,
      }, { merge: true });
      return { status: "missing" as const };
    }
    if (consultation.status === "not_applicable") return { status: "not_applicable" as const };
    if (consultation.status === "already_reconciled") {
      transaction.set(expenseRef, {
        ...initialExpensePatch,
        ...options.expensePatch,
        ...identity,
        ...accountingFields,
        ...referenceCenterFields,
        updatedAt: now,
      }, { merge: true });
      return {
        status: "already_reconciled" as const,
        provisionId: String(consultation.provision.id || actual.reconciledProvisionId || ""),
        obligationId: String(actual.obligationId || ""),
        variance: consultation.variance,
      };
    }

    const provision = consultation.provision as RawRecord;
    const provisionId = String(provision.id || actual.reconciledProvisionId || "");
    if (!provisionId) return { status: "missing" as const };
    const obligationId = String(actual.obligationId || provision.obligationId || `obl_${expenseId}`);
    const summary = reconciledSummary(actual, provision);
    const eventRef = financialDbAdmin.collection("financialObligations").doc(obligationId).collection("events").doc();

    transaction.set(expenseRef, {
      ...initialExpensePatch,
      ...options.expensePatch,
      ...identity,
      ...accountingFields,
      ...referenceCenterFields,
      obligationId,
      reconciledProvisionId: provisionId,
      provisionReconciliationStatus: "reconciled",
      provisionedValue: consultation.provisionedValue,
      provisionVariance: consultation.variance,
      provisionReconciledAt: now,
      provisionReconciledBy: actor.uid,
      settlementSummary: summary,
      updatedAt: now,
    }, { merge: true });
    transaction.set(financialDbAdmin.collection("expenses").doc(provisionId), {
      obligationId,
      status: "reconciled",
      replacedByExpenseId: expenseId,
      actualValue: consultation.actualValue,
      provisionVariance: consultation.variance,
      provisionReconciliationStatus: "reconciled",
      provisionReconciledAt: now,
      provisionReconciledBy: actor.uid,
      updatedAt: now,
    }, { merge: true });
    transaction.set(financialDbAdmin.collection("financialObligations").doc(obligationId), {
      sourceType: "EXPENSE",
      sourceId: expenseId,
      obligationType: "EXPENSE",
      supplierName: String(actual.supplier || actual.employeeName || "Despesa"),
      competenceKey: identity.provisionCompetence,
      seriesKey: identity.provisionSeriesKey,
      status: summary.obligationStatus,
      reconciliationStatus: summary.reconciliationStatus,
      summary,
      updatedAt: now,
    }, { merge: true });
    if (provision.obligationId && provision.obligationId !== obligationId) {
      transaction.set(financialDbAdmin.collection("financialObligations").doc(String(provision.obligationId)), {
        status: "CANCELLED",
        reconciliationStatus: "MATCHED",
        replacedByObligationId: obligationId,
        voidReason: "RECONCILED_TO_ACTUAL_OBLIGATION",
        updatedAt: now,
      }, { merge: true });
    }
    transaction.set(eventRef, {
      type: "PROVISION_RECONCILED",
      expenseId,
      provisionId,
      forecastAmountCents: moneyToCents(consultation.provisionedValue),
      actualAmountCents: moneyToCents(consultation.actualValue),
      varianceAmountCents: moneyToCents(consultation.variance),
      actorId: actor.uid,
      actorName: actor.name || null,
      occurredAt: now,
    });
    return {
      status: "reconciled" as const,
      provisionId,
      obligationId,
      variance: consultation.variance,
    };
  });
}
