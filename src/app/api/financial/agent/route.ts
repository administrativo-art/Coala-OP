import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { runFinancialAgent } from "@/features/financial/agent/service";
import { readFinancialAgentMapping } from "@/features/financial/agent/mapping.server";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

export const POST = withApiErrorHandling({ source: "api-financial", operation: "financial-agent-read",
  routeOrJob: "/api/financial/agent" }, async (request: NextRequest) => {
  const context = await requireUser(request).catch(() => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" });
  });
  if (!context.isDefaultAdmin) throw new AppError({ code: "FINANCIAL_AGENT_FORBIDDEN", kind: "AUTHORIZATION" });
  const body = await request.text();
  if (body.length > 2048) throw new AppError({ code: "FINANCIAL_AGENT_BODY_TOO_LARGE", kind: "VALIDATION" });
  let input: unknown;
  try { input = JSON.parse(body); }
  catch { throw new AppError({ code: "FINANCIAL_AGENT_INVALID_JSON", kind: "VALIDATION" }); }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]);
  const result = await runFinancialAgent(input, context, {
    resolveMapping: readFinancialAgentMapping,
    readStone: query => fetchStoneAgendaXml(query, { apiKey: process.env.STONE_CONCILIATION_API_KEY, signal }),
    prioritize: process.env.ENABLE_AI_FEATURES === "true" ? async data => {
      const { prioritizeFinancialAgentActions } = await import("@/ai/flows/financial-agent-flow");
      return prioritizeFinancialAgentActions(data, request.signal);
    } : undefined,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
