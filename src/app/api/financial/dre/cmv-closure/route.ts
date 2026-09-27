import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { cmvClosureInputSchema } from "@/features/financial/dre/cmv-closure";
import { mutateCmvClosure } from "@/features/financial/dre/cmv-closure.server";
import { DreSourceLimitError } from "@/features/financial/dre/source-data";

export const POST = withApiErrorHandling({ source: "api-financial", operation: "mutate-dre-cmv-closure",
  routeOrJob: "/api/financial/dre/cmv-closure" }, async (request: NextRequest) => {
  const context = await requireUser(request).catch(cause => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const input = cmvClosureInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) throw new AppError({ code: "DRE_CMV_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Confira os dados do congelamento de CMV." });
  const result = await mutateCmvClosure(context, input.data).catch(cause => {
    if (cause instanceof DreSourceLimitError) throw new AppError({ code: "DRE_CMV_LIMIT_EXCEEDED", kind: "CONFLICT",
      safeMessage: "O volume desta competência ultrapassa o limite operacional de congelamento do CMV.", cause,
      metadata: { limitReason: cause.reason } });
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
