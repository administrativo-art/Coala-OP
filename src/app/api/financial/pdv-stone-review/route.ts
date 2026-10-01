import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { z } from "zod";
import { financialAgentIdentifier } from "@/features/financial/agent/contracts";
import { reviewDate } from "@/features/financial/sales-reconciliation/validation";
import { calendarDateRangeDays } from "@/features/financial/sales-reconciliation/review-calendar";
import { readSalesReviewBody } from "@/features/financial/sales-reconciliation/request-body";
import { readSalesReviewCalendarBinding } from "@/features/financial/sales-reconciliation/mapping.server";
import { listDailySalesReviewCalendar, readDailySalesReviewSnapshot } from "@/features/financial/sales-reconciliation/review-state.server";
import { collectDailySalesReview } from "@/features/financial/sales-reconciliation/review-service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

const calendarQuerySchema = z.object({
  resource: z.enum(["calendar", "snapshot"]),
  kioskId: financialAgentIdentifier,
  mappingId: financialAgentIdentifier,
  stoneCode: z.string().regex(/^[1-9]\d{0,19}$/),
  from: reviewDate.optional(),
  through: reviewDate.optional(),
  referenceDate: reviewDate.optional(),
}).strict().superRefine((value, context) => {
  if (value.resource === "calendar") {
    if (!value.from || !value.through || value.from > value.through
      || calendarDateRangeDays(value.from, value.through) > 366) {
      context.addIssue({ code: "custom", message: "Intervalo de calendário inválido." });
    }
  } else if (!value.referenceDate) context.addIssue({ code: "custom", message: "Data da revisão ausente." });
});

async function admin(request: NextRequest) {
  const context = await requireUser(request).catch(() => { throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" }); });
  if (!context.isDefaultAdmin) throw new AppError({ code: "SALES_REVIEW_FORBIDDEN", kind: "AUTHORIZATION" });
  return context;
}

export const GET = withApiErrorHandling({ source: "api-financial", operation: "read-pdv-stone-review", routeOrJob: "/api/financial/pdv-stone-review" }, async (request: NextRequest) => {
  const context = await admin(request);
  const parsed = calendarQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw new AppError({ code: "SALES_REVIEW_CALENDAR_QUERY_INVALID", kind: "VALIDATION",
    safeMessage: "Informe um vínculo e um período válido de até 366 dias." });
  const input = parsed.data;
  await readSalesReviewCalendarBinding(input, context.workspace_id);
  const identity = { workspaceId: context.workspace_id, kioskId: input.kioskId, mappingId: input.mappingId,
    stoneCode: input.stoneCode, referenceDate: input.referenceDate ?? input.from! };
  if (input.resource === "snapshot") {
    return NextResponse.json({ result: await readDailySalesReviewSnapshot(identity) }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const records = await listDailySalesReviewCalendar({ ...identity, from: input.from!, through: input.through! });
  return NextResponse.json({ from: input.from, through: input.through, records }, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = withApiErrorHandling({ source: "api-financial", operation: "pdv-stone-review", routeOrJob: "/api/financial/pdv-stone-review" }, async (request: NextRequest) => {
  const context = await admin(request);
  const input = await readSalesReviewBody(request);
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(110_000), controller.signal]);
  try {
    return NextResponse.json(await collectDailySalesReview(input, context, context.decoded.uid, signal),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (signal.aborted) throw new AppError({ code: "SALES_REVIEW_CANCELLED", kind: "TRANSIENT_EXTERNAL",
      safeMessage: "A consulta foi cancelada ou excedeu o prazo. Tente novamente." });
    throw error;
  } finally { controller.abort(); }
});
