import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { extractDocxVariables } from "@/features/hr/documents/docx-generator";
import { validateDocxForLetterhead } from "@/features/hr/documents/docx-template-validation";
import { loadSystemDocumentTemplateSource } from "@/features/hr/documents/system-template-source.server";
import { systemDocumentTemplateById } from "@/features/hr/documents/system-template-catalog";
import { DOCUMENT_VARIABLE_SCHEMA_VERSION } from "@/features/hr/integration/document-variables";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "companyDocumentTemplates";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await assertFormalizationAccess(request, "templates.manage");
    const { id } = await context.params;
    const systemTemplate = systemDocumentTemplateById(id);
    const storedSourceReference = dbAdmin.collection(COLLECTION).doc(id);
    const storedSourceDocument = systemTemplate ? null : await storedSourceReference.get();
    const storedOfficialVersion = Boolean(
      storedSourceDocument?.exists
      && !storedSourceDocument.get("deletedAt")
      && storedSourceDocument.get("officialCandidate") === true
      && typeof storedSourceDocument.get("storagePath") === "string"
      && ["rh_approval", "legal_review", "published"].includes(
        String(storedSourceDocument.get("workflowStatus")),
      )
    );
    if (
      (!systemTemplate || systemTemplate.sourceFormat !== "docx" || !systemTemplate.sourcePath)
      && !storedOfficialVersion
    ) {
      return error("Este modelo oficial não possui uma fonte Word editável.", 404);
    }

    const candidates = await dbAdmin.collection(COLLECTION)
      .where("derivedFromTemplateId", "==", id)
      .get();
    const reusable = candidates.docs.find((document) =>
      !document.get("deletedAt")
      && document.get("status") === "draft"
      && document.get("workflowStatus") !== "archived"
      && document.get("workflowStatus") !== "superseded"
    );
    if (reusable) {
      return NextResponse.json({
        template: { id: reusable.id, ...(serializeHrValue(reusable.data()) as Record<string, unknown>) },
        reused: true,
      });
    }

    const source = systemTemplate
      ? await loadSystemDocumentTemplateSource(systemTemplate)
      : (await getStorage(adminApp)
          .bucket(firebaseClientConfig.storageBucket)
          .file(String(storedSourceDocument!.get("storagePath")))
          .download())[0];
    const sourceData = systemTemplate
      ? systemTemplate as unknown as Record<string, unknown>
      : storedSourceDocument!.data() as Record<string, unknown>;
    const sourceVersion = Number(sourceData.version ?? 1);
    const rootSystemTemplateId = systemTemplate
      ? systemTemplate.id
      : String(sourceData.derivedFromSystemTemplateId);
    const variables = extractDocxVariables(source);
    const validation = validateDocxForLetterhead(source);
    const candidateId = randomUUID();
    const version = sourceVersion + 1;
    const storagePath = `document-templates/${candidateId}/versions/${String(version).padStart(3, "0")}/template.docx`;
    const now = Timestamp.now();
    const contentHash = createHash("sha256").update(source).digest("hex");
    const sourceName = String(sourceData.name ?? "Modelo oficial");
    const originalName = `${sourceName.replace(/[^\p{L}\p{N}._ -]+/gu, "").trim() || "modelo"}-v${version}.docx`;

    await getStorage(adminApp)
      .bucket(firebaseClientConfig.storageBucket)
      .file(storagePath)
      .save(source, {
        resumable: false,
        metadata: {
          contentType: DOCX_MIME,
          cacheControl: "private, no-store",
          metadata: {
            templateId: candidateId,
            version: String(version),
            derivedFromTemplateId: id,
            derivedFromTemplateVersion: String(sourceVersion),
            derivedFromSystemTemplateId: rootSystemTemplateId,
          },
        },
      });

    const payload = {
      name: sourceName,
      category: String(sourceData.category ?? "Outros"),
      description: `Nova versão editável derivada de ${sourceName}, versão ${sourceVersion}.`,
      status: "draft",
      workflowStatus: "technical_validation",
      workflowHistory: [],
      preparationStatus: "ai_mapping",
      officialCandidate: true,
      derivedFromTemplateId: id,
      derivedFromTemplateVersion: sourceVersion,
      derivedFromSystemTemplateId: rootSystemTemplateId,
      derivedFromSystemTemplateVersion: systemTemplate
        ? systemTemplate.version
        : Number(sourceData.derivedFromSystemTemplateVersion ?? sourceVersion),
      version,
      storagePath,
      originalName,
      size: source.length,
      contentHash,
      variables,
      fieldMapping: sourceData.fieldMapping ?? {},
      variableContract: DOCUMENT_VARIABLE_SCHEMA_VERSION,
      unknownVariables: [],
      formSchema: sourceData.formSchema ?? null,
      letterheadProfileId: validation.profileId,
      templateValidation: validation,
      signatureScope: sourceData.signatureScope ?? "none",
      retentionPolicyId: sourceData.retentionPolicyId ?? null,
      generationMode: sourceData.generationMode ?? "direct",
      sourceModule: sourceData.sourceModule ?? null,
      sourceModulePath: sourceData.sourceModulePath ?? null,
      createdAt: now,
      createdBy: access.decoded.uid,
      createdByName: access.actorName,
      contentUpdatedAt: now,
      contentUpdatedBy: access.decoded.uid,
      contentUpdatedByName: access.actorName,
      sourceIntegrity: null,
      updatedAt: now,
      updatedBy: access.decoded.uid,
      updatedByName: access.actorName,
      deletedAt: null,
    };
    const reference = dbAdmin.collection(COLLECTION).doc(candidateId);
    await reference.set(payload);
    await reference.collection("versions").doc(String(version).padStart(3, "0")).set({
      operation: "derived_from_system_template",
      sourceTemplateId: id,
      sourceTemplateVersion: sourceVersion,
      rootSystemTemplateId,
      storagePath,
      contentHash,
      createdAt: now,
      createdBy: access.decoded.uid,
      createdByName: access.actorName,
    });
    return NextResponse.json({
      template: { id: candidateId, ...(serializeHrValue(payload) as Record<string, unknown>) },
      reused: false,
    }, { status: 201 });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao criar a versão editável.", 403);
  }
}
