import { writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { config } from "dotenv";
import { getStorage } from "firebase-admin/storage";

config({ path: ".env.local" });

const { adminApp } = await import("../src/lib/firebase-admin.ts");
const { hrDbAdmin } = await import("../src/lib/firebase-rh-admin.ts");
const { firebaseClientConfig } = await import("../src/lib/firebase-client-config.ts");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_FILES_URL = "https://api.openai.com/v1/files";
const DEFAULT_MODEL = process.env.OPENAI_DOCUMENT_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";

const DOCUMENT_FIELD_KEYS = [
  "employee.name",
  "employee.cpf",
  "employee.birth_date",
  "employee.nationality",
  "employee.marital_status",
  "employee.mother_name",
  "employee.father_name",
  "employee.pis",
  "employee.ctps_number",
  "employee.ctps_series",
  "employee.ctps_date",
  "employee.has_cnh",
  "employee.cnh_number",
  "employee.cnh_type",
  "employee.cnh_expiry",
  "employee.cnh_first_date",
  "employee.state",
  "employee.city",
  "employee.address",
  "employee.aso_admission_date",
  "employee.employer_name",
  "employee.employer_cnpj",
];

const ALL_FIELD_KEYS = [
  ...DOCUMENT_FIELD_KEYS,
  "employee.personal_email",
  "employee.bank_name",
  "employee.bank_agency",
  "employee.bank_account",
  "employee.pix_key",
  "employee.uniform_shirt_size",
  "employee.uniform_pants_size",
  "employee.uniform_shoe_size",
  "employee.has_vt",
  "employee.emergency_name",
  "employee.emergency_phone",
  "employee.emergency_relation",
  "employee.education_level",
  "employee.education_course",
  "employee.education_institution",
  "employee.education_end_date",
  "employee.has_food_restriction",
  "employee.food_restrictions",
  "employee.food_restriction_other",
  "employee.food_restriction_activity_effects",
  "employee.children_under_14",
  "employee.children",
  "employee.has_family_salary",
  "employee.job_role_id",
];

const STRING_OR_NULL = { type: ["string", "null"] };
const NUMBER_OR_NULL = { type: ["number", "null"] };
const BOOLEAN_OR_NULL = { type: ["boolean", "null"] };
const VALUE_SCHEMA = {
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "array", items: { type: ["string", "number", "boolean", "null"] } },
    { type: "null" },
  ],
};

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["documentAnalyses", "fieldCandidates", "conflicts", "notExtracted", "summaryNotes"],
  properties: {
    documentAnalyses: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["documentId", "label", "documentType", "legibility", "belongsToCandidate", "summary", "warnings"],
        properties: {
          documentId: { type: "string" },
          label: { type: "string" },
          documentType: { type: "string" },
          legibility: { type: "string", enum: ["GOOD", "PARTIAL", "POOR"] },
          belongsToCandidate: { type: "string", enum: ["YES", "POSSIBLE", "NO", "UNKNOWN"] },
          summary: { type: "string" },
          warnings: { type: "array", maxItems: 8, items: { type: "string" } },
        },
      },
    },
    fieldCandidates: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "fieldKey",
          "label",
          "value",
          "confidence",
          "sourceDocumentId",
          "sourceDocumentLabel",
          "evidence",
          "notes",
        ],
        properties: {
          fieldKey: { type: "string", enum: DOCUMENT_FIELD_KEYS },
          label: { type: "string" },
          value: VALUE_SCHEMA,
          confidence: { type: "number", minimum: 0, maximum: 1 },
          sourceDocumentId: { type: "string" },
          sourceDocumentLabel: { type: "string" },
          evidence: { type: "string" },
          notes: STRING_OR_NULL,
        },
      },
    },
    conflicts: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fieldKey", "values", "recommendation"],
        properties: {
          fieldKey: { type: "string", enum: DOCUMENT_FIELD_KEYS },
          values: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["value", "sourceDocumentId"],
              properties: {
                value: VALUE_SCHEMA,
                sourceDocumentId: { type: "string" },
              },
            },
          },
          recommendation: { type: "string" },
        },
      },
    },
    notExtracted: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fieldKey", "reason"],
        properties: {
          fieldKey: { type: "string", enum: DOCUMENT_FIELD_KEYS },
          reason: { type: "string" },
        },
      },
    },
    summaryNotes: {
      type: "array",
      maxItems: 12,
      items: { type: "string" },
    },
  },
};

const FIELD_LABELS = {
  "employee.name": "Nome completo",
  "employee.state": "Estado (UF)",
  "employee.city": "Cidade",
  "employee.address": "Endereco",
  "employee.phone": "Telefone celular",
  "employee.personal_email": "E-mail pessoal",
  "employee.nationality": "Nacionalidade",
  "employee.birth_date": "Data de nascimento",
  "employee.marital_status": "Estado civil",
  "employee.mother_name": "Nome da mae",
  "employee.father_name": "Nome do pai",
  "employee.children_under_14": "Quantidade de filhos menores de 14 anos",
  "employee.children": "Cadastro de filhos",
  "employee.cpf": "CPF",
  "employee.pis": "PIS",
  "employee.ctps_number": "CTPS - Numero",
  "employee.ctps_series": "CTPS - Serie",
  "employee.ctps_date": "CTPS - Data de emissao",
  "employee.has_cnh": "Possui CNH?",
  "employee.cnh_number": "Numero de registro",
  "employee.cnh_type": "Categoria",
  "employee.cnh_expiry": "Data de validade",
  "employee.cnh_first_date": "1a habilitacao",
  "employee.employer_cnpj": "CNPJ do empregador",
  "employee.employer_name": "Razao social",
  "employee.job_role_id": "Cargo / Funcao",
  "employee.has_vt": "Tem VT?",
  "employee.bank_name": "Banco",
  "employee.bank_agency": "Agencia",
  "employee.bank_account": "Conta corrente",
  "employee.pix_key": "Chave Pix",
  "employee.aso_admission_date": "Exame admissional",
  "employee.uniform_shirt_size": "Tamanho de camisa",
  "employee.uniform_pants_size": "Tamanho da calca",
  "employee.uniform_shoe_size": "Numeracao do calcado",
  "employee.emergency_name": "Contato de emergencia - nome",
  "employee.emergency_phone": "Contato de emergencia - celular",
  "employee.emergency_relation": "Contato de emergencia - parentesco",
  "employee.education_level": "Grau de instrucao",
  "employee.education_course": "Curso",
  "employee.education_institution": "Instituicao",
  "employee.education_end_date": "Data de conclusao",
  "employee.has_food_restriction": "Restricao alimentar?",
  "employee.food_restrictions": "Ingredientes relacionados a restricao",
  "employee.food_restriction_other": "Outro ingrediente",
  "employee.food_restriction_activity_effects": "Impacto da restricao na atividade",
  "employee.has_family_salary": "Tem salario-familia?",
};

function usage() {
  console.error("Uso: npx tsx scratch/analyze-onboarding-docs.mjs <email-ou-id> [--model=<modelo>] [--out=<arquivo.json>]");
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const identifier = args.find((arg) => !arg.startsWith("--"));
  if (!identifier) usage();
  const modelArg = args.find((arg) => arg.startsWith("--model="))?.slice("--model=".length).trim();
  const outArg = args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length).trim();
  return { identifier: identifier.trim(), model: modelArg || DEFAULT_MODEL, outPath: outArg || null };
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeFileName(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140) || "documento";
}

function extensionFor(contentType, fileName) {
  const current = extname(fileName || "");
  if (current) return current;
  if (contentType === "application/pdf") return ".pdf";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  return ".bin";
}

function outputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => item.text)
    .filter((text) => typeof text === "string")
    .join("\n");
}

function parseJsonObject(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  return JSON.parse(candidate);
}

function digits(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\D/g, "")
    : "";
}

function compactValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "").trim();
}

function normalizeForCompare(fieldKey, value) {
  if (value === null || value === undefined || value === "") return "";
  if (fieldKey.includes("cpf") || fieldKey.includes("pis") || fieldKey.includes("ctps") || fieldKey.includes("cnh_number")) {
    return digits(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return compactValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formCandidate(fieldKey, value, notes = null) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return {
    fieldKey,
    label: FIELD_LABELS[fieldKey] ?? fieldKey,
    value,
    confidence: 1,
    sourceType: "FORM_ANSWER",
    source: "Formulario publico do onboarding",
    evidence: "Resposta fornecida pelo candidato no onboarding.",
    notes,
  };
}

function childAge(birthDate) {
  if (typeof birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const date = new Date(`${birthDate}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - date.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < date.getUTCDate())) age -= 1;
  return age;
}

function buildFormCandidates(processData) {
  const answers = asRecord(processData.publicFormAnswers);
  const children = Array.isArray(answers.children)
    ? answers.children.map(asRecord).filter((child) => asString(child.name) || asString(child.birthDate) || asString(child.cpf))
    : [];
  const childrenUnder14 = children.filter((child) => {
    const age = childAge(child.birthDate);
    return age !== null && age >= 0 && age < 14;
  }).length;
  const candidates = [
    formCandidate("employee.name", asString(answers.fullName) ?? asString(processData.candidateName)),
    formCandidate("employee.cpf", asString(answers.cpf)),
    formCandidate("employee.personal_email", asString(processData.candidateEmail)),
    formCandidate("employee.bank_name", asString(answers.bankName)),
    formCandidate("employee.bank_agency", asString(answers.bankAgency)),
    formCandidate("employee.bank_account", asString(answers.bankAccount)),
    formCandidate("employee.pix_key", asString(answers.pixKey)),
    formCandidate("employee.uniform_shirt_size", asString(answers.uniformShirtSize)),
    formCandidate("employee.uniform_pants_size", asString(answers.uniformPantsSize)),
    formCandidate("employee.uniform_shoe_size", asString(answers.uniformShoeSize)),
    formCandidate("employee.has_cnh", answers.hasCnh === "yes" ? true : answers.hasCnh === "no" ? false : null),
    formCandidate("employee.has_vt", answers.wantsTransportVoucher === "yes" ? true : answers.wantsTransportVoucher === "no" ? false : null),
    formCandidate("employee.emergency_name", asString(answers.emergencyName)),
    formCandidate("employee.emergency_phone", asString(answers.emergencyPhone)),
    formCandidate("employee.emergency_relation", asString(answers.emergencyRelation)),
    formCandidate("employee.education_level", asString(answers.educationLevel)),
    formCandidate("employee.education_course", asString(answers.educationCourse)),
    formCandidate("employee.education_institution", asString(answers.educationInstitution)),
    formCandidate("employee.education_end_date", asString(answers.educationEndDate)),
    formCandidate("employee.has_food_restriction", answers.hasFoodRestriction === "yes" ? true : answers.hasFoodRestriction === "no" ? false : null),
    formCandidate("employee.food_restrictions", Array.isArray(answers.foodRestrictions) ? answers.foodRestrictions.filter(Boolean) : []),
    formCandidate("employee.food_restriction_other", asString(answers.foodRestrictionOther)),
    formCandidate("employee.food_restriction_activity_effects", Array.isArray(answers.foodRestrictionActivityEffects) ? answers.foodRestrictionActivityEffects.filter(Boolean) : []),
    formCandidate("employee.children", children.length ? children : null),
    formCandidate("employee.children_under_14", children.length ? String(childrenUnder14) : answers.hasChildren === "no" ? "Nenhum" : null),
    formCandidate("employee.has_family_salary", children.length ? childrenUnder14 > 0 : answers.hasChildren === "no" ? false : null),
    formCandidate("employee.job_role_id", asString(processData.jobRoleName), "Valor do processo; confirme o ID/cargo cadastrado antes de gravar campo ref."),
  ].filter(Boolean);
  return candidates;
}

async function loadProcess(identifier) {
  if (identifier.includes("@")) {
    const snap = await hrDbAdmin
      .collection("onboardingProcesses")
      .where("candidateEmail", "==", identifier.toLowerCase())
      .limit(10)
      .get();
    if (snap.empty) throw new Error(`Onboarding nao encontrado para ${identifier}.`);
    const docs = snap.docs.sort((left, right) => String(right.get("updatedAt") ?? "").localeCompare(String(left.get("updatedAt") ?? "")));
    return docs[0];
  }
  const doc = await hrDbAdmin.collection("onboardingProcesses").doc(identifier).get();
  if (!doc.exists) throw new Error(`Onboarding ${identifier} nao encontrado.`);
  return doc;
}

async function downloadDocument(bucket, document) {
  const path = asString(document.filePath);
  if (path) {
    const file = bucket.file(path);
    const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
    const contentType = asString(metadata.contentType) ?? "application/octet-stream";
    const originalName = asString(metadata.metadata?.originalName) ?? basename(path);
    const hasExtension = Boolean(extname(originalName));
    const fileName = safeFileName(`${document.id}-${originalName}${hasExtension ? "" : extensionFor(contentType, originalName)}`);
    return { buffer, contentType, fileName };
  }

  const url = asString(document.fileUrl);
  if (!url) throw new Error(`Documento ${document.id} nao tem filePath/fileUrl.`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao baixar ${document.id}: HTTP ${response.status}.`);
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  const fileName = safeFileName(`${document.id}-${document.label}${extensionFor(contentType, document.label)}`);
  return { buffer: Buffer.from(arrayBuffer), contentType, fileName };
}

async function uploadOpenAiFile({ buffer, contentType, fileName }, apiKey) {
  const form = new FormData();
  form.set("purpose", contentType.startsWith("image/") ? "vision" : "user_data");
  form.set("file", new Blob([buffer], { type: contentType }), fileName);
  const response = await fetch(OPENAI_FILES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || `Falha ao enviar arquivo para OpenAI: HTTP ${response.status}`);
  }
  return payload.id;
}

async function deleteOpenAiFile(fileId, apiKey) {
  try {
    await fetch(`${OPENAI_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // best-effort cleanup
  }
}

function buildPrompt({ processId, candidateName, candidateEmail, documents }) {
  return [
    "Voce esta analisando documentos de onboarding de RH brasileiro para sugerir campos de Gestao do Colaborador.",
    "Retorne somente JSON valido no schema solicitado.",
    "Extraia apenas dados visiveis nos documentos enviados. Nao invente campos, numeros ou datas.",
    "Use datas no formato ISO YYYY-MM-DD. Para CPF, PIS, CTPS e CNH preserve o numero legivel, com ou sem pontuacao.",
    "Para comprovante de residencia, extraia employee.address, employee.city e employee.state somente quando o endereco completo estiver visivel. Se o titular do comprovante parecer diferente da candidata, extraia mesmo assim e sinalize em notes.",
    "Para ASO admissional, extraia employee.aso_admission_date como a data de realizacao do exame. Nao extraia diagnostico, CID ou informacao clinica.",
    "Para foto de identificacao, apenas classifique o documento e informe se nao ha campos cadastrais a extrair.",
    "Se um documento estiver ilegivel, marque legibility como PARTIAL ou POOR e explique em warnings.",
    `Candidata esperada: ${candidateName || "nao informado"} (${candidateEmail || "sem email"}).`,
    `Processo: ${processId}.`,
    "Documentos anexados:",
    JSON.stringify(documents.map((doc) => ({ id: doc.id, label: doc.label, expectedType: doc.documentTypeCode ?? null }))),
    "Campos aceitos para fieldCandidates:",
    JSON.stringify(DOCUMENT_FIELD_KEYS),
  ].join("\n\n");
}

async function analyzeWithOpenAi({ apiKey, model, processId, processData, uploadedFiles }) {
  const content = [
    {
      type: "input_text",
      text: buildPrompt({
        processId,
        candidateName: asString(processData.candidateName),
        candidateEmail: asString(processData.candidateEmail),
        documents: uploadedFiles,
      }),
    },
  ];
  for (const item of uploadedFiles) {
    content.push({
      type: "input_text",
      text: `Documento ${item.id}: ${item.label}. Tipo esperado: ${item.documentTypeCode ?? "nao informado"}.`,
    });
    content.push(item.contentType.startsWith("image/")
      ? { type: "input_image", file_id: item.openAiFileId, detail: "high" }
      : { type: "input_file", file_id: item.openAiFileId });
  }

  const requestBody = {
    model,
    input: [{ role: "user", content }],
    max_output_tokens: 5000,
    text: {
      format: {
        type: "json_schema",
        name: "onboarding_document_extraction",
        strict: true,
        schema: EXTRACTION_SCHEMA,
      },
    },
  };

  if (!model.toLowerCase().startsWith("gpt-5")) {
    requestBody.temperature = 0;
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error?.message || `Falha na analise OpenAI: HTTP ${response.status}`);
  }
  return {
    rawResponse: payload,
    parsed: parseJsonObject(outputText(payload)),
    usage: payload.usage ?? null,
  };
}

function withCandidateMetadata(candidates) {
  return candidates
    .filter((candidate) => candidate && candidate.value !== null && candidate.value !== undefined && candidate.value !== "")
    .map((candidate) => ({
      ...candidate,
      label: candidate.label || FIELD_LABELS[candidate.fieldKey] || candidate.fieldKey,
    }));
}

function buildRecommendations(candidates) {
  const priority = { DOCUMENT: 3, FORM_ANSWER: 2, PROCESS: 1 };
  const grouped = new Map();
  for (const candidate of candidates) {
    if (!ALL_FIELD_KEYS.includes(candidate.fieldKey)) continue;
    const normalized = normalizeForCompare(candidate.fieldKey, candidate.value);
    if (!normalized) continue;
    const list = grouped.get(candidate.fieldKey) ?? [];
    list.push({ ...candidate, normalized });
    grouped.set(candidate.fieldKey, list);
  }

  const recommendedFields = [];
  const conflicts = [];
  for (const [fieldKey, list] of grouped.entries()) {
    const uniqueValues = new Map();
    for (const candidate of list) {
      if (!uniqueValues.has(candidate.normalized)) uniqueValues.set(candidate.normalized, []);
      uniqueValues.get(candidate.normalized).push(candidate);
    }
    if (uniqueValues.size > 1) {
      conflicts.push({
        fieldKey,
        label: FIELD_LABELS[fieldKey] ?? fieldKey,
        values: [...uniqueValues.values()].map((items) => ({
          value: items[0].value,
          sources: items.map((item) => item.source ?? item.sourceDocumentLabel ?? item.sourceType),
        })),
      });
    }

    const sorted = [...list].sort((left, right) => {
      const leftPriority = priority[left.sourceType] ?? 0;
      const rightPriority = priority[right.sourceType] ?? 0;
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return (right.confidence ?? 0) - (left.confidence ?? 0);
    });
    const best = sorted[0];
    recommendedFields.push({
      fieldKey,
      label: FIELD_LABELS[fieldKey] ?? fieldKey,
      value: best.value,
      confidence: best.confidence,
      sourceType: best.sourceType,
      source: best.source ?? best.sourceDocumentLabel ?? null,
      evidence: best.evidence ?? null,
      notes: best.notes ?? null,
      needsReview: conflicts.some((conflict) => conflict.fieldKey === fieldKey) || (best.confidence ?? 1) < 0.85,
    });
  }
  return {
    recommendedFields: recommendedFields.sort((left, right) => ALL_FIELD_KEYS.indexOf(left.fieldKey) - ALL_FIELD_KEYS.indexOf(right.fieldKey)),
    conflicts,
  };
}

function printSummary(report) {
  console.log(`Processo: ${report.process.id}`);
  console.log(`Candidata: ${report.process.candidateName ?? "-"} <${report.process.candidateEmail ?? "-"}>`);
  console.log(`Documentos analisados: ${report.documents.length}`);
  console.log(`Campos recomendados: ${report.recommendedFields.length}`);
  if (report.conflicts.length) console.log(`Conflitos para revisar: ${report.conflicts.length}`);
  console.log(`Relatorio JSON: ${report.outputPath}`);
  console.log("");
  for (const field of report.recommendedFields) {
    const review = field.needsReview ? " [revisar]" : "";
    console.log(`- ${field.fieldKey}: ${compactValue(field.value)} (${field.sourceType}, conf. ${field.confidence})${review}`);
  }
}

const { identifier, model, outPath } = parseArgs();
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY nao configurada.");

const processDoc = await loadProcess(identifier);
const processData = processDoc.data();
const rawDocuments = Array.isArray(processData.documents) ? processData.documents : [];
const documents = rawDocuments
  .map((document) => asRecord(document))
  .filter((document) => Boolean(asString(document.id)) && (Boolean(asString(document.filePath)) || Boolean(asString(document.fileUrl))))
  .map((document) => ({
    id: asString(document.id),
    label: asString(document.label) ?? asString(document.id),
    status: asString(document.status),
    documentTypeCode: asString(document.documentTypeCode),
    filePath: asString(document.filePath),
    fileUrl: asString(document.fileUrl),
  }));

if (!documents.length) throw new Error("Nenhum documento com arquivo encontrado no onboarding.");

const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
const uploadedFiles = [];

try {
  for (const document of documents) {
    console.error(`Baixando ${document.id}...`);
    const downloaded = await downloadDocument(bucket, document);
    console.error(`Enviando ${document.id} para analise...`);
    const openAiFileId = await uploadOpenAiFile(downloaded, apiKey);
    uploadedFiles.push({ ...document, ...downloaded, buffer: undefined, openAiFileId });
  }

  console.error(`Analisando ${uploadedFiles.length} documentos com ${model}...`);
  const ai = await analyzeWithOpenAi({ apiKey, model, processId: processDoc.id, processData, uploadedFiles });
  const formCandidates = buildFormCandidates(processData);
  const documentCandidates = withCandidateMetadata((ai.parsed.fieldCandidates ?? []).map((candidate) => ({
    ...candidate,
    sourceType: "DOCUMENT",
    source: candidate.sourceDocumentLabel,
  })));
  const allCandidates = withCandidateMetadata([...formCandidates, ...documentCandidates]);
  const recommendations = buildRecommendations(allCandidates);
  const outputPath = outPath || `/tmp/onboarding-analysis-${processDoc.id}.json`;
  const report = {
    generatedAt: new Date().toISOString(),
    model,
    process: {
      id: processDoc.id,
      candidateName: processData.candidateName ?? null,
      candidateEmail: processData.candidateEmail ?? null,
      currentStage: processData.currentStage ?? null,
      status: processData.status ?? null,
      jobRoleName: processData.jobRoleName ?? null,
      functionName: processData.functionName ?? null,
      unitName: processData.unitName ?? null,
    },
    documents: uploadedFiles.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      documentTypeCode: item.documentTypeCode,
      fileName: item.fileName,
      contentType: item.contentType,
    })),
    documentAnalyses: ai.parsed.documentAnalyses ?? [],
    formFieldCandidates: formCandidates,
    documentFieldCandidates: documentCandidates,
    recommendedFields: recommendations.recommendedFields,
    conflicts: [...(ai.parsed.conflicts ?? []), ...recommendations.conflicts],
    notExtracted: ai.parsed.notExtracted ?? [],
    summaryNotes: ai.parsed.summaryNotes ?? [],
    usage: ai.usage,
    outputPath,
  };
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  printSummary(report);
} finally {
  await Promise.all(uploadedFiles.map((item) => deleteOpenAiFile(item.openAiFileId, apiKey)));
}
