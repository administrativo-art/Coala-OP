"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDoc, doc, getDoc, increment, Timestamp, updateDoc } from "firebase/firestore";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Trash2,
  ChevronsUpDown,
  FileUp,
  FolderOpen,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Save,
  SkipForward,
  Plus,
  PlusCircle,
  Upload,
  UserCircle2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useEntities } from "@/hooks/use-entities";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { expenseDescriptionFormSchema } from "@/features/financial/lib/schemas";
import { usePurchaseFinancials } from "@/hooks/use-purchase-financials";
import { usePurchaseOrders } from "@/hooks/use-purchase-orders";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { AccountPlanTreeSelect } from "@/components/purchasing/account-plan-tree-select";
import { ResultCenterSelect } from "@/components/purchasing/result-center-select";
import { applyAliasesAndMatch, type PendingInstallment } from "@/features/financial/lib/import-matcher";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { parseCSV, CSV_BANK_PROFILES } from "@/features/financial/lib/parsers/csv";
import { parseOFX } from "@/features/financial/lib/parsers/ofx";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import type { Account } from "@/features/financial/types/account";
import type {
  ImportSession,
  ImportSessionExpenseMode,
  ImportSessionItem,
  ImportSessionItemStatus,
  ImportSessionOrigin,
  ImportSessionPurchaseLinkMode,
  ImportSessionSummary,
  ImportedTransaction,
  ParsedBankEntry,
} from "@/features/financial/types/import";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { getUserDisplayName } from "@/lib/user-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/firebase";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { cn } from "@/lib/utils";
import type { PurchaseFinancial, PurchaseOrder } from "@/types";

type PurchaseCandidate = {
  orderId: string;
  linkedExpenseId: string;
  financialId: string;
  label: string;
  supplierName: string;
  dueDate: string;
  totalEstimated: number;
  goodsAmountEstimated: number;
  freightAmountEstimated: number;
  goodsAmountPaid: number;
  freightAmountPaid: number;
  goodsPending: number;
  freightPending: number;
  freightPaymentMode: "included_with_goods" | "separate" | null;
  goodsAccountPlanId: string;
  goodsAccountPlanName: string;
  freightAccountPlanId: string;
  freightAccountPlanName: string;
  resultCenterId: string;
  resultCenterName: string;
};

const PURCHASE_LINK_MODE_LABELS: Record<ImportSessionPurchaseLinkMode, string> = {
  goods: "Mercadoria",
  freight: "Frete",
  combined: "Mercadoria + frete",
};

const IMPORT_SESSION_ORIGIN_LABELS: Record<ImportSessionOrigin, string> = {
  bank_statement: "Importação de extrato",
  ai_assisted: "Populado pela IA",
  manual: "Manual",
  other: "Outra origem",
};

const IMPORT_SESSION_ORIGIN_CLASSES: Record<ImportSessionOrigin, string> = {
  bank_statement: "border-blue-200 bg-blue-50 text-blue-700",
  ai_assisted: "border-amber-200 bg-amber-50 text-amber-700",
  manual: "border-zinc-200 bg-zinc-50 text-zinc-700",
  other: "border-slate-200 bg-slate-50 text-slate-700",
};

function getImportSessionOrigin(value: unknown): ImportSessionOrigin {
  return value === "ai_assisted" || value === "manual" || value === "other" || value === "bank_statement"
    ? value
    : "bank_statement";
}

function getImportedFromValue(session: ImportSession) {
  return session.origin === "ai_assisted" ? "ai_assisted" : session.origin === "manual" ? "manual" : "bank_statement";
}

function getRevenueSourceValue(session: ImportSession) {
  return session.origin === "ai_assisted" ? "ai_assisted" : session.origin === "manual" ? "manual" : "bank_statement";
}

function buildExpenseOptionLabel(expense: any) {
  const dueDate = toDate(expense.dueDate);
  const suffix = dueDate ? format(dueDate, "dd/MM/yyyy", { locale: ptBR }) : "sem data";
  const supplier = expense.supplier ? ` • ${expense.supplier}` : "";
  return `${expense.description}${supplier} • ${formatCurrency(expense.totalValue || 0)} • ${suffix}`;
}

function toInputDate(value: Date) {
  return format(value, "yyyy-MM-dd");
}

function formatInputDate(value?: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "dd/MM/yyyy", { locale: ptBR });
}

function formatLooseDate(value?: string) {
  if (!value) return "—";
  const date = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "dd/MM/yyyy", { locale: ptBR });
}

function formatSessionNameDate(value: Date) {
  return format(value, "dd/MM/yyyy", { locale: ptBR });
}

function getTransactionPrimaryDescription(item: ImportSessionItem) {
  const description = item.financialDraft.description || item.suggestedExpenseDescription || item.expenseDraft.description || item.rawDescription;
  return description.replace(/\s+/g, " ").trim();
}

function getTransactionKindLabel(item: ImportSessionItem) {
  if (item.financialDraft.movementKind === "transfer") return "Transferência";
  if (item.amount >= 0) return "Receita";
  if (item.expenseDraft.mode === "purchase") return "Compra";
  if (item.expenseDraft.mode === "split") return "Dividida";
  return "Despesa";
}

function getTransactionKindClassName(item: ImportSessionItem) {
  if (item.financialDraft.movementKind === "transfer") return "bg-sky-100 text-sky-700";
  if (item.amount >= 0) return "bg-emerald-100 text-emerald-700";
  if (item.expenseDraft.mode === "purchase") return "bg-blue-100 text-blue-700";
  if (item.expenseDraft.mode === "split") return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

const IMPORT_ITEM_STATUS_META: Record<
  ImportSessionItemStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pendente",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  audited: {
    label: "Auditada",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  completed: {
    label: "Efetivada",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  ignored: {
    label: "Ignorada",
    className: "border-zinc-200 bg-zinc-100 text-zinc-600",
  },
};

function inferStatementPaymentMethod(item: ImportSessionItem, accounts: Account[]) {
  if (item.financialDraft.paymentMethodId) return null;
  const account = accounts.find((entry) => entry.id === item.financialDraft.accountId);
  if (!account) return null;

  const text = `${item.rawDescription} ${item.financialDraft.description}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR");
  const expectedType = text.includes("PIX")
    ? "pix"
    : /CARTAO.*CREDITO|FATURA/.test(text)
    ? "credit_card"
    : /CARTAO.*DEBITO/.test(text)
    ? "debit_card"
    : /TRANSFERENCIA|\bTED\b|\bDOC\b/.test(text)
    ? "transfer"
    : /SAQUE|DINHEIRO/.test(text)
    ? "cash"
    : null;
  if (!expectedType) return null;

  return account.paymentMethods.find((method) => method.type === expectedType) ?? null;
}

function applyStatementPaymentMethodSuggestions(session: ImportSession, accounts: Account[]) {
  return {
    ...session,
    items: session.items.map((item) => {
      const method = inferStatementPaymentMethod(item, accounts);
      if (!method) return item;
      return {
        ...item,
        financialDraft: {
          ...item.financialDraft,
          paymentMethodId: method.id,
          paymentMethodLabel: method.label,
        },
      };
    }),
  };
}

function createDraftId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createApportionmentEntry(overrides?: Partial<ImportSessionItem["expenseDraft"]["apportionments"][number]>) {
  return {
    id: createDraftId("apportion"),
    resultCenterId: "",
    resultCenterName: "",
    percentage: 0,
    ...overrides,
  };
}

function createSplitExpenseEntry(overrides?: Partial<ImportSessionItem["expenseDraft"]["splitExpenses"][number]>) {
  return {
    id: createDraftId("split-expense"),
    description: "",
    supplier: "",
    accountPlanId: "",
    accountPlanName: "",
    resultCenterId: "",
    resultCenterName: "",
    competenceDate: "",
    value: 0,
    ...overrides,
  };
}

const ACCOUNT_GROUP_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#eab308",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }

  if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof Timestamp)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefinedDeep(entry)])
    ) as T;
  }

  return value;
}

function serializeSessionItem(item: ImportSessionItem) {
  return {
    id: item.id,
    origin: item.origin ?? null,
    syncSource: item.syncSource ?? null,
    externalTransactionId: item.externalTransactionId ?? null,
    linkedBankTransactionId: item.linkedBankTransactionId ?? null,
    date: item.date,
    amount: item.amount,
    rawDescription: item.rawDescription,
    matchedAliasId: item.matchedAliasId ?? null,
    suggestedExpenseId: item.suggestedExpenseId ?? null,
    suggestedExpenseDescription: item.suggestedExpenseDescription ?? null,
    suggestedInstallmentNumber: item.suggestedInstallmentNumber ?? null,
    suggestedInstallmentValue: item.suggestedInstallmentValue ?? null,
    suggestedConfidence: item.suggestedConfidence ?? null,
    expenseDraft: {
      mode: item.expenseDraft.mode,
      linkedExpenseId: item.expenseDraft.linkedExpenseId,
      purchaseOrderId: item.expenseDraft.purchaseOrderId,
      purchaseLinkMode: item.expenseDraft.purchaseLinkMode,
      allocatedAmount: item.expenseDraft.allocatedAmount,
      description: item.expenseDraft.description,
      supplier: item.expenseDraft.supplier,
      accountPlanId: item.expenseDraft.accountPlanId,
      accountPlanName: item.expenseDraft.accountPlanName,
      isApportioned: item.expenseDraft.isApportioned,
      resultCenterId: item.expenseDraft.resultCenterId,
      resultCenterName: item.expenseDraft.resultCenterName,
      apportionments: item.expenseDraft.apportionments.map((entry) => ({
        id: entry.id,
        resultCenterId: entry.resultCenterId,
        resultCenterName: entry.resultCenterName,
        percentage: entry.percentage,
      })),
      splitExpenses: item.expenseDraft.splitExpenses.map((entry) => ({
        id: entry.id,
        description: entry.description,
        supplier: entry.supplier,
        accountPlanId: entry.accountPlanId,
        accountPlanName: entry.accountPlanName,
        resultCenterId: entry.resultCenterId,
        resultCenterName: entry.resultCenterName,
        competenceDate: entry.competenceDate,
        value: entry.value,
      })),
      competenceDate: item.expenseDraft.competenceDate,
      notes: item.expenseDraft.notes,
    },
    financialDraft: {
      movementKind: item.financialDraft.movementKind,
      date: item.financialDraft.date,
      description: item.financialDraft.description,
      accountId: item.financialDraft.accountId,
      accountName: item.financialDraft.accountName,
      paymentMethodId: item.financialDraft.paymentMethodId,
      paymentMethodLabel: item.financialDraft.paymentMethodLabel,
      counterpartyAccountId: item.financialDraft.counterpartyAccountId,
      counterpartyAccountName: item.financialDraft.counterpartyAccountName,
      counterpartyPaymentMethodId: item.financialDraft.counterpartyPaymentMethodId,
      counterpartyPaymentMethodLabel: item.financialDraft.counterpartyPaymentMethodLabel,
      notes: item.financialDraft.notes,
    },
    status: item.status,
  };
}

function serializeSessionItems(items: ImportSessionItem[]) {
  return items.map(serializeSessionItem);
}

function buildSessionSummary(items: ImportSessionItem[]): ImportSessionSummary {
  return {
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    audited: items.filter((item) => item.status === "audited").length,
    ignored: items.filter((item) => item.status === "ignored").length,
    completed: items.filter((item) => item.status === "completed").length,
  };
}

function createSessionItem(transaction: ImportedTransaction): ImportSessionItem {
  const competenceDate = format(transaction.date, "yyyy-MM-01");
  const canPrelinkPayment =
    transaction.suggestedConfidence === "high" && !!transaction.suggestedExpenseId;
  const preferredDescription = transaction.matchedAliasId
    ? transaction.description || transaction.suggestedExpenseDescription || transaction.rawDescription
    : transaction.suggestedExpenseDescription || transaction.description || transaction.rawDescription;

  return {
    id: transaction.tempId,
    origin: "bank_statement",
    date: toInputDate(transaction.date),
    amount: transaction.amount,
    rawDescription: transaction.rawDescription,
    matchedAliasId: transaction.matchedAliasId,
    suggestedExpenseId: transaction.suggestedExpenseId,
    suggestedExpenseDescription: transaction.suggestedExpenseDescription,
    suggestedInstallmentNumber: transaction.suggestedInstallmentNumber,
    suggestedInstallmentValue: transaction.suggestedInstallmentValue,
    suggestedConfidence: transaction.suggestedConfidence,
    expenseDraft: {
      mode: transaction.linkedExpenseId || transaction.suggestedExpenseId ? "existing" : "new",
      linkedExpenseId: transaction.linkedExpenseId || (canPrelinkPayment ? transaction.suggestedExpenseId : "") || "",
      purchaseOrderId: "",
      purchaseLinkMode: "goods",
      allocatedAmount: Math.abs(transaction.amount),
      description: transaction.suggestedExpenseDescription || preferredDescription,
      supplier: transaction.supplier,
      accountPlanId: transaction.accountPlanId,
      accountPlanName: transaction.accountPlanName,
      isApportioned: false,
      resultCenterId: transaction.resultCenterId,
      resultCenterName: transaction.resultCenterName,
      apportionments: [],
      splitExpenses: [],
      competenceDate,
      notes: transaction.rawDescription,
    },
    financialDraft: {
      movementKind: transaction.amount >= 0 ? "standard" : "standard",
      date: toInputDate(transaction.date),
      description: preferredDescription,
      accountId: "",
      accountName: "",
      paymentMethodId: "",
      paymentMethodLabel: "",
      counterpartyAccountId: "",
      counterpartyAccountName: "",
      counterpartyPaymentMethodId: "",
      counterpartyPaymentMethodLabel: "",
      notes: transaction.rawDescription,
    },
    status: "pending",
  };
}

function normalizeSession(doc: any): ImportSession {
  const origin = getImportSessionOrigin(doc.origin);
  const items = Array.isArray(doc.items)
    ? (doc.items as any[]).map((item): ImportSessionItem => {
        const mode: ImportSessionExpenseMode =
          item.expenseDraft?.mode === "existing"
            ? "existing"
            : item.expenseDraft?.mode === "purchase"
            ? "purchase"
            : item.expenseDraft?.mode === "split"
            ? "split"
            : "new";
        const status: ImportSessionItemStatus =
          item.status === "audited" || item.status === "ignored" || item.status === "completed"
            ? item.status
            : "pending";

        return {
          id: String(item.id ?? ""),
          origin: item.origin ? getImportSessionOrigin(item.origin) : origin,
          syncSource: item.syncSource === "inter_api" ? "inter_api" : undefined,
          externalTransactionId: item.externalTransactionId ? String(item.externalTransactionId) : undefined,
          linkedBankTransactionId: item.linkedBankTransactionId ? String(item.linkedBankTransactionId) : undefined,
          date: String(item.date ?? ""),
          amount: Number(item.amount ?? 0),
          rawDescription: String(item.rawDescription ?? ""),
          matchedAliasId: item.matchedAliasId || undefined,
          suggestedExpenseId: item.suggestedExpenseId || undefined,
          suggestedExpenseDescription: item.suggestedExpenseDescription || undefined,
          suggestedInstallmentNumber:
            typeof item.suggestedInstallmentNumber === "number" ? item.suggestedInstallmentNumber : undefined,
          suggestedInstallmentValue:
            typeof item.suggestedInstallmentValue === "number" ? item.suggestedInstallmentValue : undefined,
          suggestedConfidence:
            item.suggestedConfidence === "high" || item.suggestedConfidence === "medium"
              ? item.suggestedConfidence
              : undefined,
          expenseDraft: {
            mode,
            linkedExpenseId: String(item.expenseDraft?.linkedExpenseId ?? ""),
            purchaseOrderId: String(item.expenseDraft?.purchaseOrderId ?? ""),
            purchaseLinkMode:
              item.expenseDraft?.purchaseLinkMode === "freight" || item.expenseDraft?.purchaseLinkMode === "combined"
                ? item.expenseDraft.purchaseLinkMode
                : "goods",
            allocatedAmount: Number(item.expenseDraft?.allocatedAmount ?? Math.abs(Number(item.amount ?? 0))),
            description: String(item.expenseDraft?.description ?? ""),
            supplier: String(item.expenseDraft?.supplier ?? ""),
            accountPlanId: String(item.expenseDraft?.accountPlanId ?? ""),
            accountPlanName: String(item.expenseDraft?.accountPlanName ?? ""),
            isApportioned: Boolean(item.expenseDraft?.isApportioned),
            resultCenterId: String(item.expenseDraft?.resultCenterId ?? ""),
            resultCenterName: String(item.expenseDraft?.resultCenterName ?? ""),
            apportionments: Array.isArray(item.expenseDraft?.apportionments)
              ? item.expenseDraft.apportionments.map((entry: any) => ({
                  id: String(entry?.id ?? createDraftId("apportion")),
                  resultCenterId: String(entry?.resultCenterId ?? ""),
                  resultCenterName: String(entry?.resultCenterName ?? ""),
                  percentage: Number(entry?.percentage ?? 0),
                }))
              : [],
            splitExpenses: Array.isArray(item.expenseDraft?.splitExpenses)
              ? item.expenseDraft.splitExpenses.map((entry: any) =>
                  createSplitExpenseEntry({
                    id: String(entry?.id ?? createDraftId("split-expense")),
                    description: String(entry?.description ?? ""),
                    supplier: String(entry?.supplier ?? ""),
                    accountPlanId: String(entry?.accountPlanId ?? ""),
                    accountPlanName: String(entry?.accountPlanName ?? ""),
                    resultCenterId: String(entry?.resultCenterId ?? ""),
                    resultCenterName: String(entry?.resultCenterName ?? ""),
                    competenceDate: String(entry?.competenceDate ?? ""),
                    value: Number(entry?.value ?? 0),
                  })
                )
              : [],
            competenceDate: String(item.expenseDraft?.competenceDate ?? ""),
            notes: String(item.expenseDraft?.notes ?? ""),
          },
          financialDraft: {
            movementKind: item.financialDraft?.movementKind === "transfer" ? "transfer" : "standard",
            date: String(item.financialDraft?.date ?? ""),
            description: String(item.financialDraft?.description ?? ""),
            accountId: String(item.financialDraft?.accountId ?? ""),
            accountName: String(item.financialDraft?.accountName ?? ""),
            paymentMethodId: String(item.financialDraft?.paymentMethodId ?? ""),
            paymentMethodLabel: String(item.financialDraft?.paymentMethodLabel ?? ""),
            counterpartyAccountId: String(item.financialDraft?.counterpartyAccountId ?? ""),
            counterpartyAccountName: String(item.financialDraft?.counterpartyAccountName ?? ""),
            counterpartyPaymentMethodId: String(item.financialDraft?.counterpartyPaymentMethodId ?? ""),
            counterpartyPaymentMethodLabel: String(item.financialDraft?.counterpartyPaymentMethodLabel ?? ""),
            notes: String(item.financialDraft?.notes ?? ""),
          },
          status,
        };
      })
    : [];

  return {
    ...doc,
    origin,
    syncSource: doc.syncSource === "inter_api" ? "inter_api" : undefined,
    syncKey: doc.syncKey ? String(doc.syncKey) : undefined,
    originLabel: String(doc.originLabel ?? IMPORT_SESSION_ORIGIN_LABELS[origin]),
    requestDate: doc.requestDate ? String(doc.requestDate) : undefined,
    displayName: String(doc.displayName ?? doc.fileName ?? "Sessão de importação"),
    fileType:
      doc.fileType === "ai_assisted" || doc.fileType === "manual" || doc.fileType === "csv" || doc.fileType === "ofx"
        ? doc.fileType
        : "ofx",
    statementAccountId: String(doc.statementAccountId ?? ""),
    statementAccountName: String(doc.statementAccountName ?? ""),
    items,
    summary: doc.summary || buildSessionSummary(items),
  } as ImportSession;
}

function getSortedItems(items: ImportSessionItem[]) {
  return [...items].sort(
    (left, right) => new Date(left.date).getTime() - new Date(right.date).getTime()
  );
}

function getNextPendingItemId(
  items: ImportSessionItem[],
  currentItemId: string,
  direction: "all" | "in" | "out"
) {
  const visibleItems = getSortedItems(items).filter((item) => {
    if (direction === "in") return item.amount >= 0;
    if (direction === "out") return item.amount < 0;
    return true;
  });
  const currentIndex = visibleItems.findIndex((item) => item.id === currentItemId);
  const orderedCandidates =
    currentIndex >= 0
      ? [...visibleItems.slice(currentIndex + 1), ...visibleItems.slice(0, currentIndex)]
      : visibleItems;
  return orderedCandidates.find((item) => item.status === "pending")?.id ?? null;
}

function buildSessionPayload(
  file: File,
  fileType: "ofx" | "csv",
  bankProfile: string,
  displayName: string,
  statementAccountId: string,
  statementAccountName: string,
  createdBy: string,
  createdByName: string,
  items: ImportSessionItem[],
  origin: ImportSessionOrigin = "bank_statement"
) {
  return {
    origin,
    originLabel: IMPORT_SESSION_ORIGIN_LABELS[origin],
    displayName,
    fileName: file.name,
    fileType,
    bankProfile: fileType === "csv" ? bankProfile : null,
    statementAccountId,
    statementAccountName,
    createdBy,
    createdByName,
    status: "open",
    items: serializeSessionItems(items),
    summary: buildSessionSummary(items),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    completedAt: null,
  };
}

function inferBankName(file: File, fileType: "ofx" | "csv", bankProfile: string, content: string) {
  if (fileType === "csv") {
    return CSV_BANK_PROFILES[bankProfile]?.label || "Extrato";
  }

  const lowerName = file.name.toLowerCase();
  const filenameMatches: Array<[string, string]> = [
    ["inter", "Banco Inter"],
    ["nubank", "Nubank"],
    ["itau", "Itaú"],
    ["itaú", "Itaú"],
    ["bradesco", "Bradesco"],
    ["santander", "Santander"],
    ["sicredi", "Sicredi"],
    ["bb", "Banco do Brasil"],
    ["bancodobrasil", "Banco do Brasil"],
  ];

  for (const [needle, label] of filenameMatches) {
    if (lowerName.includes(needle)) return label;
  }

  const orgMatch = content.match(/<ORG>([^<\r\n]+)/i);
  const fidMatch = content.match(/<FID>([^<\r\n]+)/i);
  const bankIdMatch = content.match(/<BANKID>([^<\r\n]+)/i);
  const rawBank = orgMatch?.[1] || fidMatch?.[1] || bankIdMatch?.[1] || "";
  const normalizedBank = rawBank.trim();

  if (normalizedBank) {
    return normalizedBank;
  }

  return "Extrato bancário";
}

function buildDisplayName(bankName: string, entries: ParsedBankEntry[]) {
  const dates = entries
    .map((entry) => entry.date)
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  const sessionDate = dates[dates.length - 1] || new Date();
  return `${bankName} - ${formatSessionNameDate(sessionDate)}`;
}

function getAccountOptionLabel(account: Account, unitNameById: Record<string, string> = {}) {
  const details = [account.agency && `Ag ${account.agency}`, account.accountNumber && `Cc ${account.accountNumber}`]
    .filter(Boolean)
    .join(" • ");
  const unitName = account.resultCenterId ? (unitNameById[account.resultCenterId] ?? "") : "";
  const suffix = unitName ? ` • ${unitName}` : "";

  return details ? `${account.name} • ${details}${suffix}` : `${account.name} • ${account.id.slice(0, 6)}${suffix}`;
}

function getAccountDisplayLabel(accounts: Account[], accountId: string, fallbackName = "", unitNameById: Record<string, string> = {}) {
  const account = accounts.find((entry) => entry.id === accountId);
  return account ? getAccountOptionLabel(account, unitNameById) : fallbackName;
}

function getSessionPeriodLabel(session: ImportSession) {
  const monthlyKey = session.syncSource === "inter_api"
    ? session.syncKey?.match(/:(\d{4}-\d{2})$/)?.[1] || session.fileName?.match(/inter-api-(\d{4}-\d{2})/)?.[1]
    : null;

  if (monthlyKey) {
    const [year, month] = monthlyKey.split("-").map(Number);
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    return `${format(first, "dd/MM/yyyy", { locale: ptBR })} — ${format(last, "dd/MM/yyyy", { locale: ptBR })}`;
  }

  const dates = session.items
    .map((item) => new Date(`${item.date}T00:00:00`))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  if (dates.length === 0) return session.displayName;

  const first = dates[0];
  const last = dates[dates.length - 1];
  const firstLabel = format(first, "dd/MM/yyyy", { locale: ptBR });
  const lastLabel = format(last, "dd/MM/yyyy", { locale: ptBR });

  return firstLabel === lastLabel ? firstLabel : `${firstLabel} — ${lastLabel}`;
}

function getPurchaseSearchText(candidate: PurchaseCandidate) {
  return [
    candidate.label,
    candidate.supplierName,
    candidate.dueDate,
    candidate.freightPaymentMode === "included_with_goods" ? "frete junto" : "frete separado",
  ]
    .join(" ")
    .toLocaleLowerCase("pt-BR");
}

function getEligibleAllocationAmount(item: ImportSessionItem, candidate: PurchaseCandidate | null) {
  if (!candidate) return 0;
  if (item.expenseDraft.purchaseLinkMode === "goods") return candidate.goodsPending;
  if (item.expenseDraft.purchaseLinkMode === "freight") return candidate.freightPending;
  return candidate.goodsPending + candidate.freightPending;
}

function normalizeExpenseDescriptionLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

function buildAccountTree(items: any[], parentId: string | null = null): any[] {
  return items
    .filter((item) => item.parentId === parentId)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((item) => ({ ...item, children: buildAccountTree(items, item.id) }));
}

function flattenAccountTree(nodes: any[], level = 0, prefix = ""): any[] {
  return nodes.flatMap((node, index) => {
    const order = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
    return [
      { ...node, level, order, isParent: node.children.length > 0 },
      ...flattenAccountTree(node.children, level + 1, order),
    ];
  });
}

function collectAccountParentPath(items: any[], targetId: string) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const path: string[] = [];
  let current = byId.get(targetId);

  while (current?.parentId) {
    path.unshift(current.parentId);
    current = byId.get(current.parentId);
  }

  return path;
}

function filterAccountTree(nodes: any[], query: string): any[] {
  if (!query.trim()) return nodes;

  const normalizedQuery = query.trim().toLowerCase();

  return nodes.flatMap((node) => {
    const children = filterAccountTree(node.children ?? [], normalizedQuery);
    const matchesSelf = [node.order, node.name, node.description, ...(node.searchTerms ?? [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery));

    if (!matchesSelf && children.length === 0) {
      return [];
    }

    return [
      {
        ...node,
        children: matchesSelf ? node.children ?? [] : children,
      },
    ];
  });
}

function AccountPlanTreeRow({
  node,
  depth,
  topLevelIndex,
  expanded,
  selectedId,
  searching,
  onToggle,
  onSelect,
}: {
  node: any;
  depth: number;
  topLevelIndex: number;
  expanded: Set<string>;
  selectedId: string;
  searching: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isExpanded = searching || expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const color = ACCOUNT_GROUP_COLORS[topLevelIndex % ACCOUNT_GROUP_COLORS.length];

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-transparent px-3 py-2 text-sm transition-colors hover:bg-muted/40",
          isSelected && "border-border bg-muted/30"
        )}
      >
        {depth === 0 ? (
          <>
            <button
              type="button"
              className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
              onClick={() => hasChildren && onToggle(node.id)}
            >
              {hasChildren ? (
                isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <span className="h-3.5 w-3.5" />
              )}
            </button>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          </>
        ) : (
          <div className="relative h-5 shrink-0" style={{ width: `${18 + (depth - 1) * 18}px` }}>
            <span
              className="absolute border-b border-l border-border/70"
              style={{
                left: `${8 + (depth - 1) * 18}px`,
                top: 0,
                height: 14,
                width: 12,
                borderBottomLeftRadius: 6,
              }}
            />
          </div>
        )}

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onSelect(node.id)}
        >
          <span className={cn("shrink-0 font-mono text-xs", depth === 0 ? "text-foreground/80" : "text-muted-foreground")}>
            {node.order}
          </span>
          <span className={cn("truncate", depth === 0 ? "font-semibold" : "font-medium")}>{node.name}</span>
        </button>

        {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </div>

      {hasChildren && isExpanded && (
        <div className="mt-0.5 space-y-0.5">
          {node.children.map((child: any) => (
            <AccountPlanTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              topLevelIndex={topLevelIndex}
              expanded={expanded}
              selectedId={selectedId}
              searching={searching}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function validateItem(item: ImportSessionItem, purchaseCandidatesByOrderId: Map<string, PurchaseCandidate>) {
  const issues: string[] = [];
  const isTransfer = item.financialDraft.movementKind === "transfer";
  const movementBaseValid =
    item.financialDraft.accountId.trim().length > 0 &&
    item.financialDraft.paymentMethodId.trim().length > 0 &&
    item.financialDraft.date.trim().length > 0 &&
    item.financialDraft.description.trim().length >= 3;
  const transferValid =
    !isTransfer ||
    (item.financialDraft.counterpartyAccountId.trim().length > 0 &&
      item.financialDraft.counterpartyPaymentMethodId.trim().length > 0 &&
      item.financialDraft.counterpartyAccountId !== item.financialDraft.accountId);
  const movementValid = movementBaseValid && transferValid;

  if (!movementValid) {
    issues.push(isTransfer ? "Complete a transferência entre contas." : "Preencha a movimentação financeira.");
  }

  const requiresExpense = item.amount < 0 && !isTransfer;
  let expenseValid = true;

  if (requiresExpense) {
    if (item.expenseDraft.mode === "existing") {
      expenseValid = item.expenseDraft.linkedExpenseId.trim().length > 0;
    } else if (item.expenseDraft.mode === "purchase") {
      const candidate = purchaseCandidatesByOrderId.get(item.expenseDraft.purchaseOrderId);
      const eligibleAmount = getEligibleAllocationAmount(item, candidate || null);
      const allocatedAmount = Number(item.expenseDraft.allocatedAmount || 0);
      const purchaseLinkValid =
        !!candidate &&
        candidate.linkedExpenseId.trim().length > 0 &&
        allocatedAmount > 0 &&
        allocatedAmount <= eligibleAmount + 0.01 &&
        (item.expenseDraft.purchaseLinkMode !== "combined" ||
          candidate.freightPaymentMode === "included_with_goods") &&
        (item.expenseDraft.purchaseLinkMode !== "freight" || candidate.freightAmountEstimated > 0);
      expenseValid = purchaseLinkValid;
    } else if (item.expenseDraft.mode === "split") {
      const splitTotal = item.expenseDraft.splitExpenses.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);
      expenseValid =
        item.expenseDraft.splitExpenses.length > 1 &&
        Math.abs(splitTotal - Math.abs(item.amount)) < 0.01 &&
        item.expenseDraft.splitExpenses.every(
          (entry) =>
            entry.description.trim().length >= 3 &&
            entry.accountPlanId.trim().length > 0 &&
            entry.resultCenterId.trim().length > 0 &&
            entry.competenceDate.trim().length > 0 &&
            Number(entry.value) > 0
        );
    } else {
      const apportionmentTotal = item.expenseDraft.apportionments.reduce(
        (sum, entry) => sum + (Number(entry.percentage) || 0),
        0
      );
      const apportionmentValid =
        item.expenseDraft.isApportioned &&
        item.expenseDraft.apportionments.length > 0 &&
        item.expenseDraft.apportionments.every(
          (entry) => entry.resultCenterId.trim().length > 0 && Number(entry.percentage) > 0
        ) &&
        Math.abs(apportionmentTotal - 100) < 0.01;
      expenseValid =
        item.expenseDraft.description.trim().length >= 10 &&
        item.expenseDraft.accountPlanId.trim().length > 0 &&
        (item.expenseDraft.isApportioned ? apportionmentValid : item.expenseDraft.resultCenterId.trim().length > 0) &&
        item.expenseDraft.competenceDate.trim().length > 0;
    }

    if (!expenseValid) {
      issues.push(
        item.expenseDraft.mode === "purchase"
          ? "Revise o vínculo com a compra e o valor apropriado."
          : item.expenseDraft.mode === "split"
          ? "Complete as despesas divididas e confira a soma dos valores."
          : "Complete a etapa de despesa."
      );
    }
  }

  return {
    movementValid,
    expenseValid,
    ready: movementValid && expenseValid,
    issues,
  };
}

export function FinancialImportPage({
  embedded = false,
  showImportControls = true,
  uploadOnly = false,
  onImportComplete,
}: {
  embedded?: boolean;
  showImportControls?: boolean;
  uploadOnly?: boolean;
  onImportComplete?: (sessionId: string) => void;
} = {}) {
  const { firebaseUser, permissions, user, users } = useAuth();
  const { entities } = useEntities();
  const { kiosks } = useKiosks();
  const { orders } = usePurchaseOrders();
  const { financials: purchaseFinancials } = usePurchaseFinancials();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: aliasesData } = useFinancialCollection<any>(financialCollection("importAliases"));
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accounts"));
  const { data: expensesData } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: bankAccountsData } = useFinancialCollection<Account>(financialCollection("bankAccounts"));
  const { data: resultCentersData } = useFinancialCollection<{ id: string; name: string }>(financialCollection("resultCenters"));
  const { data: expenseDescriptionsData, refresh: refreshExpenseDescriptions } = useFinancialCollection<any>(
    financialCollection("expenseDescriptions")
  );
  const {
    data: sessionsData,
    refresh: refreshSessions,
  } = useFinancialCollection<any>(financialCollection("importDrafts"), { preferFallback: true });
  const refreshImportSessions = useCallback(() => {
    refreshSessions();
  }, [refreshSessions]);
  const patchImportSession = useCallback(
    async (sessionId: string, payload: Record<string, unknown>) => {
      if (!firebaseUser) throw new Error("Usuário não autenticado.");
      const token = await firebaseUser.getIdToken();
      const response = await fetchWithTimeout(
        `/api/financial/import-sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        20_000
      );
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(result?.error || "Não foi possível salvar a auditoria.");
      }
      return result;
    },
    [firebaseUser]
  );
  const canEditImportSession = useCallback(
    (session: ImportSession | null) =>
      Boolean(
        session &&
        firebaseUser &&
        (session.createdBy === firebaseUser.uid ||
          (session.syncSource === "inter_api" && permissions.financial?.expenses?.import))
      ),
    [firebaseUser, permissions.financial?.expenses?.import]
  );

  const aliases = aliasesData || [];
  const expenses = expensesData || [];
  const accountPlansList = accountPlans || [];
  const flattenedAccounts = useMemo(() => {
    if (!accountPlans) return [];
    return flattenAccountTree(buildAccountTree(accountPlans));
  }, [accountPlans]);
  const accountTree = useMemo(() => buildAccountTree(accountPlans || []), [accountPlans]);
  const activeExpenseDescriptions = useMemo(
    () =>
      [...(expenseDescriptionsData || [])]
        .filter((item) => item.active !== false && typeof item.label === "string" && item.label.trim().length > 0)
        .sort((left, right) => left.label.localeCompare(right.label, "pt-BR", { sensitivity: "base" })),
    [expenseDescriptionsData]
  );
  const accounts = useMemo(() => (bankAccountsData || []).filter((account) => account.active), [bankAccountsData]);
  const openSessions = useMemo(
    () =>
      (sessionsData || [])
        .filter((session) => session.status === "open")
        .map(normalizeSession)
        .map((session) => applyStatementPaymentMethodSuggestions(session, accounts))
        .sort((left, right) => {
          const leftDate = left.items
            .map((item) => new Date(item.date))
            .filter((date) => !Number.isNaN(date.getTime()))
            .sort((a, b) => a.getTime() - b.getTime())[0]
            ?.getTime() || 0;
          const rightDate = right.items
            .map((item) => new Date(item.date))
            .filter((date) => !Number.isNaN(date.getTime()))
            .sort((a, b) => a.getTime() - b.getTime())[0]
            ?.getTime() || 0;

          return leftDate - rightDate;
        }),
    [accounts, sessionsData]
  );
  const units = useMemo(
    () => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [kiosks]
  );
  const unitNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const unit of units) map[unit.id] = unit.name;
    for (const rc of resultCentersData ?? []) map[rc.id] = rc.name;
    return map;
  }, [units, resultCentersData]);
  const pendingInstallments = useMemo<PendingInstallment[]>(
    () =>
      expenses
        .filter((expense) => expense.status === "pending" && expense.totalValue)
        .flatMap((expense) => {
          const installments = Array.isArray(expense.installments)
            ? expense.installments.filter(
                (installment: any) =>
                  installment?.status !== "paid" &&
                  installment?.status !== "cancelled" &&
                  Number(installment?.value) > 0
              )
            : [];

          if (installments.length > 0) {
            return installments.map((installment: any, index: number) => ({
              expenseId: expense.id,
              expenseDescription: expense.description,
              installmentNumber: Number(installment.number) || index + 1,
              dueDate: toDate(installment.dueDate) || toDate(expense.dueDate) || new Date(),
              value: Number(installment.value) || 0,
            }));
          }

          return [{
            expenseId: expense.id,
            expenseDescription: expense.description,
            installmentNumber: expense.installmentNumber,
            dueDate: toDate(expense.dueDate) || new Date(),
            value: Number(expense.totalValue) || 0,
          }];
        }),
    [expenses]
  );
  const linkableExpenses = useMemo(
    () =>
      expenses
        .filter((expense) => expense.status !== "draft" && expense.status !== "cancelled")
        .sort((left, right) => (toDate(right.createdAt)?.getTime() || 0) - (toDate(left.createdAt)?.getTime() || 0)),
    [expenses]
  );
  const purchaseCandidates = useMemo<PurchaseCandidate[]>(() => {
    const financialByOrderId = new Map<string, PurchaseFinancial>(
      (purchaseFinancials || []).map((entry) => [entry.purchaseOrderId, entry])
    );

    return (orders || [])
      .filter((order: PurchaseOrder) => order.status === "confirmed" && !!order.linkedExpenseId)
      .map((order: PurchaseOrder) => {
        const financial = financialByOrderId.get(order.id);
        if (!financial || financial.status === "cancelled") return null;
        const goodsAmountEstimated = Math.max(
          Number(financial.goodsAmountEstimated ?? order.totalEstimated ?? 0) - Number(financial.freightAmountEstimated ?? order.deliveryFee ?? 0),
          0
        );
        const freightAmountEstimated = Number(financial.freightAmountEstimated ?? order.deliveryFee ?? 0);
        const goodsAmountPaid = Number(financial.goodsAmountPaid ?? 0);
        const freightAmountPaid = Number(financial.freightAmountPaid ?? 0);
        const goodsPending = Math.max(goodsAmountEstimated - goodsAmountPaid, 0);
        const freightPending = Math.max(freightAmountEstimated - freightAmountPaid, 0);
        const totalEstimated = Number(financial.amountEstimated ?? order.totalEstimated ?? goodsAmountEstimated + freightAmountEstimated);
        const supplierName = (order as any).supplierName || (financial as any).supplierName || financial.supplierId || "Fornecedor";

        return {
          orderId: order.id,
          linkedExpenseId: order.linkedExpenseId || financial.linkedExpenseId || "",
          financialId: financial.id,
          label: `Pedido ${order.id.slice(-8)}`,
          supplierName,
          dueDate: order.paymentDueDate,
          totalEstimated,
          goodsAmountEstimated,
          freightAmountEstimated,
          goodsAmountPaid,
          freightAmountPaid,
          goodsPending,
          freightPending,
          freightPaymentMode: financial.freightPaymentMode ?? order.freightPaymentMode ?? null,
          goodsAccountPlanId: order.accountPlanId ?? financial.accountPlanId ?? "",
          goodsAccountPlanName: order.accountPlanName ?? financial.accountPlanName ?? "",
          freightAccountPlanId: order.freightAccountPlanId ?? financial.freightAccountPlanId ?? "",
          freightAccountPlanName: order.freightAccountPlanName ?? financial.freightAccountPlanName ?? "",
          resultCenterId: order.resultCenterId ?? financial.resultCenterId ?? "",
          resultCenterName: order.resultCenterName ?? financial.resultCenterName ?? "",
        } satisfies PurchaseCandidate;
      })
      .filter((candidate): candidate is PurchaseCandidate => !!candidate)
      .sort((left, right) => new Date(right.dueDate).getTime() - new Date(left.dueDate).getTime());
  }, [orders, purchaseFinancials]);
  const purchaseCandidatesByOrderId = useMemo(
    () => new Map(purchaseCandidates.map((candidate) => [candidate.orderId, candidate])),
    [purchaseCandidates]
  );
  const selectablePurchaseCandidates = useMemo(
    () => purchaseCandidates.filter((candidate) => candidate.goodsPending > 0 || candidate.freightPending > 0),
    [purchaseCandidates]
  );
  const nonPurchaseExpenses = useMemo(
    () => linkableExpenses.filter((expense) => !expense.purchaseOrderId),
    [linkableExpenses]
  );

  const [fileType, setFileType] = useState<"ofx" | "csv">("ofx");
  const [bankProfile, setBankProfile] = useState("nubank");
  const [statementAccountId, setStatementAccountId] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<ImportSession | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [isSessionDirty, setIsSessionDirty] = useState(false);
  const sessionRevisionRef = useRef(0);
  const currentSessionId = currentSession ? currentSession.id : null;
  const [directionFilter, setDirectionFilter] = useState<"all" | "in" | "out">("all");
  const [itemStatusFilter, setItemStatusFilter] = useState<"all" | ImportSessionItemStatus>("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<"all" | "completed" | "discarded">("all");
  const [historySearch, setHistorySearch] = useState("");
  const [purchaseSearchByItem, setPurchaseSearchByItem] = useState<Record<string, string>>({});
  const [existingExpenseSearchByItem, setExistingExpenseSearchByItem] = useState<Record<string, string>>({});
  const [descriptionFocusedItemId, setDescriptionFocusedItemId] = useState<string | null>(null);
  const [descriptionDraftsByItem, setDescriptionDraftsByItem] = useState<Record<string, string>>({});
  const [apportionmentPercentageDrafts, setApportionmentPercentageDrafts] = useState<Record<string, string>>({});
  const [accountPlanOpenItemId, setAccountPlanOpenItemId] = useState<string | null>(null);
  const [accountPlanSearch, setAccountPlanSearch] = useState("");
  const [expandedAccountPlans, setExpandedAccountPlans] = useState<Set<string>>(new Set());
  const [supplierOpenItemId, setSupplierOpenItemId] = useState<string | null>(null);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [sessionsSidebarOpen, setSessionsSidebarOpen] = useState(true);
  const [generalSummaryOpen, setGeneralSummaryOpen] = useState(true);
  const visibleOpenSessions = useMemo(
    () =>
      statementAccountId
        ? openSessions.filter((session) => session.statementAccountId === statementAccountId)
        : openSessions,
    [openSessions, statementAccountId]
  );
  const canManageExpenseDescriptions = !!permissions.financial?.settings?.manageExpenseDescriptions;
  const canQuickAddExpenseDescriptions =
    !!permissions.financial?.expenses?.create ||
    !!permissions.financial?.expenses?.edit ||
    canManageExpenseDescriptions;

  const replaceSessionUrl = useCallback(
    (sessionId: string | null) => {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      if (sessionId) {
        url.searchParams.set("session", sessionId);
      } else {
        url.searchParams.delete("session");
      }
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sessionFromUrl = new URL(window.location.href).searchParams.get("session");
    if (sessionFromUrl) {
      setSelectedSessionId((current) => current ?? sessionFromUrl);
    }
  }, []);

  useEffect(() => {
    if (!selectedSessionId && visibleOpenSessions.length > 0) {
      const firstSession = visibleOpenSessions[0];
      setSelectedSessionId(firstSession.id);
      replaceSessionUrl(firstSession.id);
    }
  }, [replaceSessionUrl, selectedSessionId, visibleOpenSessions]);

  useEffect(() => {
    if (!statementAccountId) return;
    if (selectedSessionId && visibleOpenSessions.some((session) => session.id === selectedSessionId)) return;

    const nextSession = visibleOpenSessions[0] ?? null;
    setSelectedSessionId(nextSession?.id ?? null);
    setCurrentSession(nextSession);
    setExpandedItemId(nextSession?.items[0]?.id ?? null);
    setIsSessionDirty(false);
    replaceSessionUrl(nextSession?.id ?? null);
  }, [replaceSessionUrl, selectedSessionId, statementAccountId, visibleOpenSessions]);

  useEffect(() => {
    setDescriptionDraftsByItem({});
    setApportionmentPercentageDrafts({});
  }, [currentSessionId]);

  useEffect(() => {
    if (!accountPlanOpenItemId) {
      setAccountPlanSearch("");
      return;
    }

    const selectedItem = currentSession?.items.find((item) => item.id === accountPlanOpenItemId);
    if (!selectedItem?.expenseDraft.accountPlanId || !accountPlans?.length) return;

    setExpandedAccountPlans(new Set(collectAccountParentPath(accountPlans, selectedItem.expenseDraft.accountPlanId)));
  }, [accountPlanOpenItemId, accountPlans, currentSession]);

  useEffect(() => {
    if (!supplierOpenItemId) {
      setSupplierSearch("");
    }
  }, [supplierOpenItemId]);

  useEffect(() => {
    if (!selectedSessionId) {
      setCurrentSession(null);
      return;
    }

    const sessionFromList = openSessions.find((session) => session.id === selectedSessionId);
    if (!sessionFromList) {
      if (currentSessionId === selectedSessionId) {
        return;
      }

      if (!isSessionDirty) {
        if (openSessions.length > 0) {
          const fallbackSession = openSessions[0];
          setSelectedSessionId(fallbackSession.id);
          setCurrentSession(fallbackSession);
          replaceSessionUrl(fallbackSession.id);
        } else {
          setCurrentSession(null);
        }
      }
      return;
    }

    setCurrentSession((previous) => {
      if (previous?.id !== sessionFromList.id) {
        return sessionFromList;
      }

      // While this session is open in the editor, its local state is authoritative.
      // A refresh can finish with an older snapshot and must never restore stale field
      // values. Automated bank syncs may still append transactions, so merge only IDs
      // that are genuinely new and preserve every item already being audited.
      const existingIds = new Set(previous.items.map((item) => item.id));
      const appendedItems = sessionFromList.items.filter((item) => !existingIds.has(item.id));
      if (appendedItems.length === 0) return previous;

      const items = [...previous.items, ...appendedItems];
      return {
        ...previous,
        items,
        summary: buildSessionSummary(items),
      };
    });
  }, [currentSessionId, isSessionDirty, openSessions, replaceSessionUrl, selectedSessionId]);

  useEffect(() => {
    if (!currentSession || !isSessionDirty || !canEditImportSession(currentSession)) return;

    const revisionAtSchedule = sessionRevisionRef.current;
    const timeout = window.setTimeout(async () => {
      setIsSavingSession(true);
      try {
        await patchImportSession(currentSession.id, {
          action: "save",
          statementAccountId: currentSession.statementAccountId,
          statementAccountName: currentSession.statementAccountName,
          items: serializeSessionItems(currentSession.items),
        });

        if (sessionRevisionRef.current === revisionAtSchedule) {
          setIsSessionDirty(false);
          refreshImportSessions();
        }
      } catch (error) {
        console.error(error);
        toast({
          variant: "destructive",
          title: "Erro ao salvar a sessão de importação.",
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setIsSavingSession(false);
      }
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [canEditImportSession, currentSession, isSessionDirty, patchImportSession, refreshImportSessions, toast]);

  const updateSession = useCallback((updater: (session: ImportSession) => ImportSession) => {
    setCurrentSession((previous) => {
      if (!previous) return previous;
      const next = updater(previous);
      sessionRevisionRef.current += 1;
      setIsSessionDirty(true);
      return {
        ...next,
        summary: buildSessionSummary(next.items),
      };
    });
  }, []);

  async function handleQuickAddExpenseDescription(item: ImportSessionItem) {
    if (!firebaseUser) return;

    if (!canQuickAddExpenseDescriptions) {
      toast({
        variant: "destructive",
        title: "Sem permissão para cadastrar sugestões.",
        description: "Seu perfil precisa poder lançar ou editar despesas para usar esse atalho.",
      });
      return;
    }

    const rawLabel = getExpenseDescriptionValue(item) || "";
    const parsed = expenseDescriptionFormSchema.safeParse({
      label: rawLabel,
      active: true,
    });

    if (!parsed.success) {
      toast({
        variant: "destructive",
        title: "Descrição inválida.",
        description: parsed.error.issues[0]?.message || "Revise o texto antes de adicionar a sugestão.",
      });
      return;
    }

    const normalizedLabel = normalizeExpenseDescriptionLabel(parsed.data.label);
    const alreadyExists = activeExpenseDescriptions.some(
      (entry) => normalizeExpenseDescriptionLabel(entry.label) === normalizedLabel
    );

    if (alreadyExists) {
      toast({
        title: "Sugestão já cadastrada.",
        description: "Essa descrição já está disponível na lista de sugestões.",
      });
      return;
    }

    try {
      const trimmedLabel = parsed.data.label.trim();
      await addDoc(financialCollection("expenseDescriptions"), {
        label: trimmedLabel,
        active: true,
        createdAt: Timestamp.now(),
        createdBy: firebaseUser.uid,
        updatedAt: Timestamp.now(),
        updatedBy: firebaseUser.uid,
      });
      await refreshExpenseDescriptions();
      toast({
        title: "Sugestão adicionada.",
        description: "A descrição foi salva e já pode ser reutilizada nos próximos lançamentos.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Erro ao adicionar sugestão.",
        description: "Não foi possível salvar a descrição no catálogo. Se a regra já deveria permitir isso, publique as regras financeiras atualizadas.",
      });
    }
  }

  const processFile = useCallback(
    async (file: File) => {
      if (!firebaseUser) return;
      if (!statementAccountId) {
        toast({ variant: "destructive", title: "Selecione a conta vinculada ao extrato antes de importar." });
        return;
      }

      setIsProcessing(true);
      try {
        const content = await file.text();
        let entries: ParsedBankEntry[] = [];
        if (file.name.toLowerCase().endsWith(".ofx") || fileType === "ofx") {
          entries = parseOFX(content);
        } else {
          const profile = CSV_BANK_PROFILES[bankProfile]?.config || CSV_BANK_PROFILES.custom.config;
          entries = parseCSV(content, profile);
        }

        if (entries.length === 0) {
          toast({ variant: "destructive", title: "Nenhuma transação encontrada no arquivo." });
          return;
        }

        if (openSessions.length > 0) {
          toast({
            title: "Já existem sessões de importação abertas.",
            description: "Uma nova sessão será criada para este extrato.",
          });
        }

        const importedTransactions = applyAliasesAndMatch(entries, aliases, pendingInstallments);
        const statementAccountName = getAccountName(statementAccountId);
        const items = importedTransactions.map((transaction) => {
          let item = createSessionItem(transaction);
          const purchaseCandidate =
            transaction.suggestedConfidence === "high"
              ? purchaseCandidates.find((candidate) => candidate.linkedExpenseId === transaction.suggestedExpenseId)
              : undefined;

          if (purchaseCandidate) {
            const purchaseLinkMode: ImportSessionPurchaseLinkMode =
              purchaseCandidate.goodsPending > 0 ? "goods" : "freight";
            const eligibleAmount =
              purchaseLinkMode === "goods" ? purchaseCandidate.goodsPending : purchaseCandidate.freightPending;
            const accountPlanId =
              purchaseLinkMode === "goods" ? purchaseCandidate.goodsAccountPlanId : purchaseCandidate.freightAccountPlanId;
            const accountPlanName =
              purchaseLinkMode === "goods" ? purchaseCandidate.goodsAccountPlanName : purchaseCandidate.freightAccountPlanName;

            item = {
              ...item,
              expenseDraft: {
                ...item.expenseDraft,
                mode: "purchase",
                linkedExpenseId: purchaseCandidate.linkedExpenseId,
                purchaseOrderId: purchaseCandidate.orderId,
                purchaseLinkMode,
                allocatedAmount: Math.min(Math.abs(transaction.amount), eligibleAmount),
                supplier: purchaseCandidate.supplierName || item.expenseDraft.supplier,
                accountPlanId,
                accountPlanName,
                resultCenterId: purchaseCandidate.resultCenterId,
                resultCenterName: purchaseCandidate.resultCenterName,
                isApportioned: false,
                apportionments: [],
              },
            };
          }

          return {
            ...item,
            financialDraft: {
              ...item.financialDraft,
              accountId: statementAccountId,
              accountName: statementAccountName,
            },
          };
        });
        const bankName = inferBankName(file, fileType, bankProfile, content);
        const displayName = buildDisplayName(bankName, entries);
        const createdByName = getUserDisplayName(user, firebaseUser.uid);
        const payload = stripUndefinedDeep(
          buildSessionPayload(
            file,
            fileType,
            bankProfile,
            displayName,
            statementAccountId,
            statementAccountName,
            firebaseUser.uid,
            createdByName,
            items
          )
        );
        const createdSession = await addDoc(financialCollection("importDrafts"), payload);

        const nextSession = normalizeSession({ id: createdSession.id, ...payload });
        setCurrentSession(nextSession);
        setSelectedSessionId(createdSession.id);
        setExpandedItemId(nextSession.items[0]?.id ?? null);
        replaceSessionUrl(createdSession.id);
        refreshImportSessions();
        onImportComplete?.(createdSession.id);
        toast({ title: `${items.length} transações carregadas em uma nova sessão.` });
      } catch (error) {
        console.error(error);
        toast({
          variant: "destructive",
          title: "Erro ao processar o arquivo",
          description: "Verifique se o formato do extrato está correto.",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [
      aliases,
      bankProfile,
      fileType,
      firebaseUser,
      statementAccountId,
      openSessions.length,
      pendingInstallments,
      purchaseCandidates,
      refreshImportSessions,
      replaceSessionUrl,
      toast,
      onImportComplete,
      user,
    ]
  );

  function updateItem(itemId: string, updater: (item: ImportSessionItem) => ImportSessionItem) {
    updateSession((session) => ({
      ...session,
      items: session.items.map((item) => (item.id === itemId ? updater(item) : item)),
    }));
  }

  function getExpenseDescriptionValue(item: ImportSessionItem) {
    return descriptionDraftsByItem[item.id] ?? item.expenseDraft.description;
  }

  function setExpenseDescription(itemId: string, value: string) {
    setDescriptionDraftsByItem((current) => ({ ...current, [itemId]: value }));
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: { ...current.expenseDraft, description: value },
    }));
  }

  function clearExpenseDescriptionDraft(itemId: string, fallbackValue: string) {
    setDescriptionDraftsByItem((current) => {
      if (!(itemId in current)) return current;
      const next = { ...current };
      if (fallbackValue === current[itemId]) {
        delete next[itemId];
      }
      return next;
    });
  }

  function getApportionmentPercentageValue(entry: ImportSessionItem["expenseDraft"]["apportionments"][number]) {
    return apportionmentPercentageDrafts[entry.id] ?? String(entry.percentage ?? 0);
  }

  function setApportionmentPercentageDraft(
    apportionmentId: string,
    rawValue: string
  ) {
    setApportionmentPercentageDrafts((current) => ({
      ...current,
      [apportionmentId]: rawValue,
    }));
  }

  function clearApportionmentPercentageDraft(
    apportionmentId: string,
    fallbackNumericValue: number
  ) {
    setApportionmentPercentageDrafts((current) => {
      if (!(apportionmentId in current)) return current;
      const next = { ...current };
      const normalizedDraft = current[apportionmentId].replace(",", ".");
      if (normalizedDraft === String(fallbackNumericValue)) {
        delete next[apportionmentId];
      }
      return next;
    });
  }

  const filteredAccountTree = useMemo(
    () => filterAccountTree(accountTree, accountPlanSearch),
    [accountPlanSearch, accountTree]
  );
  const filteredEntities = useMemo(() => {
    const normalizedSearch = supplierSearch.trim().toLowerCase();
    if (!normalizedSearch) return entities;
    return entities.filter((entity) => {
      const label = entity.fantasyName || entity.name;
      return label.toLowerCase().includes(normalizedSearch);
    });
  }, [entities, supplierSearch]);
  const filteredUsers = useMemo(() => {
    const normalizedSearch = supplierSearch.trim().toLowerCase();
    if (!normalizedSearch) return users || [];
    return (users || []).filter((entry) => {
      const label = entry.username || entry.email;
      return label.toLowerCase().includes(normalizedSearch);
    });
  }, [supplierSearch, users]);

  function setItemStatus(itemId: string, status: ImportSessionItemStatus) {
    updateItem(itemId, (item) => ({ ...item, status }));
  }

  async function confirmAuditItem(itemId: string) {
    if (!currentSession || !canEditImportSession(currentSession)) return;

    const previousSession = currentSession;
    const nextItems = currentSession.items.map((item) =>
      item.id === itemId ? { ...item, status: "audited" as const } : item
    );
    const nextSession = {
      ...currentSession,
      items: nextItems,
      summary: buildSessionSummary(nextItems),
    };
    const nextPendingItemId = getNextPendingItemId(nextItems, itemId, directionFilter);
    sessionRevisionRef.current += 1;
    const confirmationRevision = sessionRevisionRef.current;

    setCurrentSession(nextSession);
    setIsSessionDirty(false);
    setIsSavingSession(true);
    try {
      await patchImportSession(nextSession.id, {
        action: "save",
        statementAccountId: nextSession.statementAccountId,
        statementAccountName: nextSession.statementAccountName,
        items: serializeSessionItems(nextSession.items),
      });

      if (sessionRevisionRef.current === confirmationRevision) {
        setExpandedItemId(nextPendingItemId ?? (itemStatusFilter === "all" ? itemId : null));
        setIsSessionDirty(false);
      }
      refreshImportSessions();
      toast({
        title: "Auditoria confirmada — aguardando efetivação",
      });
    } catch (error) {
      console.error(error);
      if (sessionRevisionRef.current === confirmationRevision) {
        setCurrentSession(previousSession);
        setExpandedItemId(itemId);
        setIsSessionDirty(false);
      }
      toast({
        variant: "destructive",
        title: "Não foi possível confirmar a auditoria.",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsSavingSession(false);
    }
  }

  function getMethodsForAccount(accountId: string) {
    return accounts.find((account) => account.id === accountId)?.paymentMethods ?? [];
  }

  function getAccountName(accountId: string) {
    return accounts.find((account) => account.id === accountId)?.name ?? "";
  }

  function getMethodLabel(accountId: string, methodId: string) {
    return getMethodsForAccount(accountId).find((method) => method.id === methodId)?.label ?? "";
  }

  function applyStatementAccountToSession(accountId: string) {
    const accountName = getAccountName(accountId);
    updateSession((session) => ({
      ...session,
      statementAccountId: accountId,
      statementAccountName: accountName,
      items: session.items.map((item) => ({
        ...item,
        financialDraft: {
          ...item.financialDraft,
          accountId,
          accountName,
          paymentMethodId: "",
          paymentMethodLabel: "",
        },
      })),
    }));
  }

  function getFilteredPurchaseCandidates(itemId: string) {
    const search = (purchaseSearchByItem[itemId] || "").trim().toLocaleLowerCase("pt-BR");
    if (!search) return selectablePurchaseCandidates;
    return selectablePurchaseCandidates.filter((candidate) => getPurchaseSearchText(candidate).includes(search));
  }

  function getFilteredExistingExpenses(itemId: string, suggestedExpenseId?: string) {
    const normalizedSearch = (existingExpenseSearchByItem[itemId] || "").trim().toLocaleLowerCase("pt-BR");
    const rankedExpenses = [...nonPurchaseExpenses].sort((left, right) => {
      if (left.id === suggestedExpenseId) return -1;
      if (right.id === suggestedExpenseId) return 1;
      return 0;
    });

    if (!normalizedSearch) return rankedExpenses;
    return rankedExpenses.filter((expense) =>
      [expense.description, expense.supplier, formatCurrency(expense.totalValue || 0)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(normalizedSearch))
    );
  }

  function applyPurchaseCandidate(itemId: string, candidate: PurchaseCandidate) {
    updateItem(itemId, (current) => {
      const defaultLinkMode: ImportSessionPurchaseLinkMode =
        candidate.goodsPending > 0 ? "goods" : candidate.freightPending > 0 ? "freight" : "goods";
      const accountPlanId = defaultLinkMode === "freight" ? candidate.freightAccountPlanId : candidate.goodsAccountPlanId;
      const accountPlanName =
        defaultLinkMode === "freight" ? candidate.freightAccountPlanName : candidate.goodsAccountPlanName;

      return {
        ...current,
        expenseDraft: {
          ...current.expenseDraft,
          mode: "purchase",
          linkedExpenseId: candidate.linkedExpenseId,
          purchaseOrderId: candidate.orderId,
          purchaseLinkMode: defaultLinkMode,
          allocatedAmount: Math.min(
            Math.abs(current.amount),
            getEligibleAllocationAmount(
              { ...current, expenseDraft: { ...current.expenseDraft, purchaseLinkMode: defaultLinkMode } },
              candidate
            )
          ),
          description: current.expenseDraft.description,
          supplier: candidate.supplierName || current.expenseDraft.supplier,
          accountPlanId,
          accountPlanName,
          isApportioned: false,
          resultCenterId: candidate.resultCenterId,
          resultCenterName: candidate.resultCenterName,
          apportionments: [],
        },
      };
    });
  }

  function appendApportionment(itemId: string) {
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: {
        ...current.expenseDraft,
        isApportioned: true,
        resultCenterId: "",
        resultCenterName: "",
        apportionments: [
          ...current.expenseDraft.apportionments,
          createApportionmentEntry(),
        ],
      },
    }));
  }

  function updateApportionment(
    itemId: string,
    apportionmentId: string,
    updater: (entry: ImportSessionItem["expenseDraft"]["apportionments"][number]) => ImportSessionItem["expenseDraft"]["apportionments"][number]
  ) {
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: {
        ...current.expenseDraft,
        apportionments: current.expenseDraft.apportionments.map((entry) =>
          entry.id === apportionmentId ? updater(entry) : entry
        ),
      },
    }));
  }

  function removeApportionment(itemId: string, apportionmentId: string) {
    setApportionmentPercentageDrafts((current) => {
      if (!(apportionmentId in current)) return current;
      const next = { ...current };
      delete next[apportionmentId];
      return next;
    });

    updateItem(itemId, (current) => {
      const nextApportionments = current.expenseDraft.apportionments.filter((entry) => entry.id !== apportionmentId);
      return {
        ...current,
        expenseDraft: {
          ...current.expenseDraft,
          isApportioned: nextApportionments.length > 0,
          apportionments: nextApportionments,
          ...(nextApportionments.length === 0
            ? {
                resultCenterId: "",
                resultCenterName: "",
              }
            : {}),
        },
      };
    });
  }

  async function finalizeAuditedItems() {
    if (!firebaseUser || !currentSession) return;
    const auditedItems = currentSession.items.filter((item) => item.status === "audited");

    if (auditedItems.length === 0) {
      toast({ variant: "destructive", title: "Nenhum item auditado pronto para efetivar." });
      return;
    }

    setIsProcessing(true);
    try {
      const now = Timestamp.now();
      const importedFrom = getImportedFromValue(currentSession);
      const revenueSource = getRevenueSourceValue(currentSession);
      const purchaseBalances = new Map(
        purchaseCandidates.map((candidate) => [
          candidate.orderId,
          {
            ...candidate,
            goodsPending: candidate.goodsPending,
            freightPending: candidate.freightPending,
          },
        ])
      );

      for (const item of auditedItems) {
        const transactionDate = Timestamp.fromDate(new Date(`${item.financialDraft.date}T12:00:00`));
        const isTransfer = item.financialDraft.movementKind === "transfer";

        if (isTransfer) {
          const originIsCurrent = item.amount < 0;
          const fromAccountId = originIsCurrent ? item.financialDraft.accountId : item.financialDraft.counterpartyAccountId;
          const fromAccountName = originIsCurrent ? item.financialDraft.accountName : item.financialDraft.counterpartyAccountName;
          const fromPaymentMethodId = originIsCurrent
            ? item.financialDraft.paymentMethodId
            : item.financialDraft.counterpartyPaymentMethodId;
          const fromPaymentMethodLabel = originIsCurrent
            ? item.financialDraft.paymentMethodLabel
            : item.financialDraft.counterpartyPaymentMethodLabel;
          const toAccountId = originIsCurrent ? item.financialDraft.counterpartyAccountId : item.financialDraft.accountId;
          const toAccountName = originIsCurrent ? item.financialDraft.counterpartyAccountName : item.financialDraft.accountName;
          const toPaymentMethodId = originIsCurrent
            ? item.financialDraft.counterpartyPaymentMethodId
            : item.financialDraft.paymentMethodId;
          const toPaymentMethodLabel = originIsCurrent
            ? item.financialDraft.counterpartyPaymentMethodLabel
            : item.financialDraft.paymentMethodLabel;

          const transferOut = {
            type: "transfer_out",
            direction: "out",
            amount: Math.abs(item.amount),
            date: transactionDate,
            description: item.financialDraft.description,
            notes: item.financialDraft.notes || "",
            accountId: fromAccountId,
            accountName: fromAccountName,
            paymentMethodId: fromPaymentMethodId,
            paymentMethodLabel: fromPaymentMethodLabel,
            toAccountId,
            toAccountName,
            toPaymentMethodId,
            toPaymentMethodLabel,
            importedFrom,
            rawBankDescription: item.rawDescription,
          };
          const transferIn = {
            type: "transfer_in",
            direction: "in",
            amount: Math.abs(item.amount),
            date: transactionDate,
            description: item.financialDraft.description,
            notes: item.financialDraft.notes || "",
            accountId: toAccountId,
            accountName: toAccountName,
            paymentMethodId: toPaymentMethodId,
            paymentMethodLabel: toPaymentMethodLabel,
            toAccountId: fromAccountId,
            toAccountName: fromAccountName,
            toPaymentMethodId: fromPaymentMethodId,
            toPaymentMethodLabel: fromPaymentMethodLabel,
            importedFrom,
            rawBankDescription: item.rawDescription,
          };

          if (item.linkedBankTransactionId) {
            const primary = originIsCurrent ? transferOut : transferIn;
            const counterpart = originIsCurrent ? transferIn : transferOut;
            await Promise.all([
              updateDoc(financialDoc("transactions", item.linkedBankTransactionId), {
                ...primary,
                auditStatus: "resolved",
                auditedBy: firebaseUser.uid,
                auditedAt: now,
              }),
              addDoc(financialCollection("transactions"), {
                ...counterpart,
                sourceBankTransactionId: item.linkedBankTransactionId,
                createdBy: firebaseUser.uid,
                createdAt: now,
              }),
            ]);
          } else {
            await Promise.all([
              addDoc(financialCollection("transactions"), {
                ...transferOut,
                createdBy: firebaseUser.uid,
                createdAt: now,
              }),
              addDoc(financialCollection("transactions"), {
                ...transferIn,
                createdBy: firebaseUser.uid,
                createdAt: now,
              }),
            ]);
          }
        } else if (item.amount < 0) {
          const isPurchaseMode = item.expenseDraft.mode === "purchase";
          const purchaseCandidate = isPurchaseMode ? purchaseBalances.get(item.expenseDraft.purchaseOrderId) : undefined;
          let expenseId = item.expenseDraft.linkedExpenseId || "";
          const splitExpenseIds: string[] = [];

          if (item.expenseDraft.mode === "split") {
            for (const split of item.expenseDraft.splitExpenses) {
              const createdExpense = await addDoc(financialCollection("expenses"), {
                accountPlan: split.accountPlanId,
                accountId: split.accountPlanId,
                accountPlanName: split.accountPlanName,
                description: split.description,
                supplier: split.supplier || "",
                notes: item.expenseDraft.notes || item.rawDescription,
                totalValue: Number(split.value) || 0,
                competenceDate: Timestamp.fromDate(new Date(`${split.competenceDate}T12:00:00`)),
                dueDate: transactionDate,
                paymentMethod: "single",
                installmentType: null,
                installmentPeriodicity: null,
                isApportioned: false,
                resultCenter: split.resultCenterName || null,
                apportionments: null,
                installments: [
                  {
                    number: 1,
                    dueDate: transactionDate,
                    value: Number(split.value) || 0,
                    status: "pending",
                  },
                ],
                recurrenceFirstDueDate: null,
                recurrenceEndDate: null,
                status: "paid",
                paidAt: transactionDate,
                paidByImport: true,
                importedFrom,
                rawBankDescription: item.rawDescription,
                createdBy: firebaseUser.uid,
                createdAt: now,
                updatedAt: now,
              });
              splitExpenseIds.push(createdExpense.id);
            }
            expenseId = splitExpenseIds[0] || "";
          } else if (item.expenseDraft.mode === "new") {
            const expensePayload = {
              accountPlan: item.expenseDraft.accountPlanId,
              accountId: item.expenseDraft.accountPlanId,
              accountPlanName: item.expenseDraft.accountPlanName,
              description: item.expenseDraft.description,
              supplier: item.expenseDraft.supplier || "",
              notes: item.expenseDraft.notes || "",
              totalValue: Math.abs(item.amount),
              competenceDate: Timestamp.fromDate(new Date(`${item.expenseDraft.competenceDate}T12:00:00`)),
              dueDate: transactionDate,
              paymentMethod: "single",
              installmentType: null,
              installmentPeriodicity: null,
              isApportioned: item.expenseDraft.isApportioned,
              resultCenter: item.expenseDraft.isApportioned ? null : item.expenseDraft.resultCenterName || null,
              apportionments: item.expenseDraft.isApportioned
                ? item.expenseDraft.apportionments.map((entry) => ({
                    resultCenter: entry.resultCenterName,
                    percentage: Number(entry.percentage) || 0,
                  }))
                : null,
              installments: [
                {
                  number: 1,
                  dueDate: transactionDate,
                  value: Math.abs(item.amount),
                  status: "pending",
                },
              ],
              recurrenceFirstDueDate: null,
              recurrenceEndDate: null,
              status: "paid",
              paidAt: transactionDate,
              paidByImport: true,
              importedFrom,
              rawBankDescription: item.rawDescription,
              createdBy: firebaseUser.uid,
              createdAt: now,
              updatedAt: now,
            };
            const createdExpense = await addDoc(financialCollection("expenses"), expensePayload);
            expenseId = createdExpense.id;
          } else if (expenseId && !isPurchaseMode) {
            await updateDoc(financialDoc("expenses", expenseId), {
              status: "paid",
              paidAt: transactionDate,
              paidByImport: true,
              updatedAt: now,
            });
          }

          const transactionPayload = {
            type: "expense_payment",
            direction: "out",
            amount: Math.abs(item.amount),
            date: transactionDate,
            description: item.financialDraft.description,
            notes: item.financialDraft.notes || "",
            accountId: item.financialDraft.accountId,
            accountName: item.financialDraft.accountName,
            paymentMethodId: item.financialDraft.paymentMethodId,
            paymentMethodLabel: item.financialDraft.paymentMethodLabel,
            accountPlanId: item.expenseDraft.accountPlanId || null,
            accountPlanName: item.expenseDraft.accountPlanName || null,
            resultCenterId: item.expenseDraft.resultCenterId || null,
            resultCenterName: item.expenseDraft.resultCenterName || null,
            supplier: item.expenseDraft.supplier || null,
            expenseId: expenseId || null,
            linkedExpenseId: expenseId || null,
            splitExpenseIds: splitExpenseIds.length > 0 ? splitExpenseIds : null,
            purchaseOrderId: item.expenseDraft.purchaseOrderId || null,
            purchaseLinkMode: isPurchaseMode ? item.expenseDraft.purchaseLinkMode : null,
            allocatedAmount: isPurchaseMode ? Number(item.expenseDraft.allocatedAmount || Math.abs(item.amount)) : null,
            importedFrom,
            rawBankDescription: item.rawDescription,
            auditStatus: "resolved",
          };
          const createdTransaction = item.linkedBankTransactionId
            ? await updateDoc(financialDoc("transactions", item.linkedBankTransactionId), {
                ...transactionPayload,
                auditedBy: firebaseUser.uid,
                auditedAt: now,
              }).then(() => ({ id: item.linkedBankTransactionId! }))
            : await addDoc(financialCollection("transactions"), {
                ...transactionPayload,
                createdBy: firebaseUser.uid,
                createdAt: now,
              });

          if (expenseId) {
            if (splitExpenseIds.length > 0) {
              await Promise.all(
                splitExpenseIds.map((createdExpenseId) =>
                  updateDoc(financialDoc("expenses", createdExpenseId), {
                    linkedBankTransactionId: createdTransaction.id,
                    updatedAt: now,
                  })
                )
              );
            } else if (isPurchaseMode && purchaseCandidate) {
              const allocationAmount = Number(item.expenseDraft.allocatedAmount || Math.abs(item.amount));
              const goodsAllocation =
                item.expenseDraft.purchaseLinkMode === "goods"
                  ? allocationAmount
                  : item.expenseDraft.purchaseLinkMode === "freight"
                  ? 0
                  : Math.min(allocationAmount, purchaseCandidate.goodsPending);
              const freightAllocation =
                item.expenseDraft.purchaseLinkMode === "freight"
                  ? allocationAmount
                  : item.expenseDraft.purchaseLinkMode === "goods"
                  ? 0
                  : Math.max(allocationAmount - goodsAllocation, 0);
              const nextGoodsPending = Math.max(purchaseCandidate.goodsPending - goodsAllocation, 0);
              const nextFreightPending = Math.max(purchaseCandidate.freightPending - freightAllocation, 0);
              const fullyPaidAfterAllocation = nextGoodsPending <= 0.01 && nextFreightPending <= 0.01;

              await updateDoc(doc(db, "purchase_financials", purchaseCandidate.financialId), {
                goodsAmountPaid: increment(goodsAllocation),
                freightAmountPaid: increment(freightAllocation),
                ...(fullyPaidAfterAllocation
                  ? {
                      status: "paid",
                      paidAt: `${item.financialDraft.date}T12:00:00.000Z`,
                    }
                  : {}),
                updatedAt: new Date().toISOString(),
              });
              purchaseBalances.set(purchaseCandidate.orderId, {
                ...purchaseCandidate,
                goodsPending: nextGoodsPending,
                freightPending: nextFreightPending,
                goodsAmountPaid: purchaseCandidate.goodsAmountPaid + goodsAllocation,
                freightAmountPaid: purchaseCandidate.freightAmountPaid + freightAllocation,
              });

              let installmentsPatch: Record<string, unknown> = {};
              if (item.suggestedInstallmentNumber) {
                const expenseSnapshot = await getDoc(financialDoc("expenses", expenseId));
                const currentInstallments = expenseSnapshot.exists() && Array.isArray(expenseSnapshot.data()?.installments)
                  ? expenseSnapshot.data()!.installments
                  : [];
                const nextInstallments = currentInstallments.map((installment: any, index: number) =>
                  (Number(installment?.number) || index + 1) === item.suggestedInstallmentNumber
                    ? {
                        ...installment,
                        status: "paid",
                        paidAt: transactionDate,
                        linkedBankTransactionId: createdTransaction.id,
                      }
                    : installment
                );
                if (nextInstallments.length > 0) installmentsPatch = { installments: nextInstallments };
              }

              await updateDoc(financialDoc("expenses", expenseId), {
                linkedBankTransactionId: createdTransaction.id,
                ...installmentsPatch,
                updatedAt: now,
                ...(fullyPaidAfterAllocation
                  ? {
                      status: "paid",
                      paidAt: transactionDate,
                      paidByImport: true,
                    }
                  : {}),
              });
            } else {
              await updateDoc(financialDoc("expenses", expenseId), {
                linkedBankTransactionId: createdTransaction.id,
                updatedAt: now,
              });
            }
          }
        } else {
          await addDoc(financialCollection("transactions"), {
            type: "revenue",
            direction: "in",
            amount: Math.abs(item.amount),
            date: transactionDate,
            description: item.financialDraft.description,
            notes: item.financialDraft.notes || "",
            accountId: item.financialDraft.accountId,
            accountName: item.financialDraft.accountName,
            paymentMethodId: item.financialDraft.paymentMethodId,
            paymentMethodLabel: item.financialDraft.paymentMethodLabel,
            revenueCategory: "other",
            revenueSource,
            importedFrom,
            rawBankDescription: item.rawDescription,
            createdBy: firebaseUser.uid,
            createdAt: now,
          });
        }
      }

      const nextItems = currentSession.items.map((item) =>
        item.status === "audited"
          ? {
              ...item,
              status: "completed" as const,
            }
          : item
      );

      const updatedSession = {
        ...currentSession,
        items: nextItems,
        summary: buildSessionSummary(nextItems),
      };

      await patchImportSession(currentSession.id, {
        action: "finalize",
        statementAccountId: updatedSession.statementAccountId,
        statementAccountName: updatedSession.statementAccountName,
        items: serializeSessionItems(updatedSession.items),
      });

      setCurrentSession(updatedSession);
      setIsSessionDirty(false);
      refreshImportSessions();
      toast({ title: `${auditedItems.length} item(ns) efetivado(s) com sucesso.` });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao efetivar a sessão." });
    } finally {
      setIsProcessing(false);
    }
  }

  async function updateSessionStatus(nextStatus: "completed" | "discarded") {
    if (!currentSession || !canEditImportSession(currentSession)) return;

    setIsProcessing(true);
    try {
      await patchImportSession(currentSession.id, {
        action: "status",
        status: nextStatus,
      });
      toast({
        title: nextStatus === "completed" ? "Sessão concluída." : "Sessão descartada.",
      });
      setCurrentSession(null);
      setSelectedSessionId(null);
      setExpandedItemId(null);
      setIsSessionDirty(false);
      replaceSessionUrl(null);
      refreshImportSessions();
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao atualizar a sessão." });
    } finally {
      setIsProcessing(false);
    }
  }

  async function deleteSession(sessionId: string) {
    if (!firebaseUser) return;

    setIsProcessing(true);
    try {
      await patchImportSession(sessionId, {
        action: "status",
        status: "discarded",
      });

      if (currentSessionId === sessionId) {
        setCurrentSession(null);
        setSelectedSessionId(null);
        setExpandedItemId(null);
        setIsSessionDirty(false);
        replaceSessionUrl(null);
      }

      refreshImportSessions();
      toast({ title: "Sessão removida da lista." });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao excluir a sessão." });
    } finally {
      setIsProcessing(false);
    }
  }

  const selectedSession = currentSession;
  const selectedSessionEditable = canEditImportSession(selectedSession);
  const selectedStatementAccountLabel = selectedSession
    ? getAccountDisplayLabel(accounts, selectedSession.statementAccountId, selectedSession.statementAccountName)
    : "";
  const historySessions = useMemo(() => {
    const normalizedSearch = historySearch.trim().toLocaleLowerCase("pt-BR");

    return (sessionsData || [])
      .map(normalizeSession)
      .filter((session) => session.status !== "open")
      .filter((session) => (historyStatusFilter === "all" ? true : session.status === historyStatusFilter))
      .filter((session) => {
        if (!normalizedSearch) return true;
        const accountLabel = getAccountDisplayLabel(accounts, session.statementAccountId, session.statementAccountName);
        return [session.displayName, session.fileName, session.createdByName, accountLabel]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(normalizedSearch));
      })
      .sort((left, right) => (toDate(right.updatedAt)?.getTime() || 0) - (toDate(left.updatedAt)?.getTime() || 0));
  }, [accounts, historySearch, historyStatusFilter, sessionsData]);
  const selectedSessionItems = useMemo(
    () =>
      selectedSession
        ? getSortedItems(selectedSession.items).filter((item) => {
            if (itemStatusFilter !== "all" && item.status !== itemStatusFilter) return false;
            if (directionFilter === "in") return item.amount >= 0;
            if (directionFilter === "out") return item.amount < 0;
            return true;
          })
        : [],
    [directionFilter, itemStatusFilter, selectedSession]
  );
  const selectedSessionCounts = useMemo(
    () => ({
      all: selectedSession?.items.length ?? 0,
      pending: selectedSession?.items.filter((item) => item.status === "pending").length ?? 0,
      audited: selectedSession?.items.filter((item) => item.status === "audited").length ?? 0,
      completed: selectedSession?.items.filter((item) => item.status === "completed").length ?? 0,
      ignored: selectedSession?.items.filter((item) => item.status === "ignored").length ?? 0,
    }),
    [selectedSession]
  );
  const selectedSessionPeriodSummary = useMemo(() => {
    const items = selectedSession?.items ?? [];
    const entries = items.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
    const exits = items.filter((item) => item.amount < 0).reduce((sum, item) => sum + Math.abs(item.amount), 0);
    return {
      entries,
      exits,
      balance: entries - exits,
    };
  }, [selectedSession]);
  const selectedDetailItem = useMemo(
    () => (expandedItemId ? selectedSessionItems.find((item) => item.id === expandedItemId) ?? null : null),
    [expandedItemId, selectedSessionItems]
  );
  const selectedValidation = useMemo(
    () => (selectedDetailItem ? validateItem(selectedDetailItem, purchaseCandidatesByOrderId) : null),
    [purchaseCandidatesByOrderId, selectedDetailItem]
  );
  const selectedChecklist = useMemo(() => {
    if (!selectedDetailItem || !selectedValidation) return [];
    const isIncome = selectedDetailItem.amount >= 0;
    const isTransfer = selectedDetailItem.financialDraft.movementKind === "transfer";
    if (isIncome) {
      return [
        {
          label: "Definir onde e como o dinheiro entrou",
          done:
            selectedDetailItem.financialDraft.accountId.trim().length > 0 &&
            selectedDetailItem.financialDraft.paymentMethodId.trim().length > 0,
        },
        {
          label: "Conferir data e descrição do extrato",
          done:
            selectedDetailItem.financialDraft.date.trim().length > 0 &&
            selectedDetailItem.financialDraft.description.trim().length >= 3,
        },
        {
          label: "Validar sugestão de receita bancária",
          done: selectedValidation.expenseValid,
        },
        {
          label: "Marcar receita como auditada",
          done: selectedDetailItem.status === "audited" || selectedDetailItem.status === "completed",
        },
        {
          label: "Efetivar receita no fluxo financeiro",
          done: selectedDetailItem.status === "completed",
        },
      ];
    }

    return [
      {
        label: "Definir de onde e como o dinheiro saiu",
        done:
          selectedDetailItem.financialDraft.accountId.trim().length > 0 &&
          selectedDetailItem.financialDraft.paymentMethodId.trim().length > 0,
      },
      {
        label: "Data e descrição do extrato conferidas",
        done:
          selectedDetailItem.financialDraft.date.trim().length > 0 &&
          selectedDetailItem.financialDraft.description.trim().length >= 3,
      },
      {
        label: isIncome ? "Receita pronta para registrar" : isTransfer ? "Transferência validada" : "Despesa tratada",
        done: selectedValidation.expenseValid,
      },
      {
        label: "Item auditado",
        done: selectedDetailItem.status === "audited" || selectedDetailItem.status === "completed",
      },
      {
        label: "Efetivado no financeiro",
        done: selectedDetailItem.status === "completed",
      },
    ];
  }, [selectedDetailItem, selectedValidation]);
  const selectedChecklistDone = selectedChecklist.filter((item) => item.done).length;

  function getItemSuggestion(item: ImportSessionItem) {
    if (item.amount >= 0) {
      return {
        badge: "receita",
        text: item.financialDraft.description || "Registrar como receita bancária",
        className: "bg-emerald-100 text-emerald-700",
      };
    }

    return {
      badge:
        item.suggestedConfidence === "high"
          ? "98% match"
          : item.suggestedConfidence === "medium"
          ? "72% match"
          : "sem match",
      text: item.expenseDraft.description || "Sem sugestão",
      className:
        item.suggestedConfidence === "high"
          ? "bg-emerald-100 text-emerald-700"
          : item.suggestedConfidence === "medium"
          ? "bg-amber-100 text-amber-700"
          : "bg-zinc-100 text-zinc-500",
    };
  }

  function applyExistingExpense(itemId: string, expense: any) {
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: {
        ...current.expenseDraft,
        mode: "existing",
        linkedExpenseId: expense.id,
        purchaseOrderId: "",
        description: expense.description || current.expenseDraft.description,
        supplier: expense.supplier || current.expenseDraft.supplier,
        accountPlanId: expense.accountPlan || expense.accountPlanId || current.expenseDraft.accountPlanId,
        accountPlanName: expense.accountPlanName || current.expenseDraft.accountPlanName,
        resultCenterId: expense.resultCenterId || current.expenseDraft.resultCenterId,
        resultCenterName: expense.resultCenter || expense.resultCenterName || current.expenseDraft.resultCenterName,
        isApportioned: false,
        apportionments: [],
      },
    }));
  }

  function switchToNewExpense(itemId: string) {
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: {
        ...current.expenseDraft,
        mode: "new",
        linkedExpenseId: "",
        purchaseOrderId: "",
        description: current.expenseDraft.description || current.rawDescription,
        allocatedAmount: Math.abs(current.amount),
      },
    }));
  }

  function switchToSplitExpenses(itemId: string) {
    updateItem(itemId, (current) => {
      const total = Math.abs(current.amount);
      const existingSplits = current.expenseDraft.splitExpenses.length
        ? current.expenseDraft.splitExpenses
        : [
            createSplitExpenseEntry({
              description: current.expenseDraft.description || current.rawDescription,
              supplier: current.expenseDraft.supplier,
              accountPlanId: current.expenseDraft.accountPlanId,
              accountPlanName: current.expenseDraft.accountPlanName,
              resultCenterId: current.expenseDraft.resultCenterId,
              resultCenterName: current.expenseDraft.resultCenterName,
              competenceDate: current.expenseDraft.competenceDate || current.date.slice(0, 7) + "-01",
              value: Number((total / 2).toFixed(2)),
            }),
            createSplitExpenseEntry({
              description: current.expenseDraft.description || current.rawDescription,
              supplier: current.expenseDraft.supplier,
              accountPlanId: current.expenseDraft.accountPlanId,
              accountPlanName: current.expenseDraft.accountPlanName,
              resultCenterId: current.expenseDraft.resultCenterId,
              resultCenterName: current.expenseDraft.resultCenterName,
              competenceDate: current.expenseDraft.competenceDate || current.date.slice(0, 7) + "-01",
              value: Number((total - Number((total / 2).toFixed(2))).toFixed(2)),
            }),
          ];

      return {
        ...current,
        expenseDraft: {
          ...current.expenseDraft,
          mode: "split",
          linkedExpenseId: "",
          purchaseOrderId: "",
          splitExpenses: existingSplits,
        },
      };
    });
  }

  function updateSplitExpense(
    itemId: string,
    splitId: string,
    updater: (entry: ImportSessionItem["expenseDraft"]["splitExpenses"][number]) => ImportSessionItem["expenseDraft"]["splitExpenses"][number]
  ) {
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: {
        ...current.expenseDraft,
        splitExpenses: current.expenseDraft.splitExpenses.map((entry) => (entry.id === splitId ? updater(entry) : entry)),
      },
    }));
  }

  function addSplitExpense(itemId: string) {
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: {
        ...current.expenseDraft,
        splitExpenses: [
          ...current.expenseDraft.splitExpenses,
          createSplitExpenseEntry({
            description: current.expenseDraft.description || current.rawDescription,
            supplier: current.expenseDraft.supplier,
            accountPlanId: current.expenseDraft.accountPlanId,
            accountPlanName: current.expenseDraft.accountPlanName,
            resultCenterId: current.expenseDraft.resultCenterId,
            resultCenterName: current.expenseDraft.resultCenterName,
            competenceDate: current.expenseDraft.competenceDate || current.date.slice(0, 7) + "-01",
          }),
        ],
      },
    }));
  }

  function removeSplitExpense(itemId: string, splitId: string) {
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: {
        ...current.expenseDraft,
        splitExpenses: current.expenseDraft.splitExpenses.filter((entry) => entry.id !== splitId),
      },
    }));
  }

  useEffect(() => {
    if (selectedSessionItems.length === 0) {
      if (expandedItemId !== null) {
        setExpandedItemId(null);
      }
      return;
    }

    if (expandedItemId && !selectedSessionItems.some((item) => item.id === expandedItemId)) {
      setExpandedItemId(null);
    }
  }, [expandedItemId, selectedSessionItems]);

  if (!permissions.financial?.expenses?.import) {
    return (
      <FinancialAccessGuard
        title="Importar extrato"
        description="Seu perfil não possui permissão para importar extratos e efetivar transações no financeiro."
        backHref={FINANCIAL_ROUTES.expenses}
      />
    );
  }

  return (
    <div className={cn("mx-auto w-full max-w-[1460px] space-y-4", embedded && "max-w-none")}>
      {!embedded ? (
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border/70 bg-background/80 px-5 py-4 shadow-sm backdrop-blur">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Financeiro / Importações</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Importar extrato bancário</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Concilie pagamentos com despesas provisionadas. OFX, CSV e Pix-API.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-xl" disabled={isProcessing}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Sincronizar bancos
            </Button>
            <Button size="sm" className="rounded-xl" onClick={() => fileRef.current?.click()} disabled={isProcessing}>
              <Upload className="mr-2 h-4 w-4" />
              Importar arquivo
            </Button>
          </div>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept={fileType === "ofx" ? ".ofx" : ".csv,.txt"}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!statementAccountId) {
            toast({ variant: "destructive", title: "Selecione a conta vinculada ao extrato antes de importar." });
            return;
          }
          if (file) void processFile(file);
        }}
      />

      {selectedSession ? (
        <Card className="h-[min(720px,calc(100vh-215px))] min-h-[590px] overflow-hidden rounded-[30px] border-border/70 bg-background shadow-sm">
          <div
            className="grid h-full min-h-0 min-w-0"
            style={{ gridTemplateColumns: sessionsSidebarOpen ? "286px minmax(560px, 1fr) 360px" : "40px 560px minmax(360px, 1fr)" }}
          >
            <div className="flex min-h-0 flex-col border-r bg-[#fbfbfc]">
              <div className="border-b px-4 py-3">
                {sessionsSidebarOpen ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sessões</p>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="rounded-full text-[10px]">{visibleOpenSessions.length}</Badge>
                      <button type="button" onClick={() => setSessionsSidebarOpen(false)} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <PanelLeftClose className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setSessionsSidebarOpen(true)} className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                    <PanelLeftOpen className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className={cn("min-h-0 flex-1 space-y-3 overflow-y-auto p-3", !sessionsSidebarOpen && "hidden")}>
                <div className="space-y-2">
                  {fileType === "csv" && (
                    <Select value={bankProfile} onValueChange={setBankProfile}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(CSV_BANK_PROFILES).map(([value, profile]) => (
                          <SelectItem key={value} value={value}>
                            {profile.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={statementAccountId || "none"} onValueChange={(value) => setStatementAccountId(value === "none" ? "" : value)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Conta do extrato" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {getAccountOptionLabel(account, unitNameById)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {showImportControls ? (
                <button
                  type="button"
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                    const file = event.dataTransfer.files?.[0];
                    if (file) void processFile(file);
                  }}
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    "w-full rounded-2xl border border-dashed px-4 py-3 text-left transition-colors",
                    isDragging ? "border-primary bg-primary/5" : "border-border bg-background/80 hover:border-primary/40 hover:bg-background"
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    Arrastar OFX/CSV
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">ou clique para escolher</p>
                </button>
                ) : null}

                <div className="space-y-2">
                  {visibleOpenSessions.map((session) => {
                    const isSelected = session.id === selectedSession.id;
                    const periodLabel = getSessionPeriodLabel(session);

                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => {
                          setSelectedSessionId(session.id);
                          setCurrentSession(session);
                          setExpandedItemId(session.items[0]?.id ?? null);
                          setIsSessionDirty(false);
                          replaceSessionUrl(session.id);
                        }}
                        className={cn(
                          "w-full rounded-2xl border px-3 py-3 text-left transition-colors",
                          isSelected
                            ? "border-primary/40 bg-background shadow-sm ring-1 ring-primary/10"
                            : "border-transparent bg-background/70 hover:border-primary/30 hover:bg-background"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={cn(
                              "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                              isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                            )}
                          >
                            {visibleOpenSessions.findIndex((entry) => entry.id === session.id) + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{periodLabel}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {getAccountDisplayLabel(accounts, session.statementAccountId, session.statementAccountName, unitNameById) || session.displayName}
                            </p>
                            <Badge
                              variant="outline"
                              className={cn(
                                "mt-1 rounded-full px-1.5 py-0 text-[9.5px] font-medium normal-case tracking-normal",
                                IMPORT_SESSION_ORIGIN_CLASSES[session.origin]
                              )}
                            >
                              {session.originLabel || IMPORT_SESSION_ORIGIN_LABELS[session.origin]}
                            </Badge>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {toDate(session.updatedAt) ? format(toDate(session.updatedAt)!, "dd/MM/yyyy") : "—"}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-end justify-between gap-3">
                          <div className="min-w-0">
                            {isSelected ? <div className="h-1.5 w-7 rounded-full bg-amber-400" /> : null}
                            <p className="mt-1 text-[10.5px] text-muted-foreground">
                              {session.summary.audited + session.summary.completed} de {session.items.length} conciliados
                            </p>
                          </div>
                          {session.summary.pending === 0 ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-col border-r">
              <div className="space-y-2 border-b px-4 py-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {selectedSession.origin === "bank_statement" ? "Transações do extrato" : "Itens para auditoria"}
                    </p>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                      <p className="truncate text-[11px] text-muted-foreground">{selectedSession.displayName}</p>
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full px-1.5 py-0 text-[9.5px] font-medium normal-case tracking-normal",
                          IMPORT_SESSION_ORIGIN_CLASSES[selectedSession.origin]
                        )}
                      >
                        {selectedSession.originLabel || IMPORT_SESSION_ORIGIN_LABELS[selectedSession.origin]}
                      </Badge>
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {selectedSession.items.length} itens
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</p>
                    <div className="grid grid-cols-5 gap-1 rounded-xl bg-muted/50 p-1">
                      {([
                        ["all", "Todos", selectedSession.items.length],
                        ["pending", "Pendentes", selectedSessionCounts.pending],
                        ["audited", "Auditadas", selectedSessionCounts.audited],
                        ["completed", "Efetivadas", selectedSessionCounts.completed],
                        ["ignored", "Ignoradas", selectedSessionCounts.ignored],
                      ] as const).map(([value, label, count]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setItemStatusFilter(value)}
                          className={cn(
                            "flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[10.5px] font-medium transition-colors",
                            itemStatusFilter === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <span>{label}</span>
                          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9.5px] leading-none text-muted-foreground">
                            {count}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Movimentação</p>
                      <div className="flex rounded-full bg-muted/50 p-1">
                        {([
                          ["all", "Todas"],
                          ["out", "Saídas"],
                          ["in", "Entradas"],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setDirectionFilter(value)}
                            className={cn(
                              "rounded-full px-3 py-1 text-[10.5px] font-medium transition-colors",
                              directionFilter === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <span className="pb-1.5 whitespace-nowrap text-[10.5px] text-muted-foreground">
                      Exibindo {selectedSessionItems.length} de {selectedSession.items.length}
                    </span>
                  </div>
                </div>
              </div>

              <div
                className="grid items-center gap-3 border-b bg-muted/20 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                style={{ gridTemplateColumns: "28px minmax(0, 1fr) 104px 140px" }}
              >
                <span />
                <span>Descrição</span>
                <span>Tipo</span>
                <span className="text-right">Valor</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {selectedSessionItems.map((item) => {
                  const isSelected = selectedDetailItem?.id === item.id;
                  const isExpense = item.amount < 0;
                  const primaryDescription = getTransactionPrimaryDescription(item);
                  const kindLabel = getTransactionKindLabel(item);
                  const statusMeta = IMPORT_ITEM_STATUS_META[item.status];

                  return (
                    <Fragment key={item.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedItemId(isSelected ? null : item.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setExpandedItemId(isSelected ? null : item.id);
                          }
                        }}
                        className={cn(
                          "grid w-full cursor-pointer items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/20",
                          isSelected && "border-l-2 border-l-primary bg-primary/5"
                        )}
                        style={{ gridTemplateColumns: "28px minmax(0, 1fr) 104px 140px" }}
                      >
                        <div
                          className={cn(
                            "grid h-6 w-6 place-items-center rounded-full border bg-background text-muted-foreground",
                            isSelected && "border-primary/40 bg-primary/10 text-primary"
                          )}
                        >
                          {isSelected ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="truncate font-sans text-sm font-semibold leading-tight">{primaryDescription}</p>
                          <p className="truncate text-xs leading-tight text-muted-foreground">
                            {formatInputDate(item.date)} · {item.rawDescription}
                          </p>
                        </div>
                        <div className="min-w-0 space-y-1">
                          <Badge className={cn("rounded-full px-2 py-0.5 text-[10.5px] hover:bg-current/0", getTransactionKindClassName(item))}>
                            {kindLabel}
                          </Badge>
                          <div>
                            <Badge
                              variant="outline"
                              className={cn("rounded-full px-2 py-0.5 text-[9.5px] font-semibold", statusMeta.className)}
                            >
                              {statusMeta.label}
                            </Badge>
                          </div>
                        </div>
                        <p className={cn("whitespace-nowrap text-right font-mono text-sm font-semibold", isExpense ? "text-rose-600" : "text-emerald-600")}>
                          {isExpense ? "− " : "+ "}
                          {formatCurrency(Math.abs(item.amount))}
                        </p>
                      </div>

                    </Fragment>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-2.5 text-xs">
                <span className="text-muted-foreground">{selectedSessionItems.length} transações</span>
                <div className="flex gap-2">
                  {selectedSessionCounts.audited > 0 && (
                    <Button variant="ghost" size="sm" className="h-8 rounded-xl text-[11px]">Marcar como ignorar</Button>
                  )}
                  <Button size="sm" className="h-8 rounded-xl text-[11px]" onClick={finalizeAuditedItems} disabled={!selectedSessionEditable || isProcessing}>
                    Efetivar auditadas
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#fbfbfc]">
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Resumo geral</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                  onClick={() => setGeneralSummaryOpen((current) => !current)}
                  aria-expanded={generalSummaryOpen}
                  aria-label={generalSummaryOpen ? "Recolher resumo geral" : "Expandir resumo geral"}
                  title={generalSummaryOpen ? "Recolher resumo geral" : "Expandir resumo geral"}
                >
                  {generalSummaryOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                {generalSummaryOpen ? <div className="sticky top-0 z-10 border-b bg-[#fbfbfc] p-4">
                  <div className="rounded-2xl border bg-background p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Período da sessão</p>
                        <p className="mt-1 text-xs text-muted-foreground">{getSessionPeriodLabel(selectedSession)}</p>
                      </div>
                      <Badge variant="outline" className="rounded-full">
                        {selectedSession.items.length} itens
                      </Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2.5">
                      <div className="rounded-2xl bg-muted/60 p-3.5">
                        <p className="text-sm text-muted-foreground">Entradas</p>
                        <p className="mt-2 font-mono text-sm font-semibold text-emerald-600">
                          {formatCurrency(selectedSessionPeriodSummary.entries)}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-muted/60 p-3.5">
                        <p className="text-sm text-muted-foreground">Saídas</p>
                        <p className="mt-2 font-mono text-sm font-semibold text-rose-700">
                          {formatCurrency(selectedSessionPeriodSummary.exits)}
                        </p>
                      </div>
                      <div className="col-span-2 rounded-2xl bg-muted/60 p-3.5">
                        <p className="text-sm text-muted-foreground">Saldo do período</p>
                        <p
                          className={cn(
                            "mt-2 truncate font-mono text-xl font-semibold",
                            selectedSessionPeriodSummary.balance >= 0 ? "text-emerald-600" : "text-rose-700"
                          )}
                        >
                          {selectedSessionPeriodSummary.balance >= 0 ? "+" : "−"}{formatCurrency(Math.abs(selectedSessionPeriodSummary.balance))}
                        </p>
                      </div>
                    </div>
                  </div>
                </div> : null}
              {selectedDetailItem && selectedValidation ? (() => {
                const item = selectedDetailItem;
                const validation = selectedValidation;
                const isIncomingMovement = item.amount >= 0;
                const currentMethods = getMethodsForAccount(item.financialDraft.accountId);
                const existingOptions = getFilteredExistingExpenses(item.id, item.suggestedExpenseId).slice(0, 8);
                const purchaseOptions = getFilteredPurchaseCandidates(item.id).slice(0, 8);
                const selectedPurchaseCandidate = item.expenseDraft.purchaseOrderId
                  ? purchaseCandidatesByOrderId.get(item.expenseDraft.purchaseOrderId) ?? null
                  : null;
                return (
                  <div className="min-w-0 space-y-3 p-4">
                    <div className="rounded-2xl border bg-background p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">Auditoria da transação</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selectedChecklistDone} de {selectedChecklist.length} etapas concluídas.
                          </p>
                        </div>
                        <Badge
                          className={cn(
                            "rounded-full",
                            item.status === "completed"
                              ? "bg-emerald-600"
                              : item.status === "audited"
                              ? "bg-blue-600"
                              : item.status === "ignored"
                              ? "bg-zinc-500"
                              : "bg-amber-500"
                          )}
                        >
                          {item.status === "completed"
                            ? "Efetivada"
                            : item.status === "audited"
                            ? "Auditada"
                            : item.status === "ignored"
                            ? "Ignorada"
                            : "Pendente"}
                        </Badge>
                      </div>
                      <div className="mt-3 flex gap-1">
                        {selectedChecklist.map((step, idx) => (
                          <div
                            key={idx}
                            className={cn("h-1.5 flex-1 rounded-full transition-all", step.done ? "bg-primary" : "bg-muted")}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border bg-background p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Movimentação selecionada
                        </p>
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 rounded-full",
                            isIncomingMovement
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-rose-200 bg-rose-50 text-rose-700"
                          )}
                        >
                          {isIncomingMovement ? "Entrada" : "Saída"}
                        </Badge>
                      </div>
                      <p className="mt-3 break-words text-sm font-semibold leading-snug">
                        {item.rawDescription || "Movimentação sem descrição no extrato"}
                      </p>
                      <div className="mt-3 flex items-end justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
                        <div>
                          <p className="text-[11px] text-muted-foreground">Data no extrato</p>
                          <p className="mt-1 text-sm font-medium">{formatInputDate(item.date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] text-muted-foreground">Valor</p>
                          <p
                            className={cn(
                              "mt-1 whitespace-nowrap font-mono text-sm font-semibold",
                              isIncomingMovement ? "text-emerald-600" : "text-rose-700"
                            )}
                          >
                            {isIncomingMovement ? "+" : "−"} {formatCurrency(Math.abs(item.amount))}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0 overflow-hidden rounded-2xl border border-sky-100 bg-sky-50/50 p-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-800">
                        1. {isIncomingMovement ? "Destino do recebimento" : "Origem do pagamento"}
                      </p>
                      <div className="grid min-w-0 gap-3">
                        <div className="min-w-0 space-y-1.5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                            {isIncomingMovement ? "Onde entrou" : "De onde saiu"}
                          </p>
                          <Select
                            value={item.financialDraft.accountId || "none"}
                            onValueChange={(value) => {
                              const accountId = value === "none" ? "" : value;
                              const accountName = accountId ? getAccountName(accountId) : "";
                              updateItem(item.id, (current) => ({
                                ...current,
                                financialDraft: {
                                  ...current.financialDraft,
                                  accountId,
                                  accountName,
                                  paymentMethodId: "",
                                  paymentMethodLabel: "",
                                },
                              }));
                            }}
                          >
                            <SelectTrigger className="h-9 w-full min-w-0 max-w-full overflow-hidden rounded-xl text-xs [&>span]:block [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left [&>svg]:shrink-0">
                              <SelectValue placeholder={isIncomingMovement ? "Selecione onde entrou" : "Selecione de onde saiu"} />
                            </SelectTrigger>
                            <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-24px)]">
                              <SelectItem value="none">
                                {isIncomingMovement ? "Selecione onde entrou" : "Selecione de onde saiu"}
                              </SelectItem>
                              {accounts.map((account) => (
                                <SelectItem key={account.id} value={account.id}>
                                  {getAccountOptionLabel(account, unitNameById)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="min-w-0 space-y-1.5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                            {isIncomingMovement ? "Como entrou" : "Como saiu"}
                          </p>
                          <Select
                            value={item.financialDraft.paymentMethodId || "none"}
                            onValueChange={(value) => {
                              const methodId = value === "none" ? "" : value;
                              updateItem(item.id, (current) => ({
                                ...current,
                                financialDraft: {
                                  ...current.financialDraft,
                                  paymentMethodId: methodId,
                                  paymentMethodLabel: methodId ? getMethodLabel(current.financialDraft.accountId, methodId) : "",
                                },
                              }));
                            }}
                          >
                            <SelectTrigger className="h-9 w-full min-w-0 max-w-full overflow-hidden rounded-xl text-xs [&>span]:block [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left [&>svg]:shrink-0">
                              <SelectValue placeholder={isIncomingMovement ? "Selecione como entrou" : "Selecione como saiu"} />
                            </SelectTrigger>
                            <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-24px)]">
                              <SelectItem value="none">
                                {isIncomingMovement ? "Selecione como entrou" : "Selecione como saiu"}
                              </SelectItem>
                              {currentMethods.map((method: any) => (
                                <SelectItem key={method.id} value={method.id}>
                                  {method.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-violet-100 bg-violet-50/50 p-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-800">
                        2. Conferência do extrato
                      </p>
                      <div className="grid gap-3 grid-cols-[110px_1fr]">
                        <Input
                          type="date"
                          value={item.financialDraft.date}
                          onChange={(event) =>
                            updateItem(item.id, (current) => ({
                              ...current,
                              financialDraft: { ...current.financialDraft, date: event.target.value },
                            }))
                          }
                          className="h-9 rounded-xl text-xs"
                        />
                        <Input
                          value={item.financialDraft.description}
                          onChange={(event) =>
                            updateItem(item.id, (current) => ({
                              ...current,
                              financialDraft: { ...current.financialDraft, description: event.target.value },
                            }))
                          }
                          className="h-9 rounded-xl text-xs"
                          placeholder="Descrição no fluxo financeiro"
                        />
                      </div>
                    </div>

                    {item.amount >= 0 ? (
                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm">
                        <p className="font-semibold text-emerald-800">3. Validar sugestão de receita</p>
                        <p className="mt-1 text-xs text-emerald-700">
                          Esta entrada será registrada como receita bancária no fluxo de caixa usando a conta, forma e descrição acima.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-2xl border border-amber-100 bg-amber-50/50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                          3. Tratamento da despesa
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {([
                            ["existing", "Vincular existente"],
                            ["new", "Criar nova despesa"],
                            ["purchase", "Vincular compra"],
                            ["split", "Dividir"],
                          ] as const).map(([mode, label]) => (
                            <Button
                              key={mode}
                              type="button"
                              size="sm"
                              variant={item.expenseDraft.mode === mode ? "default" : "outline"}
                              className="h-8 rounded-xl text-xs"
                              onClick={() => {
                                if (mode === "new") { switchToNewExpense(item.id); return; }
                                if (mode === "split") { switchToSplitExpenses(item.id); return; }
                                updateItem(item.id, (current) => ({
                                  ...current,
                                  expenseDraft: { ...current.expenseDraft, mode },
                                }));
                              }}
                            >
                              {label}
                            </Button>
                          ))}
                        </div>

                        {item.expenseDraft.mode === "existing" ? (
                          <div className="space-y-2">
                            <Input
                              value={existingExpenseSearchByItem[item.id] || ""}
                              onChange={(event) =>
                                setExistingExpenseSearchByItem((current) => ({ ...current, [item.id]: event.target.value }))
                              }
                              className="h-9 rounded-xl text-xs"
                              placeholder="Buscar despesa por descrição, fornecedor ou valor"
                            />
                            <Select
                              value={item.expenseDraft.linkedExpenseId || "none"}
                              onValueChange={(value) => {
                                const expense = linkableExpenses.find((entry) => entry.id === value);
                                if (expense) applyExistingExpense(item.id, expense);
                              }}
                            >
                              <SelectTrigger className="h-9 rounded-xl text-xs">
                                <SelectValue placeholder="Selecione a despesa existente" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Selecione a despesa existente</SelectItem>
                                {existingOptions.map((expense) => (
                                  <SelectItem key={expense.id} value={expense.id}>
                                    {buildExpenseOptionLabel(expense)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}

                        {item.expenseDraft.mode === "new" ? (
                          <div className="grid gap-3">
                            <Input
                              value={item.expenseDraft.description}
                              onChange={(event) => setExpenseDescription(item.id, event.target.value)}
                              className="h-9 rounded-xl text-xs"
                              placeholder="Descrição da despesa"
                            />
                            <AccountPlanTreeSelect
                              value={item.expenseDraft.accountPlanId}
                              onChange={(value) => {
                                const account = flattenedAccounts.find((entry) => entry.id === value);
                                updateItem(item.id, (current) => ({
                                  ...current,
                                  expenseDraft: {
                                    ...current.expenseDraft,
                                    accountPlanId: value,
                                    accountPlanName: account?.name || "",
                                  },
                                }));
                              }}
                              options={accountPlansList}
                              placeholder="Plano de contas"
                              triggerClassName="h-9 rounded-xl text-xs"
                            />
                            <ResultCenterSelect
                              value={item.expenseDraft.resultCenterId}
                              onChange={(value) => {
                                const unit = units.find((entry) => entry.id === value);
                                updateItem(item.id, (current) => ({
                                  ...current,
                                  expenseDraft: {
                                    ...current.expenseDraft,
                                    resultCenterId: value,
                                    resultCenterName: unit?.name || "",
                                  },
                                }));
                              }}
                              options={units}
                              placeholder="Unidade"
                              searchPlaceholder="Buscar unidade..."
                              triggerClassName="h-9 rounded-xl text-xs"
                            />
                          </div>
                        ) : null}

                        {item.expenseDraft.mode === "purchase" ? (
                          <div className="space-y-3">
                            <Input
                              value={purchaseSearchByItem[item.id] || ""}
                              onChange={(event) =>
                                setPurchaseSearchByItem((current) => ({ ...current, [item.id]: event.target.value }))
                              }
                              className="h-9 rounded-xl text-xs"
                              placeholder="Buscar compra por fornecedor, pedido ou valor"
                            />
                            <Select
                              value={item.expenseDraft.purchaseOrderId || "none"}
                              onValueChange={(value) => {
                                const candidate = selectablePurchaseCandidates.find((entry) => entry.orderId === value);
                                if (candidate) applyPurchaseCandidate(item.id, candidate);
                              }}
                            >
                              <SelectTrigger className="h-9 rounded-xl text-xs">
                                <SelectValue placeholder="Selecione a compra" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Selecione a compra</SelectItem>
                                {purchaseOptions.map((candidate) => (
                                  <SelectItem key={candidate.orderId} value={candidate.orderId}>
                                    {candidate.label} • {candidate.supplierName} • {formatCurrency(candidate.goodsPending + candidate.freightPending)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {selectedPurchaseCandidate ? (
                              <div className="grid gap-3 rounded-2xl border bg-muted/20 p-3 grid-cols-2">
                                <div className="space-y-1.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Vincular como</p>
                                  <Select
                                    value={item.expenseDraft.purchaseLinkMode}
                                    onValueChange={(value) => {
                                      const linkMode = value as ImportSessionPurchaseLinkMode;
                                      updateItem(item.id, (current) => ({
                                        ...current,
                                        expenseDraft: {
                                          ...current.expenseDraft,
                                          purchaseLinkMode: linkMode,
                                          allocatedAmount: Math.min(
                                            Math.abs(current.amount),
                                            getEligibleAllocationAmount(
                                              { ...current, expenseDraft: { ...current.expenseDraft, purchaseLinkMode: linkMode } },
                                              selectedPurchaseCandidate
                                            )
                                          ),
                                        },
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="h-9 rounded-xl text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(["goods", "freight", "combined"] as ImportSessionPurchaseLinkMode[]).map((mode) => (
                                        <SelectItem key={mode} value={mode}>
                                          {PURCHASE_LINK_MODE_LABELS[mode]}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Valor apropriado</p>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={item.expenseDraft.allocatedAmount}
                                    onChange={(event) =>
                                      updateItem(item.id, (current) => ({
                                        ...current,
                                        expenseDraft: {
                                          ...current.expenseDraft,
                                          allocatedAmount: Number(event.target.value) || 0,
                                        },
                                      }))
                                    }
                                    className="h-9 rounded-xl text-xs"
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {item.expenseDraft.mode === "split" ? (
                          <div className="space-y-3 rounded-2xl border bg-muted/10 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold">Despesas divididas</p>
                                <p className="text-xs text-muted-foreground">
                                  Soma: {formatCurrency(item.expenseDraft.splitExpenses.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0))} de{" "}
                                  {formatCurrency(Math.abs(item.amount))}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-xl text-xs"
                                onClick={() => addSplitExpense(item.id)}
                              >
                                <Plus className="mr-1 h-3.5 w-3.5" />
                                Adicionar
                              </Button>
                            </div>
                            <div className="space-y-3">
                              {item.expenseDraft.splitExpenses.map((split, splitIndex) => (
                                <div key={split.id} className="rounded-2xl border bg-background p-3">
                                  <div className="mb-3 flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                      Despesa {splitIndex + 1}
                                    </p>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 rounded-lg text-muted-foreground"
                                      onClick={() => removeSplitExpense(item.id, split.id)}
                                      disabled={item.expenseDraft.splitExpenses.length <= 2}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                  <div className="grid gap-3 grid-cols-2">
                                    <Input
                                      value={split.description}
                                      onChange={(event) =>
                                        updateSplitExpense(item.id, split.id, (current) => ({
                                          ...current,
                                          description: event.target.value,
                                        }))
                                      }
                                      className="h-9 rounded-xl text-xs col-span-2"
                                      placeholder="Descrição da despesa"
                                    />
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={split.value}
                                      onChange={(event) =>
                                        updateSplitExpense(item.id, split.id, (current) => ({
                                          ...current,
                                          value: Number(event.target.value) || 0,
                                        }))
                                      }
                                      className="h-9 rounded-xl text-xs"
                                      placeholder="Valor"
                                    />
                                    <Input
                                      type="month"
                                      value={split.competenceDate ? split.competenceDate.slice(0, 7) : ""}
                                      onChange={(event) =>
                                        updateSplitExpense(item.id, split.id, (current) => ({
                                          ...current,
                                          competenceDate: event.target.value ? `${event.target.value}-01` : "",
                                        }))
                                      }
                                      className="h-9 rounded-xl text-xs"
                                    />
                                    <AccountPlanTreeSelect
                                      value={split.accountPlanId}
                                      onChange={(value) => {
                                        const account = flattenedAccounts.find((entry) => entry.id === value);
                                        updateSplitExpense(item.id, split.id, (current) => ({
                                          ...current,
                                          accountPlanId: value,
                                          accountPlanName: account?.name || "",
                                        }));
                                      }}
                                      options={accountPlansList}
                                      placeholder="Plano de contas"
                                      triggerClassName="h-9 rounded-xl text-xs"
                                    />
                                    <ResultCenterSelect
                                      value={split.resultCenterId}
                                      onChange={(value) => {
                                        const unit = units.find((entry) => entry.id === value);
                                        updateSplitExpense(item.id, split.id, (current) => ({
                                          ...current,
                                          resultCenterId: value,
                                          resultCenterName: unit?.name || "",
                                        }));
                                      }}
                                      options={units}
                                      placeholder="Unidade"
                                      searchPlaceholder="Buscar unidade..."
                                      triggerClassName="h-9 rounded-xl text-xs"
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}

                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-700">
                        4. Auditoria e efetivação
                      </p>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-xl"
                          onClick={() => setItemStatus(item.id, item.status === "ignored" ? "pending" : "ignored")}
                        >
                          {item.status === "ignored" ? "Reabrir" : "Ignorar"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-xl"
                          disabled={
                            !validation.ready ||
                            !selectedSessionEditable ||
                            isSavingSession ||
                            item.status === "audited" ||
                            item.status === "completed"
                          }
                          onClick={() => void confirmAuditItem(item.id)}
                        >
                          {isSavingSession ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {item.status === "completed"
                            ? "Efetivada"
                            : item.status === "audited"
                            ? "Auditoria confirmada"
                            : "Confirmar etapa"}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-2xl border bg-background p-4 shadow-sm">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Checklist</p>
                      <div className="mt-3 space-y-2">
                        {selectedChecklist.map((entry, index) => (
                          <div key={entry.label} className="flex items-start gap-2">
                            <span
                              className={cn(
                                "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                                entry.done
                                  ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                  : "border-muted-foreground/20 bg-transparent text-transparent"
                              )}
                            >
                              {entry.done ? <Check className="h-3.5 w-3.5" /> : null}
                            </span>
                            <p className={cn("text-xs", entry.done ? "text-foreground" : "text-muted-foreground")}>
                              {index + 1}. {entry.label}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                  Selecione uma transação para ver o resumo.
                </div>
              )}
              </div>
            </div>
          </div>
        </Card>
      ) : statementAccountId && visibleOpenSessions.length === 0 ? (
        <Card className="mx-auto max-w-[1120px] rounded-2xl border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle>Nenhuma sessão aberta para esta conta</CardTitle>
            <CardDescription>
              Selecione outra conta ou importe o extrato para iniciar uma nova auditoria.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={statementAccountId} onValueChange={setStatementAccountId}>
              <SelectTrigger className="h-11 rounded-2xl">
                <SelectValue placeholder="Conta vinculada ao extrato" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {getAccountOptionLabel(account, unitNameById)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      ) : (
        uploadOnly || showImportControls ? (
        <Card className="mx-auto max-w-[1120px] rounded-2xl border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle>Upload do arquivo</CardTitle>
            <CardDescription>Selecione a conta do extrato e importe um arquivo OFX ou CSV para iniciar a conciliação.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
              <div className="grid grid-cols-2 rounded-2xl border bg-muted/30 p-1">
                {(["ofx", "csv"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFileType(type)}
                    className={cn(
                      "rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors",
                      fileType === type ? "bg-background text-primary shadow-sm" : "text-muted-foreground"
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <Select value={statementAccountId || "none"} onValueChange={(value) => setStatementAccountId(value === "none" ? "" : value)}>
                <SelectTrigger className="h-11 rounded-2xl">
                  <SelectValue placeholder="Conta vinculada ao extrato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione a conta</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {getAccountOptionLabel(account, unitNameById)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {fileType === "csv" ? (
              <Select value={bankProfile} onValueChange={setBankProfile}>
                <SelectTrigger className="h-11 rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CSV_BANK_PROFILES).map(([value, profile]) => (
                    <SelectItem key={value} value={value}>
                      {profile.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            <button
              type="button"
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) void processFile(file);
              }}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "grid min-h-[132px] w-full place-items-center rounded-2xl border-2 border-dashed px-5 py-6 text-center transition-colors",
                isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/20"
              )}
            >
              <span>
                <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
                <span className="mt-3 block text-sm font-semibold">Arraste o arquivo aqui ou clique para selecionar</span>
                <span className="mt-1 block text-xs text-muted-foreground">Arquivos OFX e CSV, máximo 10 MB.</span>
              </span>
            </button>
          </CardContent>
        </Card>
        ) : (
        <Card className="mx-auto max-w-[1120px] rounded-2xl border-border/70 shadow-sm">
          <CardContent className="flex min-h-[180px] items-center justify-center p-6 text-center">
            <div className="space-y-2">
              <p className="text-base font-semibold">Nenhuma sessão aberta para auditoria</p>
              <p className="text-sm text-muted-foreground">Use o botão “Importar extrato” em Despesas para carregar um novo arquivo.</p>
            </div>
          </CardContent>
        </Card>
        )
      )}
    </div>
  );
}
