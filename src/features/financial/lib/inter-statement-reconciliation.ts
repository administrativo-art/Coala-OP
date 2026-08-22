export type StatementExpenseMatchCandidate = {
  candidateKey?: string;
  expenseId: string;
  expenseDescription: string;
  supplier?: string;
  installmentNumber?: number;
  dueDate: Date;
  value: number;
  settlementPrincipalValue?: number;
  reportedPaymentId?: string;
  reportedLinkId?: string;
  interest?: number;
  fine?: number;
  discount?: number;
  abatement?: number;
  chargesAccountPlanId?: string;
  chargesAccountPlanName?: string;
};

export type StatementExpenseMatchSuggestion = StatementExpenseMatchCandidate & {
  confidence: "high" | "medium";
  additionalCharges: number;
};

export function refreshStatementSessionItem(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  const incomingStatus = String(incoming.status || "");
  const currentStatus = String(current.status || "pending");
  if (incomingStatus === "completed" || currentStatus === "pending") {
    return {
      ...current,
      ...incoming,
      auditHistory: current.auditHistory,
      auditSnapshot: current.auditSnapshot,
      auditRevision: current.auditRevision,
      effectuation: current.effectuation,
    };
  }
  return {
    ...current,
    bankStatementData: incoming.bankStatementData,
    bankReferences: incoming.bankReferences,
    bankOperationType: incoming.bankOperationType,
    bankTransactionType: incoming.bankTransactionType,
  };
}

function statementDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00-03:00`);
}

function dateDistanceInDays(left: Date, right: Date) {
  return Math.abs(left.getTime() - right.getTime()) / 86_400_000;
}

function claimKey(candidate: StatementExpenseMatchCandidate) {
  return candidate.candidateKey || `${candidate.expenseId}:${candidate.installmentNumber ?? 0}`;
}

export function findUniqueExactExpenseMatch(
  entry: { date: string; amount: number },
  candidates: StatementExpenseMatchCandidate[],
  claimedExpenseInstallments = new Set<string>()
) {
  if (entry.amount >= 0) return null;
  const entryDate = statementDate(entry.date);
  const exact = candidates.filter((candidate) => {
    return (
      !claimedExpenseInstallments.has(claimKey(candidate)) &&
      Math.abs(Math.abs(entry.amount) - candidate.value) <= 0.05 &&
      dateDistanceInDays(entryDate, candidate.dueDate) <= 5
    );
  });
  return exact.length === 1 ? exact[0] : null;
}

function normalizedTokens(value: unknown) {
  const ignored = new Set(["pagamento", "efetuado", "pix", "boleto", "ltda", "brasil", "banco"]);
  return new Set(
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !ignored.has(token)),
  );
}

function descriptionOverlap(entryDescription: string, candidate: StatementExpenseMatchCandidate) {
  const entryTokens = normalizedTokens(entryDescription);
  const candidateTokens = normalizedTokens(`${candidate.supplier || ""} ${candidate.expenseDescription}`);
  if (entryTokens.size === 0 || candidateTokens.size === 0) return 0;
  return [...entryTokens].filter((token) => candidateTokens.has(token)).length;
}

export function findExpenseMatchSuggestion(
  entry: { date: string; amount: number; description?: string },
  candidates: StatementExpenseMatchCandidate[],
  claimedExpenseInstallments = new Set<string>(),
): StatementExpenseMatchSuggestion | null {
  const exact = findUniqueExactExpenseMatch(entry, candidates, claimedExpenseInstallments);
  if (exact) return { ...exact, confidence: "high", additionalCharges: 0 };
  if (entry.amount >= 0) return null;

  const paidValue = Math.abs(entry.amount);
  const paidAt = statementDate(entry.date);
  const ranked = candidates.flatMap((candidate) => {
    const charges = paidValue - candidate.value;
    const relativeCharges = candidate.value > 0 ? charges / candidate.value : Number.POSITIVE_INFINITY;
    const daysAfterDue = (paidAt.getTime() - candidate.dueDate.getTime()) / 86_400_000;
    if (
      claimedExpenseInstallments.has(claimKey(candidate)) ||
      charges <= 0.05 ||
      charges > 1_000 ||
      relativeCharges > 0.3 ||
      daysAfterDue < -2 ||
      daysAfterDue > 90
    ) return [];
    const overlap = descriptionOverlap(entry.description || "", candidate);
    const score =
      Math.max(0, 30 - relativeCharges * 100) +
      Math.max(0, 20 - Math.abs(daysAfterDue) / 3) +
      Math.min(overlap, 3) * 12;
    return [{ candidate, charges: Number(charges.toFixed(2)), score, overlap }];
  }).sort((left, right) => right.score - left.score || left.charges - right.charges);

  const best = ranked[0];
  const second = ranked[1];
  if (!best || (second && best.score - second.score < 6)) return null;
  if (!best.overlap && ranked.length > 1) return null;
  return {
    ...best.candidate,
    confidence: "medium",
    additionalCharges: best.charges,
  };
}
