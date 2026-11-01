import { createHash, randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { auditUploadId } from "@/features/assets/audit-evidence.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type C = { params: Promise<{ assetId: string }> };
type Input = { buffer: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp"; extension: string };

function detect(buffer: Buffer): Omit<Input, "buffer"> | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return { contentType: "image/png", extension: "png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return { contentType: "image/webp", extension: "webp" };
  return null;
}

const contract = defineSecurityContract({ schemaVersion: 1, id: "assets.audits.upload", version: 1, surface: { method: "POST", path: "/api/assets/[assetId]/audits/upload" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "assets.edit" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "assets.audit-photo.multipart", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });
const enforcer = defineSecurityEnforcer<NextRequest, C, unknown, ServerUserContext, Input, { id: string; workspaceId: string }>({
  id: "assets-audits-upload-v1", guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && actor.permissions.assets?.edit !== true) throw new AppError({ code: "ASSET_AUDIT_UPLOAD_FORBIDDEN", kind: "AUTHORIZATION" });
    const assetId = (await routeContext.params).assetId;
    const asset = await dbAdmin.collection("assets").doc(assetId).get();
    if (!asset.exists) throw new AppError({ code: "ASSET_NOT_FOUND", kind: "NOT_FOUND" });
    if (asset.get("workspaceId") !== actor.workspace_id) throw new AppError({ code: "ASSET_AUDIT_UPLOAD_SCOPE", kind: "AUTHORIZATION" });
    const form = await request.formData().catch(() => null);
    if (!form || [...form.keys()].some((key) => key !== "file") || form.getAll("file").length !== 1) throw new AppError({ code: "ASSET_AUDIT_UPLOAD_FORM", kind: "VALIDATION" });
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0 || file.size > 5 * 1024 * 1024) throw new AppError({ code: "ASSET_AUDIT_UPLOAD_SIZE", kind: "VALIDATION", safeMessage: "Envie uma imagem de até 5 MB." });
    const buffer = Buffer.from(await file.arrayBuffer()); const detected = detect(buffer);
    if (!detected) throw new AppError({ code: "ASSET_AUDIT_UPLOAD_TYPE", kind: "VALIDATION", safeMessage: "Envie uma imagem JPG, PNG ou WEBP válida." });
    return { actor, input: { buffer, ...detected }, resource: { id: assetId, workspaceId: actor.workspace_id } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const contentHash = createHash("sha256").update(security.input.buffer).digest("hex");
  const path = `assets/${security.actor.workspace_id}/${security.resource.id}/audits/${Date.now()}-${randomUUID()}.${security.input.extension}`;
  const uploadId = auditUploadId(path); const now = new Date(); const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).save(security.input.buffer, { resumable: false, metadata: { contentType: security.input.contentType, cacheControl: "private, no-store", metadata: { workspaceId: security.actor.workspace_id, assetId: security.resource.id, assetFileKind: "audit", auditUploadId: uploadId, contentHash, uploadedBy: security.actor.userDoc.id } } });
  await dbAdmin.collection("assetAuditUploads").doc(uploadId).create({ id: uploadId, workspaceId: security.actor.workspace_id, assetId: security.resource.id, storagePath: path, contentHash, mimeType: security.input.contentType, size: security.input.buffer.length, status: "pending", uploadedBy: security.actor.userDoc.id, createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt });
  return NextResponse.json({ storagePath: path, contentHash, mimeType: security.input.contentType, size: security.input.buffer.length }, { status: 201 });
});
