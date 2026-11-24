import { type NextRequest, NextResponse } from "next/server";
import { type ServerUserContext, requireAuthenticatedUser } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { readSalesReviewBinding } from "@/features/financial/sales-reconciliation/mapping.server";
import { readSalesReviewBody } from "@/features/financial/sales-reconciliation/request-body";
import {
  resolveUnlinkedPix, unlinkedResolutionRequestSchema, type UnlinkedResolutionRequest,
} from "@/features/financial/sales-reconciliation/unlinked-resolution.server";
import type { SalesReviewBinding } from "@/features/financial/sales-reconciliation/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<Record<string, never>> };
const contract = defineSecurityContract({
  schemaVersion: 1, id: "financial.pdv-stone-review.resolve-unlinked-pix", version: 1,
  surface: { method: "POST", path: "/api/financial/pdv-stone-review/unlinked-resolution" },
  exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-default-admin" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.pdv-stone-review.resolve-unlinked-pix", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized",
});

function assertDefaultAdmin(actor: ServerUserContext) {
  if (!actor.isDefaultAdmin) throw new AppError({ code: "SALES_REVIEW_FORBIDDEN", kind: "AUTHORIZATION" });
}

const enforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, UnlinkedResolutionRequest, SalesReviewBinding>(contract, {
  async authenticate({ request }) {
    return requireAuthenticatedUser(request).catch(() => {
      throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" });
    });
  },
  async parseInput({ request }) {
    const parsed = unlinkedResolutionRequestSchema.safeParse(await readSalesReviewBody(request));
    if (!parsed.success) throw new AppError({ code: "SALES_REVIEW_UNLINKED_INPUT", kind: "VALIDATION",
      safeMessage: "Informe uma justificativa de 12 a 500 caracteres para a resolução." });
    return parsed.data;
  },
  authorize({ actor }) { assertDefaultAdmin(actor); },
  loadResource({ actor, input }) {
    assertDefaultAdmin(actor);
    return readSalesReviewBinding(input, actor.workspace_id);
  },
  assertScope({ actor, input, resource }) {
    if (resource.mapping.workspaceId !== actor.workspace_id || resource.mapping.id !== input.mappingId
      || resource.mapping.kioskId !== input.kioskId || !resource.mapping.stoneCodes.includes(input.stoneCode)) {
      throw new AppError({ code: "SALES_REVIEW_UNLINKED_SCOPE", kind: "AUTHORIZATION" });
    }
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { input, resource, actor } = security;
  const result = await resolveUnlinkedPix(input, resource, { namespace: "main.users", id: actor.decoded.uid });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
