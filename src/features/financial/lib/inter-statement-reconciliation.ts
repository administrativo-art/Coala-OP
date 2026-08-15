export type StatementExpenseMatchCandidate = {
  expenseId: string;
  expenseDescription: string;
  installmentNumber?: number;
  dueDate: Date;
  value: number;
};

function statementDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00-03:00`);
}

function dateDistanceInDays(left: Date, right: Date) {
  return Math.abs(left.getTime() - right.getTime()) / 86_400_000;
}

export function findUniqueExactExpenseMatch(
  entry: { date: string; amount: number },
  candidates: StatementExpenseMatchCandidate[],
  claimedExpenseInstallments = new Set<string>()
) {
  if (entry.amount >= 0) return null;
  const entryDate = statementDate(entry.date);
  const exact = candidates.filter((candidate) => {
    const claimKey = `${candidate.expenseId}:${candidate.installmentNumber ?? 0}`;
    return (
      !claimedExpenseInstallments.has(claimKey) &&
      Math.abs(Math.abs(entry.amount) - candidate.value) <= 0.05 &&
      dateDistanceInDays(entryDate, candidate.dueDate) <= 5
    );
  });
  return exact.length === 1 ? exact[0] : null;
}
