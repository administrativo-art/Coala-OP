import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { extractDocxVariables, generateDocx, replaceDocxText, replaceDocxTextWithVariable } from "@/features/hr/documents/docx-generator";
import { validateDocxForLetterhead } from "@/features/hr/documents/docx-template-validation";
import { normalizeFieldMapping, pendingPlaceholders } from "@/features/hr/documents/field-mapping";
import { buildDocumentTemplateDemoData } from "@/features/hr/documents/document-template-demo-data";
import {
  DOCUMENT_VARIABLE_SCHEMA_VERSION,
  isDocumentVariableKey,
} from "@/features/hr/integration/document-variables";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import {
  documentTemplateEditBlockMessage,
  isDocumentTemplateContentEditable,
} from "@/features/hr/documents/document-template-governance";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type EditorMapping = { text: string; variableKey: string };
type EditorTextReplacement = { text: string; replacement: string };

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parseMappings(value: unknown): EditorMapping[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("As marcações de variáveis são inválidas.");
  if (value.length > 80) throw new Error("Cada edição pode possuir até 80 marcações.");
  const seen = new Set<string>();
  return value.map((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const variableKey = typeof record.variableKey === "string" ? record.variableKey.trim() : "";
    if (!text || text.length > 500) throw new Error("Uma das marcações é inválida.");
    if (text.includes("{{") || text.includes("}}")) throw new Error("Marque o texto visível, não um placeholder existente.");
    if (!isDocumentVariableKey(variableKey)) throw new Error(`Selecione o significado do termo “${text}”.`);
    const normalized = text.toLocaleLowerCase("pt-BR");
    if (seen.has(normalized)) throw new Error(`O termo “${text}” foi marcado mais de uma vez.`);
    seen.add(normalized);
    return { text, variableKey };
  }).sort((left, right) => right.text.length - left.text.length);
}

function parseTextReplacements(value: unknown): EditorTextReplacement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("As alterações de texto são inválidas.");
  if (value.length > 80) throw new Error("Cada edição pode possuir até 80 alterações de texto.");
  const seen = new Set<string>();
  return value.map((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const replacement = typeof record.replacement === "string" ? record.replacement.trim() : "";
    if (!text || text.length > 500 || !replacement || replacement.length > 2_000) {
      throw new Error("Uma das alterações de texto é inválida.");
    }
    if (text.includes("{{") || text.includes("}}") || replacement.includes("{{") || replacement.includes("}}")) {
      throw new Error("Use a vinculação de variável para trabalhar com placeholders.");
    }
    const normalized = text.toLocaleLowerCase("pt-BR");
    if (seen.has(normalized)) throw new Error(`O trecho “${text}” foi editado mais de uma vez.`);
    seen.add(normalized);
    return { text, replacement };
  }).sort((left, right) => right.text.length - left.text.length);
}

function applyChanges(source: Buffer, textReplacements: EditorTextReplacement[], mappings: EditorMapping[]) {
  let buffer = source;
  let replacements = 0;
  textReplacements.forEach((edit) => {
    const result = replaceDocxText(buffer, edit.text, edit.replacement);
    if (result.replacements === 0) throw new Error(`O trecho “${edit.text}” não foi encontrado no DOCX.`);
    buffer = result.buffer;
    replacements += result.replacements;
  });
  mappings.forEach((mapping) => {
    const result = replaceDocxTextWithVariable(buffer, mapping.text, mapping.variableKey);
    if (result.replacements === 0) throw new Error(`O trecho “${mapping.text}” não foi encontrado no DOCX.`);
    buffer = result.buffer;
    replacements += result.replacements;
  });
  return { buffer, replacements };
}

async function sourceFor(id: string) {
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
  if (typeof storagePath !== "string" || !storagePath) throw new Error("Envie o arquivo DOCX antes de abrir o editor.");
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const [source] = await bucket.file(storagePath).download();
  return { reference, document, bucket, source };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertFormalizationAccess(request, "templates.manage");
    const { id } = await context.params;
    const { document, source } = await sourceFor(id);
    const fileName = String(document.get("originalName") ?? "modelo.docx").replace(/[\r\n"]/g, "_");
    return new NextResponse(new Uint8Array(source), {
      headers: {
        "Content-Type": DOCX_MIME,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao abrir o modelo.", 403);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = body.action === "finalize" ? "finalize" : "test";
    const access = await assertFormalizationAccess(
      request,
      "templates.manage",
    );
    const mappings = parseMappings(body.mappings);
    const textReplacements = parseTextReplacements(body.textReplacements);
    const { reference, document, bucket, source } = await sourceFor(id);
    if (action === "finalize" && document.get("officialCandidate") !== true) {
      await assertFormalizationAccess(request, "templates.publish");
    }
    const marked = applyChanges(source, textReplacements, mappings);
    const variables = extractDocxVariables(marked.buffer);
    const missingWrittenVariables = mappings
      .map((mapping) => mapping.variableKey)
      .filter((variableKey) => !variables.includes(variableKey));
    if (missingWrittenVariables.length) {
      throw new Error(`A gravação não pôde ser verificada para: ${missingWrittenVariables.join(", ")}.`);
    }

    if (action === "test") {
      const preview = generateDocx(marked.buffer, buildDocumentTemplateDemoData({
        variables,
        fieldMapping: normalizeFieldMapping(document.get("fieldMapping"), variables),
      }));
      await reference.update({
        preparationStatus: "visual_test",
        visualTestStartedAt: Timestamp.now(),
        visualTestStartedBy: access.decoded.uid,
        visualTestStartedByName: access.actorName,
      });
      return new NextResponse(new Uint8Array(preview), {
        headers: {
          "Content-Type": DOCX_MIME,
          "Content-Disposition": "inline; filename=teste-modelo.docx",
          "Cache-Control": "private, no-store",
          "X-Template-Replacements": String(marked.replacements),
        },
      });
    }

    const fieldMapping = normalizeFieldMapping(document.get("fieldMapping"), variables);
    const pending = pendingPlaceholders(variables, fieldMapping);
    const templateValidation = validateDocxForLetterhead(marked.buffer);
    const sourceVersion = Number(document.get("version") ?? 0);
    const version = sourceVersion + 1;
    const storagePath = `document-templates/${id}/versions/${String(version).padStart(3, "0")}/template.docx`;
    const now = Timestamp.now();
    await bucket.file(storagePath).save(marked.buffer, {
      resumable: false,
      metadata: {
        contentType: DOCX_MIME,
        cacheControl: "private, no-store",
        metadata: { templateId: id, version: String(version), sourceVersion: String(sourceVersion) },
      },
    });
    const update = {
      status: document.get("officialCandidate") === true ? "draft" : "published",
      preparationStatus: document.get("officialCandidate") === true
        ? "ready_for_rh_approval"
        : "available",
      ...(document.get("officialCandidate") === true ? {
        workflowStatus: "technical_validation",
        workflowNote: null,
      } : {}),
      version,
      storagePath,
      size: marked.buffer.length,
      contentHash: createHash("sha256").update(marked.buffer).digest("hex"),
      variables,
      fieldMapping,
      variableContract: DOCUMENT_VARIABLE_SCHEMA_VERSION,
      unknownVariables: pending,
      letterheadProfileId: templateValidation.profileId,
      templateValidation,
      fieldPreparationTestedAt: now,
      fieldPreparationTestedBy: access.decoded.uid,
      fieldPreparationTestedByName: access.actorName,
      sourceIntegrity: null,
      contentUpdatedAt: now,
      contentUpdatedBy: access.decoded.uid,
      contentUpdatedByName: access.actorName,
      updatedAt: now,
      updatedBy: access.decoded.uid,
      updatedByName: access.actorName,
    };
    await reference.update(update);
    await reference.collection("versions").doc(String(version).padStart(3, "0")).set({
      operation: "visual_placeholder_editor",
      sourceVersion,
      storagePath,
      mappings,
      textReplacements,
      replacements: marked.replacements,
      createdAt: now,
      createdBy: access.decoded.uid,
      createdByName: access.actorName,
    });
    return NextResponse.json({
      replacements: marked.replacements,
      pending,
      template: { id, ...(serializeHrValue({ ...document.data(), ...update }) as Record<string, unknown>) },
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao editar o modelo.", 403);
  }
}
