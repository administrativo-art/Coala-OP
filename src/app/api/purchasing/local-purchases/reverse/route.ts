import { NextRequest, NextResponse } from "next/server";

import { reverseLocalPurchase } from "@/features/purchasing/local-purchase-admin.server";
import { reverseLocalPurchaseSchema } from "@/features/purchasing/local-purchase-admin";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { canRevertPurchaseStage } from "@/lib/purchasing-permissions";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type ReverseInput = { purchaseId: string; reason: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "purchasing.local-purchase.reverse",
  version: 1,
  surface: { method: "POST", path: "/api/purchasing/local-purchases/reverse" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "purchasing.revert-purchase-stage" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "purchasing.local-purchase.reverse", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
  additionalGuarantees: ["replay-protected"],
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, ReverseInput, { workspaceId: string }>({
  id: "purchasing-local-purchase-reverse-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted", "replay-protected"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "LOCAL_PURCHASE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    if (!actor.isDefaultAdmin && !canRevertPurchaseStage(actor.permissions)) {
      throw new AppError({ code: "LOCAL_PURCHASE_REVERSAL_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para estornar compras." });
    }
    const parsed = reverseLocalPurchaseSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "LOCAL_PURCHASE_REVERSAL_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Dados do estorno inválidos." });
    }
    // The purchase's unit is checked against the actor inside the reversal, where the document is read.
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await reverseLocalPurchase(security.input, security.actor), { headers: { "Cache-Control": "private, no-store" } }));
