import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { Timestamp } from "firebase-admin/firestore";

import { proposeDocumentTemplatePlan } from "@/ai/flows/document-template-plan-flow";
import {
  scanDocxTemplateForPersonalData,
  validateTemplateAiPlan,
  type DocumentTemplateAiPlan,
} from "@/features/hr/documents/document-template-ai";
import {
  extractDocxVariables,
  replaceDocxTextWithVariable,
} from "@/features/hr/documents/docx-generator";
import {
  validateCtDocumentStandard,
  validateDocxForLetterhead,
} from "@/features/hr/documents/docx-template-validation";
import { normalizeFieldMapping, pendingPlaceholders } from "@/features/hr/documents/field-mapping";
import { DOCUMENT_VARIABLE_SCHEMA_VERSION } from "@/features/hr/integration/document-variables";
import { isDocumentFormSchema } from "@/features/hr/documents/document-form-schema";
import {
  documentTemplateEditBlockMessage,
  isDocumentTemplateContentEditable,
} from "@/features/hr/documents/document-template-governance";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

async function templateSource(id: string) {
  const reference = dbAdmin.collection("companyDocumentTemplates").doc(id);
  const document = await reference.get();
  if (!document.exists || document.get("deletedAt")) throw new Error("Modelo não encontrado.");
  if (!isDocumentTemplateContentEditable({
    officialCandidate: document.get("officialCandidate") === true,
    status: document.get("status"),
    workflowStatus: document.get("workflowStatus"),
  })) {
    throw new Error(documentTemplateEditBlockMessage({
      officialCandidate: document.get("officialCandidate") === true,
      status: document.get("status"),
      workflowStatus: document.get("workflowStatus"),
    }));
  }
  const storagePath = document.get("storagePath");
  if (typeof storagePath !== "string" || !storagePath) throw new Error("Envie o DOCX antes de solicitar o plano.");
  const [source] = await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(storagePath)
    .download();
  return { reference, document, source };
}

function mappingsFrom(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is DocumentTemplateAiPlan["mappings"][number] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    return typeof item.exactText === "string"
      && typeof item.variableKey === "string"
      && Number.isInteger(item.expectedOccurrences)
      && Number(item.expectedOccurrences) > 0
      && typeof item.confidence === "number"
      && typeof item.rationale === "string";
  }).slice(0, 200);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await assertFormalizationAccess(request, "templates.view");
    const { id } = await context.params;
    const { document } = await templateSource(id);
    return NextResponse.json({
      plan: serializeHrValue(document.get("aiMappingPlan") ?? null),
      blocked: document.get("aiPreparationBlocked") === true,
      findings: document.get("aiPreparationFindings") ?? [],
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao carregar plano.", 403);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await assertFormalizationAccess(request, "templates.manage");
    const { id } = await context.params;
    const { reference, source } = await templateSource(id);
    const scan = scanDocxTemplateForPersonalData(source);
    if (!scan.safeForAi) {
      await reference.set({
        aiPreparationBlocked: true,
        aiPreparationFindings: scan.findings,
        updatedAt: new Date(),
      }, { merge: true });
      return error(
        "O DOCX contém dados pessoais preenchidos. Substitua-os por dados fictícios ou campos em branco antes de usar a IA.",
        422,
        scan.findings,
      );
    }
    const proposed = await proposeDocumentTemplatePlan(scan.text.slice(0, 60_000));
    const validation = validateTemplateAiPlan(scan.text, proposed.mappings);
    if (!validation.valid) {
      return error("O plano da IA não passou na validação determinística.", 422, validation.errors);
    }
    const plan: DocumentTemplateAiPlan = {
      schemaVersion: 1,
      sourceHash: createHash("sha256").update(source).digest("hex"),
      mappings: proposed.mappings,
      formSchemaProposal: proposed.formSchemaProposal,
      documentClass: proposed.documentClass,
      retentionAnchorType: proposed.retentionAnchorType,
      signatureScope: proposed.signatureScope,
      reviewed: false,
    };
    await reference.set({
      aiMappingPlan: plan,
      preparationStatus: "validation_editing",
      aiPreparationBlocked: false,
      aiPreparationFindings: [],
      aiPlanCreatedAt: new Date(),
      aiPlanCreatedBy: actor.decoded.uid,
    }, { merge: true });
    return NextResponse.json({ plan });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao propor mapeamento.", 400);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await assertFormalizationAccess(request, "templates.manage");
    const { id } = await context.params;
    const { reference, document, source } = await templateSource(id);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const storedPlan = document.get("aiMappingPlan") as DocumentTemplateAiPlan | undefined;
    if (!storedPlan || storedPlan.schemaVersion !== 1) {
      return error("Solicite e revise um plano da IA antes de aplicá-lo.");
    }
    const sourceHash = createHash("sha256").update(source).digest("hex");
    if (storedPlan.sourceHash !== sourceHash) {
      return error("O DOCX mudou depois da proposta. Gere um novo plano antes de aplicar.", 409);
    }
    const scan = scanDocxTemplateForPersonalData(source);
    if (!scan.safeForAi) {
      return error("A matriz contém dados pessoais e não pode ser preparada.", 422, scan.findings);
    }
    const mappings = mappingsFrom(body.mappings);
    if (!mappings.length) return error("Selecione ao menos um mapeamento.");
    const allowed = new Set(
      storedPlan.mappings.map((item) =>
        JSON.stringify([item.exactText, item.expectedOccurrences, item.variableKey]),
      ),
    );
    if (mappings.some((item) =>
      !allowed.has(JSON.stringify([item.exactText, item.expectedOccurrences, item.variableKey])),
    )) {
      return error("O plano revisado contém um mapeamento que não foi proposto pela IA.");
    }
    const validation = validateTemplateAiPlan(scan.text, mappings);
    if (!validation.valid) {
      return error("O plano revisado não corresponde mais ao DOCX.", 422, validation.errors);
    }

    let prepared = source;
    for (const mapping of mappings) {
      const result = replaceDocxTextWithVariable(
        prepared,
        mapping.exactText,
        mapping.variableKey,
      );
      if (result.replacements !== mapping.expectedOccurrences) {
        return error(
          `A substituição de “${mapping.exactText}” produziu ${result.replacements} ocorrência(s), mas eram esperadas ${mapping.expectedOccurrences}.`,
          422,
        );
      }
      prepared = result.buffer;
    }

    const variables = extractDocxVariables(prepared);
    const templateValidation = validateDocxForLetterhead(prepared);
    const documentStandardValidation = validateCtDocumentStandard(prepared);
    if (!templateValidation.valid) {
      return error(
        "O DOCX preparado não respeita a área segura do papel timbrado.",
        422,
        templateValidation.issues,
      );
    }
    const version = Number(document.get("version") ?? 0) + 1;
    const storagePath = `document-templates/${id}/versions/${String(version).padStart(3, "0")}/template.docx`;
    await getStorage(adminApp)
      .bucket(firebaseClientConfig.storageBucket)
      .file(storagePath)
      .save(prepared, {
        resumable: false,
        metadata: {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          cacheControl: "private, no-store",
          metadata: { templateId: id, version: String(version), preparedBy: "ai-reviewed-plan" },
        },
      });
    const fieldMapping = normalizeFieldMapping(document.get("fieldMapping"), variables);
    const pending = pendingPlaceholders(variables, fieldMapping);
    const reviewedAt = new Date().toISOString();
    const reviewedPlan: DocumentTemplateAiPlan = {
      ...storedPlan,
      mappings,
      reviewed: true,
      reviewedAt,
      reviewedBy: actor.decoded.uid,
      appliedVersion: version,
    };
    const schemaProposal = body.acceptFormSchema === true
      && isDocumentFormSchema(storedPlan.formSchemaProposal)
      ? storedPlan.formSchemaProposal
      : null;
    const update = {
      status: "draft",
      preparationStatus: "validation_editing",
      ...(document.get("officialCandidate") === true ? {
        workflowStatus: "technical_validation",
        workflowNote: null,
      } : {}),
      version,
      storagePath,
      originalName: String(document.get("originalName") ?? "modelo.docx"),
      size: prepared.byteLength,
      contentHash: createHash("sha256").update(prepared).digest("hex"),
      variables,
      fieldMapping,
      variableContract: DOCUMENT_VARIABLE_SCHEMA_VERSION,
      unknownVariables: pending,
      letterheadProfileId: templateValidation.profileId,
      templateValidation,
      documentStandardVersion: 1,
      documentStandardValidation,
      ...(schemaProposal ? { formSchema: schemaProposal } : {}),
      aiMappingPlan: reviewedPlan,
      aiPreparationBlocked: false,
      aiPreparationFindings: [],
      aiPlanAppliedAt: Timestamp.now(),
      aiPlanAppliedBy: actor.decoded.uid,
      sourceIntegrity: null,
      contentUpdatedAt: Timestamp.now(),
      contentUpdatedBy: actor.decoded.uid,
      contentUpdatedByName: actor.actorName,
      updatedAt: Timestamp.now(),
      updatedBy: actor.decoded.uid,
      updatedByName: actor.actorName,
    };
    await reference.update(update);
    return NextResponse.json({
      plan: reviewedPlan,
      template: {
        id,
        ...(serializeHrValue({ ...document.data(), ...update }) as Record<string, unknown>),
      },
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao aplicar o plano.", 400);
  }
}
