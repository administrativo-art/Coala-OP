import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { resolvePdvFilialId } from "@/lib/kiosk-identifiers";
import { filterUnitsByAccess } from "@/lib/unit-access";
import { assertCashClosureAccess } from "@/features/financial/cash-closures/access.server";
import { listCashClosureKioskDocuments } from "@/features/financial/cash-closures/kiosks.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/financial/cash-closures/overview";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "get-cash-closure-overview",
  routeOrJob: ROUTE,
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  try {
    assertCashClosureAccess(context, "view");
  } catch (cause) {
    throw new AppError({ code: "CASH_CLOSURE_OVERVIEW_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const kioskDocuments = await listCashClosureKioskDocuments();
  const units = filterUnitsByAccess(
    kioskDocuments.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        name: typeof data.name === "string" ? data.name : document.id,
        pdvFilialId: resolvePdvFilialId({
          id: document.id,
          pdvFilialId: typeof data.pdvFilialId === "string" ? data.pdvFilialId : null,
        }) ?? null,
      };
    }),
    context.userDoc,
    { isDefaultAdmin: context.isDefaultAdmin },
  );
  return NextResponse.json({ units }, { headers: { "Cache-Control": "private, no-store" } });
});
