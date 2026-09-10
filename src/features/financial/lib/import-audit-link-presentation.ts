export type ImportAuditLinkedExpense = {
  id: string;
  description?: string | null;
  accountPlanName?: string | null;
  accountName?: string | null;
  resultCenter?: string | null;
  resultCenterName?: string | null;
  isApportioned?: boolean | null;
  status?: string | null;
  settlementSummary?: {
    settlementAmountCents?: number | null;
    balanceAmountCents?: number | null;
  } | null;
};

export type ImportAuditLinkPresentation = {
  label: string;
  meta: string | null;
  expenseId: string | null;
  action: "expense" | "details" | null;
  tone: "linked" | "pending" | "neutral";
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

type ImportAuditLinkPresentationInput = {
  amount: number;
  movementKind: "standard" | "transfer";
  isCardStatementSettlement: boolean;
  expenseMode: "new" | "existing" | "purchase" | "split";
  linkedExpenseId?: string | null;
  effectuationExpenseIds?: string[] | null;
  draftDescription?: string | null;
  suggestedExpenseDescription?: string | null;
  splitExpenseCount?: number;
  purchaseLabel?: string | null;
  expensesById: ReadonlyMap<string, ImportAuditLinkedExpense>;
};

function uniqueText(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function expenseMeta(expense?: ImportAuditLinkedExpense) {
  if (!expense) return null;
  const settlementAmountCents = Number(
    expense.settlementSummary?.settlementAmountCents,
  );
  const balanceAmountCents = Number(
    expense.settlementSummary?.balanceAmountCents,
  );
  const partialPayment =
    expense.status === "partially_paid" &&
    settlementAmountCents > 0 &&
    balanceAmountCents > 0 &&
    balanceAmountCents < settlementAmountCents
      ? `${currencyFormatter.format((settlementAmountCents - balanceAmountCents) / 100)} de ${currencyFormatter.format(settlementAmountCents / 100)} pagos`
      : null;
  const account = expense.accountPlanName || expense.accountName;
  const allocation = expense.isApportioned
    ? "Rateado"
    : expense.resultCenter || expense.resultCenterName;
  return uniqueText([partialPayment, account, allocation]).join(" · ") || null;
}

export function getImportAuditSourceDescription(input: {
  rawDescription?: string | null;
  financialDescription?: string | null;
  suggestedExpenseDescription?: string | null;
  draftDescription?: string | null;
}) {
  const description =
    input.rawDescription ||
    input.financialDescription ||
    input.suggestedExpenseDescription ||
    input.draftDescription ||
    "Movimentação bancária";
  return description.replace(/\s+/g, " ").trim();
}

export function buildImportAuditLinkPresentation(
  input: ImportAuditLinkPresentationInput,
): ImportAuditLinkPresentation {
  const expenseIds = uniqueText([
    ...(input.effectuationExpenseIds || []),
    input.linkedExpenseId,
  ]);

  if (expenseIds.length > 1) {
    return {
      label: `Vinculada a ${expenseIds.length} despesas`,
      meta: input.expenseMode === "split" ? "Ver rateio" : "Ver vínculos",
      expenseId: null,
      action: "details",
      tone: "linked",
    };
  }

  if (expenseIds.length === 1) {
    const expenseId = expenseIds[0];
    const expense = input.expensesById.get(expenseId);
    const description =
      expense?.description?.trim() ||
      input.suggestedExpenseDescription?.trim() ||
      input.draftDescription?.trim() ||
      `Despesa ${expenseId}`;
    return {
      label: `Vinculada a: ${description}`,
      meta: expenseMeta(expense),
      expenseId,
      action: "expense",
      tone: "linked",
    };
  }

  if (input.movementKind === "transfer") {
    return {
      label: "Transferência entre contas",
      meta: null,
      expenseId: null,
      action: null,
      tone: "neutral",
    };
  }

  if (input.amount >= 0) {
    return {
      label: "Receita reconhecida no extrato",
      meta: null,
      expenseId: null,
      action: null,
      tone: "neutral",
    };
  }

  if (input.isCardStatementSettlement) {
    return {
      label: "Liquidação da fatura do cartão",
      meta: null,
      expenseId: null,
      action: null,
      tone: "neutral",
    };
  }

  if (input.expenseMode === "split") {
    const count = Math.max(input.splitExpenseCount || 0, 1);
    return {
      label: `Rateio preparado em ${count} ${count === 1 ? "despesa" : "despesas"}`,
      meta: "Ver rateio",
      expenseId: null,
      action: "details",
      tone: "pending",
    };
  }

  if (input.expenseMode === "new" && input.draftDescription?.trim()) {
    return {
      label: `Nova despesa: ${input.draftDescription.trim()}`,
      meta: "Revisar cadastro",
      expenseId: null,
      action: "details",
      tone: "pending",
    };
  }

  if (input.expenseMode === "purchase" && input.purchaseLabel?.trim()) {
    return {
      label: `Vinculada à compra: ${input.purchaseLabel.trim()}`,
      meta: "Ver alocação",
      expenseId: null,
      action: "details",
      tone: "linked",
    };
  }

  return {
    label: "Sem despesa vinculada",
    meta: "Vincular",
    expenseId: null,
    action: "details",
    tone: "pending",
  };
}
