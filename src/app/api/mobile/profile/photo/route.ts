import { NextRequest, NextResponse } from "next/server";

import { MOBILE_PROFILE_PHOTO_MAX_BYTES, replaceOwnProfilePhoto } from "@/features/collaborator-schedule/mobile-profile-photo.server";
import { detectMobileInboxFile, type DetectedMobileInboxFile } from "@/features/financial/inbox/mobile-upload";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { assertMobileAppAttested } from "@/lib/security/mobile-app-attestation.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type PhotoInput = { buffer: Buffer; detected: DetectedMobileInboxFile };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "mobile.profile.photo.replace",
  version: 1,
  surface: { method: "POST", path: "/api/mobile/profile/photo" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "owner" },
  resourceScope: { kind: "owner" },
  input: { kind: "schema", schema: "mobile.profile.photo-form", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, PhotoInput, { ownerId: string }>({
  id: "mobile-profile-photo-replace-v1",
  guarantees: ["authenticated-user", "active-user", "owner-checked", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "MOBILE_PROFILE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    const form = await request.formData().catch(() => null);
    const fields = form ? [...form.keys()] : [];
    const file = form?.get("photo");
    if (!form || fields.length !== 1 || fields[0] !== "photo" || !(file instanceof File)) {
      throw new AppError({ code: "MOBILE_PROFILE_PHOTO_INVALID", kind: "VALIDATION", safeMessage: "Envie somente a foto." });
    }
    if (file.size <= 0 || file.size > MOBILE_PROFILE_PHOTO_MAX_BYTES) {
      throw new AppError({ code: "MOBILE_PROFILE_PHOTO_SIZE", kind: "VALIDATION", safeMessage: "A foto deve ter no máximo 5 MB." });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    // The type is taken from the content, not from what the phone declares; a PDF is not a photo.
    const detected = detectMobileInboxFile(buffer);
    if (!detected || detected.contentType === "application/pdf") {
      throw new AppError({ code: "MOBILE_PROFILE_PHOTO_TYPE", kind: "VALIDATION", safeMessage: "A foto deve ser uma imagem JPG, PNG ou WEBP." });
    }
    // The person can only ever replace their own photo: there is no target id in the request.
    return { actor, input: { buffer, detected }, resource: { ownerId: actor.decoded.uid } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json({ avatarUrl: await replaceOwnProfilePhoto(security.actor, security.input) }, { headers: { "Cache-Control": "private, no-store" } }));
