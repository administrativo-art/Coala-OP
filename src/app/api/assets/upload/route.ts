import { randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
type C = { params: Promise<Record<string, never>> };
type Detected = { extension: string; contentType: string; kind: "image" | "document" };
type Input = { assetId: string; kind: "image" | "fiscal"; buffer: Buffer; detected: Detected };

function detectFile(buffer: Buffer): Detected | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return { extension: "png", contentType: "image/png", kind: "image" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extension: "jpg", contentType: "image/jpeg", kind: "image" };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return { extension: "webp", contentType: "image/webp", kind: "image" };
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return { extension: "pdf", contentType: "application/pdf", kind: "document" };
  return null;
}

const contract = defineSecurityContract({ schemaVersion: 1, id: "assets.upload", version: 1, surface: { method: "POST", path: "/api/assets/upload" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "assets.create-or-edit" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "assets.upload.multipart", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });
const enforcer = defineSecurityEnforcer<NextRequest, C, unknown, ServerUserContext, Input, { workspaceId: string }>({
  id: "assets-upload-v1", guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request);
    const form = await request.formData().catch(() => null);
    if (!form || [...form.keys()].some((key) => !["file", "assetId", "kind"].includes(key)) || ["file", "assetId", "kind"].some((key) => form.getAll(key).length !== 1)) throw new AppError({ code: "ASSET_UPLOAD_FORM", kind: "VALIDATION", safeMessage: "Upload de patrimônio inválido." });
    const file = form.get("file"); const assetId = String(form.get("assetId") ?? "").trim(); const rawKind = String(form.get("kind") ?? "");
    if (!(file instanceof File) || !assetId || !["image", "fiscal"].includes(rawKind)) throw new AppError({ code: "ASSET_UPLOAD_INPUT", kind: "VALIDATION", safeMessage: "Upload de patrimônio inválido." });
    const kind = rawKind as "image" | "fiscal"; const pending = assetId === "_pending";
    if (!actor.isDefaultAdmin && (pending ? actor.permissions.assets?.create !== true : actor.permissions.assets?.edit !== true)) throw new AppError({ code: "ASSET_UPLOAD_FORBIDDEN", kind: "AUTHORIZATION" });
    if (!pending) { const asset = await dbAdmin.collection("assets").doc(assetId).get(); if (!asset.exists) throw new AppError({ code: "ASSET_NOT_FOUND", kind: "NOT_FOUND" }); if (asset.get("workspaceId") !== actor.workspace_id) throw new AppError({ code: "ASSET_UPLOAD_SCOPE", kind: "AUTHORIZATION" }); }
    const max = kind === "image" ? IMAGE_MAX_BYTES : DOCUMENT_MAX_BYTES;
    if (file.size <= 0 || file.size > max) throw new AppError({ code: "ASSET_UPLOAD_SIZE", kind: "VALIDATION", safeMessage: kind === "image" ? "Imagem acima do limite de 5 MB." : "Documento acima do limite de 10 MB." });
    const buffer = Buffer.from(await file.arrayBuffer()); const detected = detectFile(buffer);
    if (!detected || (kind === "image" && detected.kind !== "image")) throw new AppError({ code: "ASSET_UPLOAD_TYPE", kind: "VALIDATION", safeMessage: kind === "image" ? "Envie uma imagem PNG, JPG ou WEBP válida." : "Envie uma imagem ou PDF válido." });
    return { actor, input: { assetId, kind, buffer, detected }, resource: { workspaceId: actor.workspace_id } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const token = randomUUID(); const folder = security.input.kind === "image" ? "images" : "fiscal";
  const path = `assets/${security.input.assetId}/${folder}/${Date.now()}-${token}.${security.input.detected.extension}`;
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).save(security.input.buffer, { resumable: false, metadata: { contentType: security.input.detected.contentType, metadata: { firebaseStorageDownloadTokens: token, uploadedBy: security.actor.userDoc.id, workspaceId: security.actor.workspace_id, assetId: security.input.assetId, assetFileKind: security.input.kind } } });
  const url = `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  return NextResponse.json({ url, path }, { status: 201 });
});
