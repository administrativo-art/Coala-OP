import "server-only";

import {
  EMPLOYEE_DOCUMENT_TYPE_CATALOG,
  employeeDocumentTypeConfigByCode,
  type EmployeeDocumentTypeConfig,
} from "@/lib/hr/employee-document-options";
import { extractionGuideForPrompt } from "@/lib/hr/employee-document-extraction-guide";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_FILES_URL = "https://api.openai.com/v1/files";
const DOCUMENT_TYPE_CODES = EMPLOYEE_DOCUMENT_TYPE_CATALOG.map((item) => item.code);
const EXTRACTED_FIELD_KEYS = [
  "cpf",
  "employeeName",
  "motherName",
  "fatherName",
  "registrationNumber",
  "pisPasep",
  "ctpsNumber",
  "ctpsSeries",
  "ctpsIssueDate",
  "cnhNumber",
  "cnhCategory",
  "cnhExpiryDate",
  "cnhFirstLicenseDate",
  "maritalStatus",
  "birthDate",
  "admissionDate",
  "probationFirstEndDate",
  "probationFinalEndDate",
  "probationInitialDays",
  "probationExtensionDays",
  "employer",
  "cnpj",
  "position",
  "referenceMonth",
  "issueDate",
  "startDate",
  "endDate",
  "acquisitionPeriodStart",
  "acquisitionPeriodEnd",
  "vacationStartDate",
  "vacationEndDate",
  "numberOfDays",
  "installmentNumber",
  "amountGross",
  "amountDiscounts",
  "amountNet",
  "paymentDate",
  "asoType",
  "examDate",
  "fitnessStatus",
  "terminationDate",
  "dependentName",
  "dependentBirthDate",
  "dependentCpf",
  "dependentRg",
  "dependents",
  "vaccinationRecordDetected",
  "schoolAttendanceDetected",
  "responsibilityTermDetected",
  "signatureDetected",
  "transportVoucherAuthorized",
  "transportVoucherDailyValue",
] as const;

const STRING_OR_NULL_SCHEMA = { type: ["string", "null"] };
const NUMBER_OR_NULL_SCHEMA = { type: ["number", "null"] };
const BOOLEAN_OR_NULL_SCHEMA = { type: ["boolean", "null"] };
const DEPENDENTS_SCHEMA = {
  type: ["array", "null"],
  maxItems: 12,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["name", "birthDate", "cpf", "rg", "relationship"],
    properties: {
      name: STRING_OR_NULL_SCHEMA,
      birthDate: STRING_OR_NULL_SCHEMA,
      cpf: STRING_OR_NULL_SCHEMA,
      rg: STRING_OR_NULL_SCHEMA,
      relationship: STRING_OR_NULL_SCHEMA,
    },
  },
};

const EXTRACTED_FIELD_SCHEMA: Record<typeof EXTRACTED_FIELD_KEYS[number], unknown> = {
  cpf: STRING_OR_NULL_SCHEMA,
  employeeName: STRING_OR_NULL_SCHEMA,
  motherName: STRING_OR_NULL_SCHEMA,
  fatherName: STRING_OR_NULL_SCHEMA,
  registrationNumber: STRING_OR_NULL_SCHEMA,
  pisPasep: STRING_OR_NULL_SCHEMA,
  ctpsNumber: STRING_OR_NULL_SCHEMA,
  ctpsSeries: STRING_OR_NULL_SCHEMA,
  ctpsIssueDate: STRING_OR_NULL_SCHEMA,
  cnhNumber: STRING_OR_NULL_SCHEMA,
  cnhCategory: STRING_OR_NULL_SCHEMA,
  cnhExpiryDate: STRING_OR_NULL_SCHEMA,
  cnhFirstLicenseDate: STRING_OR_NULL_SCHEMA,
  maritalStatus: STRING_OR_NULL_SCHEMA,
  birthDate: STRING_OR_NULL_SCHEMA,
  admissionDate: STRING_OR_NULL_SCHEMA,
  probationFirstEndDate: STRING_OR_NULL_SCHEMA,
  probationFinalEndDate: STRING_OR_NULL_SCHEMA,
  probationInitialDays: NUMBER_OR_NULL_SCHEMA,
  probationExtensionDays: NUMBER_OR_NULL_SCHEMA,
  employer: STRING_OR_NULL_SCHEMA,
  cnpj: STRING_OR_NULL_SCHEMA,
  position: STRING_OR_NULL_SCHEMA,
  referenceMonth: STRING_OR_NULL_SCHEMA,
  issueDate: STRING_OR_NULL_SCHEMA,
  startDate: STRING_OR_NULL_SCHEMA,
  endDate: STRING_OR_NULL_SCHEMA,
  acquisitionPeriodStart: STRING_OR_NULL_SCHEMA,
  acquisitionPeriodEnd: STRING_OR_NULL_SCHEMA,
  vacationStartDate: STRING_OR_NULL_SCHEMA,
  vacationEndDate: STRING_OR_NULL_SCHEMA,
  numberOfDays: NUMBER_OR_NULL_SCHEMA,
  installmentNumber: NUMBER_OR_NULL_SCHEMA,
  amountGross: NUMBER_OR_NULL_SCHEMA,
  amountDiscounts: NUMBER_OR_NULL_SCHEMA,
  amountNet: NUMBER_OR_NULL_SCHEMA,
  paymentDate: STRING_OR_NULL_SCHEMA,
  asoType: STRING_OR_NULL_SCHEMA,
  examDate: STRING_OR_NULL_SCHEMA,
  fitnessStatus: STRING_OR_NULL_SCHEMA,
  terminationDate: STRING_OR_NULL_SCHEMA,
  dependentName: STRING_OR_NULL_SCHEMA,
  dependentBirthDate: STRING_OR_NULL_SCHEMA,
  dependentCpf: STRING_OR_NULL_SCHEMA,
  dependentRg: STRING_OR_NULL_SCHEMA,
  dependents: DEPENDENTS_SCHEMA,
  vaccinationRecordDetected: BOOLEAN_OR_NULL_SCHEMA,
  schoolAttendanceDetected: BOOLEAN_OR_NULL_SCHEMA,
  responsibilityTermDetected: BOOLEAN_OR_NULL_SCHEMA,
  signatureDetected: BOOLEAN_OR_NULL_SCHEMA,
  transportVoucherAuthorized: BOOLEAN_OR_NULL_SCHEMA,
  transportVoucherDailyValue: NUMBER_OR_NULL_SCHEMA,
};

const FIELD_CONFIDENCE_SCHEMA: Record<typeof EXTRACTED_FIELD_KEYS[number], unknown> = Object.fromEntries(
  EXTRACTED_FIELD_KEYS.map((key) => [key, { type: "number", minimum: 0, maximum: 1 }]),
) as Record<typeof EXTRACTED_FIELD_KEYS[number], unknown>;

const EMPLOYEE_DOCUMENT_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "documentTypeCode",
    "documentTypeConfidence",
    "employeeMatchStatus",
    "identifiedEmployee",
    "extractedFields",
    "fieldConfidences",
    "structure",
    "issues",
    "warnings",
  ],
  properties: {
    documentTypeCode: { type: "string", enum: DOCUMENT_TYPE_CODES },
    documentTypeConfidence: { type: "number", minimum: 0, maximum: 1 },
    employeeMatchStatus: { type: "string", enum: ["MATCH", "POSSIBLE_MATCH", "MISMATCH", "UNKNOWN"] },
    identifiedEmployee: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: STRING_OR_NULL_SCHEMA,
      },
    },
    extractedFields: {
      type: "object",
      additionalProperties: false,
      required: EXTRACTED_FIELD_KEYS,
      properties: EXTRACTED_FIELD_SCHEMA,
    },
    fieldConfidences: {
      type: "object",
      additionalProperties: false,
      required: EXTRACTED_FIELD_KEYS,
      properties: FIELD_CONFIDENCE_SCHEMA,
    },
    structure: {
      type: "object",
      additionalProperties: false,
      required: ["legibility", "multipleDocumentsDetected", "pageCount"],
      properties: {
        legibility: { type: "string", enum: ["GOOD", "PARTIAL", "POOR"] },
        multipleDocumentsDetected: { type: "boolean" },
        pageCount: NUMBER_OR_NULL_SCHEMA,
      },
    },
    issues: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
  },
};

export type AiEmployeeDocumentAnalysis = {
  provider: "openai" | "local_fallback";
  model: string;
  documentTypeCode: string;
  documentTypeConfidence: number;
  employeeMatchStatus: "MATCH" | "POSSIBLE_MATCH" | "MISMATCH" | "UNKNOWN";
  identifiedEmployeeName?: string | null;
  extractedFields: Record<string, unknown>;
  fieldConfidences: Record<string, number>;
  structure: {
    legibility: "GOOD" | "PARTIAL" | "POOR";
    multipleDocumentsDetected: boolean;
    pageCount?: number | null;
  };
  issues: string[];
  warnings: string[];
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCostUsd?: number | null;
  promptVersion: string;
  schemaVersion: string;
};

type OpenAiFileResponse = {
  id?: string;
  error?: { message?: string };
};

type OpenAiResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  error?: { message?: string };
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
};

type RawAiResult = {
  documentTypeCode?: unknown;
  documentTypeConfidence?: unknown;
  employeeMatchStatus?: unknown;
  identifiedEmployee?: {
    name?: unknown;
  };
  extractedFields?: unknown;
  fieldConfidences?: unknown;
  structure?: {
    legibility?: unknown;
    multipleDocumentsDetected?: unknown;
    pageCount?: unknown;
  };
  issues?: unknown;
  warnings?: unknown;
};

const PROMPT_VERSION = "employee-document-v5";
const SCHEMA_VERSION = "employee-document-analysis-v5";

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function clampConfidence(value: unknown, fallback = 0.5) {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, numberValue));
}

function normalizedFieldConfidences(value: unknown): Record<string, number> {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(EXTRACTED_FIELD_KEYS.map((key) => [key, clampConfidence(input[key], 0)]));
}

function estimateCostUsd(model: string, inputTokens: number | null, outputTokens: number | null) {
  if (inputTokens == null && outputTokens == null) return null;
  const normalized = model.toLowerCase();
  const rates = normalized.includes("luna") ? [1, 6] : normalized.includes("sol") ? [5, 30] : [2.5, 15];
  return Number((((inputTokens ?? 0) * rates[0] + (outputTokens ?? 0) * rates[1]) / 1_000_000).toFixed(8));
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 220))
    : [];
}

function outputText(response: OpenAiResponse) {
  if (typeof response.output_text === "string") return response.output_text;
  return response.output
    ?.flatMap((item) => item.content ?? [])
    .map((item) => item.text)
    .filter((item): item is string => typeof item === "string")
    .join("\n") ?? "";
}

function parseJsonObject(text: string): RawAiResult {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  const parsed = JSON.parse(candidate);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RawAiResult : {};
}

function catalogForPrompt() {
  return EMPLOYEE_DOCUMENT_TYPE_CATALOG.map((item) => ({
    code: item.code,
    name: item.label,
    category: item.category,
    defaultAccessLevel: item.defaultAccessLevel,
    aliases: item.aliases,
    hints: item.classificationHints,
  }));
}

function fallbackByFilename(fileName: string): AiEmployeeDocumentAnalysis {
  const normalizedFile = normalizeText(fileName);
  const ranked = EMPLOYEE_DOCUMENT_TYPE_CATALOG
    .filter((item) => item.code !== "UNKNOWN_DOCUMENT")
    .map((item) => {
      const terms = [item.label, ...item.aliases].map(normalizeText);
      const score = terms.reduce((best, term) => normalizedFile.includes(term) ? Math.max(best, 0.68) : best, 0);
      const wordScore = normalizeText(item.label)
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 3 && normalizedFile.includes(word))
        .length * 0.08;
      return { item, score: Math.min(0.74, score + wordScore) };
    })
    .sort((a, b) => b.score - a.score);

  const winner = ranked[0]?.score ? ranked[0].item : employeeDocumentTypeConfigByCode("UNKNOWN_DOCUMENT");

  return {
    provider: "local_fallback",
    model: "local-filename-classifier",
    documentTypeCode: winner.code,
    documentTypeConfidence: ranked[0]?.score || 0.35,
    employeeMatchStatus: "UNKNOWN",
    identifiedEmployeeName: null,
    extractedFields: {},
    fieldConfidences: {},
    structure: {
      legibility: "PARTIAL",
      multipleDocumentsDetected: false,
      pageCount: null,
    },
    issues: ["OPENAI_API_KEY não configurada; análise de conteúdo não executada."],
    warnings: ["Resultado baseado apenas no nome do arquivo. Exige revisão humana."],
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
  };
}

function buildPrompt({
  expectedEmployeeName,
}: {
  expectedEmployeeName?: string | null;
}) {
  return [
    "Você analisa documentos de RH brasileiros. Retorne somente JSON válido, sem markdown.",
    "A saída é validada por JSON Schema rígido. Preencha todos os campos do schema; use null quando não houver evidência.",
    "Princípio obrigatório: a IA interpreta; regras determinísticas validam; o sistema executa.",
    "Use exclusivamente um documentTypeCode do catálogo. Se nenhum tipo for seguro, use UNKNOWN_DOCUMENT.",
    "Não invente tipos, pastas, colaboradores ou datas. Use null quando não encontrar campo.",
    "Para atestado/documento médico, não extraia diagnóstico, CID ou conteúdo clínico; extraia apenas dados operacionais mínimos.",
    "Para ASO, extraia examDate como a data real de realização do exame, não a data de upload ou arquivamento.",
    "Para RG, CNH, certidões e documentos com seção de filiação, extraia motherName e fatherName exatamente como aparecem. Se houver apenas uma pessoa na filiação, preencha apenas o campo correspondente quando o rótulo indicar mãe/pai; se o rótulo não distinguir, use null.",
    "Para CTPS, extraia ctpsNumber, ctpsSeries e ctpsIssueDate quando existirem. Em CTPS digital, número/série podem não existir; nesse caso use null e extraia CPF em cpf quando visível.",
    "Para comprovante de PIS/PASEP/NIS/NIT, extraia o número em pisPasep, preservando apenas o número legível.",
    "Para CNH, extraia cnhNumber, cnhCategory, cnhExpiryDate e cnhFirstLicenseDate quando estiverem visíveis.",
    "Para certidão de nascimento ou casamento, extraia maritalStatus quando houver evidência explícita.",
    "Para salário-família, trate o cadastro como lista de filhos. Extraia cada filho com nome, nascimento, CPF e RG quando houver. Use relationship como Filho(a), salvo evidência textual diferente.",
    "Para contrato de experiência, leia a cláusula de prazo. Grave a data impressa depois de 'término em' em probationFirstEndDate e a data impressa depois de 'finaliza em' (ou equivalente) em probationFinalEndDate. Não recalcule datas quando elas estiverem escritas no documento.",
    "Use o mapa de extração abaixo para localizar cada informação. O mapa orienta a busca, mas nunca substitui evidência visível no arquivo.",
    JSON.stringify(extractionGuideForPrompt()),
    "Para certidão, vacinação e frequência escolar, não calcule status final. O sistema deriva Pendente/Enviada/Não exigida pela idade e pelo tipo de documento. Você só deve marcar vaccinationRecordDetected, schoolAttendanceDetected e responsibilityTermDetected como true quando o arquivo enviado comprovar o respectivo documento.",
    expectedEmployeeName ? `Colaborador esperado no ponto de entrada: ${expectedEmployeeName}. Compare com o conteúdo, mas não force correspondência.` : "Não há colaborador esperado.",
    "Catálogo fechado:",
    JSON.stringify(catalogForPrompt()),
    "Formato obrigatório:",
    JSON.stringify({
      documentTypeCode: "PAYSLIP",
      documentTypeConfidence: 0.98,
      employeeMatchStatus: "MATCH | POSSIBLE_MATCH | MISMATCH | UNKNOWN",
      identifiedEmployee: { name: "Nome identificado ou null" },
      extractedFields: {
        cpf: "somente se visível; pode mascarar parcialmente",
        motherName: "nome da mãe quando houver filiação visível",
        fatherName: "nome do pai quando houver filiação visível",
        pisPasep: "PIS/PASEP/NIS/NIT quando houver",
        ctpsNumber: "número da CTPS quando houver",
        ctpsSeries: "série da CTPS quando houver",
        ctpsIssueDate: "AAAA-MM-DD quando houver",
        cnhNumber: "número de registro da CNH quando houver",
        cnhCategory: "categoria da CNH quando houver",
        cnhExpiryDate: "AAAA-MM-DD quando houver",
        cnhFirstLicenseDate: "AAAA-MM-DD quando houver",
        maritalStatus: "estado civil quando houver",
        admissionDate: "AAAA-MM-DD; início/admissão quando houver",
        probationFirstEndDate: "AAAA-MM-DD; término do primeiro período de experiência",
        probationFinalEndDate: "AAAA-MM-DD; término após a prorrogação",
        probationInitialDays: "quantidade de dias do primeiro período",
        probationExtensionDays: "quantidade de dias da prorrogação",
        referenceMonth: "AAAA-MM quando aplicável",
        issueDate: "AAAA-MM-DD quando aplicável",
        startDate: "AAAA-MM-DD quando aplicável",
        endDate: "AAAA-MM-DD quando aplicável",
        amountNet: "número quando aplicável",
        dependentName: "nome do filho quando houver",
        dependentBirthDate: "AAAA-MM-DD quando houver",
        dependentCpf: "CPF do filho ou null",
        dependentRg: "RG do filho ou null",
        dependents: [{ name: "Nome do filho", birthDate: "AAAA-MM-DD", cpf: "CPF ou null", rg: "RG ou null", relationship: "Filho(a)" }],
        vaccinationRecordDetected: false,
        schoolAttendanceDetected: false,
        responsibilityTermDetected: false,
        signatureDetected: true,
        transportVoucherAuthorized: true,
        transportVoucherDailyValue: 8.4,
        "demais campos do schema": null,
      },
      fieldConfidences: {
        cpf: 0.99,
        employeeName: 0.99,
        motherName: 0.99,
        fatherName: 0.99,
        referenceMonth: 0.99,
        "demais campos do schema": 0,
      },
      structure: {
        legibility: "GOOD | PARTIAL | POOR",
        multipleDocumentsDetected: false,
        pageCount: 1,
      },
      issues: ["problemas objetivos curtos"],
      warnings: ["alertas objetivos curtos"],
    }),
  ].join("\n\n");
}

async function uploadFileToOpenAi(file: File, apiKey: string) {
  const form = new FormData();
  form.set("purpose", "user_data");
  form.set("file", file, file.name);

  const response = await fetch(OPENAI_FILES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = await response.json() as OpenAiFileResponse;
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || "Falha ao enviar arquivo para análise.");
  }
  return payload.id;
}

async function deleteOpenAiFile(fileId: string, apiKey: string) {
  try {
    await fetch(`${OPENAI_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Best-effort cleanup. The definitive copy remains only in private Storage after confirmation.
  }
}

async function createOpenAiResponse({
  apiKey,
  fileId,
  fileName,
  expectedEmployeeName,
}: {
  apiKey: string;
  fileId: string;
  fileName: string;
  expectedEmployeeName?: string | null;
}) {
  const model = process.env.OPENAI_DOCUMENT_MODEL || "gpt-5.6-terra";
  const requestBody: Record<string, unknown> = {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_file", file_id: fileId },
          {
            type: "input_text",
            text: `${buildPrompt({ expectedEmployeeName })}\n\nArquivo original: ${fileName}`,
          },
        ],
      },
    ],
    max_output_tokens: 1800,
    reasoning: { effort: "low" },
    text: {
      format: {
        type: "json_schema",
        name: "employee_document_analysis",
        strict: true,
        schema: EMPLOYEE_DOCUMENT_ANALYSIS_SCHEMA,
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
  const payload = await response.json() as OpenAiResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || "Falha ao analisar documento com OpenAI.");
  }
  const inputTokens = typeof payload.usage?.input_tokens === "number" ? payload.usage.input_tokens : null;
  const outputTokens = typeof payload.usage?.output_tokens === "number" ? payload.usage.output_tokens : null;
  return { model, text: outputText(payload), inputTokens, outputTokens, estimatedCostUsd: estimateCostUsd(model, inputTokens, outputTokens) };
}

function normalizeAiResult(raw: RawAiResult, response: { model: string; inputTokens: number | null; outputTokens: number | null; estimatedCostUsd: number | null }): AiEmployeeDocumentAnalysis {
  const config: EmployeeDocumentTypeConfig = employeeDocumentTypeConfigByCode(
    typeof raw.documentTypeCode === "string" ? raw.documentTypeCode : "UNKNOWN_DOCUMENT"
  );
  const matchStatus = raw.employeeMatchStatus === "MATCH" || raw.employeeMatchStatus === "POSSIBLE_MATCH" || raw.employeeMatchStatus === "MISMATCH"
    ? raw.employeeMatchStatus
    : "UNKNOWN";
  const legibility = raw.structure?.legibility === "GOOD" || raw.structure?.legibility === "POOR"
    ? raw.structure.legibility
    : "PARTIAL";

  return {
    provider: "openai",
    model: response.model,
    documentTypeCode: config.code,
    documentTypeConfidence: clampConfidence(raw.documentTypeConfidence, config.code === "UNKNOWN_DOCUMENT" ? 0.25 : 0.7),
    employeeMatchStatus: matchStatus,
    identifiedEmployeeName: typeof raw.identifiedEmployee?.name === "string" ? raw.identifiedEmployee.name.slice(0, 160) : null,
    extractedFields: raw.extractedFields && typeof raw.extractedFields === "object" && !Array.isArray(raw.extractedFields)
      ? raw.extractedFields as Record<string, unknown>
      : {},
    fieldConfidences: normalizedFieldConfidences(raw.fieldConfidences),
    structure: {
      legibility,
      multipleDocumentsDetected: raw.structure?.multipleDocumentsDetected === true,
      pageCount: typeof raw.structure?.pageCount === "number" ? raw.structure.pageCount : null,
    },
    issues: stringArray(raw.issues),
    warnings: stringArray(raw.warnings),
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    estimatedCostUsd: response.estimatedCostUsd,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
  };
}

export async function analyzeEmployeeDocumentWithAi({
  file,
  expectedEmployeeName,
}: {
  file: File;
  expectedEmployeeName?: string | null;
}): Promise<AiEmployeeDocumentAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fallbackByFilename(file.name);

  let openAiFileId: string | null = null;
  try {
    openAiFileId = await uploadFileToOpenAi(file, apiKey);
    const response = await createOpenAiResponse({
      apiKey,
      fileId: openAiFileId,
      fileName: file.name,
      expectedEmployeeName,
    });
    return normalizeAiResult(parseJsonObject(response.text), response);
  } catch (error) {
    return {
      ...fallbackByFilename(file.name),
      issues: [error instanceof Error ? error.message : "Falha técnica na análise de IA."],
      warnings: ["Documento não foi classificado com segurança. Envie para revisão."],
    };
  } finally {
    if (openAiFileId) await deleteOpenAiFile(openAiFileId, apiKey);
  }
}
