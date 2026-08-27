import { randomUUID } from "crypto";

import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

function detectFile(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { extension: "png", contentType: "image/png", kind: "image" as const };
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { extension: "jpg", contentType: "image/jpeg", kind: "image" as const };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", contentType: "image/webp", kind: "image" as const };
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { extension: "pdf", contentType: "application/pdf", kind: "document" as const };
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const formData = await request.formData();
    const file = formData.get("file");
    const assetId = String(formData.get("assetId") ?? "").trim();
    const kind = String(formData.get("kind") ?? "").trim();

    if (!(file instanceof File) || !assetId || !["image", "fiscal"].includes(kind)) {
      return NextResponse.json({ error: "Upload de patrimônio inválido." }, { status: 400 });
    }

    const isPending = assetId === "_pending";
    const allowed = isPending
      ? context.isDefaultAdmin || context.permissions.assets?.create === true
      : context.isDefaultAdmin || context.permissions.assets?.edit === true;
    if (!allowed) {
      return NextResponse.json({ error: "Sem permissão para anexar arquivo ao patrimônio." }, { status: 403 });
    }

    if (!isPending) {
      const asset = await dbAdmin.collection("assets").doc(assetId).get();
      if (!asset.exists || asset.data()?.workspaceId !== WORKSPACE_ID) {
        return NextResponse.json({ error: "Patrimônio não encontrado." }, { status: 404 });
      }
    }

    const maxBytes = kind === "image" ? IMAGE_MAX_BYTES : DOCUMENT_MAX_BYTES;
    if (file.size <= 0 || file.size > maxBytes) {
      return NextResponse.json(
        { error: kind === "image" ? "Imagem acima do limite de 5 MB." : "Documento acima do limite de 10 MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = detectFile(buffer);
    if (
      !detected ||
      (kind === "image" && detected.kind !== "image") ||
      (kind === "fiscal" && !["image", "document"].includes(detected.kind))
    ) {
      return NextResponse.json(
        { error: kind === "image" ? "Envie uma imagem PNG, JPG ou WEBP válida." : "Envie uma imagem ou PDF válido." },
        { status: 400 },
      );
    }

    const token = randomUUID();
    const folder = kind === "image" ? "images" : "fiscal";
    const objectPath = `assets/${assetId}/${folder}/${Date.now()}-${token}.${detected.extension}`;
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    await bucket.file(objectPath).save(buffer, {
      resumable: false,
      metadata: {
        contentType: detected.contentType,
        metadata: {
          firebaseStorageDownloadTokens: token,
          uploadedBy: context.userDoc.id,
          assetId,
          assetFileKind: kind,
        },
      },
    });

    const url =
      `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}` +
      `/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    return NextResponse.json({ url, path: objectPath }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar arquivo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
