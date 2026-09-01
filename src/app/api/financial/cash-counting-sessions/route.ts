import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { assertCashClosureAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import {
  canViewCashCountingSession,
} from "@/features/financial/cash-counting-sessions/access.server";
import {
  createCashCountingSession,
  listCashCountingSessions,
} from "@/features/financial/cash-counting-sessions/repository.server";
import { createCashCountingSessionSchema } from "@/features/financial/cash-counting-sessions/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/financial/cash-counting-sessions";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-cash-counting-sessions",
  routeOrJob: ROUTE,
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  try {
    assertCashClosureAccess(context, "view");
  } catch (cause) {
    throw new AppError({ code: "CASH_COUNTING_SESSION_VIEW_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const sessions = (await listCashCountingSessions(context.workspace_id))
    .filter((session) => canViewCashCountingSession(context, session));
  return NextResponse.json({ sessions }, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "create-cash-counting-session",
  routeOrJob: ROUTE,
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const parsed = createCashCountingSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_COUNTING_SESSION_INVALID",
      kind: "VALIDATION",
      safeMessage: parsed.error.issues[0]?.message ?? "Selecione unidades válidas.",
      cause: parsed.error,
    });
  }
  const unitRefs = parsed.data.kioskIds.map((kioskId) => dbAdmin.collection("kiosks").doc(kioskId));
  const unitSnapshots = await dbAdmin.getAll(...unitRefs);
  const units = unitSnapshots.map((snapshot, index) => {
    if (!snapshot.exists) {
      throw new AppError({
        code: "CASH_COUNTING_SESSION_UNIT_NOT_FOUND",
        kind: "NOT_FOUND",
        safeMessage: `A unidade ${parsed.data.kioskIds[index]} não foi encontrada.`,
      });
    }
    try {
      assertCashClosureAccess(context, "approve", snapshot.id);
    } catch (cause) {
      throw new AppError({ code: "CASH_COUNTING_SESSION_CREATE_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    const data = snapshot.data() ?? {};
    return { id: snapshot.id, name: typeof data.name === "string" ? data.name : snapshot.id };
  });
  const session = await createCashCountingSession({
    workspaceId: context.workspace_id,
    units,
    actor: cashClosureActor(context),
  }).catch((cause) => {
    const message = cause instanceof Error ? cause.message : "";
    if (message.includes("Já existe uma sessão aberta")) {
      throw new AppError({
        code: "CASH_COUNTING_SESSION_SCOPE_LOCKED",
        kind: "CONFLICT",
        safeMessage: "Já existe uma sessão de contagem aberta para uma das unidades selecionadas.",
        cause,
      });
    }
    throw cause;
  });
  return NextResponse.json({ session }, { status: 201 });
});
