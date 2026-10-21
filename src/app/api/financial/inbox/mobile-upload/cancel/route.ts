import { NextRequest, NextResponse } from "next/server";

import { mobileInboxUploadCancelSchema, type MobileInboxUploadCancel } from "@/features/financial/inbox/mobile-upload";
import { cancelFinancialMobileUpload } from "@/features/financial/inbox/mobile-upload.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { assertMobileAppAttested } from "@/lib/security/mobile-app-attestation.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.inbox.mobile-upload.cancel",
  version: 1,
  surface: { method: "POST", path: "/api/financial/inbox/mobile-upload/cancel" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.local-purchase.register" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.inbox.mobile-upload-cancel", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
  additionalGuarantees: ["replay-protected"],
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, MobileInboxUploadCancel, { workspaceId: string }>({
  id: "financial-inbox-mobile-upload-cancel-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted", "replay-protected"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    if (!actor.isDefaultAdmin && actor.permissions.app?.localPurchase?.register !== true) {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_CANCEL_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sua conta não possui permissão para enviar notas de compras." });
    }
    const parsed = mobileInboxUploadCancelSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_CANCEL_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Dados inválidos." });
    }
    // Ownership and state are checked inside the transaction that discards the entry.
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json({ submission: await cancelFinancialMobileUpload({ actor: security.actor, submissionId: security.input.submissionId }) }));
