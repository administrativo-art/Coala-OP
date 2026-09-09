import type {
  CardStatementImportLine,
  CardStatementPreviousImportLine,
  CardStatementRevisionDiff,
  CardStatementRevisionLine,
} from "./card-statement-import";

function comparableText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: unknown) {
  return new Set(comparableText(value).split(" ").filter((token) => token.length >= 3));
}

function textSimilarity(left: unknown, right: unknown) {
  const leftText = comparableText(left);
  const rightText = comparableText(right);
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;
  if (leftText.includes(rightText) || rightText.includes(leftText)) return 0.9;
  const leftTokens = tokens(leftText);
  const rightTokens = tokens(rightText);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function dateDistance(left: string, right: string) {
  const leftDate = new Date(`${left}T12:00:00`);
  const rightDate = new Date(`${right}T12:00:00`);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return Number.POSITIVE_INFINITY;
  return Math.abs(leftDate.getTime() - rightDate.getTime()) / 86_400_000;
}

function changeFields(next: CardStatementImportLine, previous: CardStatementPreviousImportLine) {
  const changes: CardStatementRevisionLine["changes"] = [];
  if (next.date !== previous.date) changes.push("date");
  if (comparableText(next.description) !== comparableText(previous.description)) changes.push("description");
  if (comparableText(next.supplier) !== comparableText(previous.supplier)) changes.push("supplier");
  if (Math.abs(next.amount - previous.amount) > 0.005) changes.push("amount");
  if ((next.installmentNumber ?? null) !== (previous.installmentNumber ?? null)) changes.push("installmentNumber");
  if ((next.installmentTotal ?? null) !== (previous.installmentTotal ?? null)) changes.push("installmentTotal");
  return changes;
}

function sameChargeIdentity(
  left: Pick<CardStatementImportLine, "date" | "description" | "supplier" | "amount" | "installmentNumber" | "installmentTotal">,
  right: Pick<CardStatementPreviousImportLine, "date" | "description" | "supplier" | "amount" | "installmentNumber" | "installmentTotal">,
) {
  return left.date === right.date
    && comparableText(left.description) === comparableText(right.description)
    && comparableText(left.supplier) === comparableText(right.supplier)
    && Math.abs(left.amount - right.amount) <= 0.005
    && (left.installmentNumber ?? null) === (right.installmentNumber ?? null)
    && (left.installmentTotal ?? null) === (right.installmentTotal ?? null);
}

function revisionScore(next: CardStatementImportLine, previous: CardStatementPreviousImportLine) {
  if (
    next.installmentNumber && previous.installmentNumber &&
    next.installmentNumber !== previous.installmentNumber
  ) return null;
  if (
    next.installmentTotal && previous.installmentTotal &&
    next.installmentTotal !== previous.installmentTotal
  ) return null;

  const referenceMatches = comparableText(next.sourceReference) === comparableText(previous.sourceReference);
  const days = dateDistance(next.date, previous.date);
  const descriptionSimilarity = textSimilarity(next.description, previous.description);
  const supplierSimilarity = textSimilarity(next.supplier, previous.supplier);
  const valueDifference = Math.abs(next.amount - previous.amount);
  const relativeDifference = previous.amount > 0 ? valueDifference / previous.amount : Number.POSITIVE_INFINITY;

  let score = referenceMatches ? 75 : 0;
  if (days === 0) score += 25;
  else if (days <= 3) score += 15;
  else if (days <= 10) score += 5;
  if (descriptionSimilarity === 1) score += 35;
  else if (descriptionSimilarity >= 0.6) score += 24;
  else if (descriptionSimilarity >= 0.3) score += 10;
  if (supplierSimilarity === 1) score += 15;
  else if (supplierSimilarity >= 0.5) score += 8;
  if (valueDifference <= 0.005) score += 25;
  else if (relativeDifference <= 0.05) score += 12;
  if (next.installmentNumber && next.installmentNumber === previous.installmentNumber) score += 8;

  // Referências de linha são a evidência mais forte (especialmente em CSV).
  // Sem elas, exigimos uma combinação conservadora de data, texto e valor.
  if (!referenceMatches && (score < 70 || days > 10)) return null;
  return score;
}

export function diffCardStatementRevision(
  nextLines: CardStatementImportLine[],
  previousLines: CardStatementPreviousImportLine[],
): CardStatementRevisionDiff {
  const unmatchedPrevious = new Map(previousLines.map((line) => [line.fingerprint, line]));
  const lines: CardStatementRevisionLine[] = [];
  const unmatchedNext: CardStatementImportLine[] = [];

  for (const next of nextLines) {
    const previous = unmatchedPrevious.get(next.fingerprint);
    if (!previous) {
      unmatchedNext.push(next);
      continue;
    }
    unmatchedPrevious.delete(next.fingerprint);
    lines.push({
      fingerprint: next.fingerprint,
      status: "unchanged",
      previousFingerprint: previous.fingerprint,
      previousExpenseId: previous.expenseId,
      previousLineId: previous.lineId,
      previousInstallmentNumber: previous.installmentNumber,
      previousDescription: previous.description,
      previousAmount: previous.amount,
      changes: [],
    });
  }

  for (const [nextIndex, next] of unmatchedNext.entries()) {
    const ranked = [...unmatchedPrevious.values()]
      .map((previous) => ({ previous, score: revisionScore(next, previous) }))
      .filter((candidate): candidate is { previous: CardStatementPreviousImportLine; score: number } => candidate.score !== null)
      .sort((left, right) => right.score - left.score || left.previous.fingerprint.localeCompare(right.previous.fingerprint));
    const best = ranked[0] ?? null;
    const second = ranked[1] ?? null;
    const equivalentNextCount = unmatchedNext
      .slice(nextIndex)
      .filter((candidate) => sameChargeIdentity(candidate, next))
      .length;
    const equivalentPreviousCount = [...unmatchedPrevious.values()]
      .filter((candidate) => sameChargeIdentity(next, candidate))
      .length;
    const balancedDuplicateGroup = equivalentNextCount > 1 && equivalentNextCount === equivalentPreviousCount;
    const unambiguous = Boolean(best && (!second || best.score - second.score >= 10 || balancedDuplicateGroup));
    if (best && unambiguous) {
      unmatchedPrevious.delete(best.previous.fingerprint);
      lines.push({
        fingerprint: next.fingerprint,
        status: "changed",
        previousFingerprint: best.previous.fingerprint,
        previousExpenseId: best.previous.expenseId,
        previousLineId: best.previous.lineId,
        previousInstallmentNumber: best.previous.installmentNumber,
        previousDescription: best.previous.description,
        previousAmount: best.previous.amount,
        changes: changeFields(next, best.previous),
      });
      continue;
    }
    lines.push({ fingerprint: next.fingerprint, status: "new", changes: [] });
  }

  const removed = [...unmatchedPrevious.values()];
  const summary = {
    unchanged: lines.filter((line) => line.status === "unchanged").length,
    changed: lines.filter((line) => line.status === "changed").length,
    added: lines.filter((line) => line.status === "new").length,
    removed: removed.length,
  };
  return {
    summary,
    lines,
    removed,
    hasChanges: summary.changed + summary.added + summary.removed > 0,
  };
}
