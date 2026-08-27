export type ExpectedBankDebitCandidate = {
  id: string;
  paymentRequestId: string;
  financialInboxMessageId: string;
  expenseId: string;
  amount: number;
  expectedDate: Date;
  references: string[];
};

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
