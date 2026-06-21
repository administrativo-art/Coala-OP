import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";

import { adminApp } from "@/lib/firebase-admin";
import { requireUser } from "@/lib/auth-server";
import { getFormExecutionById } from "@/features/forms/lib/server";
import { assertFormExecutionAccess } from "@/features/forms/lib/server-access";
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
const scopeSchema = z.enum(["item", "section"]);

async function loadAndAuthorizeExecution(params: {
  executionId: string;
  context: Awaited<ReturnType<typeof requireUser>>;
  scope: "item" | "section";
  targetId: string;
}) {
  const payload = await getFormExecutionById(params.executionId, params.context.workspace_id);
  if (!payload) {
    throw new Error("Execução não encontrada.");
  }

  assertFormExecutionAccess({
    permissions: params.context.permissions,
    isDefaultAdmin: params.context.isDefaultAdmin,
    userId: params.context.userDoc.id,
    userDoc: params.context.userDoc as unknown as Record<string, unknown>,
    workspaceId: params.context.workspace_id,
    execution: payload.execution,
    level: "operate",
  });

  const targetExists = params.scope === "item"
    ? (payload.execution.items ?? []).some((item) => item.id === params.targetId)
    : payload.execution.sections.some((section) => section.id === params.targetId);

  if (!targetExists) {
    throw new Error("Item ou seção da evidência não encontrado.");
  }

  return payload.execution;
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);

    const formData = await request.formData();
    const file = formData.get("file");
    const rawKind = formData.get("kind");
    const rawExecutionId = formData.get("executionId");
    const rawScope = formData.get("scope");
    const rawTargetId = formData.get("targetId");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
    }

    const kind = kindSchema.parse(rawKind);
    const executionId = typeof rawExecutionId === "string" ? rawExecutionId.trim() : "";
    const scope = scopeSchema.parse(rawScope);
    const targetId = typeof rawTargetId === "string" ? rawTargetId.trim() : "";
    if (!executionId || !targetId) {
      return NextResponse.json({ error: "Execução e destino da evidência são obrigatórios." }, { status: 400 });
    }

    await loadAndAuthorizeExecution({
      executionId,
      context,
      scope,
      targetId,
    });

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
      executionId,
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
          formsExecutionId: executionId,
          formsEvidenceScope: scope,
          formsEvidenceTargetId: targetId,
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
    const context = await requireUser(request);
    const body = (await request.json().catch(() => null)) as
      | { action?: string; assetPath?: string; executionId?: string; scope?: string; targetId?: string }
      | null;

    if (
      body?.action !== "delete" ||
      !body.assetPath?.trim() ||
      !body.executionId?.trim() ||
      !body.targetId?.trim()
    ) {
      return NextResponse.json(
        { error: "Payload inválido para remoção do arquivo." },
        { status: 400 }
      );
    }

    const scope = scopeSchema.parse(body.scope);
    await loadAndAuthorizeExecution({
      executionId: body.executionId.trim(),
      context,
      scope,
      targetId: body.targetId.trim(),
    });

    const assetPath = body.assetPath.trim();
    if (!assetPath.startsWith(`forms/${body.executionId.trim()}/`)) {
      return NextResponse.json(
        { error: "Arquivo não pertence à execução informada." },
        { status: 403 }
      );
    }

    const bucket = getStorage(adminApp).bucket(FORMS_STORAGE_BUCKET);
    await bucket.file(assetPath).delete({ ignoreNotFound: true });

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
