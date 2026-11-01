export type ExpectedBankDebitCandidate = {
  id: string;
  paymentRequestId: string;
  financialInboxMessageId: string;
  expenseId: string;
  amount: number;
  principalAmount: number;
  expectedDate: Date;
  references: string[];
  counterpartyName?: string | null;
};

export type ExpectedBankDebitEntry = {
  externalId: string;
  amount: number;
  date: string;
  description: string;
  references: string[];
};

const COUNTERPARTY_STOP_WORDS = new Set([
  "BANCO", "BOLETO", "COMERCIO", "DE", "DO", "DA", "EIRELI", "EPP", "LTDA", "ME",
  "PAGAMENTO", "SA", "SIMPLES", "TITULO",
]);

function normalizedTokens(value: string) {
  const normalized = value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  // O Inter descreve alguns fornecedores por letras separadas ("T V N").
  const withAcronym = normalized.replace(/\b(?:[A-Z]\s+){2,}[A-Z]\b/g, (match) => match.replace(/\s+/g, ""));
  return withAcronym
    .split(/[^A-Z0-9]+/)
    .filter((token) => (token.length >= 4 || token === "TVN") && !COUNTERPARTY_STOP_WORDS.has(token));
}

function counterpartySignature(value: string | null | undefined) {
  return [...new Set(normalizedTokens(value ?? ""))].sort().join("|");
}

function dateDistanceInDays(left: Date, rightIso: string) {
  const right = new Date(`${rightIso}T12:00:00-03:00`);
  return Math.abs(left.getTime() - right.getTime()) / 86_400_000;
}

export function findExpectedBankDebitMatch(
  entry: { amount: number; date: string; references: string[] },
  candidates: ExpectedBankDebitCandidate[],
  claimed: Set<string>,
) {
  if (entry.amount >= 0) return null;
  const eligible = candidates.filter((candidate) => !claimed.has(candidate.id));
  const direct = eligible.filter((candidate) => candidate.references.some((reference) => entry.references.includes(reference)));
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) return null;
  const entryDate = new Date(`${entry.date}T12:00:00-03:00`);
  const exact = eligible.filter((candidate) =>
    Math.abs(candidate.amount - Math.abs(entry.amount)) <= 0.05
    && Math.abs(candidate.expectedDate.getTime() - entryDate.getTime()) / 86_400_000 <= 5
  );
  return exact.length === 1 ? exact[0] : null;
}

/**
 * Resolves a set-level ambiguity without pretending that one statement row is
 * individually identifiable. Every debit and every expected payment must have
 * the same amount, the same counterparty evidence, compatible dates and equal
 * cardinality. The deterministic pairing is only an implementation detail;
 * the financial evidence is the complete group.
 */
export function findExpectedBankDebitGroupMatches(
  entries: ExpectedBankDebitEntry[],
  candidates: ExpectedBankDebitCandidate[],
  claimed: Set<string>,
) {
  const matches = new Map<string, ExpectedBankDebitCandidate>();
  const eligibleCandidates = candidates.filter((candidate) => !claimed.has(candidate.id));
  const groups = new Map<string, ExpectedBankDebitCandidate[]>();

  for (const candidate of eligibleCandidates) {
    const signature = counterpartySignature(candidate.counterpartyName);
    if (!signature) continue;
    const key = `${Math.round(candidate.amount * 100)}:${signature}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const signatureTokens = counterpartySignature(group[0]?.counterpartyName).split("|").filter(Boolean);
    if ((signatureTokens.length < 2 && signatureTokens[0] !== "TVN")
      || group.some((candidate) => counterpartySignature(candidate.counterpartyName) !== signatureTokens.join("|"))) continue;

    const matchingEntries = entries.filter((entry) => {
      if (entry.amount >= 0 || Math.abs(group[0]!.amount - Math.abs(entry.amount)) > 0.05) return false;
      if (group.some((candidate) => candidate.references.some((reference) => entry.references.includes(reference)))) return false;
      const entryTokens = new Set(normalizedTokens(entry.description));
      if (!signatureTokens.every((token) => entryTokens.has(token))) return false;
      if (!group.some((candidate) => dateDistanceInDays(candidate.expectedDate, entry.date) <= 5)) return false;
      const competing = eligibleCandidates.filter((candidate) =>
        Math.abs(candidate.amount - Math.abs(entry.amount)) <= 0.05
        && dateDistanceInDays(candidate.expectedDate, entry.date) <= 5
      );
      return competing.every((candidate) => group.some((member) => member.id === candidate.id));
    });

    if (matchingEntries.length !== group.length) continue;
    const orderedCandidates = [...group].sort((left, right) =>
      left.expectedDate.getTime() - right.expectedDate.getTime() || left.id.localeCompare(right.id));
    const orderedEntries = [...matchingEntries].sort((left, right) =>
      left.date.localeCompare(right.date) || left.externalId.localeCompare(right.externalId));
    orderedEntries.forEach((entry, index) => matches.set(entry.externalId, orderedCandidates[index]!));
  }
  return matches;
}
