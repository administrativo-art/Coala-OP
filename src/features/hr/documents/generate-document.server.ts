import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { generateDocx } from "@/features/hr/documents/docx-generator";
import { applyFieldMapping, normalizeFieldMapping } from "@/features/hr/documents/field-mapping";
import { convertDocxToPdf } from "@/features/hr/documents/pdf-converter.server";
import { resolveDocumentData } from "@/features/hr/documents/document-resolver.server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export type GenerateDocumentFromTemplateParams = {
  templateId: string;
  employeeId?: string | null;
  onboardingId?: string | null;
  includeSensitive?: boolean;
  /** Valores dos campos manuais do modelo, indexados pelo placeholder. */
  manualValues?: Record<string, unknown>;
  /** "draft" entra em conferência antes de finalizar; "final" mantém o comportamento legado. */
  lifecycle?: "draft" | "final";
  actorId: string;
  actorName: string;
};

export type GeneratedDocumentResult = {
  id: string;
  buffer: Buffer;
  fileName: string;
  storagePath: string;
  pdfStoragePath: string | null;
  status: "draft" | "final";
  missingRequired: string[];
  templateVersion: unknown;
};

function sanitizeManualValues(input: Record<string, unknown> | undefined) {
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .map(([key, value]) => [key, value as string | number | boolean]),
  );
}

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

  const variables = Array.isArray(template.get("variables"))
    ? (template.get("variables") as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const mapping = normalizeFieldMapping(template.get("fieldMapping"), variables);
  const manualValues = sanitizeManualValues(params.manualValues);

  const resolved = await resolveDocumentData({
    employeeId: params.employeeId,
    onboardingId: params.onboardingId,
    includeSensitive: params.includeSensitive,
  });
  const mapped = applyFieldMapping({ data: resolved.data, flat: resolved.flat, mapping, manualValues });
  if (mapped.missingManual.length) {
    throw new Error(`Preencha os campos obrigatórios: ${mapped.missingManual.join(", ")}.`);
  }

  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const [source] = await bucket.file(template.get("storagePath")).download();
  const buffer = generateDocx(source, mapped.data);
  const id = randomUUID();
  const now = Timestamp.now();
  const status = params.lifecycle === "draft" ? "draft" : "final";
  const baseName = String(template.get("name") ?? "documento").replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `${baseName}.docx`;
  const folder = `generated-documents/${params.onboardingId || params.employeeId}/${id}`;
  const storagePath = `${folder}/${fileName}`;

  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      cacheControl: "private, no-store",
    },
  });

  let pdfStoragePath: string | null = null;
  const pdfBuffer = await convertDocxToPdf(buffer);
  if (pdfBuffer) {
    pdfStoragePath = `${folder}/${baseName}.pdf`;
    await bucket.file(pdfStoragePath).save(pdfBuffer, {
      resumable: false,
      metadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
    });
  }

  await dbAdmin.collection("generatedDocuments").doc(id).set({
    templateId: params.templateId,
    templateName: template.get("name") ?? null,
    templateVersion: template.get("version"),
    employeeId: params.employeeId ?? null,
    employeeName: typeof resolved.flat["employee.name"] === "string" ? resolved.flat["employee.name"] : null,
    onboardingId: params.onboardingId ?? null,
    status,
    manualValues,
    storagePath,
    pdfStoragePath,
    originalName: fileName,
    missingRequired: resolved.missingRequired,
    generatedAt: now,
    generatedBy: params.actorId,
    generatedByName: params.actorName,
    finalizedAt: status === "final" ? now : null,
    finalizedBy: status === "final" ? params.actorId : null,
  });

  return {
    id,
    buffer,
    fileName,
    storagePath,
    pdfStoragePath,
    status,
    missingRequired: resolved.missingRequired,
    templateVersion: template.get("version"),
  };
}
