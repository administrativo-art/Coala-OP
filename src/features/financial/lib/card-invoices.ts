export type PlannedPaymentMethodType =
  | "credit_card"
  | "debit_card"
  | "pix"
  | "boleto"
  | "transfer"
  | "cash";

export type CreditCardInstrument = {
  accountId: string;
  accountName: string;
  methodId: string;
  methodLabel: string;
  lastDigits?: string;
  closingDay?: number;
  dueDay?: number;
};

export type CardExpenseEntry = {
  id: string;
  description?: string;
  supplier?: string;
  totalValue?: number;
  status?: unknown;
  provisionType?: unknown;
  replacedByExpenseId?: unknown;
  competenceDate?: unknown;
  dueDate?: unknown;
  cardChargeDate?: unknown;
  accountPlanId?: unknown;
  accountPlanName?: unknown;
  accountAllocations?: unknown;
  resultCenterId?: unknown;
  resultCenterName?: unknown;
  apportionments?: unknown;
  paymentMethod?: unknown;
  recurrenceGroupId?: unknown;
  recurrenceIndex?: unknown;
  installmentNumber?: unknown;
  installmentTotal?: unknown;
  installments?: Array<{
    number?: unknown;
    dueDate?: unknown;
    value?: unknown;
    status?: unknown;
    cardReconciliationStatus?: unknown;
  }>;
  plannedPaymentMethodType?: unknown;
  plannedBankAccountId?: unknown;
  plannedBankAccountName?: unknown;
  plannedPaymentMethodId?: unknown;
  plannedPaymentMethodLabel?: unknown;
  cardReconciliationStatus?: unknown;
  cardStatementId?: unknown;
  cardStatementKey?: unknown;
  cardStatementMonthKey?: unknown;
};

export type CardStatementCycle = {
  key: string;
  monthKey: string;
  closingDate: Date;
  dueDate: Date;
};

export type CardStatementLine = {
  lineId: string;
  expense: CardExpenseEntry;
  chargeDate: Date;
  value: number;
  reconciled: boolean;
  installmentNumber?: number;
  installmentTotal?: number;
};

export type CardStatementLineAuditStatus = "pending" | "audited" | "reconciled";

export type CardStatementAllocation = {
  lineId: string;
  expenseId: string;
  installmentNumber: number | null;
  description: string;
  supplier: string;
  amount: number;
  competenceDate: string | null;
  accountPlanId: string;
  accountPlanName: string;
  resultCenterId: string;
  resultCenterName: string;
  accountAllocations: unknown[];
  apportionments: unknown[];
};

export type CardStatementGroup = CardStatementCycle & {
  card: CreditCardInstrument;
  lines: CardStatementLine[];
  projectedTotal: number;
  reconciledTotal: number;
  recurringCount: number;
  provisionCount: number;
  provisionedTotal: number;
};

export type BankOutflowEntry = {
  id: string;
  direction?: unknown;
  amount?: unknown;
  date?: unknown;
  description?: unknown;
};

export type CardStatementPaymentCandidate = {
  transaction: BankOutflowEntry;
  confidence: "high" | "medium";
  dateDistanceDays: number;
  valueDifference: number;
};

function positiveDay(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : fallback;
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function dateAtDay(year: number, monthIndex: number, day: number) {
  return new Date(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex)), 12, 0, 0, 0);
}

export function cardDateFromUnknown(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function cardExpenseChargeDate(expense: CardExpenseEntry) {
  return (
    cardDateFromUnknown(expense.cardChargeDate) ??
    cardDateFromUnknown(expense.dueDate) ??
    cardDateFromUnknown(expense.competenceDate)
  );
}

export function cardExpenseAuditIssues(expense: CardExpenseEntry) {
  const issues: string[] = [];
  if (String(expense.description || "").trim().length < 10) issues.push("descrição");
  if (String(expense.supplier || "").trim().length < 3) issues.push("favorecido");
  if (
    !String(expense.accountPlanId || "").trim() &&
    (!Array.isArray(expense.accountAllocations) || expense.accountAllocations.length === 0)
  ) {
    issues.push("plano de contas");
  }
  if (
    !String(expense.resultCenterId || "").trim() &&
    (!Array.isArray(expense.apportionments) || expense.apportionments.length === 0)
  ) {
    issues.push("centro de resultado");
  }
  if (!cardDateFromUnknown(expense.competenceDate)) issues.push("competência");
  return issues;
}

export function cardStatementLineAuditIssues(line: CardStatementLine) {
  return cardExpenseAuditIssues(line.expense);
}

export function cardStatementLineAuditStatus(line: CardStatementLine): CardStatementLineAuditStatus {
  if (line.reconciled) return "reconciled";
  return cardStatementLineAuditIssues(line).length === 0 ? "audited" : "pending";
}

function dateKey(value: unknown) {
  const date = cardDateFromUnknown(value);
  if (!date) return null;
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function buildCardStatementAllocations(lines: CardStatementLine[]): CardStatementAllocation[] {
  return lines.map((line) => ({
    lineId: line.lineId,
    expenseId: line.expense.id,
    installmentNumber: Number.isFinite(line.installmentNumber) ? Number(line.installmentNumber) : null,
    description: String(line.expense.description || ""),
    supplier: String(line.expense.supplier || ""),
    amount: Number(line.value.toFixed(2)),
    competenceDate: dateKey(line.expense.competenceDate),
    accountPlanId: String(line.expense.accountPlanId || ""),
    accountPlanName: String(line.expense.accountPlanName || ""),
    resultCenterId: String(line.expense.resultCenterId || ""),
    resultCenterName: String(line.expense.resultCenterName || ""),
    accountAllocations: Array.isArray(line.expense.accountAllocations)
      ? line.expense.accountAllocations
      : [],
    apportionments: Array.isArray(line.expense.apportionments)
      ? line.expense.apportionments
      : [],
  }));
}

export function resolveCardStatementCycle(
  chargeDate: Date,
  card: Pick<CreditCardInstrument, "accountId" | "methodId" | "closingDay" | "dueDay">
): CardStatementCycle {
  const closingDay = positiveDay(card.closingDay, 25);
  const dueDay = positiveDay(card.dueDay, 5);
  const currentClosingDate = dateAtDay(chargeDate.getFullYear(), chargeDate.getMonth(), closingDay);
  const closesInCurrentMonth = chargeDate.getTime() <= currentClosingDate.getTime();
  const closingMonthOffset = closesInCurrentMonth ? 0 : 1;
  const closingDate = dateAtDay(
    chargeDate.getFullYear(),
    chargeDate.getMonth() + closingMonthOffset,
    closingDay
  );
  const dueMonthOffset = dueDay <= closingDay ? 1 : 0;
  const dueDate = dateAtDay(
    closingDate.getFullYear(),
    closingDate.getMonth() + dueMonthOffset,
    dueDay
  );
  const monthKey = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}`;

  return {
    key: `${card.accountId}:${card.methodId}:${monthKey}`,
    monthKey,
    closingDate,
    dueDate,
  };
}

export function resolveCardStatementCycleFromMonth(
  monthKey: string,
  card: Pick<CreditCardInstrument, "accountId" | "methodId" | "closingDay" | "dueDay">
): CardStatementCycle {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) throw new Error("Competência da fatura inválida.");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const closingDay = positiveDay(card.closingDay, 25);
  const dueDay = positiveDay(card.dueDay, 5);
  const dueDate = dateAtDay(year, monthIndex, dueDay);
  const closingMonthOffset = dueDay <= closingDay ? -1 : 0;
  const closingDate = dateAtDay(year, monthIndex + closingMonthOffset, closingDay);

  return {
    key: `${card.accountId}:${card.methodId}:${monthKey}`,
    monthKey,
    closingDate,
    dueDate,
  };
}

export function resolveCardStatementDatesFromDueDate(
  dueDate: Date,
  card: Pick<CreditCardInstrument, "closingDay" | "dueDay">
) {
  const closingDay = positiveDay(card.closingDay, 25);
  const dueDay = positiveDay(card.dueDay, 5);
  const closingMonthOffset = closingDay > dueDay ? -1 : 0;
  return {
    closingDate: dateAtDay(dueDate.getFullYear(), dueDate.getMonth() + closingMonthOffset, closingDay),
    dueDate: dateAtDay(dueDate.getFullYear(), dueDate.getMonth(), dueDay),
  };
}

function explicitExpenseCycle(
  expense: CardExpenseEntry,
  card: Pick<CreditCardInstrument, "accountId" | "methodId" | "closingDay" | "dueDay">
) {
  const explicitMonth = String(expense.cardStatementMonthKey ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(explicitMonth)) {
    return resolveCardStatementCycleFromMonth(explicitMonth, card);
  }

  const statementKey = String(expense.cardStatementKey ?? "").trim();
  const prefix = `${card.accountId}:${card.methodId}:`;
  const statementMonth = statementKey.startsWith(prefix) ? statementKey.slice(prefix.length) : "";
  return /^\d{4}-\d{2}$/.test(statementMonth)
    ? resolveCardStatementCycleFromMonth(statementMonth, card)
    : null;
}

export function buildCardStatementGroups(
  expenses: CardExpenseEntry[],
  cards: CreditCardInstrument[]
): CardStatementGroup[] {
  const cardByKey = new Map(cards.map((card) => [`${card.accountId}:${card.methodId}`, card]));
  const groups = new Map<string, CardStatementGroup>();

  for (const expense of expenses) {
    if (expense.plannedPaymentMethodType !== "credit_card") continue;
    if (expense.status === "cancelled" || expense.status === "draft") continue;
    if (expense.provisionType === "forecast" && (expense.status === "reconciled" || expense.replacedByExpenseId)) {
      continue;
    }
    const accountId = String(expense.plannedBankAccountId ?? "");
    const methodId = String(expense.plannedPaymentMethodId ?? "");
    const card = cardByKey.get(`${accountId}:${methodId}`);
    if (!card) continue;
    const storedCycle = explicitExpenseCycle(expense, card);

    const installmentEntries =
      expense.paymentMethod === "installments" && Array.isArray(expense.installments) && expense.installments.length > 1
        ? expense.installments.map((installment, index) => ({
            lineId: `${expense.id}:installment:${Number(installment.number) || index + 1}`,
            chargeDate: cardDateFromUnknown(installment.dueDate),
            value: Number(installment.value),
            reconciled: installment.cardReconciliationStatus === "reconciled",
            installmentNumber: Number(installment.number) || index + 1,
            installmentTotal: expense.installments!.length,
          }))
        : [{
            lineId: expense.id,
            chargeDate: cardExpenseChargeDate(expense),
            value: Number(expense.totalValue),
            reconciled: expense.cardReconciliationStatus === "reconciled",
            installmentNumber: undefined,
            installmentTotal: undefined,
          }];

    for (const entry of installmentEntries) {
      if (!entry.chargeDate || !Number.isFinite(entry.value) || entry.value <= 0) continue;
      const cycle = installmentEntries.length === 1 && storedCycle
        ? storedCycle
        : resolveCardStatementCycle(entry.chargeDate, card);
      const current = groups.get(cycle.key) ?? {
        ...cycle,
        card,
        lines: [],
        projectedTotal: 0,
        reconciledTotal: 0,
        recurringCount: 0,
        provisionCount: 0,
        provisionedTotal: 0,
      };
      current.lines.push({
        lineId: entry.lineId,
        expense,
        chargeDate: entry.chargeDate,
        value: entry.value,
        reconciled: entry.reconciled,
        installmentNumber: entry.installmentNumber,
        installmentTotal: entry.installmentTotal,
      });
      current.projectedTotal += entry.value;
      if (entry.reconciled) current.reconciledTotal += entry.value;
      if (expense.paymentMethod === "recurring" || expense.recurrenceGroupId) current.recurringCount += 1;
      if (expense.provisionType === "forecast" && expense.status === "provisioned") {
        current.provisionCount += 1;
        current.provisionedTotal += entry.value;
      }
      groups.set(cycle.key, current);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      lines: group.lines.sort(
        (left, right) =>
          left.chargeDate.getTime() - right.chargeDate.getTime() ||
          String(left.expense.description ?? "").localeCompare(
            String(right.expense.description ?? ""),
            "pt-BR",
            { sensitivity: "base" }
          )
      ),
      projectedTotal: Number(group.projectedTotal.toFixed(2)),
      reconciledTotal: Number(group.reconciledTotal.toFixed(2)),
      provisionedTotal: Number(group.provisionedTotal.toFixed(2)),
    }))
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime());
}

export function findCardStatementPaymentCandidates(
  total: number,
  dueDate: Date,
  transactions: BankOutflowEntry[],
  alreadyLinkedTransactionIds: Set<string> = new Set()
): CardStatementPaymentCandidate[] {
  if (!Number.isFinite(total) || total <= 0) return [];

  return transactions
    .filter((transaction) => transaction.direction === "out" && !alreadyLinkedTransactionIds.has(transaction.id))
    .map((transaction) => {
      const date = cardDateFromUnknown(transaction.date);
      const amount = Math.abs(Number(transaction.amount));
      if (!date || !Number.isFinite(amount)) return null;
      const dateDistanceDays = Math.abs(date.getTime() - dueDate.getTime()) / 86_400_000;
      const valueDifference = Math.abs(amount - total);
      const relativeDifference = valueDifference / total;
      const confidence = valueDifference <= 0.05 && dateDistanceDays <= 5
        ? "high"
        : relativeDifference <= 0.05 && dateDistanceDays <= 10
        ? "medium"
        : null;
      return confidence
        ? { transaction, confidence, dateDistanceDays, valueDifference } satisfies CardStatementPaymentCandidate
        : null;
    })
    .filter((candidate): candidate is CardStatementPaymentCandidate => candidate !== null)
    .sort(
      (left, right) =>
        (left.confidence === right.confidence ? 0 : left.confidence === "high" ? -1 : 1) ||
        left.valueDifference - right.valueDifference ||
        left.dateDistanceDays - right.dateDistanceDays
    );
}

export const PLANNED_PAYMENT_METHOD_LABELS: Record<PlannedPaymentMethodType, string> = {
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  pix: "PIX",
  boleto: "Boleto",
  transfer: "Transferência",
  cash: "Dinheiro",
};
