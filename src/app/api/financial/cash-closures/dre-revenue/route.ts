import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { canAccessUnit } from "@/lib/unit-access";
import type { CashClosureMonthlySummary } from "@/features/financial/cash-closures/types";
import { AppError, withApiErrorHandling } from "@/lib/observability";

const querySchema = z.object({
  kioskIds: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  periods: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).min(1).max(6),
}).superRefine((value, context) => {
  if (new Set(value.kioskIds).size !== value.kioskIds.length) context.addIssue({ code: "custom", message: "Unidades repetidas." });
  if (new Set(value.periods).size !== value.periods.length) context.addIssue({ code: "custom", message: "Competências repetidas." });
});

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "get-dre-cash-closure-revenue",
  routeOrJob: "/api/financial/cash-closures/dre-revenue",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!context.isDefaultAdmin && (!context.permissions.financial?.view || context.permissions.financial?.dre !== true)) {
    throw new AppError({ code: "DRE_REVENUE_FORBIDDEN", kind: "AUTHORIZATION" });
  }
  const parsed = querySchema.safeParse({
    kioskIds: request.nextUrl.searchParams.getAll("kioskId"),
    periods: request.nextUrl.searchParams.getAll("period"),
  });
  if (!parsed.success) {
    throw new AppError({ code: "DRE_REVENUE_QUERY_INVALID", kind: "VALIDATION", safeMessage: "Informe unidades e competências válidas.", cause: parsed.error });
  }
  for (const kioskId of parsed.data.kioskIds) {
    if (!canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({ code: "DRE_REVENUE_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
    }
  }
  const refs = parsed.data.kioskIds.flatMap((kioskId) => parsed.data.periods.map((period) => {
    const [year, month] = period.split("-").map(Number);
    const id = `${context.workspace_id}_${kioskId}_${year}_${String(month).padStart(2, "0")}`;
    return financialDbAdmin.collection("cashClosureMonthlySummaries").doc(id);
  }));
  const snapshots = await financialDbAdmin.getAll(...refs);
  const summaries = snapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as CashClosureMonthlySummary));
  return NextResponse.json({ summaries }, { headers: { "Cache-Control": "private, no-store" } });
});
