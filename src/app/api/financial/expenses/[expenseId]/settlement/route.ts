import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import {
  expenseReconciliationSummary,
  resolveExpenseReconciliation,
  type ExpenseReconciliationSource,
} from "@/features/financial/obligations/expense-reconciliation";
import {
  ExpenseReconciliationLimitError,
  readExpenseReconciliationEvidence,
} from "@/features/financial/obligations/expense-reconciliation.server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ expenseId: string }> };

function dateValue(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === "string" ? value : null;
}

function documentRows(snapshot: FirebaseFirestore.QuerySnapshot) {
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      ...data,
      paidAt: dateValue(data.paidAt),
      confirmedAt: dateValue(data.confirmedAt),
      classifiedAt: dateValue(data.classifiedAt),
      occurredAt: dateValue(data.occurredAt),
      createdAt: dateValue(data.createdAt),
      updatedAt: dateValue(data.updatedAt),
    };
  });
}

const querySchema = z.object({ summary: z.literal("1").optional() }).strict();

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.expenses.settlement.read",
  version: 1,
  surface: { method: "GET", path: "/api/financial/expenses/[expenseId]/settlement" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-expense-settlement-read" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.expenses.settlement.query", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

type Input = { summaryOnly: boolean };
type Resource = { expense: Record<string, unknown> & ExpenseReconciliationSource };

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, Input, Resource>({
  id: "financial-expense-settlement-read-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:financial-expense-settlement-read",
    "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    const finance = actor.permissions.financial;
    if (!actor.isDefaultAdmin && (!finance?.view || !(finance.expenses?.view || finance.reconciliation?.view))) {
      throw new AppError({ code: "EXPENSE_SETTLEMENT_READ_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para consultar a despesa." });
    }

    const { expenseId } = await routeContext.params;
    const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!/^[a-zA-Z0-9_-]{1,170}$/.test(expenseId) || !query.success || request.nextUrl.searchParams.getAll("summary").length > 1) {
      throw new AppError({ code: "EXPENSE_SETTLEMENT_READ_INVALID", kind: "VALIDATION", safeMessage: "Consulta de despesa inválida." });
    }

    const snapshot = await financialDbAdmin.collection("expenses").doc(expenseId).get();
    const data = snapshot.data();
    if (!data || (data.workspaceId && data.workspaceId !== actor.workspace_id)) {
      throw new AppError({ code: "EXPENSE_SETTLEMENT_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Despesa não encontrada." });
    }
    return { actor, input: { summaryOnly: query.data.summary === "1" },
      resource: { expense: { ...data, id: expenseId, workspaceId: data.workspaceId || actor.workspace_id } } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { expense } = security.resource;
  const { summaryOnly } = security.input;
  const headers = { "Cache-Control": "private, no-store" };
  const bankTransactions = await readExpenseReconciliationEvidence([expense], security.actor.workspace_id).catch((cause) => {
    if (cause instanceof ExpenseReconciliationLimitError) {
      throw new AppError({ code: "EXPENSE_SETTLEMENT_EVIDENCE_LIMIT", kind: "CONFLICT",
        safeMessage: "O volume de vínculos exige conferência.", cause });
    }
    throw cause;
  });
  const reconciliation = resolveExpenseReconciliation(expense, bankTransactions);
  const summary = expenseReconciliationSummary(expense, reconciliation);
  if (summaryOnly) return NextResponse.json({ reconciliation, summary }, { headers });

  const obligationId = typeof expense.obligationId === "string" && expense.obligationId
    ? expense.obligationId
    : typeof expense.latestCardStatementObligationId === "string"
      ? expense.latestCardStatementObligationId
      : "";
  if (!obligationId) {
    return NextResponse.json({ obligation: null, reconciliation, summary,
      payments: [], links: [], adjustments: [], events: [] }, { headers });
  }

  const obligationRef = financialDbAdmin.collection("financialObligations").doc(obligationId);
  const [obligationSnapshot, paymentsSnapshot, linksSnapshot, adjustmentsSnapshot, eventsSnapshot, chargeAccountsSnapshot] = await Promise.all([
    obligationRef.get(),
    financialDbAdmin.collection("payments").where("obligationId", "==", obligationId).limit(100).get(),
    financialDbAdmin.collection("obligationPaymentLinks").where("obligationId", "==", obligationId).limit(100).get(),
    financialDbAdmin.collection("paymentAdjustments").where("obligationId", "==", obligationId).limit(100).get(),
    obligationRef.collection("events").orderBy("occurredAt", "desc").limit(100).get(),
    financialDbAdmin.collection("accounts").where("dre_position", "==", "despesas_financeiras").limit(100).get(),
  ]);

  return NextResponse.json({
    obligation: obligationSnapshot.exists ? { id: obligationSnapshot.id, ...obligationSnapshot.data() } : null,
    reconciliation,
    summary,
    payments: documentRows(paymentsSnapshot),
    links: documentRows(linksSnapshot),
    adjustments: documentRows(adjustmentsSnapshot),
    events: documentRows(eventsSnapshot),
    chargeAccountPlans: chargeAccountsSnapshot.docs
      .map((document): Record<string, unknown> => ({ id: document.id, ...document.data() }))
      .filter((account) => account.active !== false && account.isGroup !== true)
      .map((account) => ({ id: account.id, name: String(account.name || account.id) })),
  }, { headers });
});
