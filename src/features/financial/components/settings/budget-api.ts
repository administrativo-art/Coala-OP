"use client";

import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { auth } from "@/lib/firebase";

export function budgetRequest<T>(url: string, method = "GET", json?: unknown) {
  return authenticatedApiRequest<T>(url, { method, json,
    getIdToken: async () => auth.currentUser?.getIdToken(),
    fallbackError: "Não foi possível concluir a operação de orçamento." });
}

export async function validateBudgetPeople(employeeIds: string[], month: string, resultCenterId: string) {
  return budgetRequest<{ people: Array<{ employeeId: string; employeeName: string; resultCenterId: string; resultCenterName: string }> }>(
    "/api/financial/budgets/person-references", "POST", { employeeIds: [...new Set(employeeIds)], month, resultCenterId });
}
