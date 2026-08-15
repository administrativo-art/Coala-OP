import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  interStatementSessionDocumentId,
  interStatementTransactionDocumentId,
  listInterStatementEntries,
  type InterStatementEntry,
} from "@/lib/integrations/inter/statements.server";
import {
  findUniqueExactExpenseMatch,
  type StatementExpenseMatchCandidate,
} from "@/features/financial/lib/inter-statement-reconciliation";

const TIME_ZONE = "America/Belem";
const SYSTEM_ACTOR = "system:inter-statement";
const SYNC_STATE_DOCUMENT = "inter-statement";

type PendingExpenseMatch = StatementExpenseMatchCandidate;

type ImportAliasData = {
  id: string;
  pattern: string;
  matchType: "contains" | "startsWith" | "endsWith" | "exact";
  caseSensitive: boolean;
  accountPlanId?: string;
  accountPlanName?: string;
  resultCenterId?: string;
  resultCenterName?: string;
  supplier?: string;
  descriptionOverride?: string;
};

type ExistingInterLedgerCandidate = {
  transactionId: string;
  direction: "in" | "out";
  amount: number;
  date: Date;
  description: string;
  expenseId?: string;
  installmentNumber?: number;
  references: string[];
};

type SyncResult = {
  startDate: string;
  endDate: string;
  received: number;
  inserted: number;
  duplicates: number;
  reconciledExisting: number;
  autoMatched: number;
  pendingAudit: number;
  sessionsUpdated: number;
};

function requiredSetting(name: string, fallbackName?: string) {
  const value = process.env[name]?.trim() || (fallbackName ? process.env[fallbackName]?.trim() : "");
  if (!value) throw new Error(`A configuração ${name} não foi informada.`);
  return value;
}

function dateInTimeZone(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(isoDate: string, amount: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function asDate(value: unknown) {
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function statementDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00-03:00`);
}

function aliasMatches(description: string, alias: ImportAliasData) {
  const haystack = alias.caseSensitive ? description : description.toLocaleLowerCase("pt-BR");
  const needle = alias.caseSensitive ? alias.pattern : alias.pattern.toLocaleLowerCase("pt-BR");
  if (!needle) return false;
  if (alias.matchType === "exact") return haystack === needle;
  if (alias.matchType === "startsWith") return haystack.startsWith(needle);
  if (alias.matchType === "endsWith") return haystack.endsWith(needle);
  return haystack.includes(needle);
}

function normalizedText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR");
}

function canAutoMatchExpense(entry: InterStatementEntry) {
  if (entry.amount >= 0) return false;
  const text = normalizedText(`${entry.description} ${entry.operationType} ${entry.transactionType}`);
  return !text.includes("FATURA") && !text.includes("ESTORNO") && !text.includes("DEVOLUCAO");
}

function findExistingLedgerMatch(
  entry: InterStatementEntry,
  candidates: ExistingInterLedgerCandidate[],
  claimedTransactions: Set<string>
) {
  const direction = entry.amount < 0 ? "out" : "in";
  const entryDate = statementDate(entry.date);
  const eligible = candidates.filter((candidate) =>
    !claimedTransactions.has(candidate.transactionId) && candidate.direction === direction
  );
  const direct = eligible.filter((candidate) =>
    candidate.references.some((reference) => entry.references.includes(reference))
  );
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) return null;

  const exact = eligible.filter((candidate) =>
    Math.abs(candidate.amount - Math.abs(entry.amount)) <= 0.05 &&
    Math.abs(candidate.date.getTime() - entryDate.getTime()) / 86_400_000 <= 2
  );
  return exact.length === 1 ? exact[0] : null;
}

function buildSummary(items: Array<{ status?: string }>) {
  return {
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    audited: items.filter((item) => item.status === "audited").length,
    ignored: items.filter((item) => item.status === "ignored").length,
    completed: items.filter((item) => item.status === "completed").length,
  };
}

function buildSessionItem(params: {
  entry: InterStatementEntry;
  transactionId: string;
  accountId: string;
  accountName: string;
  alias?: ImportAliasData;
  match?: PendingExpenseMatch | null;
  existingLedger?: ExistingInterLedgerCandidate | null;
}) {
  const { entry, transactionId, accountId, accountName, alias, match, existingLedger } = params;
  const isDebit = entry.amount < 0;
  const linkedExpenseId = match?.expenseId || existingLedger?.expenseId || "";
  const linkedExpenseDescription = match?.expenseDescription || existingLedger?.description || "";
  const linkedInstallmentNumber = match?.installmentNumber || existingLedger?.installmentNumber;
  const description = alias?.descriptionOverride || linkedExpenseDescription || entry.description;

  return {
    id: transactionId,
    origin: "bank_statement",
    syncSource: "inter_api",
    externalTransactionId: entry.externalId,
    linkedBankTransactionId: transactionId,
    date: entry.date,
    amount: entry.amount,
    rawDescription: entry.description,
    matchedAliasId: alias?.id || null,
    suggestedExpenseId: linkedExpenseId || null,
    suggestedExpenseDescription: linkedExpenseDescription || null,
    suggestedInstallmentNumber: linkedInstallmentNumber || null,
    suggestedInstallmentValue: match?.value || (existingLedger ? Math.abs(entry.amount) : null),
    suggestedConfidence: match || existingLedger ? "high" : null,
    expenseDraft: {
      mode: linkedExpenseId ? "existing" : "new",
      linkedExpenseId,
      purchaseOrderId: "",
      purchaseLinkMode: "goods",
      allocatedAmount: Math.abs(entry.amount),
      description,
      supplier: alias?.supplier || "",
      accountPlanId: alias?.accountPlanId || "",
      accountPlanName: alias?.accountPlanName || "",
      isApportioned: false,
      resultCenterId: alias?.resultCenterId || "",
      resultCenterName: alias?.resultCenterName || "",
      apportionments: [],
      splitExpenses: [],
      competenceDate: `${entry.date.slice(0, 7)}-01`,
      notes: `Sincronizado automaticamente do Banco Inter: ${entry.description}`,
    },
    financialDraft: {
      movementKind: "standard",
      date: entry.date,
      description,
      accountId,
      accountName,
      paymentMethodId: "",
      paymentMethodLabel: "Banco Inter",
      counterpartyAccountId: "",
      counterpartyAccountName: "",
      counterpartyPaymentMethodId: "",
      counterpartyPaymentMethodLabel: "",
      notes: entry.description,
    },
    status: match || existingLedger || !isDebit ? "completed" : "pending",
  };
}

async function loadPendingExpenseMatches() {
  const snapshot = await financialDbAdmin.collection("expenses").where("status", "==", "pending").get();
  return snapshot.docs.flatMap((document): PendingExpenseMatch[] => {
    const expense = document.data();
    if (expense.originModule === "purchasing") return [];
    const installments = Array.isArray(expense.installments)
      ? expense.installments.filter(
          (installment: Record<string, unknown>) =>
            installment.status !== "paid" &&
            installment.status !== "cancelled" &&
            Number(installment.value) > 0
        )
      : [];

    if (installments.length > 0) {
      return installments.flatMap((installment: Record<string, unknown>, index: number) => {
        const dueDate = asDate(installment.dueDate) || asDate(expense.dueDate);
        if (!dueDate) return [];
        return [{
          expenseId: document.id,
          expenseDescription: String(expense.description || "Despesa"),
          installmentNumber: Number(installment.number) || index + 1,
          dueDate,
          value: Number(installment.value) || 0,
        }];
      });
    }

    const dueDate = asDate(expense.dueDate);
    const value = Number(expense.totalValue) || 0;
    if (!dueDate || value <= 0) return [];
    return [{
      expenseId: document.id,
      expenseDescription: String(expense.description || "Despesa"),
      installmentNumber: typeof expense.installmentNumber === "number" ? expense.installmentNumber : undefined,
      dueDate,
      value,
    }];
  });
}

async function loadAliases() {
  const snapshot = await financialDbAdmin.collection("importAliases").get();
  return snapshot.docs.map((document): ImportAliasData => {
    const alias = document.data();
    return {
      id: document.id,
      pattern: String(alias.pattern || ""),
      matchType: alias.matchType === "exact" || alias.matchType === "startsWith" || alias.matchType === "endsWith"
        ? alias.matchType
        : "contains",
      caseSensitive: alias.caseSensitive === true,
      accountPlanId: alias.accountPlanId || undefined,
      accountPlanName: alias.accountPlanName || undefined,
      resultCenterId: alias.resultCenterId || undefined,
      resultCenterName: alias.resultCenterName || undefined,
      supplier: alias.supplier || undefined,
      descriptionOverride: alias.descriptionOverride || undefined,
    };
  });
}

async function loadExistingInterLedgerCandidates() {
  const [paymentTransactions, depositTransactions] = await Promise.all([
    financialDbAdmin.collection("transactions").where("createdBy", "==", "bank-reconciliation").get(),
    financialDbAdmin.collection("transactions").where("createdBy", "==", "inter-reconciliation").get(),
  ]);
  const documents = new Map(
    [...paymentTransactions.docs, ...depositTransactions.docs].map((document) => [document.id, document])
  );

  return [...documents.values()].flatMap((document): ExistingInterLedgerCandidate[] => {
    const data = document.data();
    if (data.externalTransactionId || (Array.isArray(data.externalTransactionIds) && data.externalTransactionIds.length > 0)) {
      return [];
    }
    const date = asDate(data.date || data.paidAt || data.createdAt);
    const amount = Number(data.amount) || 0;
    if (!date || amount <= 0) return [];
    const inferredDirection = data.direction === "in" || data.type === "transfer_in" ? "in" : "out";
    const references = [
      data.codigoSolicitacao,
      data.interRequestId,
      data.endToEndId,
      data.paymentRequestId,
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return [{
      transactionId: document.id,
      direction: inferredDirection,
      amount,
      date,
      description: String(data.description || "Movimentação Banco Inter"),
      expenseId: typeof data.expenseId === "string" ? data.expenseId : undefined,
      installmentNumber: typeof data.installmentNumber === "number" ? data.installmentNumber : undefined,
      references,
    }];
  });
}

async function registerEntry(params: {
  entry: InterStatementEntry;
  accountId: string;
  accountName: string;
  alias?: ImportAliasData;
  match?: PendingExpenseMatch | null;
  existingLedger?: ExistingInterLedgerCandidate | null;
}) {
  const { entry, accountId, accountName, alias, match, existingLedger } = params;
  const transactionId = interStatementTransactionDocumentId(accountId, entry.externalId);
  const transactionRef = financialDbAdmin.collection("transactions").doc(transactionId);
  const eventRef = financialDbAdmin.collection("bankStatementEvents").doc(transactionId);

  return financialDbAdmin.runTransaction(async (transaction) => {
    const existingEvent = await transaction.get(eventRef);
    if (existingEvent.exists) {
      return {
        inserted: false,
        matched: existingEvent.get("reconciliationMode") === "expense_auto_match",
        reconciledExisting: existingEvent.get("reconciliationMode") === "existing_inter_ledger",
        transactionId: String(existingEvent.get("linkedTransactionId") || transactionId),
      };
    }

    if (existingLedger) {
      const linkedTransactionRef = financialDbAdmin.collection("transactions").doc(existingLedger.transactionId);
      const linkedTransaction = await transaction.get(linkedTransactionRef);
      if (linkedTransaction.exists) {
        transaction.set(linkedTransactionRef, {
          importedFrom: linkedTransaction.get("importedFrom") || "bank_statement",
          importSource: "inter_api",
          externalTransactionId: entry.externalId,
          externalTransactionIds: FieldValue.arrayUnion(entry.externalId),
          rawBankDescription: entry.description,
          bankOperationType: entry.operationType || null,
          bankTransactionType: entry.transactionType || null,
          auditStatus: "resolved",
          bankReconciledAt: Timestamp.now(),
        }, { merge: true });
        transaction.create(eventRef, {
          provider: "inter",
          accountId,
          externalTransactionId: entry.externalId,
          date: Timestamp.fromDate(statementDate(entry.date)),
          direction: entry.amount < 0 ? "out" : "in",
          amount: Math.abs(entry.amount),
          description: entry.description,
          linkedTransactionId: existingLedger.transactionId,
          linkedExpenseId: existingLedger.expenseId || null,
          reconciliationMode: "existing_inter_ledger",
          createdAt: Timestamp.now(),
          createdBy: SYSTEM_ACTOR,
        });
        return {
          inserted: true,
          matched: false,
          reconciledExisting: true,
          transactionId: existingLedger.transactionId,
          appliedLedger: existingLedger,
        };
      }
    }

    const existingTransaction = await transaction.get(transactionRef);
    if (existingTransaction.exists) {
      transaction.create(eventRef, {
        provider: "inter",
        accountId,
        externalTransactionId: entry.externalId,
        linkedTransactionId: transactionId,
        reconciliationMode: "existing_statement_transaction",
        createdAt: Timestamp.now(),
        createdBy: SYSTEM_ACTOR,
      });
      return { inserted: false, matched: Boolean(existingTransaction.get("autoMatched")), reconciledExisting: false, transactionId };
    }

    const eventDate = Timestamp.fromDate(statementDate(entry.date));
    let appliedMatch = match || null;
    if (appliedMatch) {
      const expenseRef = financialDbAdmin.collection("expenses").doc(appliedMatch.expenseId);
      const expenseSnapshot = await transaction.get(expenseRef);
      if (!expenseSnapshot.exists || expenseSnapshot.get("status") !== "pending") {
        appliedMatch = null;
      } else {
        const expense = expenseSnapshot.data() || {};
        const installments = Array.isArray(expense.installments) ? expense.installments : [];
        if (installments.length > 0 && appliedMatch.installmentNumber) {
          const nextInstallments = installments.map((installment: Record<string, unknown>, index: number) =>
            (Number(installment.number) || index + 1) === appliedMatch?.installmentNumber
              ? {
                  ...installment,
                  status: "paid",
                  paidAt: eventDate,
                  linkedBankTransactionId: transactionId,
                }
              : installment
          );
          const fullyPaid = nextInstallments.every(
            (installment: Record<string, unknown>) => installment.status === "paid" || installment.status === "cancelled"
          );
          transaction.set(expenseRef, {
            installments: nextInstallments,
            linkedBankTransactionId: transactionId,
            linkedBankTransactionIds: FieldValue.arrayUnion(transactionId),
            lastPaymentAt: eventDate,
            paidByImport: true,
            importedFrom: "inter_api",
            updatedAt: Timestamp.now(),
            ...(fullyPaid ? { status: "paid", paidAt: eventDate } : {}),
          }, { merge: true });
        } else {
          transaction.set(expenseRef, {
            status: "paid",
            paidAt: eventDate,
            linkedBankTransactionId: transactionId,
            linkedBankTransactionIds: FieldValue.arrayUnion(transactionId),
            paidByImport: true,
            importedFrom: "inter_api",
            updatedAt: Timestamp.now(),
          }, { merge: true });
        }
      }
    }

    const resolvedDescription = alias?.descriptionOverride || appliedMatch?.expenseDescription || entry.description;
    transaction.create(transactionRef, {
      type: entry.amount < 0 ? "expense_payment" : "revenue",
      direction: entry.amount < 0 ? "out" : "in",
      amount: Math.abs(entry.amount),
      date: eventDate,
      description: resolvedDescription,
      notes: "Sincronizado automaticamente pela API do Banco Inter.",
      accountId,
      accountName,
      paymentMethodId: null,
      paymentMethodLabel: "Banco Inter",
      accountPlanId: alias?.accountPlanId || null,
      accountPlanName: alias?.accountPlanName || null,
      resultCenterId: alias?.resultCenterId || null,
      resultCenterName: alias?.resultCenterName || null,
      supplier: alias?.supplier || null,
      expenseId: appliedMatch?.expenseId || null,
      linkedExpenseId: appliedMatch?.expenseId || null,
      installmentNumber: appliedMatch?.installmentNumber || null,
      importedFrom: "bank_statement",
      importSource: "inter_api",
      externalTransactionId: entry.externalId,
      rawBankDescription: entry.description,
      bankOperationType: entry.operationType || null,
      bankTransactionType: entry.transactionType || null,
      auditStatus: appliedMatch || entry.amount >= 0 ? "resolved" : "pending",
      autoMatched: Boolean(appliedMatch),
      autoMatchConfidence: appliedMatch ? "high" : null,
      createdBy: SYSTEM_ACTOR,
      createdAt: Timestamp.now(),
    });
    transaction.create(eventRef, {
      provider: "inter",
      accountId,
      externalTransactionId: entry.externalId,
      date: eventDate,
      direction: entry.amount < 0 ? "out" : "in",
      amount: Math.abs(entry.amount),
      description: entry.description,
      linkedTransactionId: transactionId,
      linkedExpenseId: appliedMatch?.expenseId || null,
      reconciliationMode: appliedMatch ? "expense_auto_match" : "statement_entry",
      createdAt: Timestamp.now(),
      createdBy: SYSTEM_ACTOR,
    });

    return { inserted: true, matched: Boolean(appliedMatch), reconciledExisting: false, transactionId, appliedMatch };
  });
}

async function updateMonthlySession(params: {
  month: string;
  accountId: string;
  accountName: string;
  items: Record<string, unknown>[];
}) {
  const { month, accountId, accountName, items } = params;
  const sessionRef = financialDbAdmin.collection("importDrafts").doc(interStatementSessionDocumentId(accountId, month));
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(sessionRef);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const currentItems = Array.isArray(current.items) ? current.items : [];
    const knownIds = new Set(currentItems.map((item: Record<string, unknown>) => String(item.externalTransactionId || item.id || "")));
    const appended = items.filter((item) => !knownIds.has(String(item.externalTransactionId || item.id || "")));
    if (snapshot.exists && appended.length === 0) return;

    const nextItems = [...currentItems, ...appended].sort((left, right) =>
      String((left as Record<string, unknown>).date || "").localeCompare(String((right as Record<string, unknown>).date || ""))
    );
    const summary = buildSummary(nextItems);
    const [year, monthNumber] = month.split("-");
    const now = Timestamp.now();
    transaction.set(sessionRef, {
      origin: "bank_statement",
      originLabel: "Sincronização Banco Inter",
      syncSource: "inter_api",
      syncKey: `${accountId}:${month}`,
      displayName: `Banco Inter · ${monthNumber}/${year}`,
      fileName: `inter-api-${month}`,
      fileType: "manual",
      bankProfile: "inter",
      statementAccountId: accountId,
      statementAccountName: accountName,
      createdBy: current.createdBy || SYSTEM_ACTOR,
      createdByName: current.createdByName || "Banco Inter",
      status: summary.pending > 0 ? "open" : "completed",
      items: nextItems,
      summary,
      createdAt: current.createdAt || now,
      updatedAt: now,
      completedAt: summary.pending > 0 ? null : now,
      lastSyncedAt: now,
    }, { merge: true });
  });
}

function initialLookbackDays() {
  const configured = Number(process.env.INTER_STATEMENT_INITIAL_LOOKBACK_DAYS || 7);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 89 ? configured : 7;
}

export async function syncInterStatement(): Promise<SyncResult> {
  const accountId = requiredSetting("INTER_STATEMENT_BANK_ACCOUNT_ID", "INTER_COBRANCA_BANK_ACCOUNT_ID");
  const accountSnapshot = await financialDbAdmin.collection("bankAccounts").doc(accountId).get();
  if (!accountSnapshot.exists) throw new Error("A conta financeira vinculada ao extrato do Inter não foi encontrada.");
  const accountName = String(accountSnapshot.get("name") || "Banco Inter");
  const stateRef = financialDbAdmin.collection("integrationState").doc(SYNC_STATE_DOCUMENT);
  const stateSnapshot = await stateRef.get();
  const endDate = dateInTimeZone();
  const lastSuccessfulSyncAt = asDate(stateSnapshot.get("lastSuccessfulSyncAt"));
  const startDate = lastSuccessfulSyncAt
    ? addDays(dateInTimeZone(lastSuccessfulSyncAt), -3)
    : addDays(endDate, -initialLookbackDays());
  const boundedStartDate = startDate < addDays(endDate, -89) ? addDays(endDate, -89) : startDate;

  const [entries, candidates, aliases, existingLedgerCandidates] = await Promise.all([
    listInterStatementEntries(boundedStartDate, endDate),
    loadPendingExpenseMatches(),
    loadAliases(),
    loadExistingInterLedgerCandidates(),
  ]);
  const claimed = new Set<string>();
  const claimedLedgerTransactions = new Set<string>();
  const sessionItems = new Map<string, Record<string, unknown>[]>();
  let inserted = 0;
  let duplicates = 0;
  let reconciledExisting = 0;
  let autoMatched = 0;
  let pendingAudit = 0;

  for (const entry of entries) {
    const existingLedger = findExistingLedgerMatch(entry, existingLedgerCandidates, claimedLedgerTransactions);
    const match = existingLedger || !canAutoMatchExpense(entry)
      ? null
      : findUniqueExactExpenseMatch(entry, candidates, claimed);
    const alias = aliases.find((candidate) => aliasMatches(entry.description, candidate));
    const result = await registerEntry({ entry, accountId, accountName, alias, match, existingLedger });
    if (!result.inserted) {
      duplicates += 1;
      continue;
    }

    inserted += 1;
    if (result.reconciledExisting && existingLedger) {
      reconciledExisting += 1;
      claimedLedgerTransactions.add(existingLedger.transactionId);
    }
    if (result.matched && result.appliedMatch) {
      autoMatched += 1;
      claimed.add(`${result.appliedMatch.expenseId}:${result.appliedMatch.installmentNumber ?? 0}`);
    } else if (!result.reconciledExisting && entry.amount < 0) {
      pendingAudit += 1;
    }

    const month = entry.date.slice(0, 7);
    const items = sessionItems.get(month) || [];
    items.push(buildSessionItem({
      entry,
      transactionId: result.transactionId,
      accountId,
      accountName,
      alias,
      match: result.matched ? result.appliedMatch : null,
      existingLedger: result.reconciledExisting ? existingLedger : null,
    }));
    sessionItems.set(month, items);
  }

  for (const [month, items] of sessionItems) {
    await updateMonthlySession({ month, accountId, accountName, items });
  }

  await stateRef.set({
    provider: "inter",
    accountId,
    accountName,
    lastAttemptAt: Timestamp.now(),
    lastSuccessfulSyncAt: Timestamp.now(),
    lastRangeStart: boundedStartDate,
    lastRangeEnd: endDate,
    lastReceived: entries.length,
    lastInserted: inserted,
    lastDuplicates: duplicates,
    lastReconciledExisting: reconciledExisting,
    lastAutoMatched: autoMatched,
    lastPendingAudit: pendingAudit,
    updatedBy: SYSTEM_ACTOR,
  }, { merge: true });

  return {
    startDate: boundedStartDate,
    endDate,
    received: entries.length,
    inserted,
    duplicates,
    reconciledExisting,
    autoMatched,
    pendingAudit,
    sessionsUpdated: sessionItems.size,
  };
}
