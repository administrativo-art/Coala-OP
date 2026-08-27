import type { CardStatementImportLine } from "@/features/financial/lib/card-statement-import";

export type CardStatementExpenseCandidate = {
  lineId: string;
  expenseId: string;
  description: string;
  supplier: string;
  amount: number;
  chargeDate: Date;
  installmentNumber?: number;
  installmentTotal?: number;
  isForecast: boolean;
};

export type CardStatementExpenseMatch = {
  lineId: string;
  recommendedCandidateId: string | null;
  confidence: "high" | "medium" | null;
  ambiguous: boolean;
  candidates: Array<CardStatementExpenseCandidate & { score: number; valueDifference: number }>;
};

const IGNORED_WORDS = new Set([
  "a", "ao", "aos", "as", "da", "das", "de", "do", "dos", "e", "em", "no", "nos", "na", "nas",
  "br", "bra", "brasil", "ltda", "sa", "sao", "pagamento", "compra", "cartao", "credito",
]);

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: unknown) {
  return new Set(
    normalizedText(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !IGNORED_WORDS.has(token)),
  );
}

function textScore(line: CardStatementImportLine, candidate: CardStatementExpenseCandidate) {
  const left = normalizedText(`${line.supplier} ${line.description}`);
  const right = normalizedText(`${candidate.supplier} ${candidate.description}`);
  if (!left || !right) return 0;
  if (left === right) return 30;
  if ((left.length >= 6 && right.includes(left)) || (right.length >= 6 && left.includes(right))) return 26;

  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const ratio = intersection / Math.min(leftTokens.size, rightTokens.size);
  if (ratio >= 0.75) return 24;
  if (ratio >= 0.5) return 16;
  if (ratio >= 0.3) return 8;
  return 0;
}

function dateDistanceInDays(lineDate: string, candidateDate: Date) {
  const parsed = new Date(`${lineDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime()) || Number.isNaN(candidateDate.getTime())) return Number.POSITIVE_INFINITY;
  return Math.abs(parsed.getTime() - candidateDate.getTime()) / 86_400_000;
}

function scoreCandidate(line: CardStatementImportLine, candidate: CardStatementExpenseCandidate) {
  const valueDifference = Math.abs(line.amount - candidate.amount);
  const relativeDifference = candidate.amount > 0 ? valueDifference / candidate.amount : Number.POSITIVE_INFINITY;
  if (valueDifference > 0.05 && relativeDifference > 0.05) return null;

  if (
    line.installmentNumber &&
    candidate.installmentNumber &&
    line.installmentNumber !== candidate.installmentNumber
  ) return null;
  if (
    line.installmentTotal &&
    candidate.installmentTotal &&
    line.installmentTotal !== candidate.installmentTotal
  ) return null;

  let score = valueDifference <= 0.05 ? 60 : relativeDifference <= 0.02 ? 38 : 22;
  score += textScore(line, candidate);
  const dateDistance = dateDistanceInDays(line.date, candidate.chargeDate);
  if (dateDistance <= 3) score += 14;
  else if (dateDistance <= 10) score += 8;
  else if (dateDistance <= 35) score += 3;
  if (line.installmentNumber && candidate.installmentNumber === line.installmentNumber) score += 8;
  if (candidate.isForecast) score += 2;

  return {
    ...candidate,
    score,
    valueDifference: Number(valueDifference.toFixed(2)),
  };
}

export function matchCardStatementExpenses(
  lines: CardStatementImportLine[],
  candidates: CardStatementExpenseCandidate[],
): CardStatementExpenseMatch[] {
  const claimed = new Set<string>();
  return lines.map((line) => {
    const ranked = candidates
      .filter((candidate) => !claimed.has(candidate.lineId))
      .map((candidate) => scoreCandidate(line, candidate))
      .filter((candidate): candidate is NonNullable<ReturnType<typeof scoreCandidate>> => candidate !== null)
      .sort((left, right) => right.score - left.score || left.valueDifference - right.valueDifference)
      .slice(0, 5);
    const best = ranked[0] ?? null;
    const second = ranked[1] ?? null;
    const ambiguous = Boolean(best && second && best.score - second.score < 5);
    const confidence = !best || best.score < 50
      ? null
      : best.score >= 78 && best.valueDifference <= 0.05
        ? "high" as const
        : "medium" as const;
    const recommendedCandidateId = confidence && !ambiguous ? best!.lineId : null;
    if (confidence === "high" && recommendedCandidateId) claimed.add(recommendedCandidateId);
    return {
      lineId: line.id,
      recommendedCandidateId,
      confidence,
      ambiguous,
      candidates: ranked,
    };
  });
}
