import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { getEntityPixProfile, saveEntityPixProfile } from "@/features/financial/beneficiaries/repository.server";
import { entityPixProfileInputSchema } from "@/features/financial/beneficiaries/schemas";
import { AppError } from "@/lib/observability";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { dbAdmin } from "@/lib/firebase-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { matchesPersonWorkspace } from "@/features/privacy/person-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ entityId: string }> };
type Resource = { entityId: string };
type Input = z.infer<typeof entityPixProfileInputSchema>;
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
const path = "/api/financial/beneficiaries/entities/[entityId]";

const getContract = defineSecurityContract({
  schemaVersion: 1, id: "financial.entity-pix-profile.read", version: 1,
  surface: { method: "GET", path }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "entity-pix-profile-read" },
  resourceScope: { kind: "workspace" }, input: { kind: "none" },
  effects: { mode: "read", audit: "none" }, errorExposure: "sanitized",
});
const patchContract = defineSecurityContract({
  schemaVersion: 1, id: "financial.entity-pix-profile.write", version: 1,
  surface: { method: "PATCH", path }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "entity-pix-profile-write" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "entity-pix-profile-json", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized",
});

async function actorAndEntity(request: NextRequest, context: Context) {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "ENTITY_PIX_PROFILE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const entityId = idSchema.safeParse((await context.params).entityId);
  if (!entityId.success) throw new AppError({ code: "ENTITY_PIX_PROFILE_INVALID_ID", kind: "VALIDATION" });
  const entity = await dbAdmin.collection("entities").doc(entityId.data).get();
  if (!entity.exists) throw new AppError({ code: "ENTITY_PIX_PROFILE_NOT_FOUND", kind: "NOT_FOUND" });
  if (actor.workspace_id !== WORKSPACE_ID || !matchesPersonWorkspace(entity.data(), WORKSPACE_ID, true)) {
    throw new AppError({ code: "ENTITY_PIX_PROFILE_SCOPE", kind: "AUTHORIZATION" });
  }
  return { actor, resource: { entityId: entityId.data } };
}

const getEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, undefined, Resource>({
  id: "entity-pix-profile-read-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:entity-pix-profile-read", "workspace-scoped"],
  async enforce({ request, routeContext }) {
    const { actor, resource } = await actorAndEntity(request, routeContext);
    if (!actor.isDefaultAdmin && actor.permissions.registration?.entities?.edit !== true) {
      throw new AppError({ code: "ENTITY_PIX_PROFILE_READ_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    return { actor, input: undefined, resource };
  },
});

const patchEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, Resource>({
  id: "entity-pix-profile-write-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:entity-pix-profile-write", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request, routeContext }) {
    const { actor, resource } = await actorAndEntity(request, routeContext);
    if (!actor.isDefaultAdmin && actor.permissions.registration?.entities?.edit !== true
      && actor.permissions.registration?.entities?.add !== true) {
      throw new AppError({ code: "ENTITY_PIX_PROFILE_WRITE_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    const input = entityPixProfileInputSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new AppError({ code: "ENTITY_PIX_PROFILE_INVALID", kind: "VALIDATION" });
    return { actor, input: input.data, resource };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => {
  const result = await getEntityPixProfile(security.resource.entityId);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});

export const PATCH = secureRoute({ contract: patchContract, enforcer: patchEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const canEdit = actor.isDefaultAdmin || actor.permissions.registration?.entities?.edit === true;
  const saved = await saveEntityPixProfile(resource.entityId, input, {
    uid: actor.decoded.uid, name: actor.userDoc.username, email: actor.userDoc.email,
  }, { requireCreator: !canEdit });
  return NextResponse.json(saved, { headers: { "Cache-Control": "private, no-store" } });
});
