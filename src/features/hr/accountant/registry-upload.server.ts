import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";

import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import {
  ACCOUNTANT_REGISTRY_MAX_FILE_SIZE,
  validateAccountantRegistryPdf,
} from "@/features/hr/accountant/registry-upload";

export type PreparedAccountantRegistryUpload = {
  buffer: Buffer;
  hashSha256: string;
  mimeType: "application/pdf";
  originalName: string;
  size: number;
};

export type AccountantRegistryDocument = {
  versionId: string;
  fileName: string;
  originalName: string;
  storagePath: string;
  hashSha256: string;
  mimeType: "application/pdf";
  size: number;
  uploadedAt: string;
  uploadSource: "accountant_public_link" | "rh";
  status: "received" | "approved";
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: null;
};

export type AccountantRegistryUploadValidation =
  | { ok: true; upload: PreparedAccountantRegistryUpload }
  | { ok: false; error: string; status: 400 };

export async function prepareAccountantRegistryUpload(
  value: FormDataEntryValue | null,
): Promise<AccountantRegistryUploadValidation> {
  if (!(value instanceof File)) {
    return { ok: false, error: "Selecione a Ficha de Registro de Empregado.", status: 400 };
  }
  if (value.type !== "application/pdf") {
    return { ok: false, error: "Envie a ficha de registro em PDF.", status: 400 };
  }
  if (value.size <= 0 || value.size > ACCOUNTANT_REGISTRY_MAX_FILE_SIZE) {
    return { ok: false, error: "O arquivo deve ter até 15 MB.", status: 400 };
  }
  const buffer = Buffer.from(await value.arrayBuffer());
  const validation = validateAccountantRegistryPdf({ mimeType: value.type, size: value.size, bytes: buffer });
  if (!validation.ok) return { ok: false, error: validation.error, status: 400 };
  return {
    ok: true,
    upload: {
      buffer,
      hashSha256: createHash("sha256").update(buffer).digest("hex"),
      mimeType: "application/pdf",
      originalName: value.name.slice(0, 240),
      size: value.size,
    },
  };
}

export async function registryUploadAlreadyExists(processId: string, hashSha256: string) {
  const snapshot = await hrDbAdmin
    .collection("onboardingProcesses")
    .doc(processId)
    .collection("accountantRegistryVersions")
    .where("hashSha256", "==", hashSha256)
    .limit(1)
    .get();
  return !snapshot.empty;
}

export async function storeAccountantRegistryUpload(params: {
  processId: string;
  candidateName: string;
  upload: PreparedAccountantRegistryUpload;
  uploadedAt: string;
  uploader: "accountant_public_link" | "rh";
  actorId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  approveImmediately?: boolean;
}) {
  const versionId = randomUUID();
  const storagePath = `hr/onboarding/${params.processId}/accountant/registry/${versionId}.pdf`;
  const status = params.approveImmediately ? "approved" : "received";
  const registryDocument: AccountantRegistryDocument = {
    versionId,
    fileName: `Ficha de registro - ${params.candidateName || "colaborador"}.pdf`,
    originalName: params.upload.originalName,
    storagePath,
    hashSha256: params.upload.hashSha256,
    mimeType: params.upload.mimeType,
    size: params.upload.size,
    uploadedAt: params.uploadedAt,
    uploadSource: params.uploader,
    status,
    reviewedAt: params.approveImmediately ? params.uploadedAt : null,
    reviewedBy: params.approveImmediately ? params.actorId ?? null : null,
    rejectionReason: null,
  };

  await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(storagePath)
    .save(params.upload.buffer, {
      resumable: false,
      metadata: {
        contentType: params.upload.mimeType,
        cacheControl: "private, max-age=0, no-store",
        metadata: {
          onboardingId: params.processId,
          versionId,
          hashSha256: params.upload.hashSha256,
          uploader: params.uploader,
        },
      },
    });

  await hrDbAdmin
    .collection("onboardingProcesses")
    .doc(params.processId)
    .collection("accountantRegistryVersions")
    .doc(versionId)
    .set({
      ...registryDocument,
      uploader: params.uploader,
      actorId: params.actorId ?? null,
      actorEmail: params.actorEmail ?? null,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    });

  return registryDocument;
}
