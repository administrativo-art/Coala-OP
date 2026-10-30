import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assetHolderSchema, assetPerformedBySchema, legacyResponsiblePatch, normalizedAssetLifecycle } from "@/features/assets/lifecycle";
import { resolveActiveEmployee, resolveRegisteredPerformer } from "@/features/assets/references.server";
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

const transferInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  toHolder: assetHolderSchema,
  performedBy: assetPerformedBySchema,
  effectiveAt: z.string().datetime({ offset: true }).optional(),
  conditionSnapshot: z.string().trim().max(2000).optional(),
  accessories: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  notes: z.string().trim().max(2000).optional(),
  generateTerm: z.boolean().default(true),
}).strict().superRefine((input, context) => {
  if (input.generateTerm && input.toHolder.holderType !== "employee") context.addIssue({ code: "custom", path: ["generateTerm"], message: "O termo automático exige um colaborador cadastrado como destinatário." });
});

const contract = defineSecurityContract({ schemaVersion: 1, id: "assets.custody-transfers.create", version: 1, surface: { method: "POST", path: "/api/assets/[assetId]/custody-transfers" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "assets.transfer" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "assets.custody-transfer.create-input", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });

async function loadAsset(routeContext: RouteContext): Promise<AssetResource> {
  const { assetId } = await routeContext.params;
  const snapshot = await dbAdmin.collection("assets").doc(assetId).get();
  if (!snapshot.exists) throw new AppError({ code: "ASSET_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Patrimônio não encontrado." });
  return { id: snapshot.id, data: snapshot.data() ?? {} };
}

const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, z.infer<typeof transferInputSchema>, AssetResource>(contract, {
  authenticate: ({ request }) => requireUser(request),
  async parseInput({ request }) { const parsed = transferInputSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: "ASSET_CUSTODY_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message || "Transferência de posse inválida." }); return parsed.data; },
  loadResource: ({ routeContext }) => loadAsset(routeContext),
  authorize: ({ actor }) => { if (!actor.permissions.assets?.transfer) throw new AppError({ code: "ASSET_CUSTODY_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para transferir a posse do patrimônio." }); },
  assertScope: ({ actor, resource }) => { if ((resource.data.workspaceId ?? WORKSPACE_ID) !== actor.workspace_id) throw new AppError({ code: "ASSET_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" }); },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const assetReference = dbAdmin.collection("assets").doc(resource.id);
  const transferReference = dbAdmin.collection("assetCustodyTransfers").doc();
  const movementReference = dbAdmin.collection("assetMovements").doc();
  const migrationReference = dbAdmin.collection("assetMovements").doc();
  const now = new Date().toISOString();
  const effectiveAt = input.effectiveAt ?? now;
  const status = input.generateTerm ? "term_generation_pending" : "recorded";
  const resolvedPerformer = await resolveRegisteredPerformer(actor.workspace_id, input.performedBy);
  const employee = input.toHolder.holderType === "employee" ? await resolveActiveEmployee(actor.workspace_id, input.toHolder.holderId!) : null;
  const resolvedHolder = employee
    ? { holderType: "employee" as const, holderId: employee.id, holderNameSnapshot: employee.nameSnapshot }
    : input.toHolder.holderType === "third_party"
      ? { holderType: "third_party" as const, holderNameSnapshot: input.toHolder.holderNameSnapshot.trim() }
      : { holderType: "company" as const, holderNameSnapshot: "Empresa" };
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(assetReference);
    if (!snapshot.exists) throw new AppError({ code: "ASSET_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Patrimônio não encontrado." });
    const current = { id: snapshot.id, ...(snapshot.data() ?? {}) } as Record<string, any>;
    if ((current.workspaceId ?? WORKSPACE_ID) !== actor.workspace_id) throw new AppError({ code: "ASSET_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
    const lifecycle = normalizedAssetLifecycle(current);
    if (input.expectedVersion !== lifecycle.lifecycleVersion) throw new AppError({ code: "ASSET_VERSION_CONFLICT", kind: "CONFLICT", safeMessage: "O patrimônio foi alterado por outra pessoa. Atualize a página e tente novamente." });
    const nextVersion = lifecycle.lifecycleVersion + 1;
    const nextCustody = { ...resolvedHolder, since: effectiveAt, sourceEventId: movementReference.id };
    transaction.update(assetReference, { owner: lifecycle.owner, ownershipRegime: lifecycle.ownershipRegime, custody: nextCustody, currentLocation: lifecycle.currentLocation, lifecycleVersion: nextVersion, ...legacyResponsiblePatch(resolvedHolder), updatedAt: now });
    if (lifecycle.lifecycleImportedFromLegacy) transaction.set(migrationReference, { workspaceId: actor.workspace_id, assetId: resource.id, assetCode: current.code, assetName: current.name, type: "MIGRACAO_BASE", actor: { userId: actor.userDoc.id, nameSnapshot: actor.userDoc.username }, userId: actor.userDoc.id, username: actor.userDoc.username, occurredAt: now, notes: "Estrutura de ciclo de vida materializada a partir do cadastro legado; datas históricas não foram inferidas.", source: { type: "system", id: resource.id }, lifecycleVersion: lifecycle.lifecycleVersion });
    transaction.set(transferReference, { id: transferReference.id, workspaceId: actor.workspace_id, assetId: resource.id, assetCode: current.code, assetName: current.name, fromHolder: lifecycle.custody, toHolder: nextCustody, effectiveAt, conditionSnapshot: input.conditionSnapshot ?? null, accessories: input.accessories, notes: input.notes ?? null, actor: { userId: actor.userDoc.id, nameSnapshot: actor.userDoc.username }, performedBy: resolvedPerformer, status, generateTerm: input.generateTerm, createdAt: now, updatedAt: now });
    transaction.set(movementReference, { workspaceId: actor.workspace_id, assetId: resource.id, assetCode: current.code, assetName: current.name, type: "TRANSFERENCIA_POSSE", actor: { userId: actor.userDoc.id, nameSnapshot: actor.userDoc.username }, performedBy: resolvedPerformer, custodyFrom: lifecycle.custody, custodyTo: nextCustody, userId: actor.userDoc.id, username: actor.userDoc.username, occurredAt: effectiveAt, notes: input.notes ?? null, source: { type: "custody_transfer", id: transferReference.id }, lifecycleVersion: nextVersion });
  });
  return NextResponse.json({ ok: true, transferId: transferReference.id, status, lifecycleVersion: input.expectedVersion + 1 }, { status: 201 });
});
