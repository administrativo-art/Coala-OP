import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { extractDocxVariables, generateDocx } from "@/features/hr/documents/docx-generator";
import { applyFieldMapping, normalizeFieldMapping } from "@/features/hr/documents/field-mapping";
import { convertDocxToPdf } from "@/features/hr/documents/pdf-converter.server";
import { resolveDocumentData } from "@/features/hr/documents/document-resolver.server";
import {
  isDocumentFormSchema,
  resolveDocumentFormSchema,
  type DocumentPartySnapshot,
} from "@/features/hr/documents/document-form-schema";
import {
  buildDocumentGenerationKey,
  canonicalDocumentJson,
  DOCUMENT_PIPELINE_VERSION,
} from "@/features/hr/documents/document-generation-key.server";
import { applyCoalaLetterheadToPdf } from "@/features/hr/documents/letterhead-pdf.server";
import { allocateIdempotentDocumentProtocol } from "@/features/hr/documents/document-protocol.server";
import { resolveDocumentLegalEntitySnapshot } from "@/features/hr/documents/legal-entity-snapshot.server";
import { buildGeneratedDocumentAudit } from "@/features/hr/documents/generated-document-audit";
import { retentionFields } from "@/features/hr/documents/document-retention";
import { systemDocumentTemplateById } from "@/features/hr/documents/system-template-catalog";
import { systemTemplateWorkflowStatus } from "@/features/hr/documents/document-template-workflow.server";
import { inspectStoredDocumentTemplateIntegrity } from "@/features/hr/documents/document-template-integrity.server";
import { loadSystemDocumentTemplateSource } from "@/features/hr/documents/system-template-source.server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { DOCUMENT_VARIABLES } from "@/features/hr/integration/document-variables";

export type GenerateDocumentFromTemplateParams = {
  templateId: string;
  employeeId?: string | null;
  onboardingId?: string | null;
  includeSensitive?: boolean;
  /** Valores dos campos manuais do modelo, indexados pelo placeholder. */
  manualValues?: Record<string, unknown>;
  /** Respostas do assistente guiado pelo schema do modelo. */
  formValues?: Record<string, unknown>;
  /** "draft" entra em conferência antes de finalizar; "final" mantém o comportamento legado. */
  lifecycle?: "draft" | "final";
  /** Identificador explícito para uma nova revisão com o mesmo conteúdo. */
  revisionKey?: string | null;
  actorId: string;
  actorName: string;
};

export type GeneratedDocumentResult = {
  id: string;
  buffer: Buffer;
  fileName: string;
  storagePath: string;
  pdfStoragePath: string | null;
  status: "draft" | "review_pending" | "approved" | "final";
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function missingSystemDataMessage(keys: string[]) {
  const groups = new Map<string, string[]>();
  keys.forEach((key) => {
    const entry = DOCUMENT_VARIABLES.find((variable) => variable.key === key);
    const section = entry?.section ?? "Cadastro do sistema";
    groups.set(section, [...(groups.get(section) ?? []), entry?.label ?? key]);
  });
  return Array.from(groups.entries())
    .map(([section, labels]) => `${section}: ${labels.join(", ")}`)
    .join("; ");
}

function sanitizeFormValue(value: unknown, depth = 0): unknown {
  if (depth > 8) throw new Error("O formulário excedeu a profundidade permitida.");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 200) throw new Error("O formulário excedeu o limite de itens.");
    return value.map((item) => sanitizeFormValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 300)
        .map(([key, item]) => [key.slice(0, 120), sanitizeFormValue(item, depth + 1)]),
    );
  }
  return null;
}

function mergeData(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (
      value && typeof value === "object" && !Array.isArray(value)
      && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])
    ) {
      mergeData(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function setDataPath(root: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = root;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else cursor = cursor[part] = record(cursor[part]);
  });
}

function schemaVariableSets(formSchema: unknown) {
  if (!isDocumentFormSchema(formSchema)) {
    return { schemaVariables: new Set<string>(), schemaSensitiveVariables: new Set<string>() };
  }
  const schemaVariables = new Set<string>();
  const schemaSensitiveVariables = new Set<string>();
  formSchema.steps.forEach((step) => step.fields.forEach((field) => {
    schemaVariables.add(field.key);
    if (field.kind === "party") schemaSensitiveVariables.add(field.key);
  }));
  return { schemaVariables, schemaSensitiveVariables };
}

function maskPartyDocument(value: string | null) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  if (digits.length === 14) return `${digits.slice(0, 2)}.***.***/****-${digits.slice(-2)}`;
  return "***";
}

export async function generateDocumentFromTemplate(
  params: GenerateDocumentFromTemplateParams
): Promise<GeneratedDocumentResult> {
  if (!params.templateId) throw new Error("Informe o modelo.");

  const storedTemplate = await dbAdmin
    .collection("companyDocumentTemplates")
    .doc(params.templateId)
    .get();
  const systemTemplate = systemDocumentTemplateById(params.templateId);
  const systemStatus = systemTemplate
    ? await systemTemplateWorkflowStatus(systemTemplate)
    : null;
  const storedPublished = storedTemplate.exists
    && storedTemplate.get("status") === "published"
    && typeof storedTemplate.get("storagePath") === "string";
  const systemPublished = systemTemplate !== null
    && systemStatus === "published"
    && systemTemplate.sourceFormat === "docx"
    && Boolean(systemTemplate.sourcePath);
  if (!storedPublished && !systemPublished) {
    throw new Error("Modelo DOCX publicado não encontrado.");
  }
  const templateData = storedPublished
    ? record(storedTemplate.data())
    : record(systemTemplate);
  const templateValue = (key: string) => templateData[key];
  const rawFormSchema = templateValue("formSchema");
  const formSchema = isDocumentFormSchema(rawFormSchema)
    ? rawFormSchema
    : null;
  if (
    !params.employeeId
    && !params.onboardingId
    && (!formSchema || formSchema.anchor === "employee")
  ) {
    throw new Error("Informe o colaborador ou integração.");
  }

  const variables = Array.isArray(templateValue("variables"))
    ? (templateValue("variables") as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const mapping = normalizeFieldMapping(templateValue("fieldMapping"), variables);
  const manualValues = sanitizeManualValues(params.manualValues);
  const formValues = record(sanitizeFormValue(params.formValues ?? {}));

  const resolved = await resolveDocumentData({
    employeeId: params.employeeId,
    onboardingId: params.onboardingId,
    includeSensitive: params.includeSensitive,
  });
  const mapped = applyFieldMapping({
    data: resolved.data,
    flat: resolved.flat,
    rawFlat: resolved.rawFlat,
    mapping,
    manualValues,
  });
  let parties: DocumentPartySnapshot[] = [];
  let missingSchema: string[] = [];
  if (formSchema) {
    const schemaResolved = resolveDocumentFormSchema(formSchema, formValues);
    mergeData(mapped.data, schemaResolved.values);
    parties = schemaResolved.parties;
    missingSchema = schemaResolved.missing;
  }
  const mappedSystemKeys = mapped.missingSystem.map((placeholder) => {
    const binding = mapping[placeholder];
    return binding?.kind === "system" ? binding.key : placeholder;
  });
  if (mappedSystemKeys.length) {
    throw new Error(
      `A geração foi bloqueada. Complete estes dados na fonte oficial: ${missingSystemDataMessage(mappedSystemKeys)}.`,
    );
  }
  const missingForm = [...mapped.missingManual, ...missingSchema];
  if (missingForm.length) {
    throw new Error(`Preencha os campos obrigatórios: ${missingForm.join(", ")}.`);
  }
  let assignedProtocol: string | null = null;
  if (formSchema?.protocolTarget && formSchema.protocolType) {
    const issuer = parties.find((party) => party.role === "issuer");
    const reservationKey = createHash("sha256")
      .update(canonicalDocumentJson({
        templateId: params.templateId,
        templateVersion: templateValue("version"),
        formValues: mapped.data,
      }))
      .digest("hex");
    assignedProtocol = await allocateIdempotentDocumentProtocol({
      entity: issuer?.snapshot.name ?? "CS",
      type: formSchema.protocolType,
      actorId: params.actorId,
      reservationKey,
    });
    setDataPath(mapped.data, formSchema.protocolTarget, assignedProtocol);
  }
  const usedSystemVariables = new Set([
    ...variables,
    ...Object.values(mapping)
      .filter((binding) => binding.kind === "system")
      .map((binding) => binding.key),
  ]);
  const missingRequired = resolved.missingRequired.filter((key) =>
    usedSystemVariables.has(key)
  );
  if (missingRequired.length) {
    throw new Error(
      `A geração foi bloqueada. Complete estes dados na fonte oficial: ${missingSystemDataMessage(missingRequired)}.`,
    );
  }
  const legalEntitySnapshot = await resolveDocumentLegalEntitySnapshot({
    cnpj: resolved.rawFlat["integration.employer_cnpj"],
    fallbackName: resolved.rawFlat["integration.employer_name"],
    fallbackAddress: resolved.rawFlat["integration.employer_address"],
  });

  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const generationKey = buildDocumentGenerationKey({
    templateId: params.templateId,
    templateVersion: templateValue("version"),
    templateHash: templateValue("contentHash"),
    employeeId: params.employeeId,
    onboardingId: params.onboardingId,
    legalEntityId: legalEntitySnapshot.entityId ?? legalEntitySnapshot.cnpj,
    resolvedValues: mapped.data,
    manualValues,
    formValues,
    letterheadVersion: String(
      templateValue("letterheadProfileId")
        ?? templateValue("letterheadVersion")
        ?? "coala-letterhead-v2",
    ),
    revisionKey: params.revisionKey,
  });
  const id = generationKey;
  const existing = await dbAdmin.collection("generatedDocuments").doc(id).get();
  if (existing.exists && typeof existing.get("storagePath") === "string") {
    const existingStoragePath = String(existing.get("storagePath"));
    const [existingBuffer] = await bucket.file(existingStoragePath).download();
    let existingPdfStoragePath = typeof existing.get("pdfStoragePath") === "string"
      ? String(existing.get("pdfStoragePath"))
      : null;
    if (!existingPdfStoragePath) {
      const convertedPdf = await convertDocxToPdf(existingBuffer);
      if (convertedPdf) {
        const pdfBuffer = await applyCoalaLetterheadToPdf(convertedPdf);
        const folder = existingStoragePath.slice(0, existingStoragePath.lastIndexOf("/"));
        const baseName = String(existing.get("originalName") ?? "documento.docx")
          .replace(/\.docx$/i, "");
        existingPdfStoragePath = `${folder}/${baseName}.pdf`;
        const pdfContentHash = createHash("sha256").update(pdfBuffer).digest("hex");
        await Promise.all([
          bucket.file(existingPdfStoragePath).save(pdfBuffer, {
            resumable: false,
            metadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
          }),
          existing.ref.set({
            pdfStoragePath: existingPdfStoragePath,
            pdfContentHash,
            pdfGenerationStatus: "ready",
            pdfGeneratedAt: Timestamp.now(),
          }, { merge: true }),
        ]);
      }
    }
    return {
      id,
      buffer: existingBuffer,
      fileName: String(existing.get("originalName") ?? "documento.docx"),
      storagePath: existing.get("storagePath"),
      pdfStoragePath: existingPdfStoragePath,
      status: ["draft", "review_pending", "approved"].includes(String(existing.get("status")))
        ? existing.get("status")
        : "final",
      missingRequired: Array.isArray(existing.get("missingRequired")) ? existing.get("missingRequired") : [],
      templateVersion: existing.get("templateVersion"),
    };
  }
  let source: Buffer;
  if (storedPublished) {
    const integrity = await inspectStoredDocumentTemplateIntegrity(storedTemplate);
    if (!integrity.valid) {
      throw new Error(
        `A geração foi bloqueada porque o DOCX publicado não corresponde ao mapeamento: ${integrity.issues.map((issue) => issue.message).join(" ")}`,
      );
    }
    source = (await bucket.file(String(templateValue("storagePath"))).download())[0];
  } else {
    source = await loadSystemDocumentTemplateSource(systemTemplate!);
  }
  const buffer = generateDocx(source, mapped.data);
  const unresolvedTokens = extractDocxVariables(buffer);
  if (unresolvedTokens.length) {
    throw new Error(
      `A geração deixou campos sem resolução: ${unresolvedTokens.join(", ")}.`,
    );
  }
  const now = Timestamp.now();
  const generatedAtIso = now.toDate().toISOString();
  const status = params.lifecycle === "draft" ? "review_pending" : "final";
  const baseName = String(templateValue("name") ?? "documento").replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `${baseName}.docx`;
  const folder = `generated-documents/${params.onboardingId || params.employeeId || "standalone"}/${id}`;
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
  let pdfContentHash: string | null = null;
  const convertedPdf = await convertDocxToPdf(buffer);
  if (convertedPdf) {
    const pdfBuffer = await applyCoalaLetterheadToPdf(convertedPdf);
    pdfContentHash = createHash("sha256").update(pdfBuffer).digest("hex");
    pdfStoragePath = `${folder}/${baseName}.pdf`;
    await bucket.file(pdfStoragePath).save(pdfBuffer, {
      resumable: false,
      metadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
    });
  }

  const retention = retentionFields({
    policyId: templateValue("retentionPolicyId"),
    generatedAt: generatedAtIso,
  });
  const schemaSets = schemaVariableSets(formSchema);
  const { audit, size: resolvedValuesAuditBytes } =
    buildGeneratedDocumentAudit({
      variables,
      mapping,
      data: mapped.data,
      flat: resolved.flat,
      rawFlat: resolved.rawFlat,
      manualValues,
      ...schemaSets,
      resolvedAt: generatedAtIso,
    });
  const generatedReference = dbAdmin.collection("generatedDocuments").doc(id);
  const batch = dbAdmin.batch();
  batch.set(generatedReference, {
    templateId: params.templateId,
    templateName: templateValue("name") ?? null,
    templateVersion: templateValue("version"),
    signatureScope: templateValue("signatureScope") ?? "none",
    postAdmissionSignatureScope: templateValue("postAdmissionSignatureScope") ?? null,
    documentTypeCode: templateValue("documentTypeCode")
      ?? (String(params.templateId).includes("transportation-voucher") ? "TRANSPORT_REQUEST" : null),
    employeeId: params.employeeId ?? null,
    employeeName: typeof resolved.flat["employee.name"] === "string" ? resolved.flat["employee.name"] : null,
    onboardingId: params.onboardingId ?? null,
    legalEntityId: legalEntitySnapshot.entityId,
    legalEntitySnapshot,
    status,
    protocol: assignedProtocol,
    manualValues,
    formValuesHash: createHash("sha256").update(canonicalDocumentJson(formValues)).digest("hex"),
    formSchemaVersion: formSchema?.schemaVersion ?? null,
    parties: parties.map((party) => ({
      partyType: party.partyType,
      role: party.role,
      ref: party.ref,
      snapshot: {
        name: party.snapshot.name,
        documentMasked: maskPartyDocument(party.snapshot.document),
        signatureEmail: party.snapshot.email?.trim().toLocaleLowerCase("pt-BR") || null,
        signatureName: party.snapshot.signatureName?.trim() || party.snapshot.name,
      },
    })),
    storagePath,
    pdfStoragePath,
    pdfGenerationStatus: pdfStoragePath ? "ready" : "unavailable",
    originalName: fileName,
    generationKey,
    pipelineVersion: DOCUMENT_PIPELINE_VERSION,
    letterheadProfileId: templateValue("letterheadProfileId")
      ?? templateValue("letterheadVersion")
      ?? "coala-letterhead-v2",
    templateContentHash: templateValue("contentHash") ?? null,
    resolvedValuesHash: createHash("sha256").update(canonicalDocumentJson(mapped.data)).digest("hex"),
    docxContentHash: createHash("sha256").update(buffer).digest("hex"),
    pdfContentHash,
    missingRequired,
    ...retention,
    legalHold: false,
    archiveStatus: "pending",
    generatedAt: now,
    generatedBy: params.actorId,
    generatedByName: params.actorName,
    finalizedAt: status === "final" ? now : null,
    finalizedBy: status === "final" ? params.actorId : null,
  });
  batch.set(generatedReference.collection("audit").doc("resolvedValues"), {
    ...audit,
    retentionPolicyId: retention.retentionPolicyId,
    retentionUntil: retention.retentionUntil,
    legalHold: false,
    byteSize: resolvedValuesAuditBytes,
  });
  if (params.employeeId && String(params.templateId).includes("transportation-voucher")) {
    const expectedMode = String(params.templateId).includes("waiver") ? "waived" : "requested";
    const currentDecision = await dbAdmin.collection("transportVoucherDecisions")
      .where("employeeId", "==", params.employeeId)
      .where("status", "==", "current")
      .limit(1)
      .get();
    const decision = currentDecision.docs[0];
    if (decision && decision.get("mode") === expectedMode) {
      batch.set(decision.ref, {
        generatedDocumentId: id,
        generatedAt: generatedAtIso,
      }, { merge: true });
      const supersedesDecisionId = decision.get("supersedesDecisionId");
      if (typeof supersedesDecisionId === "string" && supersedesDecisionId) {
        const previousDecision = await dbAdmin.collection("transportVoucherDecisions")
          .doc(supersedesDecisionId)
          .get();
        const previousGeneratedDocumentId = previousDecision.get("generatedDocumentId");
        if (typeof previousGeneratedDocumentId === "string" && previousGeneratedDocumentId) {
          batch.set(dbAdmin.collection("generatedDocuments").doc(previousGeneratedDocumentId), {
            status: "superseded",
            supersededByDocumentId: id,
            supersededAt: now,
          }, { merge: true });
        }
      }
    }
  }
  await batch.commit();

  return {
    id,
    buffer,
    fileName,
    storagePath,
    pdfStoragePath,
    status,
    missingRequired,
    templateVersion: templateValue("version"),
  };
}
