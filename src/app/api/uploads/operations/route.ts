import { randomUUID } from "crypto";

import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { canReceivePurchase } from "@/lib/purchasing-permissions";
import { type OperationalUploadKind } from "@/lib/operational-upload-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_KINDS = new Set<OperationalUploadKind>([
  "reposition-signature",
  "dispatch-document",
  "purchase-receipt",
]);

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
}

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

function canManageReposition(context: ServerUserContext) {
  return (
    context.isDefaultAdmin ||
    context.permissions.reposition.prepareDispatch ||
    context.permissions.stock.analysis.restock ||
    context.permissions.stock.inventoryControl.transfer
  );
}

async function assertTargetAccess(
  context: ServerUserContext,
  kind: OperationalUploadKind,
  targetId: string,
) {
  if (kind === "purchase-receipt") {
    if (!context.isDefaultAdmin && !canReceivePurchase(context.permissions)) {
      throw new Error("Sem permissão para anexar comprovantes de recebimento.");
    }
    const target = await dbAdmin.collection("purchase_receipts").doc(targetId).get();
    if (!target.exists) throw new Error("Recebimento não encontrado.");
    return;
  }

  if (!canManageReposition(context)) {
    throw new Error("Sem permissão para anexar documentos da reposição.");
  }
  const target = await dbAdmin.collection("repositionActivities").doc(targetId).get();
  if (!target.exists) throw new Error("Reposição não encontrada.");
}

function buildObjectPath(
  kind: OperationalUploadKind,
  targetId: string,
  extension: string,
  token: string,
) {
  const folder =
    kind === "reposition-signature"
      ? "reposition-signatures"
      : kind === "dispatch-document"
        ? "dispatch-documents"
        : "purchase-receipts";
  return `operations/${folder}/${targetId}/${Date.now()}-${token}.${extension}`;
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const formData = await request.formData();
    const rawKind = formData.get("kind");
    const rawTargetId = formData.get("targetId");
    const file = formData.get("file");

    if (
      typeof rawKind !== "string" ||
      !ALLOWED_KINDS.has(rawKind as OperationalUploadKind)
    ) {
      return NextResponse.json({ error: "Tipo de upload inválido." }, { status: 400 });
    }
    if (typeof rawTargetId !== "string") {
      return NextResponse.json({ error: "Identificador ausente." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
    }

    const kind = rawKind as OperationalUploadKind;
    const targetId = sanitizeSegment(rawTargetId);
    if (!targetId || targetId !== rawTargetId) {
      return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
    }

    const maxBytes = kind === "reposition-signature"
      ? SIGNATURE_MAX_BYTES
      : DOCUMENT_MAX_BYTES;
    if (file.size <= 0 || file.size > maxBytes) {
      return NextResponse.json(
        {
          error: kind === "reposition-signature"
            ? "Assinatura acima do limite de 2 MB."
            : "Documento acima do limite de 10 MB.",
        },
        { status: 400 },
      );
    }

    await assertTargetAccess(context, kind, targetId);

    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = detectFile(buffer);
    if (!detected || (kind === "reposition-signature" && detected.kind !== "image")) {
      return NextResponse.json(
        {
          error: kind === "reposition-signature"
            ? "Envie uma assinatura PNG, JPG ou WEBP válida."
            : "Envie uma imagem ou PDF válido.",
        },
        { status: 400 },
      );
    }

    const downloadToken = randomUUID();
    const objectPath = buildObjectPath(
      kind,
      targetId,
      detected.extension,
      downloadToken,
    );
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    await bucket.file(objectPath).save(buffer, {
      resumable: false,
      metadata: {
        contentType: detected.contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          uploadedBy: context.userDoc.id,
          uploadKind: kind,
          targetId,
        },
      },
    });

    const url =
      `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}` +
      `/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;

    return NextResponse.json({ url, path: objectPath }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar arquivo.";
    const status =
      message.includes("Authorization") || message.includes("Usuário")
        ? 401
        : message.startsWith("Sem permissão")
          ? 403
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
