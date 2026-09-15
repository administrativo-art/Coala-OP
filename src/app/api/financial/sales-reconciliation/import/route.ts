import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { canAccessUnit } from "@/lib/unit-access";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import {
  explainSalesImportValidation,
  SalesImportValidationError,
} from "@/features/financial/sales-reconciliation/ingestion.server";
import {
  importCanonicalSalesBatch,
  SalesReconciliationAccessError,
  SalesReconciliationConflictError,
  SalesReconciliationLimitError,
} from "@/features/financial/sales-reconciliation/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "import-sales-reconciliation",
  routeOrJob: "/api/financial/sales-reconciliation/import",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const canManage = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.stoneIntegration?.manage === true
  );
  if (!canManage) {
    throw new AppError({ code: "STONE_IMPORT_FORBIDDEN", kind: "AUTHORIZATION" });
  }

  const body = await request.json().catch((cause) => {
    throw new AppError({
      code: "STONE_IMPORT_BODY_INVALID",
      kind: "VALIDATION",
      safeMessage: "Envie um lote JSON válido.",
      cause,
    });
  });
  const result = await importCanonicalSalesBatch(body, {
    id: context.decoded.uid,
    workspaceId: context.workspace_id,
    canAccessKiosk: (kioskId) => canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
  }).catch((cause) => {
    if (cause instanceof SalesImportValidationError) {
      const details = explainSalesImportValidation(cause);
      throw new AppError({
        code: "STONE_IMPORT_INVALID",
        kind: "VALIDATION",
        safeMessage: details.rowNumber
          ? `${details.message} Verifique a linha ${details.rowNumber}.`
          : details.message,
        cause,
        metadata: { rowNumber: details.rowNumber, issues: details.issues },
      });
    }
    if (cause instanceof SalesReconciliationAccessError) {
      throw new AppError({ code: "STONE_IMPORT_SCOPE_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    if (cause instanceof SalesReconciliationConflictError) {
      throw new AppError({
        code: "STONE_IMPORT_ALREADY_RUNNING",
        kind: "CONFLICT",
        safeMessage: "Já existe uma importação equivalente em andamento.",
        cause,
      });
    }
    if (cause instanceof SalesReconciliationLimitError) {
      throw new AppError({
        code: "STONE_IMPORT_LIMIT_EXCEEDED",
        kind: "CONFLICT",
        safeMessage: "O volume ultrapassa o limite seguro da conciliação.",
        cause,
        metadata: { limitSource: cause.source },
      });
    }
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
