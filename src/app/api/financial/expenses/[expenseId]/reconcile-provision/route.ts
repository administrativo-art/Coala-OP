import { NextRequest, NextResponse } from "next/server";

import { reconcileExpenseProvisionOnServer } from "@/features/financial/expense-provision-reconciliation.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ expenseId: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "reconcile-expense-provision",
  routeOrJob: "/api/financial/expenses/[expenseId]/reconcile-provision",
}, async (request: NextRequest, context) => {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({
      code: "EXPENSE_PROVISION_AUTHENTICATION_REQUIRED",
      kind: "AUTHENTICATION",
      cause,
    });
  });
  if (
    !actor.isDefaultAdmin
    && (!actor.permissions.financial?.view || !actor.permissions.financial?.expenses?.edit)
  ) {
    throw new AppError({
      code: "EXPENSE_PROVISION_RECONCILIATION_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para conciliar provisões.",
    });
  }
  const { expenseId } = await context.params;
  const result = await reconcileExpenseProvisionOnServer(expenseId, {
    uid: actor.decoded.uid,
    name: actor.userDoc.username,
    email: actor.decoded.email,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
