export type CardStatementImportConfidence = "high" | "medium" | "low";
export type CardStatementAnalysisStatus = "ready" | "review_required" | "blocked";
export type CardStatementExcludedKind = "payment" | "credit" | "refund" | "metadata" | "summary" | "unsupported";

export type CardStatementImportLine = {
  id: string;
  sourceReference: string;
  date: string;
  description: string;
  supplier: string;
  amount: number;
  installmentNumber: number | null;
  installmentTotal: number | null;
  confidence: CardStatementImportConfidence;
  reviewNotes: string[];
  fingerprint: string;
};

export type CardStatementExcludedEntry = {
  sourceReference: string;
  description: string;
  amount: number | null;
  kind: CardStatementExcludedKind;
  reason: string;
};

export type CardStatementImportPreview = {
  fileName: string;
  issuer: string | null;
  cardLastDigits: string | null;
  dueDate: string | null;
  closingDate: string | null;
  officialTotal: number | null;
  transactions: CardStatementImportLine[];
  excludedEntries: CardStatementExcludedEntry[];
  warnings: string[];
  parser: "copilot";
  analysis: {
    status: CardStatementAnalysisStatus;
    summary: string;
    detectedFormat: string | null;
    includedTotal: number;
    excludedCount: number;
    promptVersion: string;
    schemaVersion: string | null;
  };
};

export type CardStatementLineInput = {
  sourceReference?: unknown;
  date?: unknown;
  description?: unknown;
  supplier?: unknown;
  amount?: unknown;
  installmentNumber?: unknown;
  installmentTotal?: unknown;
  confidence?: unknown;
  reviewNotes?: unknown;
};

export type CardStatementCsvSourceRow = {
  sourceReference: string;
  lineNumber: number;
  date: string;
  description: string;
  supplier: string;
  category: string;
  type: string;
  rawAmount: string;
  signedAmount: number;
};

export type CardStatementCsvInspection = {
  detectedFormat: string | null;
  issuer: string | null;
  cardLastDigits: string | null;
  dueDate: string | null;
  officialTotal: number | null;
  sourceRows: CardStatementCsvSourceRow[];
  warnings: string[];
};

export function resolveCardStatementOfficialTotal({
  inspection,
  transactions,
  excludedEntries,
  aiOfficialTotal,
}: {
  inspection: CardStatementCsvInspection | null;
  transactions: Array<Pick<CardStatementImportLine, "amount">>;
  excludedEntries: Array<Pick<CardStatementExcludedEntry, "amount" | "kind">>;
  aiOfficialTotal?: unknown;
}) {
  if (inspection?.detectedFormat === "CSV Banco Inter") {
    const creditPattern = /\b(estorno|credito|credit|abatimento|refund)\b/;
    const charges = inspection.sourceRows
      .filter((row) => row.signedAmount < 0 && !creditPattern.test(comparableText(row.description)))
      .reduce((total, row) => total + Math.abs(cents(row.signedAmount)), 0);
    const credits = inspection.sourceRows
      .filter((row) => row.signedAmount > 0 && creditPattern.test(comparableText(row.description)))
      .reduce((total, row) => total + cents(row.signedAmount), 0);
    const resolvedCharges = charges || transactions.reduce((total, line) => total + cents(line.amount), 0);
    const resolvedCredits = credits || excludedEntries
      .filter((entry) => entry.kind === "credit" || entry.kind === "refund")
      .reduce((total, entry) => total + cents(entry.amount), 0);
    const total = resolvedCharges - resolvedCredits;
    return total > 0 ? total / 100 : null;
  }

  const inspected = cents(inspection?.officialTotal);
  if (inspected > 0) return inspected / 100;
  const suggested = cents(aiOfficialTotal);
  return suggested > 0 ? suggested / 100 : null;
}

type CardStatementContext = { accountId: string; paymentMethodId: string; monthKey: string };

function displayText(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cents(value: unknown) {
  return Math.round((Number(value) || 0) * 100);
}

function comparableText(value: unknown) {
  return displayText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function parseIsoDate(value: unknown) {
  const raw = displayText(value);
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const year = Number(isoMatch?.[1] ?? brMatch?.[3]);
  const month = Number(isoMatch?.[2] ?? brMatch?.[2]);
  const day = Number(isoMatch?.[3] ?? brMatch?.[1]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parsePartialDate(value: unknown, monthKey: string) {
  const complete = parseIsoDate(value);
  if (complete) return complete;
  const match = /^(\d{2})\/(\d{2})$/.exec(displayText(value));
  if (!match) return null;
  const expectedYear = Number(monthKey.slice(0, 4));
  const expectedMonth = Number(monthKey.slice(5, 7));
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = expectedYear;
  if (month - expectedMonth > 6) year -= 1;
  if (expectedMonth - month > 6) year += 1;
  return parseIsoDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

function parseSignedAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  let raw = displayText(value).replace(/R\$/gi, "").replace(/\s/g, "");
  if (!raw) return null;
  const negative = raw.startsWith("-") || /^\(.*\)$/.test(raw);
  raw = raw.replace(/[()\-+]/g, "").replace(/[^0-9.,]/g, "");
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    raw = lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    raw = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Number((negative ? -Math.abs(parsed) : parsed).toFixed(2));
}

function positiveAmount(value: unknown) {
  const parsed = parseSignedAmount(value);
  return parsed && parsed !== 0 ? Number(Math.abs(parsed).toFixed(2)) : null;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function confidence(value: unknown): CardStatementImportConfidence {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && !!entry.trim()).map((entry) => entry.trim().slice(0, 240))
    : [];
}

function hashFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildCardStatementImportFingerprint(
  line: Pick<CardStatementImportLine, "sourceReference" | "date" | "description" | "amount" | "installmentNumber" | "installmentTotal">,
  context: CardStatementContext,
) {
  const identity = [
    context.accountId,
    context.paymentMethodId,
    context.monthKey,
    comparableText(line.sourceReference),
    line.date,
    comparableText(line.description),
    line.amount.toFixed(2),
    line.installmentNumber ?? "",
    line.installmentTotal ?? "",
  ].join("|");
  return `card-${hashFingerprint(identity)}`;
}

export function normalizeCardStatementImportLines(lines: CardStatementLineInput[], context: CardStatementContext) {
  const uniqueReferences = new Set<string>();
  const normalized: CardStatementImportLine[] = [];
  for (const [index, line] of lines.entries()) {
    const date = parseIsoDate(line.date);
    const amount = positiveAmount(line.amount);
    const description = displayText(line.description);
    const sourceReference = displayText(line.sourceReference) || `item-${index + 1}`;
    if (!date || !amount || !description || uniqueReferences.has(sourceReference)) continue;
    uniqueReferences.add(sourceReference);
    const installmentNumber = positiveInteger(line.installmentNumber);
    const installmentTotal = positiveInteger(line.installmentTotal);
    const partial = {
      sourceReference,
      date,
      description,
      supplier: displayText(line.supplier) || description,
      amount,
      installmentNumber,
      installmentTotal,
      confidence: confidence(line.confidence),
      reviewNotes: stringArray(line.reviewNotes),
    };
    const fingerprint = buildCardStatementImportFingerprint(partial, context);
    normalized.push({ id: `line-${index + 1}-${fingerprint}`, ...partial, fingerprint });
  }
  return normalized;
}

function splitDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = "";
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

function delimiterCount(line: string, delimiter: string) {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && quoted && line[index + 1] === '"') index += 1;
    else if (line[index] === '"') quoted = !quoted;
    else if (line[index] === delimiter && !quoted) count += 1;
  }
  return count;
}

function normalizedHeader(value: string) {
  return comparableText(value).replace(/[^a-z0-9]/g, "");
}

function findColumn(headers: string[], terms: string[]) {
  for (const term of terms) {
    const exact = headers.findIndex((header) => header === term);
    if (exact >= 0) return exact;
  }
  for (const term of terms) {
    const partial = headers.findIndex((header) => header.includes(term));
    if (partial >= 0) return partial;
  }
  return -1;
}

function installmentFromText(value: unknown) {
  const match = /(?:parcela\s*)?(\d{1,3})\s*\/\s*(\d{1,3})/i.exec(displayText(value));
  if (!match) return { installmentNumber: null, installmentTotal: null };
  const installmentNumber = positiveInteger(match[1]);
  const installmentTotal = positiveInteger(match[2]);
  if (!installmentNumber || !installmentTotal || installmentNumber > installmentTotal) {
    return { installmentNumber: null, installmentTotal: null };
  }
  return { installmentNumber, installmentTotal };
}

export function inspectCardStatementCsv(content: string, context: CardStatementContext): CardStatementCsvInspection {
  const lines = content.split(/\r?\n/);
  const sample = lines.slice(0, 12);
  const commaCount = sample.reduce((total, line) => total + delimiterCount(line, ","), 0);
  const semicolonCount = sample.reduce((total, line) => total + delimiterCount(line, ";"), 0);
  const delimiter = semicolonCount > commaCount ? ";" : ",";
  let headerIndex = -1;
  let headers: string[] = [];
  for (let index = 0; index < Math.min(lines.length, 20); index += 1) {
    const candidate = splitDelimitedLine(lines[index] ?? "", delimiter).map(normalizedHeader);
    if (
      findColumn(candidate, ["data", "date"]) >= 0
      && findColumn(candidate, ["valor", "amount"]) >= 0
      && findColumn(candidate, ["lancamento", "descricao", "historico", "estabelecimento", "transacao"]) >= 0
    ) {
      headerIndex = index;
      headers = candidate;
      break;
    }
  }
  if (headerIndex < 0) {
    return {
      detectedFormat: null,
      issuer: null,
      cardLastDigits: null,
      dueDate: null,
      officialTotal: null,
      sourceRows: [],
      warnings: ["Não foi possível identificar as colunas de data, descrição e valor no CSV."],
    };
  }

  const dateColumn = findColumn(headers, ["data", "date"]);
  const descriptionColumns = [
    findColumn(headers, ["lancamento"]),
    findColumn(headers, ["descricao"]),
    findColumn(headers, ["historico", "transacao"]),
    findColumn(headers, ["estabelecimento"]),
  ].filter((value, index, all) => value >= 0 && all.indexOf(value) === index);
  const supplierColumn = findColumn(headers, ["estabelecimento", "favorecido", "fornecedor"]);
  const amountColumn = findColumn(headers, ["valor", "amount"]);
  const typeColumn = findColumn(headers, ["tipo", "parcela", "parcelamento"]);
  const categoryColumn = findColumn(headers, ["categoria", "category"]);
  const cardColumn = findColumn(headers, ["cartao", "card"]);
  const isInter = headers.includes("lancamento") && headers.includes("cartao") && headers.includes("categoria") && headers.includes("tipo");

  let dueDate: string | null = null;
  let officialTotal: number | null = null;
  let cardLastDigits: string | null = null;
  const sourceRows: CardStatementCsvSourceRow[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const values = splitDelimitedLine(lines[index] ?? "", delimiter);
    const first = comparableText(values[0]);
    if (first === "vencimento") dueDate = parsePartialDate(values[1], context.monthKey);
    if (first === "total" && !isInter) officialTotal = positiveAmount(values[amountColumn] ?? values.at(-1));
    if (first.includes("cartao")) {
      const digits = displayText(values[1]).replace(/\D/g, "");
      if (digits.length >= 4) cardLastDigits = digits.slice(-4);
    }
    if (index <= headerIndex) continue;

    const date = parseIsoDate(values[dateColumn]);
    const signedAmount = parseSignedAmount(values[amountColumn]);
    const description = descriptionColumns.map((column) => displayText(values[column])).find(Boolean) || "";
    if (!date || signedAmount === null || signedAmount === 0 || !description) continue;
    const cardDigits = cardColumn >= 0 ? displayText(values[cardColumn]).replace(/\D/g, "") : "";
    if (!cardLastDigits && cardDigits.length >= 4) cardLastDigits = cardDigits.slice(-4);
    sourceRows.push({
      sourceReference: `csv-line-${index + 1}`,
      lineNumber: index + 1,
      date,
      description,
      supplier: supplierColumn >= 0 ? displayText(values[supplierColumn]) || description : description,
      category: categoryColumn >= 0 ? displayText(values[categoryColumn]) : "",
      type: typeColumn >= 0 ? displayText(values[typeColumn]) : "",
      rawAmount: displayText(values[amountColumn]),
      signedAmount,
    });
  }

  return {
    detectedFormat: isInter ? "CSV Banco Inter" : "CSV de fatura",
    issuer: isInter ? "Banco Inter" : null,
    cardLastDigits,
    dueDate,
    officialTotal,
    sourceRows,
    warnings: sourceRows.length === 0 ? ["Nenhum movimento financeiro datado foi encontrado no CSV."] : [],
  };
}

export function resolveCardStatementCsvAnalysisLines(
  lines: CardStatementLineInput[],
  inspection: CardStatementCsvInspection,
  context: CardStatementContext,
) {
  const sourceByReference = new Map(inspection.sourceRows.map((row) => [row.sourceReference, row]));
  return normalizeCardStatementImportLines(lines.flatMap((line) => {
    const sourceReference = displayText(line.sourceReference);
    const source = sourceByReference.get(sourceReference);
    if (!source) return [];
    const installment = installmentFromText(`${source.type} ${source.description}`);
    return [{
      sourceReference,
      date: source.date,
      description: source.description,
      supplier: source.supplier,
      amount: Math.abs(source.signedAmount),
      installmentNumber: installment.installmentNumber,
      installmentTotal: installment.installmentTotal,
      confidence: line.confidence,
      reviewNotes: line.reviewNotes,
    }];
  }), context);
}

export function parseCardStatementCsv(content: string, context: CardStatementContext) {
  const inspection = inspectCardStatementCsv(content, context);
  const relevantRows = inspection.sourceRows.filter((row) => {
    const description = comparableText(row.description);
    if (/\b(pagamento|estorno|credito|credit|abatimento)\b/.test(description)) return false;
    if (inspection.detectedFormat === "CSV Banco Inter") return row.signedAmount < 0;
    const nonPaymentRows = inspection.sourceRows.filter((candidate) => !/\b(pagamento|estorno|credito|credit|abatimento)\b/.test(comparableText(candidate.description)));
    const negativeCharges = nonPaymentRows.filter((candidate) => candidate.signedAmount < 0).length > nonPaymentRows.length / 2;
    return negativeCharges ? row.signedAmount < 0 : row.signedAmount > 0;
  });
  const transactions = normalizeCardStatementImportLines(relevantRows.map((row) => {
    const installment = installmentFromText(`${row.type} ${row.description}`);
    return {
      sourceReference: row.sourceReference,
      date: row.date,
      description: row.description,
      supplier: row.supplier,
      amount: Math.abs(row.signedAmount),
      installmentNumber: installment.installmentNumber,
      installmentTotal: installment.installmentTotal,
      confidence: "high",
      reviewNotes: [],
    };
  }), context);
  const officialTotal = resolveCardStatementOfficialTotal({
    inspection,
    transactions,
    excludedEntries: [],
  });
  return {
    ...inspection,
    officialTotal,
    transactions,
    warnings: [...inspection.warnings, ...(transactions.length === 0 ? ["Nenhuma compra válida foi encontrada no CSV."] : [])],
  };
}
