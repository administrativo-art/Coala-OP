import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { maintainFinancialInbox } from "@/features/financial/inbox/maintenance.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  mode: z.enum(["dry-run", "execute"]).default("dry-run"),
  batchSize: z.number().int().min(1).max(400).optional(),
});

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "maintain-financial-inbox",
  routeOrJob: "/api/jobs/financial-inbox/maintenance",
}, async (request: NextRequest) => {
  const secret = process.env.INTER_RECONCILIATION_SECRET?.trim();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !authorized(token, secret)) {
    throw new AppError({ code: "FINANCIAL_INBOX_MAINTENANCE_UNAUTHORIZED", kind: "AUTHENTICATION" });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    throw new AppError({
      code: "FINANCIAL_INBOX_MAINTENANCE_INVALID",
      kind: "VALIDATION",
      safeMessage: "Modo ou tamanho do lote de manutenção inválido.",
      cause: parsed.error,
    });
  }
  const result = await maintainFinancialInbox({
    dryRun: parsed.data.mode !== "execute",
    batchSize: parsed.data.batchSize,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
