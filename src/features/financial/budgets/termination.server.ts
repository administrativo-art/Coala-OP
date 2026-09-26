import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { FinancialBudget } from "./types";
import { BudgetDomainError } from "./errors";

/** Stops only future expectations, never a shared bill or its payment. Idempotent on retry. */
export async function stopTerminatedEmployeeBudgetExpectations(input: {
  employeeId: string; terminationDate: string; terminationProcessId: string; actorId: string;
}) {
  return financialDbAdmin.runTransaction(async (tx) => {
    const snapshot = await tx.get(financialDbAdmin.collection("financialBudgets")
      .where("active", "==", true).where("compositionEmployeeIds", "array-contains", input.employeeId)
      .where("competenceMonth", ">", input.terminationDate.slice(0, 7)).limit(101));
    if (snapshot.size > 100) throw new BudgetDomainError("Há mais de 100 orçamentos futuros para revisar no desligamento.");
    let stoppedCount = 0;
    for (const doc of snapshot.docs) {
      const budget = doc.data() as FinancialBudget;
      const stops = budget.expectationStops ?? [];
      const additions = (budget.composition ?? []).filter((line) => line.employeeId === input.employeeId && !stops.some((stop) => stop.lineId === line.id))
        .map((line) => ({ lineId: line.id, terminationProcessId: input.terminationProcessId, terminationDate: input.terminationDate,
          stoppedBy: input.actorId, stoppedAt: new Date().toISOString() }));
      if (!additions.length) continue;
      stoppedCount += additions.length;
      tx.update(doc.ref, { expectationStops: [...stops, ...additions], updatedAt: Timestamp.now() });
      tx.create(financialDbAdmin.collection("financialBudgetRevisions").doc(), { budgetId: doc.id, action: "termination_expectations_stopped",
        changes: additions, reason: "Desligamento anterior à competência; documento real preservado.", actorUid: input.actorId, createdAt: Timestamp.now() });
    }
    return { stoppedCount };
  });
}
