import { NextRequest, NextResponse } from "next/server";

import { stoneMappingIdSchema, stoneMerchantMappingSchema } from "@/features/financial/stone-integration/schemas";
import { saveStoneMerchantMapping, StoneIntegrationConfigurationError } from "@/features/financial/stone-integration/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { resolveUnitAccess } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withApiErrorHandling({
  source: "api-financial",
  operation: "update-stone-mapping",
  routeOrJob: "/api/financial/stone-integration/[mappingId]",
}, async (request: NextRequest, routeContext: { params: Promise<{ mappingId: string }> }) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const unitAccess = resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.stoneIntegration?.manage === true
    && unitAccess.allUnits
  );
  if (!allowed) throw new AppError({ code: "STONE_INTEGRATION_FORBIDDEN", kind: "AUTHORIZATION" });
  const { mappingId: rawMappingId } = await routeContext.params;
  const mappingId = stoneMappingIdSchema.safeParse(rawMappingId);
  const body = await request.json().catch((cause) => {
    throw new AppError({ code: "STONE_MAPPING_BODY_INVALID", kind: "VALIDATION", safeMessage: "Envie um mapeamento JSON válido.", cause });
  });
  const parsed = stoneMerchantMappingSchema.safeParse(body);
  if (!mappingId.success || !parsed.success) {
    throw new AppError({ code: "STONE_MAPPING_INVALID", kind: "VALIDATION", safeMessage: "Revise o identificador e os dados do mapeamento.", cause: parsed.success ? mappingId.error : parsed.error });
  }
  const { reason, ...draft } = parsed.data;
  const mapping = await saveStoneMerchantMapping({
    workspaceId: context.workspace_id,
    mappingId: mappingId.data,
    draft,
    reason,
    actor: {
      id: context.decoded.uid,
      name: context.userDoc.username?.trim() || context.decoded.name?.trim() || null,
      email: context.userDoc.email ?? context.decoded.email ?? null,
    },
  }).catch((cause) => {
    if (cause instanceof StoneIntegrationConfigurationError) {
      throw new AppError({
        code: `STONE_INTEGRATION_${cause.code}`,
        kind: cause.code === "NOT_FOUND" || cause.code.endsWith("NOT_FOUND")
          ? "NOT_FOUND"
          : cause.code === "MAPPING_CONFLICT" || cause.code === "LIMIT" ? "CONFLICT" : "VALIDATION",
        safeMessage: cause.message,
        cause,
      });
    }
    throw cause;
  });
  return NextResponse.json({ mapping }, { headers: { "Cache-Control": "private, no-store" } });
});
