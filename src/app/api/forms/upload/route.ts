import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";

import { adminApp } from "@/lib/firebase-admin";
import { requireUser } from "@/lib/auth-server";
import {
  buildFormStoragePath,
  detectFileMetadata,
  detectFormImage,
  FORMS_FILE_MAX_BYTES,
  FORMS_PHOTO_MAX_BYTES,
  FORMS_SIGNATURE_MAX_BYTES,
  FORMS_STORAGE_BUCKET,
  getFormAssetUrl,
} from "@/features/forms/lib/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kindSchema = z.enum(["photo", "signature", "file"]);

export async function POST(request: NextRequest) {
  try {
    await requireUser(request);

    const formData = await request.formData();
    const file = formData.get("file");
    const rawKind = formData.get("kind");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
    }

    const kind = kindSchema.parse(rawKind);
    const maxBytes =
      kind === "signature"
        ? FORMS_SIGNATURE_MAX_BYTES
        : kind === "photo"
          ? FORMS_PHOTO_MAX_BYTES
          : FORMS_FILE_MAX_BYTES;

    if (file.size > maxBytes) {
      return NextResponse.json(
        {
          error:
            kind === "signature"
              ? "Assinatura acima do limite de 2 MB."
              : kind === "photo"
                ? "Foto acima do limite de 5 MB."
                : "Arquivo acima do limite de 10 MB.",
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detected =
      kind === "file" ? detectFileMetadata(file, kind) : detectFormImage(buffer);

    if (!detected) {
      return NextResponse.json(
        { error: "Envie um arquivo válido para o tipo selecionado." },
        { status: 400 }
      );
    }

    const { downloadToken, objectPath } = buildFormStoragePath({
      kind,
      originalName:
        file.name && file.name.includes(".")
          ? file.name
          : `${kind}.${detected.extension}`,
    });

    const bucket = getStorage(adminApp).bucket(FORMS_STORAGE_BUCKET);
    const bucketFile = bucket.file(objectPath);

    await bucketFile.save(buffer, {
      resumable: false,
      metadata: {
        contentType: detected.contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          formsAssetKind: kind,
        },
      },
    });

    return NextResponse.json({
      kind,
      assetPath: objectPath,
      assetUrl: getFormAssetUrl(objectPath, downloadToken),
      fileName: file.name,
      mime: detected.contentType,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao enviar arquivo do formulário.",
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireUser(request);
    const body = (await request.json().catch(() => null)) as
      | { action?: string; assetPath?: string }
      | null;

    if (body?.action !== "delete" || !body.assetPath?.trim()) {
      return NextResponse.json(
        { error: "Payload inválido para remoção do arquivo." },
        { status: 400 }
      );
    }

    const bucket = getStorage(adminApp).bucket(FORMS_STORAGE_BUCKET);
    await bucket.file(body.assetPath.trim()).delete({ ignoreNotFound: true });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao remover arquivo do formulário.",
      },
      { status: 400 }
    );
  }
}
