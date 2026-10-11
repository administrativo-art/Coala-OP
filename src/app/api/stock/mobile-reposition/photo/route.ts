import { NextRequest, NextResponse } from "next/server";

import { mobileRepositionPhotoQuerySchema } from "@/features/reposition/mobile-receipt";
import { assertCanReceiveMobileReposition, loadMobileRepositionPhoto } from "@/features/reposition/mobile-receipt.server";
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
  schemaVersion: 1, id: "stock.mobile-reposition.photo", version: 1,
  surface: { method: "GET", path: "/api/stock/mobile-reposition/photo" }, exposure: "authenticated",
  identity: { kind: "active-user" }, authorization: { kind: "permission", action: "app.reposition.receive" },
  resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "stock.mobile-reposition.photo-query", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" }, errorExposure: "sanitized",
});
const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, { activityId: string; baseProductId: string; lotId: string }, { unitId: string; contentType: string; bytes: Buffer }>({
  id: "stock-mobile-reposition-photo-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "unit-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => { throw new AppError({ code: "MOBILE_REPOSITION_AUTH_REQUIRED", kind: "AUTHENTICATION", cause }); });
    assertMobileAppAttested(request, actor.decoded.uid);
    assertCanReceiveMobileReposition(actor);
    const parsed = mobileRepositionPhotoQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: "MOBILE_REPOSITION_PHOTO_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Lote inválido." });
    // Lookup enforces destination access before reading the associated product.
    const photo = await loadMobileRepositionPhoto(parsed.data, actor);
    return { actor, input: parsed.data, resource: photo };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const photo = security.resource;
  return new NextResponse(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
