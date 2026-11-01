import { getStorage } from "firebase-admin/storage";
import { NextRequest } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

type Context = { params: Promise<{ assetId: string; transferId: string }> };
type Resource = { workspaceId: string; path: string; fileName: string };

const contract = defineSecurityContract({ schemaVersion: 1, id: "assets.custody-term.download", version: 1, surface: { method: "GET", path: "/api/assets/[assetId]/custody-transfers/[transferId]/term/file" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "assets.view-history" }, resourceScope: { kind: "workspace" }, input: { kind: "none" }, effects: { mode: "read", audit: "server-authoritative" }, errorExposure: "sanitized" });

const enforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, undefined, Resource>(contract, {
  authenticate: ({ request }) => requireUser(request),
  async loadResource({ routeContext }) {
    const { assetId, transferId } = await routeContext.params;
    const transfer = await dbAdmin.collection("assetCustodyTransfers").doc(transferId).get();
    if (!transfer.exists || transfer.get("assetId") !== assetId) throw new AppError({ code: "ASSET_CUSTODY_TRANSFER_NOT_FOUND", kind: "NOT_FOUND" });
    const documentId = String(transfer.get("generatedDocumentId") ?? "");
    const document = documentId ? await dbAdmin.collection("generatedDocuments").doc(documentId).get() : null;
    const path = document?.get("pdfStoragePath");
    if (!document?.exists || !path || document.get("sourceAssetId") !== assetId) throw new AppError({ code: "ASSET_CUSTODY_TERM_FILE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "O PDF do termo ainda não está disponível." });
    return { workspaceId: String(transfer.get("workspaceId") ?? ""), path: String(path), fileName: `termo-posse-${String(transfer.get("assetCode") ?? assetId)}.pdf` };
  },
  authorize: ({ actor }) => { if (!actor.permissions.assets?.viewHistory) throw new AppError({ code: "ASSET_HISTORY_FORBIDDEN", kind: "AUTHORIZATION" }); },
  assertScope: ({ actor, resource }) => { if (actor.workspace_id !== resource.workspaceId) throw new AppError({ code: "ASSET_HISTORY_SCOPE", kind: "AUTHORIZATION" }); },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const [bytes] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(security.resource.path).download();
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${security.resource.fileName}"`, "Cache-Control": "private, no-store" } });
});
