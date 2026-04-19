import type {
  ImportAlias,
  ImportedTransaction,
  ParsedBankEntry,
} from "@/features/financial/types/import";

function textMatches(text: string, alias: ImportAlias): boolean {
  const haystack = alias.caseSensitive ? text : text.toLowerCase();
  const needle = alias.caseSensitive ? alias.pattern : alias.pattern.toLowerCase();

  switch (alias.matchType) {
    case "contains":
      return haystack.includes(needle);
    case "startsWith":
      return haystack.startsWith(needle);
    case "endsWith":
      return haystack.endsWith(needle);
    case "exact":
      return haystack === needle;
    default:
      return false;
  }
}

export type PendingInstallment = {
  expenseId: string;
  expenseDescription: string;
  installmentNumber?: number;
  dueDate: Date;
  value: number;
};

function valueMatch(imported: number, installment: number, tolerance: number): boolean {
  const diff = Math.abs(Math.abs(imported) - installment);
  return diff / installment <= tolerance;
}

function dateDiff(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

export function findInstallmentMatch(
  entry: ParsedBankEntry,
  pendingInstallments: PendingInstallment[]
): Pick<
  ImportedTransaction,
  | "suggestedExpenseId"
  | "suggestedExpenseDescription"
  | "suggestedInstallmentNumber"
  | "suggestedInstallmentValue"
  | "suggestedConfidence"
> | null {
  if (entry.amount >= 0) return null;

  let best: (PendingInstallment & { confidence: "high" | "medium" }) | null = null;

  for (const installment of pendingInstallments) {
    const closeValue = valueMatch(entry.amount, installment.value, 0.02);
    const closeDate = dateDiff(entry.date, installment.dueDate) <= 5;

    if (closeValue && closeDate) {
      best = { ...installment, confidence: "high" };
      break;
    }

    if (valueMatch(entry.amount, installment.value, 0.05) && !best) {
      best = { ...installment, confidence: "medium" };
    }
  }

  if (!best) return null;

  return {
    suggestedExpenseId: best.expenseId,
    suggestedExpenseDescription: best.expenseDescription,
    suggestedInstallmentNumber: best.installmentNumber,
    suggestedInstallmentValue: best.value,
    suggestedConfidence: best.confidence,
  };
}

export function applyAliasesAndMatch(
  entries: ParsedBankEntry[],
  aliases: ImportAlias[],
  pendingInstallments: PendingInstallment[]
): ImportedTransaction[] {
  return entries.map((entry, index) => {
    const matchedAlias = aliases.find((alias) => textMatches(entry.description, alias));

    const base: ImportedTransaction = {
      tempId: `import-${index}-${Date.now()}`,
      date: entry.date,
      amount: entry.amount,
      rawDescription: entry.description,
      description: matchedAlias?.descriptionOverride || entry.description,
      accountPlanId: matchedAlias?.accountPlanId || "",
      accountPlanName: matchedAlias?.accountPlanName || "",
      resultCenterId: matchedAlias?.resultCenterId || "",
      resultCenterName: matchedAlias?.resultCenterName || "",
      supplier: matchedAlias?.supplier || "",
      matchedAliasId: matchedAlias?.id,
      status: "pending",
    };

    const installmentSuggestion = findInstallmentMatch(entry, pendingInstallments);
    if (installmentSuggestion) {
      Object.assign(base, installmentSuggestion);
    }

    return base;
  });
}
