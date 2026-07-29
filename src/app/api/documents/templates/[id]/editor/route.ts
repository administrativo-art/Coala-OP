import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { extractDocxVariables, generateDocx, replaceDocxTextWithVariable } from "@/features/hr/documents/docx-generator";
import { validateDocxForLetterhead } from "@/features/hr/documents/docx-template-validation";
import { normalizeFieldMapping, pendingPlaceholders } from "@/features/hr/documents/field-mapping";
import {
  DOCUMENT_VARIABLE_SCHEMA_VERSION,
  DOCUMENT_VARIABLES,
  isDocumentVariableKey,
  type DocumentVariableCatalogEntry,
} from "@/features/hr/integration/document-variables";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type EditorMapping = { text: string; variableKey: string };

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = root;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else {
      const existing = cursor[part];
      cursor[part] = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
      cursor = cursor[part] as Record<string, unknown>;
    }
  });
}

function demoValue(entry: DocumentVariableCatalogEntry) {
  const exact: Record<string, unknown> = {
    "employee.name": "Sara Ferreira Coelho",
    "employee.cpf": "123.456.789-00",
    "employee.rg": "1234567",
    "employee.email": "sara.ferreira@exemplo.com",
    "integration.employer_name": "CT Sorvetes LTDA",
    "integration.employer_cnpj": "14.276.603/0001-25",
    "integration.employer_address": "Av. Exemplo, 100 · São Luís/MA · CEP 65000-000",
    "integration.job_function": "Atendente de balcão",
    "integration.job_role": "Atendimento",
    "integration.monthly_salary": "R$ 1.787,30",
    "integration.expected_admission_date": "25/07/2026",
    "integration.probation_first_end_date": "08/09/2026",
    "integration.probation_final_end_date": "23/10/2026",
    "integration.image_voice_authorized_mark": "X",
  };
  if (exact[entry.key] !== undefined) return exact[entry.key];
  if (entry.format === "date_br") return "25/07/2026";
  if (entry.format === "currency_br") return "R$ 1.787,30";
  if (entry.format === "cpf") return "123.456.789-00";
  if (entry.format === "cnpj") return "14.276.603/0001-25";
  if (entry.format === "phone_br") return "(98) 98888-7777";
  if (entry.format === "boolean_br") return "Sim";
  if (entry.format === "checkbox_mark") return "X";
  if (entry.format === "number_br") return "1";
  if (entry.format === "repeatable") return [];
  return `[Exemplo: ${entry.label}]`;
}

function demoData(variableKeys: string[]) {
  const data: Record<string, unknown> = {};
  variableKeys.forEach((key) => {
    const entry = DOCUMENT_VARIABLES.find((candidate) => candidate.key === key);
    if (entry) setPath(data, key, demoValue(entry));
  });
  return data;
}

function parseMappings(value: unknown): EditorMapping[] {
  if (!Array.isArray(value) || !value.length) throw new Error("Marque ao menos um termo no documento.");
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

function applyMappings(source: Buffer, mappings: EditorMapping[]) {
  let buffer = source;
  let replacements = 0;
  mappings.forEach((mapping) => {
    const result = replaceDocxTextWithVariable(buffer, mapping.text, mapping.variableKey);
    buffer = result.buffer;
    replacements += result.replacements;
  });
  return { buffer, replacements };
}

async function sourceFor(id: string) {
  const reference = dbAdmin.collection("companyDocumentTemplates").doc(id);
  const document = await reference.get();
  if (!document.exists || document.get("deletedAt")) throw new Error("Modelo não encontrado.");
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
      action === "finalize" ? "templates.publish" : "templates.manage",
    );
    const mappings = parseMappings(body.mappings);
    const { reference, document, bucket, source } = await sourceFor(id);
    const marked = applyMappings(source, mappings);
    const variables = extractDocxVariables(marked.buffer);
    const missingWrittenVariables = mappings
      .map((mapping) => mapping.variableKey)
      .filter((variableKey) => !variables.includes(variableKey));
    if (missingWrittenVariables.length) {
      throw new Error(`A gravação não pôde ser verificada para: ${missingWrittenVariables.join(", ")}.`);
    }

    if (action === "test") {
      const preview = generateDocx(marked.buffer, demoData(variables));
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
      status: "draft",
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
