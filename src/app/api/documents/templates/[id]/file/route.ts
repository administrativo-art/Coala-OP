import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { extractDocxVariables } from "@/features/hr/documents/docx-generator";
import { applyCtDocumentStandard } from "@/features/hr/documents/ct-document-standard.server";
import {
  validateCtDocumentStandard,
  validateDocxForLetterhead,
} from "@/features/hr/documents/docx-template-validation";
import { DOCUMENT_VARIABLE_SCHEMA_VERSION } from "@/features/hr/integration/document-variables";
import { normalizeFieldMapping, pendingPlaceholders } from "@/features/hr/documents/field-mapping";
import { scanDocxTemplateForPersonalData } from "@/features/hr/documents/document-template-ai";
import {
  documentTemplateEditBlockMessage,
  isDocumentTemplateContentEditable,
} from "@/features/hr/documents/document-template-governance";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
const MAX_BYTES = 10 * 1024 * 1024;
function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await assertFormalizationAccess(request, "templates.manage");
    const { id } = await context.params;
    const reference = dbAdmin.collection("companyDocumentTemplates").doc(id);
    const document = await reference.get();
    if (!document.exists || document.get("deletedAt")) return error("Modelo não encontrado.", 404);
    if (!isDocumentTemplateContentEditable({
      officialCandidate: document.get("officialCandidate") === true,
      status: document.get("status"),
      workflowStatus: document.get("workflowStatus"),
    })) {
      return error(documentTemplateEditBlockMessage({
        officialCandidate: document.get("officialCandidate") === true,
        status: document.get("status"),
        workflowStatus: document.get("workflowStatus"),
      }), 409);
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".docx")) return error("Envie um arquivo Word no formato DOCX.");
    if (file.size > MAX_BYTES) return error("O modelo DOCX deve possuir até 10 MB.");
    const originalBuffer = Buffer.from(await file.arrayBuffer());
    let buffer: Buffer;
    let variables: string[];
    let templateValidation;
    let documentStandardValidation;
    try {
      buffer = applyCtDocumentStandard(originalBuffer);
      variables = extractDocxVariables(buffer);
      templateValidation = validateDocxForLetterhead(buffer);
      documentStandardValidation = validateCtDocumentStandard(buffer);
    } catch {
      return error("O arquivo DOCX está corrompido ou não é um modelo válido.");
    }
    const fieldMapping = normalizeFieldMapping(document.get("fieldMapping"), variables);
    const personalDataScan = scanDocxTemplateForPersonalData(buffer);
    const pending = pendingPlaceholders(variables, fieldMapping);
    const version = Number(document.get("version") ?? 0) + 1;
    const storagePath = `document-templates/${id}/versions/${String(version).padStart(3, "0")}/template.docx`;
    const originalStoragePath = `document-templates/${id}/versions/${String(version).padStart(3, "0")}/original.docx`;
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    await Promise.all([
      bucket.file(originalStoragePath).save(originalBuffer, {
        resumable: false,
        metadata: {
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          cacheControl: "private, no-store",
          metadata: {
            templateId: id,
            version: String(version),
            artifact: "original",
          },
        },
      }),
      bucket.file(storagePath).save(buffer, {
        resumable: false,
        metadata: {
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          cacheControl: "private, no-store",
          metadata: {
            templateId: id,
            version: String(version),
            artifact: "standardized-candidate",
          },
        },
      }),
    ]);
    const now = Timestamp.now();
    const update = {
      status: "draft",
      preparationStatus: "ai_mapping",
      ...(document.get("officialCandidate") === true ? {
        workflowStatus: "technical_validation",
        workflowNote: null,
      } : {}),
      version,
      storagePath,
      originalStoragePath,
      originalName: file.name.slice(0, 180),
      originalSize: file.size,
      originalContentHash: createHash("sha256")
        .update(originalBuffer)
        .digest("hex"),
      size: buffer.byteLength,
      contentHash: createHash("sha256").update(buffer).digest("hex"),
      variables,
      fieldMapping,
      variableContract: DOCUMENT_VARIABLE_SCHEMA_VERSION,
      unknownVariables: pending,
      letterheadProfileId: templateValidation.profileId,
      templateValidation,
      documentStandardVersion: 1,
      documentStandardValidation,
      documentStandardAppliedAt: now,
      documentStandardAutomaticRules: [
        "estilos_ct",
        "pagina_a4",
        "margens_ct",
        "hifenizacao",
        "numeracao_multinivel",
        "campo_pagina",
      ],
      aiPreparationBlocked: !personalDataScan.safeForAi,
      aiPreparationFindings: personalDataScan.findings,
      aiMappingPlan: null,
      fieldPreparationTestedAt: null,
      fieldPreparationTestedBy: null,
      fieldPreparationTestedByName: null,
      sourceIntegrity: null,
      contentUpdatedAt: now,
      contentUpdatedBy: access.decoded.uid,
      contentUpdatedByName: access.actorName,
      updatedAt: now,
      updatedBy: access.decoded.uid,
      updatedByName: access.actorName,
    };
    await reference.update(update);
    return NextResponse.json({ template: { id, ...(serializeHrValue({ ...document.data(), ...update }) as Record<string, unknown>) } });
  } catch (cause) { return error(cause instanceof Error ? cause.message : "Falha ao enviar modelo.", 403); }
}
