import {
  financialDateFromIso,
  financialDateKey,
  financialMonthKey,
} from "@/features/financial/lib/financial-dates";

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
    competenceDate?: unknown;
    value?: unknown;
    status?: unknown;
    cardReconciliationStatus?: unknown;
    cardStatementRevisionStatus?: unknown;
    cardStatementId?: unknown;
    cardStatementKey?: unknown;
    cardStatementMonthKey?: unknown;
    cardStatementImportFingerprint?: unknown;
    cardStatementAuditDisposition?: unknown;
  }>;
  plannedPaymentMethodType?: unknown;
  plannedBankAccountId?: unknown;
  plannedBankAccountName?: unknown;
  plannedPaymentMethodId?: unknown;
  plannedPaymentMethodLabel?: unknown;
  cardReconciliationStatus?: unknown;
  cardStatementRevisionStatus?: unknown;
  cardStatementId?: unknown;
  cardStatementKey?: unknown;
  cardStatementMonthKey?: unknown;
  cardStatementImportFingerprint?: unknown;
  cardStatementAuditDisposition?: unknown;
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
  importFingerprint?: string;
  sourceReference?: string;
};

export type CardStatementLineAuditStatus = "pending" | "audited" | "historical" | "reconciled";

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
  importFingerprint?: string;
  sourceReference?: string;
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

export function canRegisterCardStatementAsHistorical(
  statementMonthKey: string,
  dreStartMonthKey: string,
) {
  return /^\d{4}-\d{2}$/.test(statementMonthKey)
    && /^\d{4}-\d{2}$/.test(dreStartMonthKey)
    && statementMonthKey < dreStartMonthKey;
}

export function cardStatementAllocationIntegrity(
  allocations: Array<Pick<CardStatementAllocation, "lineId" | "amount" | "importFingerprint">>,
  officialTotal: number,
  creditTotal = 0,
) {
  const lineIds = allocations.map((allocation) => String(allocation.lineId || "")).filter(Boolean);
  const fingerprints = allocations.map((allocation) => String(allocation.importFingerprint || "")).filter(Boolean);
  const grossAllocatedTotal = Number(allocations.reduce((total, allocation) => total + Number(allocation.amount || 0), 0).toFixed(2));
  const normalizedCreditTotal = Number(Math.max(0, Number(creditTotal || 0)).toFixed(2));
  const allocatedTotal = Number((grossAllocatedTotal - normalizedCreditTotal).toFixed(2));
  const difference = Number((Number(officialTotal || 0) - allocatedTotal).toFixed(2));
  return {
    valid: new Set(lineIds).size === lineIds.length
      && new Set(fingerprints).size === fingerprints.length
      && Math.abs(difference) <= 0.05,
    allocatedTotal,
    grossAllocatedTotal,
    creditTotal: normalizedCreditTotal,
    difference,
    duplicateLineIds: lineIds.filter((lineId, index) => lineIds.indexOf(lineId) !== index),
    duplicateFingerprints: fingerprints.filter((fingerprint, index) => fingerprints.indexOf(fingerprint) !== index),
  };
}

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
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function dateAtDay(year: number, monthIndex: number, day: number) {
  const monthAnchor = new Date(Date.UTC(year, monthIndex, 1));
  const normalizedYear = monthAnchor.getUTCFullYear();
  const normalizedMonthIndex = monthAnchor.getUTCMonth();
  const normalizedDay = Math.min(day, daysInMonth(normalizedYear, normalizedMonthIndex));
  return financialDateFromIso([
    normalizedYear,
    String(normalizedMonthIndex + 1).padStart(2, "0"),
    String(normalizedDay).padStart(2, "0"),
  ].join("-"));
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
  const installment = installmentByNumber(line.expense, line.installmentNumber ?? null);
  const auditDisposition = installment
    ? installment?.cardStatementAuditDisposition
    : line.expense.cardStatementAuditDisposition;
  if (auditDisposition === "waived_before_dre_start") return [];
  return cardExpenseAuditIssues(line.expense);
}

export function cardStatementLineAuditStatus(line: CardStatementLine): CardStatementLineAuditStatus {
  if (line.reconciled) return "reconciled";
  const installment = installmentByNumber(line.expense, line.installmentNumber ?? null);
  const auditDisposition = installment
    ? installment?.cardStatementAuditDisposition
    : line.expense.cardStatementAuditDisposition;
  if (auditDisposition === "waived_before_dre_start") return "historical";
  return cardStatementLineAuditIssues(line).length === 0 ? "audited" : "pending";
}

function dateKey(value: unknown) {
  return financialDateKey(cardDateFromUnknown(value));
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
    ...(line.importFingerprint ? { importFingerprint: line.importFingerprint } : {}),
    ...(line.sourceReference ? { sourceReference: line.sourceReference } : {}),
  }));
}

export function resolveCardStatementCycle(
  chargeDate: Date,
  card: Pick<CreditCardInstrument, "accountId" | "methodId" | "closingDay" | "dueDay">
): CardStatementCycle {
  const closingDay = positiveDay(card.closingDay, 25);
  const dueDay = positiveDay(card.dueDay, 5);
  const chargeDateKey = financialDateKey(chargeDate);
  if (!chargeDateKey) throw new Error("Data da cobrança inválida.");
  const chargeYear = Number(chargeDateKey.slice(0, 4));
  const chargeMonthIndex = Number(chargeDateKey.slice(5, 7)) - 1;
  const currentClosingDate = dateAtDay(chargeYear, chargeMonthIndex, closingDay);
  const closesInCurrentMonth = chargeDate.getTime() <= currentClosingDate.getTime();
  const closingMonthOffset = closesInCurrentMonth ? 0 : 1;
  const closingDate = dateAtDay(
    chargeYear,
    chargeMonthIndex + closingMonthOffset,
    closingDay
  );
  const dueMonthOffset = dueDay <= closingDay ? 1 : 0;
  const closingMonthKey = financialMonthKey(closingDate);
  if (!closingMonthKey) throw new Error("Data de fechamento inválida.");
  const dueDate = dateAtDay(
    Number(closingMonthKey.slice(0, 4)),
    Number(closingMonthKey.slice(5, 7)) - 1 + dueMonthOffset,
    dueDay
  );
  const monthKey = financialMonthKey(dueDate);
  if (!monthKey) throw new Error("Data de vencimento inválida.");

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
  const dueMonthKey = financialMonthKey(dueDate);
  if (!dueMonthKey) throw new Error("Data de vencimento inválida.");
  const dueYear = Number(dueMonthKey.slice(0, 4));
  const dueMonthIndex = Number(dueMonthKey.slice(5, 7)) - 1;
  return {
    closingDate: dateAtDay(dueYear, dueMonthIndex + closingMonthOffset, closingDay),
    dueDate: dateAtDay(dueYear, dueMonthIndex, dueDay),
  };
}

function explicitCardStatementCycle(
  value: { cardStatementMonthKey?: unknown; cardStatementKey?: unknown },
  card: Pick<CreditCardInstrument, "accountId" | "methodId" | "closingDay" | "dueDay">
) {
  const explicitMonth = String(value.cardStatementMonthKey ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(explicitMonth)) {
    return resolveCardStatementCycleFromMonth(explicitMonth, card);
  }

  const statementKey = String(value.cardStatementKey ?? "").trim();
  const prefix = `${card.accountId}:${card.methodId}:`;
  const statementMonth = statementKey.startsWith(prefix) ? statementKey.slice(prefix.length) : "";
  return /^\d{4}-\d{2}$/.test(statementMonth)
    ? resolveCardStatementCycleFromMonth(statementMonth, card)
    : null;
}

function installmentCycleFromDueDate(
  dueDate: Date,
  card: Pick<CreditCardInstrument, "accountId" | "methodId" | "closingDay" | "dueDay">
) {
  const monthKey = financialMonthKey(dueDate);
  if (!monthKey) return null;
  return resolveCardStatementCycleFromMonth(monthKey, card);
}

function installmentByNumber(expense: CardExpenseEntry, installmentNumber: number | null | undefined) {
  if (!installmentNumber || !Array.isArray(expense.installments)) return null;
  return expense.installments.find(
    (installment, index) => (Number(installment.number) || index + 1) === installmentNumber,
  ) ?? null;
}

export function buildCardStatementLinesFromAllocations(
  allocations: CardStatementAllocation[],
  expenses: CardExpenseEntry[],
): CardStatementLine[] {
  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
  return allocations.map((allocation) => {
    const storedExpense = expenseById.get(allocation.expenseId);
    const expense: CardExpenseEntry = storedExpense ?? {
      id: allocation.expenseId,
      description: allocation.description,
      supplier: allocation.supplier,
      competenceDate: allocation.competenceDate,
      accountPlanId: allocation.accountPlanId,
      accountPlanName: allocation.accountPlanName,
      resultCenterId: allocation.resultCenterId,
      resultCenterName: allocation.resultCenterName,
      accountAllocations: allocation.accountAllocations,
      apportionments: allocation.apportionments,
    };
    const installment = installmentByNumber(expense, allocation.installmentNumber);
    const chargeDate = cardExpenseChargeDate(expense)
      ?? cardDateFromUnknown(allocation.competenceDate)
      ?? new Date(0);
    return {
      lineId: allocation.lineId,
      expense,
      chargeDate,
      value: Number(allocation.amount),
      reconciled: installment
        ? installment.cardReconciliationStatus === "reconciled"
        : expense.cardReconciliationStatus === "reconciled",
      installmentNumber: allocation.installmentNumber ?? undefined,
      installmentTotal: allocation.installmentNumber
        ? Number(expense.installmentTotal) || expense.installments?.length || undefined
        : undefined,
      importFingerprint: allocation.importFingerprint,
      sourceReference: allocation.sourceReference,
    };
  }).filter((line) => Number.isFinite(line.value) && line.value > 0);
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
    if (expense.cardStatementRevisionStatus === "removed") continue;
    if (expense.provisionType === "forecast" && (expense.status === "reconciled" || expense.replacedByExpenseId)) {
      continue;
    }
    const accountId = String(expense.plannedBankAccountId ?? "");
    const methodId = String(expense.plannedPaymentMethodId ?? "");
    const card = cardByKey.get(`${accountId}:${methodId}`);
    if (!card) continue;
    const storedCycle = explicitCardStatementCycle(expense, card);

    const installmentEntries =
      expense.paymentMethod === "installments" && Array.isArray(expense.installments) && expense.installments.length > 1
        ? expense.installments
          .map((installment, index) => ({ installment, index }))
          .filter(({ installment }) => installment.cardStatementRevisionStatus !== "removed")
          .map(({ installment, index }) => {
            const installmentDueDate = cardDateFromUnknown(installment.dueDate);
            return {
              lineId: `${expense.id}:installment:${Number(installment.number) || index + 1}`,
              chargeDate: cardExpenseChargeDate(expense) ?? installmentDueDate,
              cycle: explicitCardStatementCycle(installment, card)
                ?? (installmentDueDate ? installmentCycleFromDueDate(installmentDueDate, card) : null),
              value: Number(installment.value),
              reconciled: installment.cardReconciliationStatus === "reconciled",
              installmentNumber: Number(installment.number) || index + 1,
              installmentTotal: expense.installments!.length,
              importFingerprint: String(installment.cardStatementImportFingerprint || "") || undefined,
              sourceReference: undefined,
            };
          })
        : [{
            lineId: expense.id,
            chargeDate: cardExpenseChargeDate(expense),
            cycle: storedCycle,
            value: Number(expense.totalValue),
            reconciled: expense.cardReconciliationStatus === "reconciled",
            installmentNumber: undefined,
            installmentTotal: undefined,
            importFingerprint: String(expense.cardStatementImportFingerprint || "") || undefined,
            sourceReference: undefined,
          }];

    for (const entry of installmentEntries) {
      if (!entry.chargeDate || !Number.isFinite(entry.value) || entry.value <= 0) continue;
      const cycle = entry.cycle ?? resolveCardStatementCycle(entry.chargeDate, card);
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
        importFingerprint: entry.importFingerprint,
        sourceReference: entry.sourceReference,
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
