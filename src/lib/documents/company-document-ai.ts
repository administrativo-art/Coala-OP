import "server-only";

import { dbAdmin } from "@/lib/firebase-admin";
import { COMPANY_DOCUMENT_CATEGORIES, type CompanyDocumentCategory } from "@/lib/documents/company-document-categories";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_FILES_URL = "https://api.openai.com/v1/files";

const PROMPT_VERSION = "company-document-v2";
const SCHEMA_VERSION = "company-document-analysis-v2";

const COMPANY_DOCUMENT_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "categoryConfidence", "documentName", "documentDetail", "suggestedUnit", "issues", "warnings"],
  properties: {
    category: { type: "string", enum: [...COMPANY_DOCUMENT_CATEGORIES] },
    categoryConfidence: { type: "number", minimum: 0, maximum: 1 },
    documentName: { type: ["string", "null"] },
    documentDetail: { type: ["string", "null"] },
    suggestedUnit: { type: ["string", "null"] },
    issues: { type: "array", items: { type: "string" }, maxItems: 6 },
    warnings: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
};

export type CompanyDocumentAiAnalysis = {
  provider: "openai" | "local_fallback";
  model: string;
  category: CompanyDocumentCategory;
  categoryConfidence: number;
  /** Nome canônico do tipo de documento, ex.: "Contrato Social", "Inscrição Estadual". */
  documentName: string | null;
  /** Qualificador curto, ex.: "Quarta alteração", "Renovação 2026". Não inclui unidade. */
  documentDetail: string | null;
  /** Unidade/filial identificada no documento, quando aplicável (ex.: "Filial 03"). */
  suggestedUnit: string | null;
  issues: string[];
  warnings: string[];
  promptVersion: string;
  schemaVersion: string;
};

type OpenAiFileResponse = { id?: string; error?: { message?: string } };
type OpenAiResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  error?: { message?: string };
};
type RawAiResult = {
  category?: unknown;
  categoryConfidence?: unknown;
  documentName?: unknown;
  documentDetail?: unknown;
  suggestedUnit?: unknown;
  issues?: unknown;
  warnings?: unknown;
};

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function clampConfidence(value: unknown, fallback = 0.5) {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, numberValue));
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 220))
    : [];
}

function shortString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function isCategory(value: unknown): value is CompanyDocumentCategory {
  return typeof value === "string" && (COMPANY_DOCUMENT_CATEGORIES as readonly string[]).includes(value);
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

/** Unidades/filiais cadastradas no sistema - usadas como referência para a IA não inventar nomes. */
async function loadKnownUnitNames(): Promise<string[]> {
  try {
    const snap = await dbAdmin.collection("dp_units").get();
    const names = new Set<string>();
    for (const doc of snap.docs) {
      if (doc.get("isArchived") === true) continue;
      const name = doc.get("name");
      if (typeof name === "string" && name.trim()) names.add(name.trim());
    }
    return [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
  } catch {
    return [];
  }
}

const CATEGORY_KEYWORDS: Record<CompanyDocumentCategory, string[]> = {
  "Societário": ["contrato social", "estatuto", "ata", "alteracao contratual", "junta comercial"],
  "Fiscal e contábil": ["nota fiscal", "balanco", "darf", "imposto", "contabil", "sped", "receita federal"],
  "Trabalhista e RH": ["ponto", "sindicato", "convencao coletiva", "esocial", "trabalhista"],
  "Licenças e autorizações": ["alvara", "licenca", "autorizacao", "vigilancia sanitaria", "bombeiro", "funcionamento", "inscricao estadual"],
  "Contratos": ["contrato", "acordo", "aditivo", "prestacao de servico", "locacao", "aluguel"],
  "Financeiro": ["extrato", "boleto", "financiamento", "banco", "emprestimo"],
  "Marca e propriedade intelectual": ["marca", "inpi", "patente", "registro de marca"],
  "A classificar": [],
};

function fallbackByFilename(fileName: string): CompanyDocumentAiAnalysis {
  const normalizedFile = normalizeText(fileName);
  const ranked = COMPANY_DOCUMENT_CATEGORIES
    .filter((category) => category !== "A classificar")
    .map((category) => {
      const terms = CATEGORY_KEYWORDS[category];
      const score = terms.reduce((best, term) => normalizedFile.includes(term) ? Math.max(best, 0.65) : best, 0);
      return { category, score };
    })
    .sort((a, b) => b.score - a.score);

  const winner = ranked[0]?.score ? ranked[0].category : "A classificar";

  return {
    provider: "local_fallback",
    model: "local-filename-classifier",
    category: winner,
    categoryConfidence: ranked[0]?.score || 0.3,
    documentName: null,
    documentDetail: null,
    suggestedUnit: null,
    issues: ["OPENAI_API_KEY não configurada; análise de conteúdo não executada."],
    warnings: ["Sugestão baseada apenas no nome do arquivo. Revise antes de salvar."],
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
  };
}

function buildPrompt(knownUnits: string[]) {
  return [
    "Você analisa documentos administrativos de uma empresa brasileira (sorveteria com múltiplas unidades/filiais) para padronizar o arquivamento.",
    "Retorne somente JSON válido, sem markdown. A saída é validada por JSON Schema rígido.",
    "Use exclusivamente uma categoria do catálogo fechado abaixo. Se não houver evidência segura, use \"A classificar\". Não existe categoria \"Unidades\": um documento de uma filial específica (ex.: inscrição estadual, alvará, contrato de locação de uma loja) é classificado pela natureza dele (Licenças e autorizações, Contratos, Fiscal e contábil etc.) e a filial vai em suggestedUnit, não na categoria.",
    "O título final do documento no sistema segue o padrão \"Nome do documento - Detalhes\". Você preenche as duas partes separadamente:",
    "- documentName: o nome canônico e curto do TIPO de documento, sem detalhes específicos. Ex.: \"Contrato Social\", \"Inscrição Estadual\", \"Alvará de Funcionamento\", \"Contrato de Locação\". Use null se não for possível identificar.",
    "- documentDetail: um qualificador curto (máx. 60 caracteres) que distingue este documento de outros do mesmo tipo, ex.: \"Quarta alteração\", \"Renovação 2026\", \"Parcela 03\". NÃO inclua o nome de unidade/filial aqui - isso vai em suggestedUnit. Use null se não houver qualificador relevante.",
    "- suggestedUnit: preencha somente quando o documento pertencer especificamente a UMA unidade/filial (ex.: inscrição estadual de uma loja, alvará de uma loja, contrato de locação de um endereço). Documentos da empresa como um todo (ex.: contrato social, marca/INPI) devem usar null aqui.",
    knownUnits.length > 0
      ? `Unidades/filiais já cadastradas no sistema (use exatamente este texto quando identificar uma delas no documento): ${JSON.stringify(knownUnits)}. Se o documento mencionar claramente uma unidade que não está nesta lista, use o texto como aparece no documento.`
      : "Nenhuma unidade cadastrada foi encontrada como referência; se identificar uma unidade/filial no documento, use o texto como aparece nele.",
    "Não invente dados que não estão no documento.",
    "Catálogo fechado de categorias:",
    JSON.stringify(COMPANY_DOCUMENT_CATEGORIES),
    "Formato obrigatório:",
    JSON.stringify({
      category: "Societário",
      categoryConfidence: 0.9,
      documentName: "Contrato Social",
      documentDetail: "Quarta alteração",
      suggestedUnit: null,
      issues: [],
      warnings: [],
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
    // Best-effort cleanup; o arquivo original permanece só no Storage privado após a confirmação.
  }
}

async function createOpenAiResponse({ apiKey, fileId, fileName, knownUnits }: { apiKey: string; fileId: string; fileName: string; knownUnits: string[] }) {
  const model = process.env.OPENAI_DOCUMENT_MODEL || "gpt-5.6-terra";
  const requestBody: Record<string, unknown> = {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_file", file_id: fileId },
          { type: "input_text", text: `${buildPrompt(knownUnits)}\n\nArquivo original: ${fileName}` },
        ],
      },
    ],
    max_output_tokens: 600,
    reasoning: { effort: "low" },
    text: {
      format: {
        type: "json_schema",
        name: "company_document_analysis",
        strict: true,
        schema: COMPANY_DOCUMENT_ANALYSIS_SCHEMA,
      },
    },
  };
  if (!model.toLowerCase().startsWith("gpt-5")) {
    requestBody.temperature = 0;
  }
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const payload = await response.json() as OpenAiResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || "Falha ao analisar documento com OpenAI.");
  }
  return { model, text: outputText(payload) };
}

function normalizeAiResult(raw: RawAiResult, model: string): CompanyDocumentAiAnalysis {
  const category = isCategory(raw.category) ? raw.category : "A classificar";
  return {
    provider: "openai",
    model,
    category,
    categoryConfidence: clampConfidence(raw.categoryConfidence, category === "A classificar" ? 0.25 : 0.7),
    documentName: shortString(raw.documentName, 80),
    documentDetail: shortString(raw.documentDetail, 60),
    suggestedUnit: shortString(raw.suggestedUnit, 80),
    issues: stringArray(raw.issues),
    warnings: stringArray(raw.warnings),
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
  };
}

export async function analyzeCompanyDocumentWithAi({ file }: { file: File }): Promise<CompanyDocumentAiAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fallbackByFilename(file.name);

  let openAiFileId: string | null = null;
  try {
    const [knownUnits, uploadedFileId] = await Promise.all([loadKnownUnitNames(), uploadFileToOpenAi(file, apiKey)]);
    openAiFileId = uploadedFileId;
    const response = await createOpenAiResponse({ apiKey, fileId: openAiFileId, fileName: file.name, knownUnits });
    return normalizeAiResult(parseJsonObject(response.text), response.model);
  } catch (error) {
    return {
      ...fallbackByFilename(file.name),
      issues: [error instanceof Error ? error.message : "Falha técnica na análise de IA."],
      warnings: ["Documento não foi classificado com segurança. Revise antes de salvar."],
    };
  } finally {
    if (openAiFileId) await deleteOpenAiFile(openAiFileId, apiKey);
  }
}
