import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ensureAssetCustodyTerm, reconcileAssetCustodyTerm } from "@/features/assets/custody-term.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assetId: string; transferId: string }> };
type Resource = { assetId: string; transferId: string; workspaceId: string; generatedDocumentId?: string | null };
const inputSchema = z.object({ action: z.enum(["send", "reconcile"]).default("send") }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: "assets.custody-term.process", version: 1, surface: { method: "POST", path: "/api/assets/[assetId]/custody-transfers/[transferId]/term" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "assets.transfer" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "assets.custody-term.action", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });

const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, z.infer<typeof inputSchema>, Resource>(contract, {
  authenticate: ({ request }) => requireUser(request),
  async parseInput({ request }) { const parsed = inputSchema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) throw new AppError({ code: "ASSET_CUSTODY_TERM_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Ação de termo inválida." }); return parsed.data; },
  async loadResource({ routeContext }) {
    const { assetId, transferId } = await routeContext.params;
    const snapshot = await dbAdmin.collection("assetCustodyTransfers").doc(transferId).get();
    if (!snapshot.exists || snapshot.get("assetId") !== assetId) throw new AppError({ code: "ASSET_CUSTODY_TRANSFER_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Transferência de posse não encontrada." });
    return { assetId, transferId, workspaceId: String(snapshot.get("workspaceId") ?? ""), generatedDocumentId: snapshot.get("generatedDocumentId") ?? null };
  },
  authorize: ({ actor }) => { if (!actor.permissions.assets?.transfer) throw new AppError({ code: "ASSET_CUSTODY_TERM_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para processar o termo patrimonial." }); },
  assertScope: ({ actor, resource }) => { if (resource.workspaceId !== actor.workspace_id) throw new AppError({ code: "ASSET_CUSTODY_TERM_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" }); },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  if (security.input.action === "reconcile") {
    if (!security.resource.generatedDocumentId) throw new AppError({ code: "ASSET_CUSTODY_TERM_NOT_SENT", kind: "CONFLICT", safeMessage: "O termo ainda não foi enviado." });
    return NextResponse.json(await reconcileAssetCustodyTerm(security.resource.generatedDocumentId));
  }
  const result = await ensureAssetCustodyTerm({ context: security.actor, assetId: security.resource.assetId, transferId: security.resource.transferId });
  return NextResponse.json(result, { status: result.reused ? 200 : 201 });
});
