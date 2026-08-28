import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { calculateFinancialObligationSummary, moneyToCents } from "@/features/financial/obligations/calculations";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { employeeForecastSeriesKeys, isForecastAfterTermination } from "./termination";

const MAX_FORECASTS_PER_SERIES = 100;

export async function cancelFutureEmployeeForecasts(params: {
  employeeId: string;
  terminationDate: string;
  terminationProcessId: string;
  actorId: string;
}) {
  const seriesKeys = employeeForecastSeriesKeys(params.employeeId);
  const snapshots = await Promise.all(seriesKeys.map((seriesKey) =>
    financialDbAdmin.collection("expenses")
      .where("provisionSeriesKey", "==", seriesKey)
      .where("provisionType", "==", "forecast")
      .where("status", "==", "provisioned")
      .limit(MAX_FORECASTS_PER_SERIES)
      .get(),
  ));
  for (const [index, snapshot] of snapshots.entries()) {
    if (snapshot.size === MAX_FORECASTS_PER_SERIES) {
      throw new Error(`A série ${seriesKeys[index]} atingiu o limite seguro de ${MAX_FORECASTS_PER_SERIES} provisões.`);
    }
  }

  const targets = snapshots.flatMap((snapshot) => snapshot.docs).filter((document) =>
    isForecastAfterTermination(document.get("provisionCompetence"), params.terminationDate),
  );
  if (targets.length === 0) return { cancelledExpenseIds: [], cancelledCount: 0 };

  const batch = financialDbAdmin.batch();
  const now = Timestamp.now();
  for (const document of targets) {
    const data = document.data();
    const summary = calculateFinancialObligationSummary({
      forecastAmountCents: moneyToCents(data.totalValue),
      actualAmountCents: null,
      settlementAmountCents: null,
      cancelled: true,
    });
    const installments = Array.isArray(data.installments)
      ? data.installments.map((installment) => ({ ...installment, status: "cancelled" }))
      : data.installments ?? null;
    batch.update(document.ref, {
      status: "cancelled",
      installments,
      paymentState: "cancelled",
      settlementSummary: summary,
      cancellationReason: "Desligamento do colaborador antes da competência provisionada.",
      cancelledAt: now,
      cancelledBy: params.actorId,
      terminationProcessId: params.terminationProcessId,
      updatedAt: now,
      updatedBy: params.actorId,
    });
    const obligationId = String(data.obligationId || "").trim();
    if (obligationId) {
      batch.set(financialDbAdmin.collection("financialObligations").doc(obligationId), {
        status: "CANCELLED",
        reconciliationStatus: summary.reconciliationStatus,
        summary,
        cancellationReason: "Desligamento do colaborador antes da competência provisionada.",
        cancelledAt: now,
        cancelledBy: params.actorId,
        terminationProcessId: params.terminationProcessId,
        updatedAt: now,
      }, { merge: true });
    }
  }
  await batch.commit();
  return { cancelledExpenseIds: targets.map((document) => document.id), cancelledCount: targets.length };
}
