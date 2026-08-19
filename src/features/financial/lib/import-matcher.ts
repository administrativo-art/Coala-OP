import type {
  ImportAlias,
  ImportedTransaction,
  ParsedBankEntry,
} from "@/features/financial/types/import";
import { findExpenseMatchSuggestion } from "@/features/financial/lib/inter-statement-reconciliation";

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
  supplier?: string;
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

function localDateKey(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
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
  | "suggestedAdditionalCharges"
  | "suggestedConfidence"
> | null {
  if (entry.amount >= 0) return null;

  const exactCandidates = pendingInstallments.filter(
    (installment) =>
      Math.abs(Math.abs(entry.amount) - installment.value) <= 0.05 &&
      dateDiff(entry.date, installment.dueDate) <= 5
  );

  // Pagamento automático exige correspondência única em centavos. Duas parcelas
  // iguais na mesma janela continuam para escolha humana, sem vínculo arbitrário.
  if (exactCandidates.length > 1) return null;

  let best: (PendingInstallment & { confidence: "high" | "medium" }) | null =
    exactCandidates.length === 1 ? { ...exactCandidates[0], confidence: "high" } : null;

  if (!best) {
    const chargeSuggestion = findExpenseMatchSuggestion({
      date: localDateKey(entry.date),
      amount: entry.amount,
      description: entry.description,
    }, pendingInstallments);
    if (chargeSuggestion?.additionalCharges) {
      return {
        suggestedExpenseId: chargeSuggestion.expenseId,
        suggestedExpenseDescription: chargeSuggestion.expenseDescription,
        suggestedInstallmentNumber: chargeSuggestion.installmentNumber,
        suggestedInstallmentValue: chargeSuggestion.value,
        suggestedAdditionalCharges: chargeSuggestion.additionalCharges,
        suggestedConfidence: "medium",
      };
    }
  }

  if (!best) {
    const mediumCandidates = pendingInstallments
      .filter((installment) => valueMatch(entry.amount, installment.value, 0.05))
      .sort((left, right) => {
        const leftValueDiff = Math.abs(Math.abs(entry.amount) - left.value);
        const rightValueDiff = Math.abs(Math.abs(entry.amount) - right.value);
        return leftValueDiff - rightValueDiff || dateDiff(entry.date, left.dueDate) - dateDiff(entry.date, right.dueDate);
      });

    if (mediumCandidates.length > 0) {
      best = { ...mediumCandidates[0], confidence: "medium" };
    }
  }

  if (!best) return null;

  const additionalCharges = Math.max(Math.abs(entry.amount) - best.value, 0);

  return {
    suggestedExpenseId: best.expenseId,
    suggestedExpenseDescription: best.expenseDescription,
    suggestedInstallmentNumber: best.installmentNumber,
    suggestedInstallmentValue: best.value,
    suggestedAdditionalCharges: Number(additionalCharges.toFixed(2)),
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
