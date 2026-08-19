import "server-only";

import { getActiveSystemPrompt, renderSystemPrompt } from "@/ai/prompts/registry";
import {
  inspectCardStatementCsv,
  normalizeCardStatementImportLines,
  resolveCardStatementOfficialTotal,
  resolveCardStatementCsvAnalysisLines,
  type CardStatementAnalysisStatus,
  type CardStatementCsvInspection,
  type CardStatementExcludedEntry,
  type CardStatementExcludedKind,
  type CardStatementImportConfidence,
  type CardStatementImportPreview,
  type CardStatementLineInput,
} from "@/features/financial/lib/card-statement-import";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_FILES_URL = "https://api.openai.com/v1/files";
const PROMPT = getActiveSystemPrompt("financial.card.statement-extraction");

const CARD_STATEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["analysis", "issuer", "cardLastDigits", "dueDate", "closingDate", "officialTotal", "transactions", "excludedEntries", "warnings"],
  properties: {
    analysis: {
      type: "object",
      additionalProperties: false,
      required: ["status", "summary", "detectedFormat"],
      properties: {
        status: { type: "string", enum: ["ready", "review_required", "blocked"] },
        summary: { type: "string" },
        detectedFormat: { type: ["string", "null"] },
      },
    },
    issuer: { type: ["string", "null"] },
    cardLastDigits: { type: ["string", "null"] },
    dueDate: { type: ["string", "null"] },
    closingDate: { type: ["string", "null"] },
    officialTotal: { type: ["number", "null"] },
    transactions: {
      type: "array",
      maxItems: 400,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceReference", "date", "description", "supplier", "amount", "installmentNumber", "installmentTotal", "confidence", "reviewNotes"],
        properties: {
          sourceReference: { type: "string" },
          date: { type: "string" },
          description: { type: "string" },
          supplier: { type: ["string", "null"] },
          amount: { type: "number" },
          installmentNumber: { type: ["integer", "null"] },
          installmentTotal: { type: ["integer", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reviewNotes: { type: "array", items: { type: "string" }, maxItems: 8 },
        },
      },
    },
    excludedEntries: {
      type: "array",
      maxItems: 400,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceReference", "description", "amount", "kind", "reason"],
        properties: {
          sourceReference: { type: "string" },
          description: { type: "string" },
          amount: { type: ["number", "null"] },
          kind: { type: "string", enum: ["payment", "credit", "refund", "metadata", "summary", "unsupported"] },
          reason: { type: "string" },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" }, maxItems: 20 },
  },
} as const;

type RawPreview = {
  analysis?: { status?: unknown; summary?: unknown; detectedFormat?: unknown };
  issuer?: unknown;
  cardLastDigits?: unknown;
  dueDate?: unknown;
  closingDate?: unknown;
  officialTotal?: unknown;
  transactions?: unknown;
  excludedEntries?: unknown;
  warnings?: unknown;
};

type RawExcludedEntry = {
  sourceReference?: unknown;
  description?: unknown;
  amount?: unknown;
  kind?: unknown;
  reason?: unknown;
};

function shortString(value: unknown, max = 180) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function isoDate(value: unknown) {
  const raw = shortString(value, 10);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Number(number.toFixed(2)) : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && !!entry.trim()).map((entry) => entry.trim().slice(0, 240))
    : [];
}

function analysisStatus(value: unknown): CardStatementAnalysisStatus {
  return value === "ready" || value === "review_required" || value === "blocked" ? value : "review_required";
}

function excludedKind(value: unknown): CardStatementExcludedKind {
  return value === "payment" || value === "credit" || value === "refund" || value === "metadata" || value === "summary" || value === "unsupported"
    ? value
    : "unsupported";
}

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  return (payload?.output || [])
    .flatMap((entry: any) => entry?.content || [])
    .map((entry: any) => entry?.text)
    .filter((entry: unknown): entry is string => typeof entry === "string")
    .join("\n");
}

function parseJson(text: string): RawPreview {
  const candidate = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    || text.trim().match(/\{[\s\S]*\}/)?.[0]
    || text.trim();
  const parsed = JSON.parse(candidate);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RawPreview : {};
}

async function uploadOpenAiFile(file: File, apiKey: string) {
  const form = new FormData();
  form.set("purpose", "user_data");
  form.set("file", file, file.name);
  const response = await fetch(OPENAI_FILES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) throw new Error(payload.error?.message || "Não foi possível enviar a fatura para o copiloto.");
  return payload.id;
}

async function deleteOpenAiFile(fileId: string, apiKey: string) {
  try {
    await fetch(`${OPENAI_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Limpeza de melhor esforço; o arquivo é usado apenas durante a análise.
  }
}

function normalizeExcludedEntries(rawEntries: unknown, inspection: CardStatementCsvInspection | null) {
  const sourceByReference = new Map((inspection?.sourceRows || []).map((row) => [row.sourceReference, row]));
  const seen = new Set<string>();
  return (Array.isArray(rawEntries) ? rawEntries : []).flatMap((raw): CardStatementExcludedEntry[] => {
    const entry = raw && typeof raw === "object" ? raw as RawExcludedEntry : {};
    const sourceReference = shortString(entry.sourceReference, 120) || "";
    if (!sourceReference || seen.has(sourceReference)) return [];
    const source = sourceByReference.get(sourceReference);
    if (inspection && !source) return [];
    const description = source?.description || shortString(entry.description, 240) || "Movimento não importado";
    const reason = shortString(entry.reason, 320) || "O copiloto não recomendou importar esta linha como despesa.";
    seen.add(sourceReference);
    return [{
      sourceReference,
      description,
      amount: source ? Math.abs(source.signedAmount) : positiveNumber(entry.amount),
      kind: excludedKind(entry.kind),
      reason,
    }];
  });
}

function csvEvidence(inspection: CardStatementCsvInspection) {
  return JSON.stringify({
    detectedFormat: inspection.detectedFormat,
    issuer: inspection.issuer,
    cardLastDigits: inspection.cardLastDigits,
    dueDate: inspection.dueDate,
    officialTotal: inspection.officialTotal,
    sourceRows: inspection.sourceRows,
  });
}

export async function extractCardStatementImportPreview(params: {
  file: File;
  accountId: string;
  paymentMethodId: string;
  monthKey: string;
}): Promise<CardStatementImportPreview> {
  const context = {
    accountId: params.accountId,
    paymentMethodId: params.paymentMethodId,
    monthKey: params.monthKey,
  };
  const lowerName = params.file.name.toLocaleLowerCase("pt-BR");
  const isCsv = params.file.type === "text/csv" || lowerName.endsWith(".csv");
  const isPdf = params.file.type === "application/pdf" || lowerName.endsWith(".pdf");
  if (!isCsv && !isPdf) throw new Error("Envie a fatura em PDF ou CSV.");

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("O copiloto de importação não está configurado neste ambiente.");

  const inspection = isCsv ? inspectCardStatementCsv(await params.file.text(), context) : null;
  if (inspection && inspection.sourceRows.length === 0) {
    throw new Error(inspection.warnings[0] || "O CSV não contém movimentos que possam ser analisados.");
  }
  if (inspection && inspection.sourceRows.length > 400) {
    throw new Error("A fatura contém mais de 400 movimentos. Divida o arquivo antes de enviar ao copiloto.");
  }
  const prompt = renderSystemPrompt("financial.card.statement-extraction", {
    expectedCompetence: params.monthKey,
    fileName: params.file.name.slice(0, 240),
    inputKind: inspection ? "csv_evidence" as const : "document" as const,
    csvEvidence: inspection ? csvEvidence(inspection) : undefined,
  });

  let fileId: string | null = null;
  try {
    if (isPdf) fileId = await uploadOpenAiFile(params.file, apiKey);
    const model = process.env.OPENAI_FINANCIAL_DOCUMENT_MODEL || "gpt-5.6-terra";
    const content = [
      ...(fileId ? [{ type: "input_file", file_id: fileId }] : []),
      { type: "input_text", text: prompt },
    ];
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        input: [{ role: "user", content }],
        max_output_tokens: 16000,
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: "card_statement_copilot_analysis", strict: true, schema: CARD_STATEMENT_SCHEMA } },
      }),
    });
    const payload = await response.json() as any;
    if (!response.ok) throw new Error(payload?.error?.message || "O copiloto não conseguiu analisar a fatura.");
    const raw = parseJson(outputText(payload));
    const rawTransactions = Array.isArray(raw.transactions) ? raw.transactions as CardStatementLineInput[] : [];
    const transactions = inspection
      ? resolveCardStatementCsvAnalysisLines(rawTransactions, inspection, context)
      : normalizeCardStatementImportLines(rawTransactions, context);
    const excludedEntries = normalizeExcludedEntries(raw.excludedEntries, inspection);
    const accountedReferences = new Set([
      ...transactions.map((line) => line.sourceReference),
      ...excludedEntries.map((entry) => entry.sourceReference),
    ]);
    const unaccountedReferences = inspection
      ? inspection.sourceRows.filter((row) => !accountedReferences.has(row.sourceReference)).map((row) => row.sourceReference)
      : [];
    const warnings = [
      ...stringArray(raw.warnings),
      ...(inspection?.warnings || []),
      ...(unaccountedReferences.length > 0
        ? [`O copiloto não classificou ${unaccountedReferences.length} movimento(s) do CSV; revise o arquivo antes de importar.`]
        : []),
    ];
    const lowConfidence = transactions.some((line) => line.confidence === "low");
    let status = analysisStatus(raw.analysis?.status);
    if (transactions.length === 0) status = "blocked";
    else if (status !== "blocked" && (lowConfidence || warnings.length > 0 || unaccountedReferences.length > 0)) status = "review_required";
    const includedTotal = Number(transactions.reduce((total, line) => total + line.amount, 0).toFixed(2));
    const officialTotal = resolveCardStatementOfficialTotal({
      inspection,
      transactions,
      excludedEntries,
      aiOfficialTotal: raw.officialTotal,
    });

    return {
      fileName: params.file.name.slice(0, 240),
      issuer: inspection?.issuer || shortString(raw.issuer),
      cardLastDigits: inspection?.cardLastDigits || shortString(raw.cardLastDigits, 4),
      dueDate: inspection?.dueDate || isoDate(raw.dueDate),
      closingDate: isoDate(raw.closingDate),
      officialTotal,
      transactions,
      excludedEntries,
      warnings,
      parser: "copilot",
      analysis: {
        status,
        summary: shortString(raw.analysis?.summary, 600)
          || `${transactions.length} compra(s) preparada(s) para revisão humana.`,
        detectedFormat: inspection?.detectedFormat || shortString(raw.analysis?.detectedFormat, 120),
        includedTotal,
        excludedCount: excludedEntries.length,
        promptVersion: PROMPT.version,
        schemaVersion: PROMPT.schemaVersion,
      },
    };
  } finally {
    if (fileId) await deleteOpenAiFile(fileId, apiKey);
  }
}

export const CARD_STATEMENT_IMPORT_PROMPT_METADATA = {
  version: PROMPT.version,
  schemaVersion: PROMPT.schemaVersion,
};
