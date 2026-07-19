import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { generateDocx } from "@/features/hr/documents/docx-generator";
import { resolveDocumentData } from "@/features/hr/documents/document-resolver.server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export type GenerateDocumentFromTemplateParams = {
  templateId: string;
  employeeId?: string | null;
  onboardingId?: string | null;
  includeSensitive?: boolean;
  actorId: string;
  actorName: string;
};

export type GeneratedDocumentResult = {
  id: string;
  buffer: Buffer;
  fileName: string;
  storagePath: string;
  missingRequired: string[];
  templateVersion: unknown;
};

export async function generateDocumentFromTemplate(
  params: GenerateDocumentFromTemplateParams
): Promise<GeneratedDocumentResult> {
  if (!params.templateId || (!params.employeeId && !params.onboardingId)) {
    throw new Error("Informe o modelo e o colaborador ou integração.");
  }

  const template = await dbAdmin
    .collection("companyDocumentTemplates")
    .doc(params.templateId)
    .get();

  if (
    !template.exists ||
    template.get("status") !== "published" ||
    typeof template.get("storagePath") !== "string"
  ) {
    throw new Error("Modelo DOCX publicado não encontrado.");
  }

  const resolved = await resolveDocumentData({
    employeeId: params.employeeId,
    onboardingId: params.onboardingId,
    includeSensitive: params.includeSensitive,
  });
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const [source] = await bucket.file(template.get("storagePath")).download();
  const buffer = generateDocx(source, resolved.data);
  const id = randomUUID();
  const now = Timestamp.now();
  const fileName = `${String(template.get("name") ?? "documento").replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  )}.docx`;
  const storagePath = `generated-documents/${
    params.onboardingId || params.employeeId
  }/${id}/${fileName}`;

  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      cacheControl: "private, no-store",
    },
  });
  await dbAdmin.collection("generatedDocuments").doc(id).set({
    templateId: params.templateId,
    templateVersion: template.get("version"),
    employeeId: params.employeeId ?? null,
    onboardingId: params.onboardingId ?? null,
    storagePath,
    originalName: fileName,
    missingRequired: resolved.missingRequired,
    generatedAt: now,
    generatedBy: params.actorId,
    generatedByName: params.actorName,
  });

  return {
    id,
    buffer,
    fileName,
    storagePath,
    missingRequired: resolved.missingRequired,
    templateVersion: template.get("version"),
  };
}
