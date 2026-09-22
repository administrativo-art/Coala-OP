import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { queryStoneAgenda } from "@/lib/integrations/stone/agenda-query";
import { readStoneAgendaXml } from "@/lib/integrations/stone/agenda.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

export const GET = withApiErrorHandling({
  source: "api-financial", operation: "read-stone-agenda",
  routeOrJob: "/api/financial/stone-agenda",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch(() => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" });
  });
  const parameters = request.nextUrl.searchParams;
  const result = await queryStoneAgenda({
    stoneCode: parameters.get("stoneCode"), referenceDate: parameters.get("referenceDate"),
    transactionId: parameters.get("transactionId") ?? undefined,
    offset: parameters.get("offset") ?? undefined,
    limit: parameters.get("limit") ?? undefined,
  }, context, readStoneAgendaXml);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
