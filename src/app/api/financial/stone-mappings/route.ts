import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { financialAgentIdentifier } from "@/features/financial/agent/contracts";
import { listStoneMappingCatalog, saveStoneMapping } from "@/features/financial/agent/configuration.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function admin(request: NextRequest) {
  const context = await requireUser(request).catch(() => { throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" }); });
  if (!context.isDefaultAdmin) throw new AppError({ code: "STONE_MAPPING_FORBIDDEN", kind: "AUTHORIZATION" });
  return context;
}
const querySchema = z.object({ resource: z.enum(["mappings", "units", "accounts"]).default("mappings"), cursor: financialAgentIdentifier.optional() }).strict();
export const GET = withApiErrorHandling({ source: "api-financial", operation: "list-stone-mappings", routeOrJob: "/api/financial/stone-mappings" }, async (request: NextRequest) => {
  const context = await admin(request);
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw new AppError({ code: "STONE_MAPPING_QUERY_INVALID", kind: "VALIDATION" });
  return NextResponse.json(await listStoneMappingCatalog(context.workspace_id, parsed.data.resource, parsed.data.cursor), { headers: { "Cache-Control": "private, no-store" } });
});
export const POST = withApiErrorHandling({ source: "api-financial", operation: "save-stone-mapping", routeOrJob: "/api/financial/stone-mappings" }, async (request: NextRequest) => {
  const context = await admin(request);
  const body = await request.text();
  if (body.length > 4096) throw new AppError({ code: "STONE_MAPPING_BODY_TOO_LARGE", kind: "VALIDATION" });
  let input: unknown;
  try { input = JSON.parse(body); } catch { throw new AppError({ code: "STONE_MAPPING_JSON_INVALID", kind: "VALIDATION" }); }
  return NextResponse.json(await saveStoneMapping(input, context.workspace_id, context.decoded.uid), { headers: { "Cache-Control": "private, no-store" } });
});
