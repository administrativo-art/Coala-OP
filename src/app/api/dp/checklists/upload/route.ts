import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";

import { adminApp } from "@/lib/firebase-admin";
import { assertLegacyChecklistWriteAllowed } from "@/features/dp-checklists/lib/rollout";
import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  buildChecklistStoragePath,
  CHECKLIST_PHOTO_MAX_BYTES,
  CHECKLIST_SIGNATURE_MAX_BYTES,
  CHECKLIST_STORAGE_BUCKET,
  detectChecklistImage,
  getChecklistAssetUrl,
} from "@/features/dp-checklists/lib/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kindSchema = z.enum(["photo", "signature"]);

export async function POST(request: NextRequest) {
  try {
    await assertLegacyChecklistWriteAllowed();
    await assertDPChecklistAccess(request, "operate");

    const formData = await request.formData();
    const file = formData.get("file");
    const rawKind = formData.get("kind");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
    }

    const kind = kindSchema.parse(rawKind);
    const maxBytes =
      kind === "signature"
        ? CHECKLIST_SIGNATURE_MAX_BYTES
        : CHECKLIST_PHOTO_MAX_BYTES;

    if (file.size > maxBytes) {
      return NextResponse.json(
        {
          error:
            kind === "signature"
              ? "Assinatura acima do limite de 2 MB."
              : "Foto acima do limite de 5 MB.",
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedImage = detectChecklistImage(buffer);

    if (!detectedImage) {
      return NextResponse.json(
        { error: "Envie uma imagem PNG, JPG ou WEBP válida." },
        { status: 400 }
      );
    }

    const { downloadToken, objectPath } = buildChecklistStoragePath({
      kind,
      originalName:
        file.name && file.name.includes(".")
          ? file.name
          : `${kind}.${detectedImage.extension}`,
    });

    const bucket = getStorage(adminApp).bucket(CHECKLIST_STORAGE_BUCKET);
    const bucketFile = bucket.file(objectPath);

    await bucketFile.save(buffer, {
      resumable: false,
      metadata: {
        contentType: detectedImage.contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          checklistAssetKind: kind,
        },
      },
    });

    return NextResponse.json({
      kind,
      assetPath: objectPath,
      assetUrl: getChecklistAssetUrl(objectPath, downloadToken),
    });
  } catch (error) {
    console.error("[dp/checklists/upload][POST]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao enviar arquivo do checklist.",
      },
      { status: 400 }
    );
  }
}
