import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { mobileAttestationRequestSchema } from "@/lib/security/mobile-app-attestation";
import { currentMobileAttestationMode, issueMobileAttestation } from "@/lib/security/mobile-app-attestation.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type AttestationInput = { integrityToken: string; nonce: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "mobile.app-attestation.exchange",
  version: 1,
  surface: { method: "POST", path: "/api/mobile/app-attestation" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "owner" },
  resourceScope: { kind: "owner" },
  input: { kind: "schema", schema: "mobile.app-attestation.exchange", unknownFields: "reject" },
  effects: { mode: "external", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, AttestationInput, { ownerId: string }>({
  id: "mobile-app-attestation-exchange-v1",
  guarantees: ["authenticated-user", "active-user", "owner-checked", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "MOBILE_ATTESTATION_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const parsed = mobileAttestationRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "MOBILE_ATTESTATION_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Verificação do aplicativo inválida." });
    }
    // The pass is issued for, and only valid with, the caller's own account.
    return { actor, input: parsed.data, resource: { ownerId: actor.decoded.uid } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  if (currentMobileAttestationMode() === "off") return NextResponse.json({ attestation: null }, { headers: { "Cache-Control": "private, no-store" } });
  const attestation = await issueMobileAttestation({ uid: security.actor.decoded.uid, ...security.input });
  return NextResponse.json({ attestation }, { headers: { "Cache-Control": "private, no-store" } });
});
