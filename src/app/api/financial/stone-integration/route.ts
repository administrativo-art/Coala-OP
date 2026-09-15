import { NextRequest, NextResponse } from "next/server";

import {
  stoneIntegrationListQuerySchema,
  stoneMerchantMappingSchema,
} from "@/features/financial/stone-integration/schemas";
import {
  listStoneIntegrationConfiguration,
  saveStoneMerchantMapping,
  StoneIntegrationConfigurationError,
} from "@/features/financial/stone-integration/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { resolveUnitAccess } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireStoneIntegrationManager(request: NextRequest) {
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
  return context;
}

function rethrowConfigurationError(cause: unknown): never {
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
}

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-stone-integration",
  routeOrJob: "/api/financial/stone-integration",
}, async (request: NextRequest) => {
  const context = await requireStoneIntegrationManager(request);
  const parsed = stoneIntegrationListQuerySchema.safeParse({
    cursor: request.nextUrl.searchParams.get("cursor") || undefined,
    limit: request.nextUrl.searchParams.get("limit") || undefined,
  });
  if (!parsed.success) {
    throw new AppError({ code: "STONE_INTEGRATION_QUERY_INVALID", kind: "VALIDATION", safeMessage: "Informe uma paginação válida.", cause: parsed.error });
  }
  const result = await listStoneIntegrationConfiguration({
    workspaceId: context.workspace_id,
    ...parsed.data,
  }).catch(rethrowConfigurationError);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "create-stone-mapping",
  routeOrJob: "/api/financial/stone-integration",
}, async (request: NextRequest) => {
  const context = await requireStoneIntegrationManager(request);
  const body = await request.json().catch((cause) => {
    throw new AppError({ code: "STONE_MAPPING_BODY_INVALID", kind: "VALIDATION", safeMessage: "Envie um mapeamento JSON válido.", cause });
  });
  const parsed = stoneMerchantMappingSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError({ code: "STONE_MAPPING_INVALID", kind: "VALIDATION", safeMessage: "Revise os dados e a vigência do mapeamento.", cause: parsed.error });
  }
  const { reason, ...draft } = parsed.data;
  const mapping = await saveStoneMerchantMapping({
    workspaceId: context.workspace_id,
    draft,
    reason,
    actor: {
      id: context.decoded.uid,
      name: context.userDoc.username?.trim() || context.decoded.name?.trim() || null,
      email: context.userDoc.email ?? context.decoded.email ?? null,
    },
  }).catch(rethrowConfigurationError);
  return NextResponse.json({ mapping }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
});
