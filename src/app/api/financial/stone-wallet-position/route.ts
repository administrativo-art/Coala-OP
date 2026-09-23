import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";
import { queryStoneWalletPosition } from "@/features/financial/receivables/wallet-position";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

export const GET = withApiErrorHandling({ source: "api-financial", operation: "read-stone-wallet-position",
  routeOrJob: "/api/financial/stone-wallet-position" }, async (request: NextRequest) => {
  const context = await requireUser(request).catch(() => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" });
  });
  const entries = [...request.nextUrl.searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new AppError({ code: "STONE_WALLET_QUERY_INVALID", kind: "VALIDATION" });
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]);
  const result = await queryStoneWalletPosition(Object.fromEntries(entries), context, {
    read: scope => fetchStoneAgendaXml(scope, { apiKey: process.env.STONE_CONCILIATION_API_KEY,
      layout: "XML2_4", signal }),
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
