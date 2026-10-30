import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assetLocationSchema, assetPerformedBySchema, normalizedAssetLifecycle } from "@/features/assets/lifecycle";
import { resolveAssetLocation, resolveRegisteredPerformer } from "@/features/assets/references.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assetId: string }> };
type AssetResource = { id: string; data: Record<string, any> };

const movementInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  location: assetLocationSchema,
  performedBy: assetPerformedBySchema,
  occurredAt: z.string().datetime({ offset: true }).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict();

const getContract = defineSecurityContract({ schemaVersion: 1, id: "assets.movements.list", version: 1, surface: { method: "GET", path: "/api/assets/[assetId]/movements" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "assets.view-history" }, resourceScope: { kind: "workspace" }, input: { kind: "none" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const postContract = defineSecurityContract({ schemaVersion: 1, id: "assets.movements.create", version: 1, surface: { method: "POST", path: "/api/assets/[assetId]/movements" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "assets.transfer" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "assets.movement.create-input", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });

async function loadAsset(routeContext: RouteContext): Promise<AssetResource> {
  const { assetId } = await routeContext.params;
  const snapshot = await dbAdmin.collection("assets").doc(assetId).get();
  if (!snapshot.exists) throw new AppError({ code: "ASSET_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Patrimônio não encontrado." });
  return { id: snapshot.id, data: snapshot.data() ?? {} };
}

function assertWorkspace(actor: ServerUserContext, resource: AssetResource) {
  if ((resource.data.workspaceId ?? WORKSPACE_ID) !== actor.workspace_id) throw new AppError({ code: "ASSET_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem acesso a este patrimônio." });
}

const getEnforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, undefined, AssetResource>(getContract, {
  authenticate: ({ request }) => requireUser(request), loadResource: ({ routeContext }) => loadAsset(routeContext),
  authorize: ({ actor }) => { if (!actor.permissions.assets?.viewHistory) throw new AppError({ code: "ASSET_HISTORY_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para ver histórico de patrimônio." }); },
  assertScope: ({ actor, resource }) => assertWorkspace(actor, resource),
});

const postEnforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, z.infer<typeof movementInputSchema>, AssetResource>(postContract, {
  authenticate: ({ request }) => requireUser(request),
  async parseInput({ request }) { const parsed = movementInputSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: "ASSET_MOVEMENT_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message || "Movimentação inválida." }); return parsed.data; },
  loadResource: ({ routeContext }) => loadAsset(routeContext),
  authorize: ({ actor }) => { if (!actor.permissions.assets?.transfer) throw new AppError({ code: "ASSET_MOVEMENT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para movimentar patrimônio." }); },
  assertScope: ({ actor, resource }) => assertWorkspace(actor, resource),
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => {
  const snapshot = await dbAdmin.collection("assetMovements").where("assetId", "==", security.resource.id).limit(200).get();
  const data = snapshot.docs.map((document) => ({ id: document.id, ...document.data() })).sort((left: any, right: any) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
  return NextResponse.json(data);
});

export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const assetReference = dbAdmin.collection("assets").doc(resource.id);
  const movementReference = dbAdmin.collection("assetMovements").doc();
  const migrationReference = dbAdmin.collection("assetMovements").doc();
  const now = new Date().toISOString();
  const occurredAt = input.occurredAt ?? now;
  const resolvedPerformer = await resolveRegisteredPerformer(actor.workspace_id, input.performedBy);
  const resolvedLocation = await resolveAssetLocation(actor.workspace_id, input.location);
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(assetReference);
    if (!snapshot.exists) throw new AppError({ code: "ASSET_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Patrimônio não encontrado." });
    const current = { id: snapshot.id, ...(snapshot.data() ?? {}) } as Record<string, any>;
    if ((current.workspaceId ?? WORKSPACE_ID) !== actor.workspace_id) throw new AppError({ code: "ASSET_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
    const lifecycle = normalizedAssetLifecycle(current);
    if (input.expectedVersion !== lifecycle.lifecycleVersion) throw new AppError({ code: "ASSET_VERSION_CONFLICT", kind: "CONFLICT", safeMessage: "O patrimônio foi alterado por outra pessoa. Atualize a página e tente novamente." });
    const nextVersion = lifecycle.lifecycleVersion + 1;
    const nextLocation = { ...resolvedLocation, since: occurredAt, sourceEventId: movementReference.id };
    const update: Record<string, unknown> = { owner: lifecycle.owner, ownershipRegime: lifecycle.ownershipRegime, custody: lifecycle.custody, currentLocation: nextLocation, lifecycleVersion: nextVersion, updatedAt: now, exactLocation: resolvedLocation.details || resolvedLocation.nameSnapshot };
    if (resolvedLocation.type === "unit") { update.currentKioskId = resolvedLocation.refId; update.currentKioskName = resolvedLocation.nameSnapshot; }
    else { update.currentKioskId = null; update.currentKioskName = null; }
    transaction.update(assetReference, update);
    if (lifecycle.lifecycleImportedFromLegacy) transaction.set(migrationReference, { workspaceId: actor.workspace_id, assetId: resource.id, assetCode: current.code, assetName: current.name, type: "MIGRACAO_BASE", actor: { userId: actor.userDoc.id, nameSnapshot: actor.userDoc.username }, userId: actor.userDoc.id, username: actor.userDoc.username, occurredAt: now, notes: "Estrutura de ciclo de vida materializada a partir do cadastro legado; datas históricas não foram inferidas.", source: { type: "system", id: resource.id }, lifecycleVersion: lifecycle.lifecycleVersion });
    transaction.set(movementReference, { workspaceId: actor.workspace_id, assetId: resource.id, assetCode: current.code, assetName: current.name, type: "MOVIMENTACAO", actor: { userId: actor.userDoc.id, nameSnapshot: actor.userDoc.username }, performedBy: resolvedPerformer, locationFrom: lifecycle.currentLocation, locationTo: nextLocation, fromKioskId: lifecycle.currentLocation.refId ?? null, fromKioskName: lifecycle.currentLocation.nameSnapshot, toKioskId: resolvedLocation.refId ?? null, toKioskName: resolvedLocation.nameSnapshot, userId: actor.userDoc.id, username: actor.userDoc.username, occurredAt, notes: input.notes ?? null, lifecycleVersion: nextVersion });
  });
  return NextResponse.json({ ok: true, movementId: movementReference.id, lifecycleVersion: input.expectedVersion + 1 }, { status: 201 });
});
