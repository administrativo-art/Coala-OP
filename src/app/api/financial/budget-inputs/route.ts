import { NextRequest, NextResponse } from "next/server";
import { dbAdmin } from "@/lib/firebase-admin";
import { budgetActor } from "@/features/financial/budgets/access.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const GET = withApiErrorHandling({ source: "api-financial", operation: "list-budget-inputs", routeOrJob: "/api/financial/budget-inputs" }, async (request: NextRequest) => {
  await budgetActor(request, "manage");
  const snapshot = await dbAdmin.collection("baseProducts").limit(501).get();
  if (snapshot.size > 500) throw new AppError({ code: "BUDGET_INPUT_CATALOG_TOO_LARGE", kind: "VALIDATION", safeMessage: "Há insumos demais para esta seleção. Refine o catálogo." });
  return NextResponse.json({ inputs: snapshot.docs.map((doc) => ({ id: doc.id, name: doc.data().name, unit: doc.data().unit, isArchived: doc.data().isArchived }))
    .filter((item) => !item.isArchived).sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")) });
});
