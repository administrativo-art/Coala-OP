import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type OwnerResource = { ownerId: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "auth.password-changed.update",
  version: 1,
  surface: { method: "POST", path: "/api/auth/password-changed" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "owner" },
  resourceScope: { kind: "owner" },
  input: { kind: "none" },
  effects: { mode: "write", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<
  NextRequest,
  StaticRouteContext,
  unknown,
  ServerUserContext,
  undefined,
  OwnerResource
>(contract, {
  authenticate: ({ request }) => requireUser(request).catch((cause) => {
    throw new AppError({ code: "PASSWORD_CHANGED_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
  }),
  loadResource: ({ actor }) => ({ ownerId: actor.decoded.uid }),
  authorize: ({ actor, resource }) => {
    if (resource.ownerId !== actor.decoded.uid) {
      throw new AppError({ code: "PASSWORD_CHANGED_OWNER_FORBIDDEN", kind: "AUTHORIZATION" });
    }
  },
  assertScope: ({ actor, resource }) => {
    if (resource.ownerId !== actor.decoded.uid) {
      throw new AppError({ code: "PASSWORD_CHANGED_SCOPE_FORBIDDEN", kind: "AUTHORIZATION" });
    }
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  await dbAdmin.collection("users").doc(security.resource.ownerId).set(
    {
      mustChangePassword: false,
      passwordChangedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return NextResponse.json({ ok: true });
});
