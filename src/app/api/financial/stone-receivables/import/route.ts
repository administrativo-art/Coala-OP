import { NextRequest, NextResponse } from "next/server";

import { StoneFinancialImportValidationError } from "@/features/financial/stone-receivables/ingestion.server";
import {
  importStoneFinancialBatch,
  StoneFinancialAccessError,
  StoneFinancialConflictError,
} from "@/features/financial/stone-receivables/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { canAccessUnit } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "import-stone-financial-data",
  routeOrJob: "/api/financial/stone-receivables/import",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.stoneIntegration?.manage === true
  );
  if (!allowed) throw new AppError({ code: "STONE_FINANCIAL_IMPORT_FORBIDDEN", kind: "AUTHORIZATION" });
  const body = await request.json().catch((cause) => {
    throw new AppError({ code: "STONE_FINANCIAL_IMPORT_BODY_INVALID", kind: "VALIDATION", safeMessage: "Envie um lote JSON válido.", cause });
  });
  const result = await importStoneFinancialBatch(body, {
    id: context.decoded.uid,
    workspaceId: context.workspace_id,
    canAccessKiosk: (kioskId) => canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
  }).catch((cause) => {
    if (cause instanceof StoneFinancialImportValidationError) {
      throw new AppError({
        code: "STONE_FINANCIAL_IMPORT_INVALID",
        kind: "VALIDATION",
        safeMessage: cause.rowNumber ? `${cause.message} Verifique a linha ${cause.rowNumber}.` : cause.message,
        cause,
        metadata: { rowNumber: cause.rowNumber },
      });
    }
    if (cause instanceof StoneFinancialAccessError) {
      throw new AppError({ code: "STONE_FINANCIAL_IMPORT_SCOPE_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    if (cause instanceof StoneFinancialConflictError) {
      throw new AppError({ code: "STONE_FINANCIAL_IMPORT_CONFLICT", kind: "CONFLICT", safeMessage: cause.message, cause });
    }
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
