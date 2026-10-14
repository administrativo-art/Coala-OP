import { NextRequest, NextResponse } from "next/server";

import { assertCanPerformMobileCount, loadMobileCountPhoto } from "@/features/stock-count/mobile-count.server";
import { mobileCountPhotoQuerySchema } from "@/features/stock-count/mobile-count";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { assertMobileAppAttested } from "@/lib/security/mobile-app-attestation.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };

// Fotos de insumo guardadas dentro do cadastro (data URI) não cabem na lista da contagem:
// o aplicativo pede cada uma aqui, com o mesmo login e a mesma permissão da contagem.
const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "stock.mobile-count.photo",
  version: 1,
  surface: { method: "GET", path: "/api/stock/mobile-count/photo" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.stock-count.perform" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "stock.mobile-count.photo-query", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, { productId: string }, { workspaceId: string }>({
  id: "stock-mobile-count-photo-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "MOBILE_COUNT_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    assertCanPerformMobileCount(actor);
    const parsed = mobileCountPhotoQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: "MOBILE_COUNT_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Produto inválido." });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const photo = await loadMobileCountPhoto(security.input.productId, security.actor);
  // O aparelho guarda a foto por um dia: a mesma contagem não relê o cadastro a cada etapa.
  return new NextResponse(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
});
