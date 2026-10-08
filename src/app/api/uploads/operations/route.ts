import { randomUUID } from "crypto";

import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { canReceivePurchase } from "@/lib/purchasing-permissions";
import { canAccessAnyUnit, canAccessUnit } from "@/lib/unit-access";
import { type OperationalUploadKind } from "@/lib/operational-upload-client";
import { WORKSPACE_ID } from "@/lib/workspace";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_KINDS = new Set<OperationalUploadKind>([
  "reposition-signature",
  "dispatch-document",
  "purchase-receipt",
]);

type UploadInput = {
  kind: OperationalUploadKind;
  targetId: string;
  file: File;
};

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
      throw new AppError({ code: "OPERATIONAL_UPLOAD_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para anexar comprovantes de recebimento." });
    }
    const target = await dbAdmin.collection("purchase_receipts").doc(targetId).get();
    if (!target.exists) throw new AppError({ code: "OPERATIONAL_UPLOAD_TARGET_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Recebimento não encontrado." });
    const receipt = target.data() ?? {};
    const orderId = typeof receipt.purchaseOrderId === "string" ? receipt.purchaseOrderId : "";
    const order = orderId
      ? await dbAdmin.collection("purchase_orders").doc(orderId).get()
      : null;
    const workspaceId = typeof receipt.workspaceId === "string"
      ? receipt.workspaceId
      : order?.get("workspaceId");
    if (workspaceId !== WORKSPACE_ID) {
      throw new AppError({ code: "OPERATIONAL_UPLOAD_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Recebimento fora do workspace ativo." });
    }
    const destinationKioskId = typeof receipt.destinationKioskId === "string"
      ? receipt.destinationKioskId
      : order?.get("destinationKioskId");
    if (
      typeof destinationKioskId === "string"
      && destinationKioskId
      && !canAccessUnit(context.userDoc, destinationKioskId, { isDefaultAdmin: context.isDefaultAdmin })
    ) {
      throw new AppError({ code: "OPERATIONAL_UPLOAD_UNIT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Recebimento fora do seu escopo de unidades." });
    }
    return;
  }

  if (!canManageReposition(context)) {
    throw new AppError({ code: "OPERATIONAL_UPLOAD_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para anexar documentos da reposição." });
  }
  const target = await dbAdmin.collection("repositionActivities").doc(targetId).get();
  if (!target.exists) throw new AppError({ code: "OPERATIONAL_UPLOAD_TARGET_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Reposição não encontrada." });
  const activity = target.data() ?? {};
  if (!canAccessAnyUnit(
    context.userDoc,
    [activity.kioskOriginId, activity.kioskDestinationId],
    { isDefaultAdmin: context.isDefaultAdmin }
  )) {
    throw new AppError({ code: "OPERATIONAL_UPLOAD_UNIT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Reposição fora do seu escopo de unidades." });
  }
}

const uploadContract = defineSecurityContract({
  schemaVersion: 1,
  id: "operations.upload.create",
  version: 1,
  surface: { method: "POST", path: "/api/uploads/operations" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "operational-upload-permission" },
  resourceScope: { kind: "custom", strategy: "operational-upload-target" },
  input: { kind: "schema", schema: "operations.upload-form", unknownFields: "reject" },
  effects: { mode: "external", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const uploadEnforcer = defineSecurityEnforcer<NextRequest, { params: Promise<Record<string, never>> }, unknown, ServerUserContext, UploadInput, { targetId: string }>({
  id: "operations-upload-polymorphic-target-v1",
  guarantees: [
    "authenticated-user",
    "active-user",
    "authorization:operational-upload-permission",
    "scope:operational-upload-target",
    "input-validated",
    "fields-allowlisted",
  ],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "OPERATIONAL_UPLOAD_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const formData = await request.formData();
    const rawKind = formData.get("kind");
    const rawTargetId = formData.get("targetId");
    const file = formData.get("file");
    if (typeof rawKind !== "string" || !ALLOWED_KINDS.has(rawKind as OperationalUploadKind)) {
      throw new AppError({ code: "OPERATIONAL_UPLOAD_KIND_INVALID", kind: "VALIDATION", safeMessage: "Tipo de upload inválido." });
    }
    if (typeof rawTargetId !== "string" || !(file instanceof File)) {
      throw new AppError({ code: "OPERATIONAL_UPLOAD_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Arquivo ou identificador ausente." });
    }
    const targetId = sanitizeSegment(rawTargetId);
    if (!targetId || targetId !== rawTargetId) {
      throw new AppError({ code: "OPERATIONAL_UPLOAD_TARGET_INVALID", kind: "VALIDATION", safeMessage: "Identificador inválido." });
    }
    const kind = rawKind as OperationalUploadKind;
    const maxBytes = kind === "reposition-signature" ? SIGNATURE_MAX_BYTES : DOCUMENT_MAX_BYTES;
    if (file.size <= 0 || file.size > maxBytes) {
      throw new AppError({ code: "OPERATIONAL_UPLOAD_SIZE_INVALID", kind: "VALIDATION", safeMessage: kind === "reposition-signature" ? "Assinatura acima do limite de 2 MB." : "Documento acima do limite de 10 MB." });
    }
    await assertTargetAccess(actor, kind, targetId);
    return { actor, input: { kind, targetId, file }, resource: { targetId } };
  },
});

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

export const POST = secureRoute({ contract: uploadContract, enforcer: uploadEnforcer }, async ({ security }) => {
    const { actor: context, input: { kind, targetId, file } } = security;
    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = detectFile(buffer);
    if (!detected || (kind === "reposition-signature" && detected.kind !== "image")) {
      throw new AppError({ code: "OPERATIONAL_UPLOAD_FILE_INVALID", kind: "VALIDATION", safeMessage: kind === "reposition-signature" ? "Envie uma assinatura PNG, JPG ou WEBP válida." : "Envie uma imagem ou PDF válido." });
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
});
