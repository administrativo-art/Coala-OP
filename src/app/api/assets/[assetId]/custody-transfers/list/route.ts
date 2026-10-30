import { NextRequest, NextResponse } from "next/server";

import { boundedLimit, listAssetCollection } from "@/features/assets/read-model.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { WORKSPACE_ID } from "@/lib/workspace";

type Context = { params: Promise<{ assetId: string }> };
type Resource = { id: string; workspaceId: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "assets.custody-transfers.list",
  version: 1,
  surface: { method: "GET", path: "/api/assets/[assetId]/custody-transfers/list" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "assets.view-history" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, undefined, Resource>(contract, {
  authenticate: ({ request }) => requireUser(request),
  async loadResource({ routeContext }) {
    const { assetId } = await routeContext.params;
    const asset = await dbAdmin.collection("assets").doc(assetId).get();
    if (!asset.exists) throw new AppError({ code: "ASSET_NOT_FOUND", kind: "NOT_FOUND" });
    return { id: assetId, workspaceId: String(asset.get("workspaceId") ?? WORKSPACE_ID) };
  },
  authorize: ({ actor }) => {
    if (!actor.permissions.assets?.viewHistory) throw new AppError({ code: "ASSET_HISTORY_FORBIDDEN", kind: "AUTHORIZATION" });
  },
  assertScope: ({ actor, resource }) => {
    if (actor.workspace_id !== resource.workspaceId) throw new AppError({ code: "ASSET_HISTORY_SCOPE", kind: "AUTHORIZATION" });
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ request, security }) => {
  const page = await listAssetCollection(
    "assetCustodyTransfers",
    security.resource.id,
    boundedLimit(request.nextUrl.searchParams.get("limit")),
    request.nextUrl.searchParams.get("cursor"),
    "createdAt",
  );
  return NextResponse.json({
    nextCursor: page.nextCursor,
    items: page.items.map((item: Record<string, any>) => ({
      id: item.id,
      createdAt: item.createdAt ?? null,
      effectiveAt: item.effectiveAt ?? null,
      fromHolder: item.fromHolder ? { holderType: item.fromHolder.holderType, holderNameSnapshot: item.fromHolder.holderNameSnapshot } : null,
      toHolder: item.toHolder ? { holderType: item.toHolder.holderType, holderNameSnapshot: item.toHolder.holderNameSnapshot } : null,
      actor: item.actor ? { nameSnapshot: item.actor.nameSnapshot } : null,
      status: item.status ?? "recorded",
      generateTerm: item.generateTerm === true,
      generatedDocumentId: item.generatedDocumentId ?? null,
      employeeDocumentId: item.employeeDocumentId ?? null,
      termGenerationCompletedAt: item.termGenerationCompletedAt ?? null,
      signatureUpdatedAt: item.signatureUpdatedAt ?? null,
      signedAt: item.signedAt ?? null,
      notes: item.notes ?? null,
    })),
  });
});
