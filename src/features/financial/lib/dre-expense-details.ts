import type { DreExpenseLineDetail } from "./dre-expense-calculation";

export type DreExpenseAccountGroup = {
  accountPlanId: string;
  accountPlanName: string;
  totalAmount: number;
  expenses: DreExpenseLineDetail[];
};

function cents(value: unknown) {
  return Math.round((Number(value) || 0) * 100);
}

export function groupDreExpenseDetailsByAccount(
  details: DreExpenseLineDetail[],
): DreExpenseAccountGroup[] {
  const groups = new Map<string, {
    accountPlanId: string;
    accountPlanName: string;
    totalCents: number;
    expenses: Map<string, DreExpenseLineDetail>;
  }>();

  details.forEach((detail) => {
    const current = groups.get(detail.accountPlanId) ?? {
      accountPlanId: detail.accountPlanId,
      accountPlanName: detail.accountPlanName,
      totalCents: 0,
      expenses: new Map<string, DreExpenseLineDetail>(),
    };
    const existing = current.expenses.get(detail.expenseId);
    current.totalCents += cents(detail.amount);
    current.expenses.set(detail.expenseId, existing
      ? { ...existing, amount: (cents(existing.amount) + cents(detail.amount)) / 100 }
      : detail);
    groups.set(detail.accountPlanId, current);
  });

  return [...groups.values()]
    .map((group) => ({
      accountPlanId: group.accountPlanId,
      accountPlanName: group.accountPlanName,
      totalAmount: group.totalCents / 100,
      expenses: [...group.expenses.values()].sort((left, right) => (
        (left.description || left.supplier || "").localeCompare(
          right.description || right.supplier || "",
          "pt-BR",
        )
      )),
    }))
    .sort((left, right) => left.accountPlanName.localeCompare(right.accountPlanName, "pt-BR"));
}

export function formatDreServiceNumber(value: string) {
  let digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
}

function formatCalendarDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function dreExpenseDetailReferences(detail: DreExpenseLineDetail) {
  const references = (detail.billingIdentity?.serviceNumbers ?? [])
    .map((number) => `Linha ${formatDreServiceNumber(number)}`);
  if (detail.billingIdentity?.customerAccount) {
    references.push(`Conta ${detail.billingIdentity.customerAccount}`);
  }
  if (detail.cardChargeDate) {
    references.push(`Compra no cartão em ${formatCalendarDate(detail.cardChargeDate)}`);
  }
  const isMobileExpense = /(?:conta\s+de\s+celular|telefonia\s+m[oó]vel)/i.test(
    `${detail.accountPlanName} ${detail.description ?? ""}`,
  );
  if (isMobileExpense && references.every((reference) => !reference.startsWith("Linha "))) {
    references.push("Linha não identificada");
  }
  return references;
}
