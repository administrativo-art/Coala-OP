import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { assertCashClosureAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { syncCashClosureSchema } from "@/features/financial/cash-closures/schemas";
import { syncCashClosure } from "@/features/financial/cash-closures/service.server";
import { AppError } from "@/lib/observability";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type SyncInput = { kioskId: string; date: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.cash-closure.sync",
  version: 1,
  surface: { method: "POST", path: "/api/financial/cash-closures/sync" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.cash-closures.resync" },
  resourceScope: { kind: "unit" },
  // Unknown fields are dropped by the schema, as before this route had a contract.
  input: { kind: "schema", schema: "financial.cash-closure.sync", unknownFields: "strip" },
  effects: { mode: "external", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, SyncInput, { workspaceId: string; unitId: string }>({
  id: "financial-cash-closure-sync-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "unit-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const parsed = syncCashClosureSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "CASH_CLOSURE_SYNC_INVALID",
        kind: "VALIDATION",
        safeMessage: "Informe uma unidade e uma data válidas.",
        cause: parsed.error,
      });
    }
    try {
      assertCashClosureAccess(actor, "resync", parsed.data.kioskId);
    } catch (cause) {
      throw new AppError({ code: "CASH_CLOSURE_SYNC_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, unitId: parsed.data.kioskId } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await syncCashClosure({
    workspaceId: security.actor.workspace_id,
    kioskId: security.input.kioskId,
    date: security.input.date,
    actor: cashClosureActor(security.actor),
    // Notes the operators attached to sangrias in the app are reconciled as soon as the day is in.
    context: security.actor,
  });
  return NextResponse.json({
    closure: result.closure,
    lines: result.lines,
    operators: result.operators,
    created: result.created,
    sourceChanged: result.sourceChanged,
  });
});
