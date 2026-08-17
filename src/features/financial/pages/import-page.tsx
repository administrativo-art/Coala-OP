"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  History,
  Loader2,
  Maximize2,
  Minimize2,
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
import { distributeEqualRateioPercentages } from "@/features/financial/lib/expense-rateio";
import {
  calculateSplitPercentagesFromValues,
  calculateSplitValuesFromPercentages,
} from "@/features/financial/lib/split-allocation";
import { invalidateAuditAfterEdit } from "@/features/financial/lib/import-audit";
import {
  buildImportAuditSnapshot,
  diffImportAuditSnapshots,
} from "@/features/financial/lib/import-audit-history";
import {
  inferStatementPaymentMethodFromText,
  isBoletoPaymentText,
  isCardStatementSettlementText,
  STATEMENT_PAYMENT_METHOD_IDS,
} from "@/features/financial/lib/statement-payment-method";
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
  ImportSessionItemAuditHistory,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

function formatStoredExpenseDate(value: unknown) {
  const date = toDate(value);
  return date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "—";
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

function isCardStatementSettlementItem(item: ImportSessionItem) {
  return item.financialDraft.paymentMethodId === STATEMENT_PAYMENT_METHOD_IDS.cardStatementSettlement ||
    isCardStatementSettlementText(item.financialDraft.paymentMethodLabel);
}

const BANK_STATEMENT_FIELD_LABELS: Record<string, string> = {
  idTransacao: "ID da transação",
  codigoTransacao: "Código da transação",
  dataInclusao: "Data de inclusão",
  dataEntrada: "Data de entrada",
  dataTransacao: "Data da transação",
  dataPagamento: "Data do pagamento",
  dataAgendamento: "Data do agendamento",
  dataVencimento: "Data de vencimento",
  dataVencimentoDigitada: "Vencimento informado",
  dataVencimentoTitulo: "Vencimento do título",
  tipoTransacao: "Tipo da transação",
  tipoOperacao: "Tipo da operação",
  tipoPagamento: "Tipo de pagamento",
  tipoRetorno: "Tipo de retorno",
  valor: "Valor informado pelo banco",
  valorPagar: "Valor solicitado",
  valorPago: "Valor pago",
  valorNominal: "Valor nominal",
  titulo: "Título",
  descricao: "Descrição",
  descricaoPix: "Comentário do Pix",
  numeroDocumento: "Número do documento",
  codBarraLinhaDigitavel: "Código de barras / linha digitável",
  codigoBarras: "Código de barras",
  linhaDigitavel: "Linha digitável",
  codigoAutenticacao: "Código de autenticação",
  autenticacao: "Autenticação bancária",
  codigoSolicitacao: "Código da solicitação",
  identificador: "Identificador",
  meuIdentificador: "Identificador informado",
  nsu: "NSU",
  status: "Status",
  statusPagamento: "Status do pagamento",
  detalhe: "Detalhe",
  txId: "TXID",
  endToEndId: "End-to-End ID",
  nomePagador: "Pagador",
  cpfCnpjPagador: "CPF/CNPJ do pagador",
  nomeRecebedor: "Beneficiário",
  nomeBeneficiario: "Beneficiário",
  cpfCnpjRecebedor: "CPF/CNPJ do beneficiário",
  cpfCnpjBeneficiario: "CPF/CNPJ do beneficiário",
  nomeEmpresaPagador: "Banco do pagador",
  nomeEmpresaRecebedor: "Banco do beneficiário",
  agenciaRecebedor: "Agência do beneficiário",
  contaBancariaRecebedor: "Conta do beneficiário",
  tipoDetalhe: "Tipo do detalhe",
  origemMovimentacao: "Origem da movimentação",
  quantidadeAprovadores: "Quantidade de aprovadores",
  aprovacoesNecessarias: "Aprovações necessárias",
  aprovacoesRealizadas: "Aprovações realizadas",
};

type BankStatementDetailRow = {
  key: string;
  label: string;
  value: string;
  group: "statement" | "payment";
};

function humanizeBankStatementField(field: string) {
  if (BANK_STATEMENT_FIELD_LABELS[field]) return BANK_STATEMENT_FIELD_LABELS[field];
  const spaced = field.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced ? `${spaced.charAt(0).toLocaleUpperCase("pt-BR")}${spaced.slice(1)}` : "Dado bancário";
}

function formatBankStatementValue(value: unknown) {
  if (value === null) return "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string") return value.trim() || "Não informado";
  return String(value);
}

function flattenBankStatementData(
  value: unknown,
  path: string[] = [],
): BankStatementDetailRow[] {
  if (Array.isArray(value)) {
    if (value.every((entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry))) {
      const field = path.at(-1) || "dados";
      return [{
        key: path.join("."),
        label: humanizeBankStatementField(field),
        value: value.map(formatBankStatementValue).join(", "),
        group: path[0] === "detalhes" || path[0] === "details" ? "payment" : "statement",
      }];
    }
    return value.flatMap((entry, index) => flattenBankStatementData(entry, [...path, String(index + 1)]));
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      flattenBankStatementData(entry, [...path, key])
    );
  }

  const field = path.at(-1) || "dados";
  return [{
    key: path.join("."),
    label: humanizeBankStatementField(field),
    value: formatBankStatementValue(value),
    group: path[0] === "detalhes" || path[0] === "details" ? "payment" : "statement",
  }];
}

function isBoletoPaymentItem(item: ImportSessionItem) {
  if (item.financialDraft.paymentMethodId === STATEMENT_PAYMENT_METHOD_IDS.boleto) return true;
  const bankDataText = item.bankStatementData ? JSON.stringify(item.bankStatementData) : "";
  return isBoletoPaymentText([
    item.rawDescription,
    item.bankOperationType,
    item.bankTransactionType,
    item.financialDraft.paymentMethodLabel,
    bankDataText,
  ].filter(Boolean).join(" "));
}

function getPixComment(item: ImportSessionItem) {
  const statement = item.bankStatementData;
  if (!statement || typeof statement !== "object") return "";
  const nestedDetails = statement.detalhes ?? statement.details;
  const details = nestedDetails && typeof nestedDetails === "object" && !Array.isArray(nestedDetails)
    ? nestedDetails as Record<string, unknown>
    : {};
  const value = details.descricaoPix ?? statement.descricaoPix;
  return typeof value === "string" ? value.trim() : "";
}

function getTransactionKindLabel(item: ImportSessionItem) {
  if (item.financialDraft.movementKind === "transfer") return "Transferência";
  if (item.amount >= 0) return "Receita";
  if (isCardStatementSettlementItem(item)) return "Fatura";
  if (item.expenseDraft.mode === "purchase") return "Compra";
  if (item.expenseDraft.mode === "split") return "Dividida";
  return "Despesa";
}

function getTransactionKindClassName(item: ImportSessionItem) {
  if (item.financialDraft.movementKind === "transfer") return "bg-sky-100 text-sky-700";
  if (item.amount >= 0) return "bg-emerald-100 text-emerald-700";
  if (isCardStatementSettlementItem(item)) return "bg-violet-100 text-violet-700";
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
  const account = accounts.find((entry) => entry.id === item.financialDraft.accountId);
  if (!account) return null;
  return inferStatementPaymentMethodFromText(
    `${item.rawDescription} ${item.financialDraft.description} ${item.bankStatementData ? JSON.stringify(item.bankStatementData) : ""}`,
    account.paymentMethods,
  );
}

function applyStatementPaymentMethodSuggestions(session: ImportSession, accounts: Account[]) {
  return {
    ...session,
    items: session.items.map((item) => {
      const method = inferStatementPaymentMethod(item, accounts);
      if (!method) return item;
      const currentMethod = accounts
        .flatMap((account) => account.paymentMethods)
        .find((paymentMethod) => paymentMethod.id === item.financialDraft.paymentMethodId);
      const shouldCorrectLegacyInvoiceMethod =
        isCardStatementSettlementText(item.rawDescription) &&
        currentMethod?.type === "credit_card";
      if (item.financialDraft.paymentMethodId && !shouldCorrectLegacyInvoiceMethod) return item;
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

function distributeApportionmentsEvenly(
  entries: ImportSessionItem["expenseDraft"]["apportionments"],
) {
  const percentages = distributeEqualRateioPercentages(entries.length);
  return entries.map((entry, index) => ({ ...entry, percentage: percentages[index] ?? 0 }));
}

function normalizeStoredApportionments(value: unknown) {
  if (!Array.isArray(value)) return [];
  const entries = value.map((entry: any) => ({
    id: String(entry?.id ?? createDraftId("apportion")),
    resultCenterId: String(entry?.resultCenterId ?? ""),
    resultCenterName: String(entry?.resultCenterName ?? ""),
    percentage: Number(entry?.percentage ?? 0),
  }));
  const total = entries.reduce((sum, entry) => sum + entry.percentage, 0);
  return entries.length > 0 && Math.abs(total) < 0.001
    ? distributeApportionmentsEvenly(entries)
    : entries;
}

function createAccountAllocationEntry(
  overrides?: Partial<ImportSessionItem["expenseDraft"]["accountAllocations"][number]>,
) {
  return {
    id: createDraftId("account-allocation"),
    accountPlanId: "",
    accountPlanName: "",
    amount: 0,
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
    dueDate: "",
    value: 0,
    percentage: 0,
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
    bankStatementData: item.bankStatementData ?? null,
    bankReferences: item.bankReferences ?? [],
    bankOperationType: item.bankOperationType ?? null,
    bankTransactionType: item.bankTransactionType ?? null,
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
      hasAccountAllocations: item.expenseDraft.hasAccountAllocations,
      accountAllocations: item.expenseDraft.accountAllocations.map((entry) => ({
        id: entry.id,
        accountPlanId: entry.accountPlanId,
        accountPlanName: entry.accountPlanName,
        amount: entry.amount,
      })),
      isApportioned: item.expenseDraft.isApportioned,
      resultCenterId: item.expenseDraft.resultCenterId,
      resultCenterName: item.expenseDraft.resultCenterName,
      apportionments: item.expenseDraft.apportionments.map((entry) => ({
        id: entry.id,
        resultCenterId: entry.resultCenterId,
        resultCenterName: entry.resultCenterName,
        percentage: entry.percentage,
      })),
      splitAllocationMode: item.expenseDraft.splitAllocationMode,
      splitExpenses: item.expenseDraft.splitExpenses.map((entry) => ({
        id: entry.id,
        description: entry.description,
        supplier: entry.supplier,
        accountPlanId: entry.accountPlanId,
        accountPlanName: entry.accountPlanName,
        resultCenterId: entry.resultCenterId,
        resultCenterName: entry.resultCenterName,
        competenceDate: entry.competenceDate,
        dueDate: entry.dueDate,
        value: entry.value,
        percentage: entry.percentage,
      })),
      competenceDate: item.expenseDraft.competenceDate,
      dueDate: item.expenseDraft.dueDate,
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
    effectuation: item.effectuation ?? null,
    auditHistory: item.auditHistory ?? [],
    auditSnapshot: item.auditSnapshot ?? null,
    auditRevision: item.auditRevision ?? 0,
  };
}

function formatAuditHistoryDate(value: string) {
  const date = toDate(value);
  return date ? format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : "Data não informada";
}

function joinHistoryLabels(labels: string[]) {
  if (labels.length <= 1) return labels[0] ?? "os dados";
  return `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`;
}

function getAuditHistoryMessage(entry: ImportSessionItemAuditHistory, isExpense: boolean) {
  const actorName = entry.actorName || "Usuário";
  if (entry.action === "effectuated") {
    return `${actorName} efetivou ${isExpense ? "a despesa" : "a movimentação"} no financeiro.`;
  }
  if (entry.action === "reopened") {
    return `${actorName} reabriu ${isExpense ? "a despesa" : "a movimentação"} para correção.`;
  }
  if (entry.changes?.length) {
    const labels = [...new Set(entry.changes.map((change) => change.label))];
    return `${actorName} alterou ${joinHistoryLabels(labels)} e concluiu novamente a auditoria.`;
  }
  return entry.revision && entry.revision > 1
    ? `${actorName} concluiu novamente a auditoria.`
    : `${actorName} concluiu a auditoria.`;
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
      hasAccountAllocations: false,
      accountAllocations: [],
      isApportioned: false,
      resultCenterId: transaction.resultCenterId,
      resultCenterName: transaction.resultCenterName,
      apportionments: [],
      splitAllocationMode: "amount",
      splitExpenses: [],
      competenceDate,
      dueDate: toInputDate(transaction.date),
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
          bankStatementData:
            item.bankStatementData && typeof item.bankStatementData === "object" && !Array.isArray(item.bankStatementData)
              ? item.bankStatementData as Record<string, unknown>
              : undefined,
          bankReferences: Array.isArray(item.bankReferences)
            ? item.bankReferences.map(String).filter(Boolean)
            : undefined,
          bankOperationType: item.bankOperationType ? String(item.bankOperationType) : undefined,
          bankTransactionType: item.bankTransactionType ? String(item.bankTransactionType) : undefined,
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
            hasAccountAllocations: Boolean(item.expenseDraft?.hasAccountAllocations),
            accountAllocations: Array.isArray(item.expenseDraft?.accountAllocations)
              ? item.expenseDraft.accountAllocations.map((entry: any) =>
                  createAccountAllocationEntry({
                    id: String(entry?.id ?? createDraftId("account-allocation")),
                    accountPlanId: String(entry?.accountPlanId ?? ""),
                    accountPlanName: String(entry?.accountPlanName ?? ""),
                    amount: Number(entry?.amount ?? 0),
                  })
                )
              : [],
            isApportioned: Boolean(item.expenseDraft?.isApportioned),
            resultCenterId: String(item.expenseDraft?.resultCenterId ?? ""),
            resultCenterName: String(item.expenseDraft?.resultCenterName ?? ""),
            apportionments: normalizeStoredApportionments(item.expenseDraft?.apportionments),
            splitAllocationMode: item.expenseDraft?.splitAllocationMode === "percentage" ? "percentage" : "amount",
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
                    dueDate: String(entry?.dueDate ?? item.date ?? item.financialDraft?.date ?? ""),
                    value: Number(entry?.value ?? 0),
                    percentage: Number(entry?.percentage ?? 0),
                  })
                )
              : [],
            competenceDate: String(item.expenseDraft?.competenceDate ?? ""),
            dueDate: String(item.expenseDraft?.dueDate ?? item.date ?? item.financialDraft?.date ?? ""),
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
          effectuation:
            item.effectuation && typeof item.effectuation === "object" && !Array.isArray(item.effectuation)
              ? {
                  id: String(item.effectuation.id ?? ""),
                  status: item.effectuation.status === "reopened" ? "reopened" : "active",
                  transactionIds: Array.isArray(item.effectuation.transactionIds)
                    ? item.effectuation.transactionIds.map(String).filter(Boolean)
                    : [],
                  expenseIds: Array.isArray(item.effectuation.expenseIds)
                    ? item.effectuation.expenseIds.map(String).filter(Boolean)
                    : [],
                  createdExpenseIds: Array.isArray(item.effectuation.createdExpenseIds)
                    ? item.effectuation.createdExpenseIds.map(String).filter(Boolean)
                    : [],
                  purchaseFinancialId: item.effectuation.purchaseFinancialId
                    ? String(item.effectuation.purchaseFinancialId)
                    : null,
                  purchaseGoodsAmount: Number(item.effectuation.purchaseGoodsAmount ?? 0),
                  purchaseFreightAmount: Number(item.effectuation.purchaseFreightAmount ?? 0),
                  effectuatedAt: item.effectuation.effectuatedAt ? String(item.effectuation.effectuatedAt) : undefined,
                  effectuatedBy: item.effectuation.effectuatedBy ? String(item.effectuation.effectuatedBy) : undefined,
                  reopenedAt: item.effectuation.reopenedAt ? String(item.effectuation.reopenedAt) : undefined,
                  reopenedBy: item.effectuation.reopenedBy ? String(item.effectuation.reopenedBy) : undefined,
                  reopenReason: item.effectuation.reopenReason ? String(item.effectuation.reopenReason) : undefined,
                }
              : undefined,
          auditHistory: Array.isArray(item.auditHistory)
            ? item.auditHistory.flatMap((entry: any) =>
                entry &&
                (entry.action === "audit_confirmed" || entry.action === "effectuated" || entry.action === "reopened") &&
                entry.actorId &&
                entry.at
                  ? [{
                      action: entry.action,
                      actorId: String(entry.actorId),
                      actorName: entry.actorName ? String(entry.actorName) : "Usuário",
                      at: String(entry.at),
                      revision: Number(entry.revision) || undefined,
                      reason: entry.reason ? String(entry.reason) : undefined,
                      changes: Array.isArray(entry.changes)
                        ? entry.changes.flatMap((change: any) =>
                            change && change.field && change.label
                              ? [{
                                  field: String(change.field),
                                  label: String(change.label),
                                  previousValue: String(change.previousValue ?? "Não informado"),
                                  nextValue: String(change.nextValue ?? "Não informado"),
                                }]
                              : []
                          )
                        : undefined,
                    }]
                  : []
              )
            : undefined,
          auditSnapshot:
            item.auditSnapshot && typeof item.auditSnapshot === "object" && item.auditSnapshot.values
              ? {
                  values: Object.fromEntries(
                    Object.entries(item.auditSnapshot.values).map(([key, value]) => [key, String(value)])
                  ),
                }
              : undefined,
          auditRevision: Number(item.auditRevision) || undefined,
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
    const monthLabel = format(new Date(year, month - 1, 1), "LLLL | yyyy", { locale: ptBR });
    return `${monthLabel.charAt(0).toLocaleUpperCase("pt-BR")}${monthLabel.slice(1)}`;
  }

  const dates = session.items
    .map((item) => new Date(`${item.date}T00:00:00`))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  if (dates.length === 0) return session.displayName;

  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
    const monthLabel = format(first, "LLLL | yyyy", { locale: ptBR });
    return `${monthLabel.charAt(0).toLocaleUpperCase("pt-BR")}${monthLabel.slice(1)}`;
  }
  const firstLabel = format(first, "dd/MM/yyyy", { locale: ptBR });
  const lastLabel = format(last, "dd/MM/yyyy", { locale: ptBR });

  return firstLabel === lastLabel ? firstLabel : `${firstLabel} — ${lastLabel}`;
}

function getSessionFinancialSummary(session: ImportSession) {
  const entries = session.items
    .filter((item) => item.amount > 0)
    .reduce((total, item) => total + item.amount, 0);
  const exits = session.items
    .filter((item) => item.amount < 0)
    .reduce((total, item) => total + Math.abs(item.amount), 0);
  return { entries, exits, balance: entries - exits };
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
  const isCardStatementSettlement = isCardStatementSettlementItem(item);
  const movementBaseValid =
    item.financialDraft.accountId.trim().length > 0 &&
    item.financialDraft.paymentMethodId.trim().length > 0 &&
    item.date.trim().length > 0 &&
    item.rawDescription.trim().length >= 3;
  const transferValid =
    !isTransfer ||
    (item.financialDraft.counterpartyAccountId.trim().length > 0 &&
      item.financialDraft.counterpartyPaymentMethodId.trim().length > 0 &&
      item.financialDraft.counterpartyAccountId !== item.financialDraft.accountId);
  const movementValid = movementBaseValid && transferValid;

  if (!movementValid) {
    issues.push(isTransfer ? "Complete a transferência entre contas." : "Preencha a movimentação financeira.");
  }

  const requiresExpense = item.amount < 0 && !isTransfer && !isCardStatementSettlement;
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
      const splitPercentageTotal = item.expenseDraft.splitExpenses.reduce(
        (sum, entry) => sum + (Number(entry.percentage) || 0),
        0,
      );
      const splitAllocationValid = item.expenseDraft.splitAllocationMode === "percentage"
        ? Math.abs(splitPercentageTotal - 100) < 0.01
        : Math.abs(splitTotal - Math.abs(item.amount)) < 0.01;
      expenseValid =
        item.expenseDraft.splitExpenses.length > 1 &&
        splitAllocationValid &&
        item.expenseDraft.splitExpenses.every(
          (entry) =>
            entry.description.trim().length >= 10 &&
            entry.supplier.trim().length >= 3 &&
            entry.accountPlanId.trim().length > 0 &&
            entry.resultCenterId.trim().length > 0 &&
            entry.competenceDate.trim().length > 0 &&
            entry.dueDate.trim().length > 0 &&
            Number(entry.value) > 0 &&
            (item.expenseDraft.splitAllocationMode !== "percentage" || Number(entry.percentage) > 0)
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
      const accountAllocationTotal = item.expenseDraft.accountAllocations.reduce(
        (sum, entry) => sum + (Number(entry.amount) || 0),
        0,
      );
      const accountAllocationIds = item.expenseDraft.accountAllocations
        .map((entry) => entry.accountPlanId)
        .filter(Boolean);
      const accountAllocationsValid =
        !item.expenseDraft.hasAccountAllocations ||
        (item.expenseDraft.accountAllocations.length >= 2 &&
          item.expenseDraft.accountAllocations.every(
            (entry) => entry.accountPlanId.trim().length > 0 && Number(entry.amount) > 0,
          ) &&
          accountAllocationIds.length === new Set(accountAllocationIds).size &&
          Math.abs(accountAllocationTotal - Math.abs(item.amount)) < 0.01);
      expenseValid =
        item.expenseDraft.description.trim().length >= 10 &&
        item.expenseDraft.supplier.trim().length >= 3 &&
        item.expenseDraft.accountPlanId.trim().length > 0 &&
        accountAllocationsValid &&
        (item.expenseDraft.isApportioned ? apportionmentValid : item.expenseDraft.resultCenterId.trim().length > 0) &&
        item.expenseDraft.competenceDate.trim().length > 0 &&
        item.expenseDraft.dueDate.trim().length > 0;
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
  const [auditStep, setAuditStep] = useState<0 | 1 | 2>(0);
  const [auditDrawerExpanded, setAuditDrawerExpanded] = useState(false);
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
  const [reopenItemId, setReopenItemId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [closeStatementDialogOpen, setCloseStatementDialogOpen] = useState(false);
  const [sessionsSidebarOpen, setSessionsSidebarOpen] = useState(true);
  const [generalSummaryOpen, setGeneralSummaryOpen] = useState(false);
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
    setExpandedItemId(null);
    setIsSessionDirty(false);
    replaceSessionUrl(nextSession?.id ?? null);
  }, [replaceSessionUrl, selectedSessionId, statementAccountId, visibleOpenSessions]);

  useEffect(() => {
    setDescriptionDraftsByItem({});
    setApportionmentPercentageDrafts({});
  }, [currentSessionId]);

  useEffect(() => {
    if (!expandedItemId) {
      setAuditStep(0);
      setAuditDrawerExpanded(false);
      return;
    }

    const item = currentSession?.items.find((entry) => entry.id === expandedItemId);
    if (!item) return;

    const originReady =
      item.financialDraft.accountId.trim().length > 0 &&
      item.financialDraft.paymentMethodId.trim().length > 0;
    setAuditStep(item.status === "audited" || item.status === "completed" || item.status === "ignored" ? 2 : originReady ? 1 : 0);
    // The drawer step must reset only when another transaction is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedItemId]);

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
      // values. Automated bank syncs may append transactions and enrich immutable
      // bank metadata, while every user-editable field remains local-authoritative.
      const existingIds = new Set(previous.items.map((item) => item.id));
      const remoteItemsById = new Map(sessionFromList.items.map((item) => [item.id, item]));
      let bankMetadataChanged = false;
      const refreshedItems = previous.items.map((item) => {
        const remoteItem = remoteItemsById.get(item.id);
        if (!remoteItem?.bankStatementData) return item;
        if (JSON.stringify(remoteItem.bankStatementData) === JSON.stringify(item.bankStatementData)) return item;
        bankMetadataChanged = true;
        return {
          ...item,
          bankStatementData: remoteItem.bankStatementData,
          bankReferences: remoteItem.bankReferences,
          bankOperationType: remoteItem.bankOperationType,
          bankTransactionType: remoteItem.bankTransactionType,
        };
      });
      const appendedItems = sessionFromList.items.filter((item) => !existingIds.has(item.id));
      if (appendedItems.length === 0 && !bankMetadataChanged) return previous;

      const items = [...refreshedItems, ...appendedItems];
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
        setExpandedItemId(null);
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
      items: session.items.map((item) => {
        if (item.id !== itemId) return item;
        if (item.status === "completed") return item;

        return invalidateAuditAfterEdit(item, updater(item));
      }),
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
    const actorName = getUserDisplayName(user, firebaseUser?.uid);
    const nextItems = currentSession.items.map((item) => {
      if (item.id !== itemId) return item;
      const snapshot = buildImportAuditSnapshot(item);
      const revision = (item.auditRevision ?? 0) + 1;
      return {
        ...item,
        status: "audited" as const,
        auditSnapshot: snapshot,
        auditRevision: revision,
        auditHistory: [
          ...(item.auditHistory ?? []),
          {
            action: "audit_confirmed" as const,
            actorId: firebaseUser?.uid ?? "",
            actorName,
            at: new Date().toISOString(),
            revision,
            changes: diffImportAuditSnapshots(item.auditSnapshot, snapshot),
          },
        ].slice(-50),
      };
    });
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
      const confirmationToast = toast({
        title: "Auditoria confirmada — aguardando efetivação",
        duration: 4_000,
      });
      window.setTimeout(confirmationToast.dismiss, 4_000);
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
    setApportionmentPercentageDrafts({});
    updateItem(itemId, (current) => {
      const apportionments = distributeApportionmentsEvenly([
        ...current.expenseDraft.apportionments,
        createApportionmentEntry(),
      ]);
      return {
        ...current,
        expenseDraft: {
          ...current.expenseDraft,
          isApportioned: true,
          resultCenterId: "",
          resultCenterName: "",
          apportionments,
        },
      };
    });
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
    setApportionmentPercentageDrafts({});

    updateItem(itemId, (current) => {
      const nextApportionments = distributeApportionmentsEvenly(
        current.expenseDraft.apportionments.filter((entry) => entry.id !== apportionmentId),
      );
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

  function setAccountAllocationMode(itemId: string, enabled: boolean) {
    updateItem(itemId, (current) => {
      const total = Math.abs(current.amount);
      const options = flattenedAccounts.filter(
        (entry) => entry.parentId === current.expenseDraft.accountPlanId && entry.active !== false,
      );
      const allocations = enabled && current.expenseDraft.accountAllocations.length === 0
        ? [
            createAccountAllocationEntry({
              accountPlanId: options[0]?.id || "",
              accountPlanName: options[0]?.name || "",
              amount: Number((total / 2).toFixed(2)),
            }),
            createAccountAllocationEntry({
              accountPlanId: options[1]?.id || "",
              accountPlanName: options[1]?.name || "",
              amount: Number((total - Number((total / 2).toFixed(2))).toFixed(2)),
            }),
          ]
        : current.expenseDraft.accountAllocations;
      return {
        ...current,
        expenseDraft: {
          ...current.expenseDraft,
          hasAccountAllocations: enabled,
          accountAllocations: allocations,
        },
      };
    });
  }

  function updateAccountAllocation(
    itemId: string,
    allocationId: string,
    updater: (entry: ImportSessionItem["expenseDraft"]["accountAllocations"][number]) => ImportSessionItem["expenseDraft"]["accountAllocations"][number],
  ) {
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: {
        ...current.expenseDraft,
        accountAllocations: current.expenseDraft.accountAllocations.map((entry) =>
          entry.id === allocationId ? updater(entry) : entry
        ),
      },
    }));
  }

  function appendAccountAllocation(itemId: string) {
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: {
        ...current.expenseDraft,
        accountAllocations: [...current.expenseDraft.accountAllocations, createAccountAllocationEntry()],
      },
    }));
  }

  function removeAccountAllocation(itemId: string, allocationId: string) {
    updateItem(itemId, (current) => ({
      ...current,
      expenseDraft: {
        ...current.expenseDraft,
        accountAllocations: current.expenseDraft.accountAllocations.filter((entry) => entry.id !== allocationId),
      },
    }));
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
        const transactionDate = Timestamp.fromDate(new Date(`${item.date}T12:00:00`));
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
            description: item.rawDescription,
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
            description: item.rawDescription,
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
        } else if (item.amount < 0 && isCardStatementSettlementItem(item)) {
          const settlementPayload = {
            type: "card_statement_payment",
            direction: "out",
            amount: Math.abs(item.amount),
            date: transactionDate,
            description: item.rawDescription,
            notes: item.financialDraft.notes || "Liquidação de fatura identificada no extrato bancário.",
            accountId: item.financialDraft.accountId,
            accountName: item.financialDraft.accountName,
            paymentMethodId: item.financialDraft.paymentMethodId,
            paymentMethodLabel: item.financialDraft.paymentMethodLabel,
            accountPlanId: null,
            accountPlanName: null,
            resultCenterId: null,
            resultCenterName: null,
            supplier: null,
            expenseId: null,
            linkedExpenseId: null,
            importedFrom,
            rawBankDescription: item.rawDescription,
            auditStatus: "resolved",
            awaitingCardStatementReconciliation: true,
          };

          if (item.linkedBankTransactionId) {
            await updateDoc(financialDoc("transactions", item.linkedBankTransactionId), {
              ...settlementPayload,
              auditedBy: firebaseUser.uid,
              auditedAt: now,
            });
          } else {
            await addDoc(financialCollection("transactions"), {
              ...settlementPayload,
              createdBy: firebaseUser.uid,
              createdAt: now,
            });
          }
        } else if (item.amount < 0) {
          const isPurchaseMode = item.expenseDraft.mode === "purchase";
          const purchaseCandidate = isPurchaseMode ? purchaseBalances.get(item.expenseDraft.purchaseOrderId) : undefined;
          let expenseId = item.expenseDraft.linkedExpenseId || "";
          const splitExpenseIds: string[] = [];

          if (item.expenseDraft.mode === "split") {
            for (const split of item.expenseDraft.splitExpenses) {
              const originalDueDate = Timestamp.fromDate(new Date(`${split.dueDate}T12:00:00`));
              const createdExpense = await addDoc(financialCollection("expenses"), {
                accountPlan: split.accountPlanId,
                accountId: split.accountPlanId,
                accountPlanName: split.accountPlanName,
                description: split.description,
                supplier: split.supplier || "",
                notes: item.expenseDraft.notes || item.rawDescription,
                totalValue: Number(split.value) || 0,
                competenceDate: Timestamp.fromDate(new Date(`${split.competenceDate}T12:00:00`)),
                dueDate: originalDueDate,
                paymentMethod: "single",
                installmentType: null,
                installmentPeriodicity: null,
                hasAccountAllocations: false,
                accountAllocations: null,
                isApportioned: false,
                resultCenter: split.resultCenterName || null,
                apportionments: null,
                installments: [
                  {
                    number: 1,
                    dueDate: originalDueDate,
                    value: Number(split.value) || 0,
                    status: "paid",
                    paidAt: transactionDate,
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
            const originalDueDate = Timestamp.fromDate(new Date(`${item.expenseDraft.dueDate}T12:00:00`));
            const expensePayload = {
              accountPlan: item.expenseDraft.accountPlanId,
              accountId: item.expenseDraft.accountPlanId,
              accountPlanName: item.expenseDraft.accountPlanName,
              description: item.expenseDraft.description,
              supplier: item.expenseDraft.supplier || "",
              notes: item.expenseDraft.notes || "",
              totalValue: Math.abs(item.amount),
              competenceDate: Timestamp.fromDate(new Date(`${item.expenseDraft.competenceDate}T12:00:00`)),
              dueDate: originalDueDate,
              paymentMethod: "single",
              installmentType: null,
              installmentPeriodicity: null,
              hasAccountAllocations: item.expenseDraft.hasAccountAllocations,
              accountAllocations: item.expenseDraft.hasAccountAllocations
                ? item.expenseDraft.accountAllocations.map((entry) => ({
                    accountPlanId: entry.accountPlanId,
                    accountPlanName: entry.accountPlanName,
                    amount: Number(entry.amount) || 0,
                  }))
                : null,
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
                  dueDate: originalDueDate,
                  value: Math.abs(item.amount),
                  status: "paid",
                  paidAt: transactionDate,
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
            description: item.rawDescription,
            notes: item.financialDraft.notes || "",
            accountId: item.financialDraft.accountId,
            accountName: item.financialDraft.accountName,
            paymentMethodId: item.financialDraft.paymentMethodId,
            paymentMethodLabel: item.financialDraft.paymentMethodLabel,
            accountPlanId: item.expenseDraft.accountPlanId || null,
            accountPlanName: item.expenseDraft.accountPlanName || null,
            hasAccountAllocations: item.expenseDraft.hasAccountAllocations,
            accountAllocations: item.expenseDraft.hasAccountAllocations
              ? item.expenseDraft.accountAllocations.map((entry) => ({
                  accountPlanId: entry.accountPlanId,
                  accountPlanName: entry.accountPlanName,
                  amount: Number(entry.amount) || 0,
                }))
              : null,
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
                      paidAt: `${item.date}T12:00:00.000Z`,
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
            description: item.rawDescription,
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

  async function effectuateItem(itemId: string, openNext = true) {
    if (!currentSession || !canEditImportSession(currentSession)) return;
    const item = currentSession.items.find((entry) => entry.id === itemId);
    if (!item || item.status !== "audited") return;

    setIsProcessing(true);
    try {
      await patchImportSession(currentSession.id, {
        action: "effectuate_item",
        itemId,
      });
      const actorName = getUserDisplayName(user, firebaseUser?.uid);
      const nextItems = currentSession.items.map((entry) =>
        entry.id === itemId
          ? {
              ...entry,
              status: "completed" as const,
              auditHistory: [
                ...(entry.auditHistory ?? []),
                {
                  action: "effectuated" as const,
                  actorId: firebaseUser?.uid ?? "",
                  actorName,
                  at: new Date().toISOString(),
                },
              ].slice(-50),
            }
          : entry
      );
      const nextSession = {
        ...currentSession,
        items: nextItems,
        summary: buildSessionSummary(nextItems),
      };
      setCurrentSession(nextSession);
      setIsSessionDirty(false);
      setExpandedItemId(openNext ? getNextPendingItemId(nextItems, itemId, directionFilter) ?? itemId : null);
      refreshImportSessions();
      const successToast = toast({ title: "Movimentação efetivada no financeiro.", duration: 4_000 });
      window.setTimeout(successToast.dismiss, 4_000);
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Não foi possível efetivar esta movimentação.",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsProcessing(false);
    }
  }

  async function reopenEffectuatedItem(itemId: string, reason: string) {
    if (!currentSession || !canEditImportSession(currentSession)) return;
    const item = currentSession.items.find((entry) => entry.id === itemId);
    if (!item || item.status !== "completed") return;

    setIsProcessing(true);
    try {
      await patchImportSession(currentSession.id, {
        action: "reopen_item",
        itemId,
        reason,
      });
      const actorName = getUserDisplayName(user, firebaseUser?.uid);
      const nextItems = currentSession.items.map((entry) =>
        entry.id === itemId
          ? {
              ...entry,
              status: "pending" as const,
              effectuation: entry.effectuation
                ? {
                    ...entry.effectuation,
                    status: "reopened" as const,
                    reopenReason: reason,
                  }
                : undefined,
              auditHistory: [
                ...(entry.auditHistory ?? []),
                {
                  action: "reopened" as const,
                  actorId: firebaseUser?.uid ?? "",
                  actorName,
                  at: new Date().toISOString(),
                  reason,
                },
              ].slice(-50),
            }
          : entry
      );
      setCurrentSession({
        ...currentSession,
        items: nextItems,
        summary: buildSessionSummary(nextItems),
      });
      setItemStatusFilter((current) => current === "completed" ? "all" : current);
      setExpandedItemId(itemId);
      setIsSessionDirty(false);
      refreshImportSessions();
      toast({
        title: "Movimentação reaberta.",
        description: "A conciliação foi desfeita e o item voltou para Pendente.",
      });
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Não foi possível reabrir esta movimentação.",
        description: error instanceof Error ? error.message : undefined,
      });
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }

  async function closeStatement() {
    if (!currentSession || !canEditImportSession(currentSession)) return;
    if (currentSession.summary.pending > 0 || currentSession.summary.audited > 0) {
      toast({
        variant: "destructive",
        title: "Ainda existem movimentações em tratamento.",
        description: "Efetive ou ignore todos os itens antes de fechar o extrato.",
      });
      return;
    }

    setIsProcessing(true);
    try {
      await patchImportSession(currentSession.id, { action: "close_statement" });
      toast({
        title: "Extrato fechado e consolidado.",
        description: `${currentSession.summary.completed} itens efetivados e ${currentSession.summary.ignored} ignorados.`,
      });
      setCurrentSession(null);
      setSelectedSessionId(null);
      setExpandedItemId(null);
      setIsSessionDirty(false);
      replaceSessionUrl(null);
      refreshImportSessions();
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Não foi possível fechar o extrato.",
        description: error instanceof Error ? error.message : undefined,
      });
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
  const selectedDetailItem = useMemo(
    () => (expandedItemId ? selectedSessionItems.find((item) => item.id === expandedItemId) ?? null : null),
    [expandedItemId, selectedSessionItems]
  );
  const selectedQueueIndex = selectedDetailItem
    ? selectedSessionItems.findIndex((item) => item.id === selectedDetailItem.id)
    : -1;
  const selectedQueuePendingCount = selectedSessionItems.filter((item) => item.status === "pending").length;
  const selectedValidation = useMemo(
    () => (selectedDetailItem ? validateItem(selectedDetailItem, purchaseCandidatesByOrderId) : null),
    [purchaseCandidatesByOrderId, selectedDetailItem]
  );
  const selectedChecklist = useMemo(() => {
    if (!selectedDetailItem || !selectedValidation) return [];
    const isIncome = selectedDetailItem.amount >= 0;
    const isTransfer = selectedDetailItem.financialDraft.movementKind === "transfer";
    const isCardStatementSettlement = isCardStatementSettlementItem(selectedDetailItem);
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
            selectedDetailItem.date.trim().length > 0 &&
            selectedDetailItem.rawDescription.trim().length >= 3,
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
          selectedDetailItem.date.trim().length > 0 &&
          selectedDetailItem.rawDescription.trim().length >= 3,
      },
      {
        label: isTransfer
          ? "Transferência validada"
          : isCardStatementSettlement
          ? "Liquidação de fatura identificada"
          : "Cadastro integral da despesa concluído",
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
  function getItemSuggestion(item: ImportSessionItem) {
    if (item.amount >= 0) {
      return {
        badge: "receita",
        text: item.financialDraft.description || "Registrar como receita bancária",
        className: "bg-emerald-100 text-emerald-700",
      };
    }

    if (isCardStatementSettlementItem(item)) {
      return {
        badge: "fatura",
        text: "Liquidação sem nova despesa",
        className: "bg-violet-100 text-violet-700",
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
        hasAccountAllocations: expense.hasAccountAllocations === true,
        accountAllocations: Array.isArray(expense.accountAllocations)
          ? expense.accountAllocations.map((entry: any) => createAccountAllocationEntry({
              accountPlanId: String(entry.accountPlanId ?? ""),
              accountPlanName: String(entry.accountPlanName ?? ""),
              amount: Number(entry.amount ?? 0),
            }))
          : [],
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
        dueDate: current.expenseDraft.dueDate || current.date || current.financialDraft.date,
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
              dueDate: current.expenseDraft.dueDate || current.date || current.financialDraft.date,
              value: Number((total / 2).toFixed(2)),
              percentage: 50,
            }),
            createSplitExpenseEntry({
              description: current.expenseDraft.description || current.rawDescription,
              supplier: current.expenseDraft.supplier,
              accountPlanId: current.expenseDraft.accountPlanId,
              accountPlanName: current.expenseDraft.accountPlanName,
              resultCenterId: current.expenseDraft.resultCenterId,
              resultCenterName: current.expenseDraft.resultCenterName,
              competenceDate: current.expenseDraft.competenceDate || current.date.slice(0, 7) + "-01",
              dueDate: current.expenseDraft.dueDate || current.date || current.financialDraft.date,
              value: Number((total - Number((total / 2).toFixed(2))).toFixed(2)),
              percentage: 50,
            }),
          ];

      return {
        ...current,
        expenseDraft: {
          ...current.expenseDraft,
          mode: "split",
          linkedExpenseId: "",
          purchaseOrderId: "",
          hasAccountAllocations: false,
          accountAllocations: [],
          splitAllocationMode: current.expenseDraft.splitAllocationMode || "amount",
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

  function setSplitAllocationMode(itemId: string, mode: "amount" | "percentage") {
    updateItem(itemId, (current) => {
      const total = Math.abs(current.amount);
      const splitExpenses = mode === "percentage"
        ? calculateSplitPercentagesFromValues(current.expenseDraft.splitExpenses, total)
        : calculateSplitValuesFromPercentages(current.expenseDraft.splitExpenses, total);
      return {
        ...current,
        expenseDraft: {
          ...current.expenseDraft,
          splitAllocationMode: mode,
          splitExpenses,
        },
      };
    });
  }

  function updateSplitPercentage(itemId: string, splitId: string, percentage: number) {
    updateItem(itemId, (current) => {
      const splitExpenses = calculateSplitValuesFromPercentages(
        current.expenseDraft.splitExpenses.map((entry) =>
          entry.id === splitId ? { ...entry, percentage } : entry
        ),
        Math.abs(current.amount),
      );
      return {
        ...current,
        expenseDraft: {
          ...current.expenseDraft,
          splitExpenses,
        },
      };
    });
  }

  function addSplitExpense(itemId: string) {
    updateItem(itemId, (current) => {
      const splitExpenses = [
          ...current.expenseDraft.splitExpenses,
          createSplitExpenseEntry({
            description: current.expenseDraft.description || current.rawDescription,
            supplier: current.expenseDraft.supplier,
            accountPlanId: current.expenseDraft.accountPlanId,
            accountPlanName: current.expenseDraft.accountPlanName,
            resultCenterId: current.expenseDraft.resultCenterId,
            resultCenterName: current.expenseDraft.resultCenterName,
            competenceDate: current.expenseDraft.competenceDate || current.date.slice(0, 7) + "-01",
            dueDate: current.expenseDraft.dueDate || current.date || current.financialDraft.date,
          }),
        ];
      return {
        ...current,
        expenseDraft: {
          ...current.expenseDraft,
          splitExpenses: current.expenseDraft.splitAllocationMode === "percentage"
            ? calculateSplitValuesFromPercentages(splitExpenses, Math.abs(current.amount))
            : splitExpenses,
        },
      };
    });
  }

  function removeSplitExpense(itemId: string, splitId: string) {
    updateItem(itemId, (current) => {
      const splitExpenses = current.expenseDraft.splitExpenses.filter((entry) => entry.id !== splitId);
      return {
        ...current,
        expenseDraft: {
          ...current.expenseDraft,
          splitExpenses: current.expenseDraft.splitAllocationMode === "percentage"
            ? calculateSplitValuesFromPercentages(splitExpenses, Math.abs(current.amount))
            : splitExpenses,
        },
      };
    });
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
            style={{
              gridTemplateColumns: `${sessionsSidebarOpen ? "320px" : "40px"} minmax(0, 1fr)`,
            }}
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
                    const sessionFinancialSummary = getSessionFinancialSummary(session);
                    const sessionAccount = accounts.find((account) => account.id === session.statementAccountId);
                    const sessionUnitName = sessionAccount?.resultCenterId
                      ? unitNameById[sessionAccount.resultCenterId] ?? ""
                      : "";
                    const sessionAccountName = sessionAccount?.name || session.statementAccountName || session.displayName;

                    return (
                      <div
                        key={session.id}
                        className={cn(
                          "overflow-hidden rounded-2xl border transition-colors",
                          isSelected
                            ? "border-primary/40 bg-background shadow-sm ring-1 ring-primary/10"
                            : "border-transparent bg-background/70 hover:border-primary/30 hover:bg-background"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSessionId(session.id);
                            setCurrentSession(session);
                            setExpandedItemId(null);
                            if (!isSelected) setGeneralSummaryOpen(false);
                            setIsSessionDirty(false);
                            replaceSessionUrl(session.id);
                          }}
                          className="w-full px-3 py-3 text-left"
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
                            <p className="text-sm font-semibold">{periodLabel}</p>
                            <p className="mt-1 break-words text-[11px] font-medium leading-snug text-foreground">
                              {sessionAccountName}
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                              <div>
                                <p className="uppercase tracking-[0.1em] text-muted-foreground">Agência</p>
                                <p className="mt-0.5 font-mono font-medium text-foreground">{sessionAccount?.agency || "—"}</p>
                              </div>
                              <div>
                                <p className="uppercase tracking-[0.1em] text-muted-foreground">Conta corrente</p>
                                <p className="mt-0.5 break-all font-mono font-medium text-foreground">{sessionAccount?.accountNumber || "—"}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-end justify-between gap-3">
                          <div className="min-w-0">
                            {isSelected ? <div className="h-1.5 w-7 rounded-full bg-amber-400" /> : null}
                            <p className="mt-1 text-[10.5px] text-muted-foreground">
                              {session.summary.audited + session.summary.completed} de {session.items.length} conciliados
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            {session.summary.pending === 0 ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : null}
                          </div>
                        </div>
                        </button>
                        {isSelected ? (
                          <button
                            type="button"
                            onClick={() => setGeneralSummaryOpen((current) => !current)}
                            className="flex w-full items-center justify-between border-t px-3 py-2 text-[10.5px] font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                            aria-expanded={generalSummaryOpen}
                          >
                            <span>Resumo geral</span>
                            {generalSummaryOpen
                              ? <ChevronUp className="h-3.5 w-3.5" />
                              : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}
                        {isSelected && generalSummaryOpen ? (
                          <div className="border-t bg-muted/20 p-3">
                            <div className="rounded-xl border bg-background p-3 shadow-sm">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                  Resumo geral
                                </p>
                                <Badge variant="secondary" className="rounded-full text-[9.5px]">
                                  {session.items.length} itens
                                </Badge>
                              </div>
                              <div className="mt-2 space-y-2 rounded-lg bg-muted/50 px-2.5 py-2 text-[10.5px]">
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Unidade</p>
                                  <p className="mt-0.5 break-words font-medium leading-snug text-foreground">{sessionUnitName || "Não vinculada"}</p>
                                </div>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-2 text-[10.5px]">
                                <div className="rounded-lg bg-emerald-50 px-2 py-2">
                                  <p className="text-emerald-700/70">Entradas</p>
                                  <p className="mt-0.5 truncate font-mono font-semibold text-emerald-700">
                                    {formatCurrency(sessionFinancialSummary.entries)}
                                  </p>
                                </div>
                                <div className="rounded-lg bg-rose-50 px-2 py-2">
                                  <p className="text-rose-700/70">Saídas</p>
                                  <p className="mt-0.5 truncate font-mono font-semibold text-rose-700">
                                    {formatCurrency(sessionFinancialSummary.exits)}
                                  </p>
                                </div>
                                <div className="col-span-2 flex items-center justify-between rounded-lg bg-muted/60 px-2 py-2">
                                  <span className="text-muted-foreground">Saldo do período</span>
                                  <span className={cn(
                                    "font-mono font-semibold",
                                    sessionFinancialSummary.balance >= 0 ? "text-emerald-700" : "text-rose-700"
                                  )}>
                                    {sessionFinancialSummary.balance >= 0 ? "+" : "−"}
                                    {formatCurrency(Math.abs(sessionFinancialSummary.balance))}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div data-testid="transactions-pane" className="flex min-h-0 min-w-0 flex-col">
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
                        onClick={() => {
                          setExpandedItemId(isSelected ? null : item.id);
                        }}
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
                <Button
                  size="sm"
                  className="h-8 rounded-xl text-[11px]"
                  onClick={() => setCloseStatementDialogOpen(true)}
                  disabled={
                    !selectedSessionEditable ||
                    isProcessing ||
                    selectedSessionCounts.pending > 0 ||
                    selectedSessionCounts.audited > 0
                  }
                  title={
                    selectedSessionCounts.pending > 0 || selectedSessionCounts.audited > 0
                      ? "Efetive ou ignore todos os itens antes de fechar."
                      : "Consolidar e fechar este extrato."
                  }
                >
                  Fechar extrato
                </Button>
              </div>
            </div>

            <Sheet
              open={Boolean(selectedDetailItem && selectedValidation)}
              onOpenChange={(open) => {
                if (!open) setExpandedItemId(null);
              }}
            >
              <SheetContent
                side="right"
                className={cn(
                  "flex h-full flex-col gap-0 overflow-hidden border-l p-0 transition-[width,border-radius] duration-200 sm:!max-w-none",
                  auditDrawerExpanded
                    ? "!w-screen rounded-none"
                    : "!w-[min(1006px,calc(100vw-24px))] rounded-l-[20px]"
                )}
              >
                <SheetHeader className="relative border-b bg-background px-7 py-[18px] pr-24">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-12 top-4 h-8 w-8 rounded-lg text-muted-foreground"
                    title={auditDrawerExpanded ? "Restaurar largura" : "Expandir auditoria"}
                    aria-label={auditDrawerExpanded ? "Restaurar largura da auditoria" : "Expandir auditoria"}
                    onClick={() => setAuditDrawerExpanded((current) => !current)}
                  >
                    {auditDrawerExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </Button>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                        Auditoria do extrato
                      </p>
                      <SheetTitle className="mt-1">Conferir e classificar movimentação</SheetTitle>
                      <SheetDescription className="mt-1">
                        {selectedDetailItem?.financialDraft.movementKind === "transfer"
                          ? "Confira as duas contas antes de confirmar. A transferência só será registrada na efetivação."
                          : selectedDetailItem && selectedDetailItem.amount >= 0
                          ? "Complete o cadastro financeiro antes de confirmar. A receita só será registrada na efetivação."
                          : selectedDetailItem && isCardStatementSettlementItem(selectedDetailItem)
                          ? "Confira a origem do pagamento. A liquidação da fatura só será registrada na efetivação."
                          : "Complete o cadastro integral antes de confirmar. A despesa só será criada ou baixada na efetivação."}
                      </SheetDescription>
                    </div>
                    {selectedDetailItem ? (
                      <Badge variant="outline" className="rounded-full px-3 py-1">
                        {formatCurrency(Math.abs(selectedDetailItem.amount))}
                      </Badge>
                    ) : null}
                  </div>
                  {selectedDetailItem && selectedQueueIndex >= 0 ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 rounded-lg"
                          disabled={selectedQueueIndex <= 0}
                          aria-label="Movimentação anterior"
                          onClick={() => setExpandedItemId(selectedSessionItems[selectedQueueIndex - 1]?.id ?? null)}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="whitespace-nowrap text-xs font-semibold text-foreground/80">
                          Item {selectedQueueIndex + 1} de {selectedSessionItems.length}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 rounded-lg"
                          disabled={selectedQueueIndex >= selectedSessionItems.length - 1}
                          aria-label="Próxima movimentação"
                          onClick={() => setExpandedItemId(selectedSessionItems[selectedQueueIndex + 1]?.id ?? null)}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <span className="hidden max-w-[360px] truncate text-[11px] text-muted-foreground md:inline">
                          {selectedDetailItem.rawDescription}
                        </span>
                      </div>
                      <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
                        {selectedQueuePendingCount} pendentes
                      </Badge>
                    </div>
                  ) : null}
                </SheetHeader>
                <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#fbfbfc]">
              {selectedDetailItem && selectedValidation ? (() => {
                const item = selectedDetailItem;
                const validation = selectedValidation;
                const isIncomingMovement = item.amount >= 0;
                const isBoletoPayment = isBoletoPaymentItem(item);
                const pixComment = getPixComment(item);
                const boletoDetailRows = item.bankStatementData
                  ? flattenBankStatementData(item.bankStatementData)
                  : [];
                const splitValueTotal = item.expenseDraft.splitExpenses.reduce(
                  (sum, entry) => sum + (Number(entry.value) || 0),
                  0,
                );
                const splitPercentageTotal = item.expenseDraft.splitExpenses.reduce(
                  (sum, entry) => sum + (Number(entry.percentage) || 0),
                  0,
                );
                const accountAllocationTotal = item.expenseDraft.accountAllocations.reduce(
                  (sum, entry) => sum + (Number(entry.amount) || 0),
                  0,
                );
                const apportionmentPercentageTotal = item.expenseDraft.apportionments.reduce(
                  (sum, entry) => sum + (Number(entry.percentage) || 0),
                  0,
                );
                const accountAllocationOptions = flattenedAccounts.filter(
                  (entry) => entry.parentId === item.expenseDraft.accountPlanId && entry.active !== false,
                );
                const currentMethods = getMethodsForAccount(item.financialDraft.accountId);
                const counterpartyMethods = getMethodsForAccount(item.financialDraft.counterpartyAccountId);
                const existingOptions = getFilteredExistingExpenses(item.id, item.suggestedExpenseId).slice(0, 8);
                const selectedExistingExpense = item.expenseDraft.linkedExpenseId
                  ? linkableExpenses.find((expense) => expense.id === item.expenseDraft.linkedExpenseId) ?? null
                  : null;
                const suggestedExistingExpense = item.suggestedExpenseId
                  ? linkableExpenses.find((expense) => expense.id === item.suggestedExpenseId) ?? null
                  : null;
                const itemSuggestion = getItemSuggestion(item);
                const suggestedExpenseApplied = Boolean(
                  item.suggestedExpenseId && item.expenseDraft.linkedExpenseId === item.suggestedExpenseId,
                );
                const purchaseOptions = getFilteredPurchaseCandidates(item.id).slice(0, 8);
                const selectedPurchaseCandidate = item.expenseDraft.purchaseOrderId
                  ? purchaseCandidatesByOrderId.get(item.expenseDraft.purchaseOrderId) ?? null
                  : null;
                const isTransferMovement = item.financialDraft.movementKind === "transfer";
                const originStepComplete =
                  item.financialDraft.accountId.trim().length > 0 &&
                  item.financialDraft.paymentMethodId.trim().length > 0 &&
                  item.date.trim().length > 0 &&
                  item.rawDescription.trim().length >= 3;
                const classificationStepComplete = validation.expenseValid;
                const auditStepLabels = isTransferMovement
                  ? ["Conta de origem", "Conta de destino", "Efetivação"]
                  : isIncomingMovement
                  ? ["Origem e extrato", "Categoria", "Efetivação"]
                  : isCardStatementSettlementItem(item)
                  ? ["Origem e extrato", "Liquidação", "Efetivação"]
                  : ["Origem e extrato", "Classificação", "Efetivação"];
                const auditStepCompleted = [
                  originStepComplete,
                  classificationStepComplete,
                  item.status === "completed",
                ];
                const treatmentLabel = isTransferMovement
                  ? "Transferência"
                  : isIncomingMovement
                  ? "Receita"
                  : isCardStatementSettlementItem(item)
                  ? "Liquidação de fatura"
                  : item.expenseDraft.mode === "existing"
                  ? "Baixa de despesa"
                  : item.expenseDraft.mode === "purchase"
                  ? "Vínculo com compra"
                  : item.expenseDraft.mode === "split"
                  ? "Despesas divididas"
                  : "Nova despesa";
                const treatmentClassName = isTransferMovement
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : isIncomingMovement
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : isCardStatementSettlementItem(item)
                  ? "border-violet-200 bg-violet-50 text-violet-700"
                  : "border-rose-200 bg-rose-50 text-rose-700";
                const reviewRows: Array<[string, string]> = [
                  [isIncomingMovement ? "Conta de destino" : "Conta pagadora", item.financialDraft.accountName || "—"],
                  ["Forma", item.financialDraft.paymentMethodLabel || "—"],
                  ["Data no extrato", formatInputDate(item.date)],
                  ["Descrição original", item.rawDescription || "—"],
                ];
                if (isTransferMovement) {
                  reviewRows.push(
                    ["Conta de destino", item.financialDraft.counterpartyAccountName || "—"],
                    ["Forma no destino", item.financialDraft.counterpartyPaymentMethodLabel || "—"]
                  );
                } else if (item.amount < 0 && !isCardStatementSettlementItem(item)) {
                  if (item.expenseDraft.mode === "existing") {
                    reviewRows.push(["Despesa vinculada", selectedExistingExpense?.description || "—"]);
                  } else if (item.expenseDraft.mode === "purchase") {
                    reviewRows.push(
                      ["Compra vinculada", selectedPurchaseCandidate?.label || "—"],
                      ["Abate", PURCHASE_LINK_MODE_LABELS[item.expenseDraft.purchaseLinkMode]]
                    );
                  } else if (item.expenseDraft.mode === "split") {
                    reviewRows.push(["Divisão", `${item.expenseDraft.splitExpenses.length} despesas`]);
                  } else {
                    reviewRows.push(
                      ["Descrição da despesa", item.expenseDraft.description || "—"],
                      ["Fornecedor", item.expenseDraft.supplier || "—"],
                      ["Plano de contas", item.expenseDraft.accountPlanName || "—"],
                      ["Competência", formatInputDate(item.expenseDraft.competenceDate)],
                      ["Vencimento", formatInputDate(item.expenseDraft.dueDate)]
                    );
                    if (item.expenseDraft.isApportioned) {
                      reviewRows.push([
                        "Rateio",
                        item.expenseDraft.apportionments
                          .map((entry) => `${entry.resultCenterName || "Unidade"} ${entry.percentage}%`)
                          .join(" · "),
                      ]);
                    } else {
                      reviewRows.push(["Unidade", item.expenseDraft.resultCenterName || "—"]);
                    }
                  }
                }
                reviewRows.push(["Valor", formatCurrency(Math.abs(item.amount))]);
                const effectConsequences = isTransferMovement
                  ? [
                      "Registra a saída na conta de origem e a entrada na conta de destino.",
                      "Concilia as duas pontas sem criar despesa ou receita.",
                      "Marca a movimentação do extrato como efetivada.",
                    ]
                  : isIncomingMovement
                  ? [
                      "Registra a receita bancária no fluxo de caixa.",
                      "Usa a conta, a forma e a descrição conferidas.",
                      "Marca a movimentação do extrato como efetivada.",
                    ]
                  : isCardStatementSettlementItem(item)
                  ? [
                      "Registra o pagamento sem criar uma nova despesa.",
                      "Mantém a associação da fatura para conclusão em Faturas de cartão.",
                      "Concilia a saída com o extrato bancário.",
                    ]
                  : item.expenseDraft.mode === "existing"
                  ? [
                      "Dá baixa na despesa já provisionada.",
                      "Não cria uma despesa duplicada.",
                      "Marca a movimentação do extrato como efetivada.",
                    ]
                  : item.expenseDraft.mode === "purchase"
                  ? [
                      "Abate o saldo pendente da compra selecionada.",
                      "Registra a liquidação parcial ou total no financeiro.",
                      "Concilia a saída com o extrato.",
                    ]
                  : item.expenseDraft.mode === "split"
                  ? [
                      "Cria as despesas divididas já liquidadas.",
                      "Respeita os valores ou percentuais definidos em cada lançamento.",
                      "Marca a movimentação do extrato como efetivada.",
                    ]
                  : [
                      "Cria a despesa já liquidada com o cadastro informado.",
                      "Lança o valor no plano de contas e nas unidades definidas.",
                      "Marca a movimentação do extrato como efetivada.",
                    ];
                return (
                  <div className="mx-auto min-w-0 max-w-[960px] space-y-4 px-6 pb-6 pt-3">
                    <div className="sticky top-0 z-30 -mx-2 border-b border-border/70 bg-[#fbfbfc]/95 px-2 py-2 backdrop-blur">
                      <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border bg-background/95 px-3 py-2 shadow-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className={cn("shrink-0 rounded-md text-[10px] font-semibold uppercase", treatmentClassName)}>
                            {treatmentLabel}
                          </Badge>
                          <span className="truncate text-xs text-muted-foreground">
                            {item.expenseDraft.mode === "new" && item.amount < 0
                              ? item.expenseDraft.description || item.rawDescription
                              : item.rawDescription}
                          </span>
                        </div>
                        <span className={cn(
                          "shrink-0 whitespace-nowrap font-mono text-sm font-semibold",
                          isIncomingMovement ? "text-emerald-600" : "text-rose-700"
                        )}>
                          {isIncomingMovement ? "+" : "−"} {formatCurrency(Math.abs(item.amount))}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-2xl border bg-background px-5 py-4 shadow-sm">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Progresso da auditoria
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-muted-foreground">{auditStep + 1} de 3 etapas</span>
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
                      </div>
                      <div className="grid grid-cols-3">
                        {auditStepLabels.map((label, index) => {
                          const current = auditStep === index;
                          const done = auditStepCompleted[index] || auditStep > index;
                          return (
                            <button
                              key={label}
                              type="button"
                              className="group relative flex min-w-0 flex-col items-center gap-2"
                              onClick={() => setAuditStep(index as 0 | 1 | 2)}
                            >
                              {index > 0 ? (
                                <span className={cn(
                                  "absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2",
                                  auditStep >= index || done ? "bg-primary" : "bg-border"
                                )} />
                              ) : null}
                              <span className={cn(
                                "relative z-10 grid h-8 w-8 place-items-center rounded-full text-xs font-bold transition-colors",
                                done
                                  ? "bg-primary text-primary-foreground"
                                  : current
                                  ? "border-2 border-primary bg-background text-primary"
                                  : "bg-muted text-muted-foreground"
                              )}>
                                {done ? <Check className="h-4 w-4" /> : index + 1}
                              </span>
                              <span className={cn(
                                "max-w-full truncate px-2 text-[11px] font-semibold",
                                current ? "text-primary" : done ? "text-foreground" : "text-muted-foreground"
                              )}>
                                {label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {auditStep > 0 ? (
                      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-background px-4 py-3 shadow-sm">
                        <div className="min-w-0">
                          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Origem confirmada</p>
                          <p className="mt-1 truncate text-xs font-semibold">
                            {item.financialDraft.accountName || "Conta não informada"} · {item.financialDraft.paymentMethodLabel || "Forma não informada"}
                          </p>
                        </div>
                        <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => setAuditStep(0)}>
                          Editar
                        </Button>
                      </div>
                    ) : null}

                    <div className={cn("rounded-2xl border bg-background p-4 shadow-sm", auditStep !== 0 && "hidden")}>
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
                      {pixComment ? (
                        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                            Comentário do Pix
                          </p>
                          <p className="mt-1.5 break-words text-sm leading-relaxed text-sky-950">{pixComment}</p>
                        </div>
                      ) : null}
                    </div>

                    {isBoletoPayment ? (
                      <div className={cn("rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm", auditStep !== 0 && "hidden")}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-amber-950">Dados do pagamento de boleto</p>
                            <p className="mt-1 text-xs leading-relaxed text-amber-800">
                              Dados bancários disponíveis para esta movimentação no Banco Inter.
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0 rounded-full border-amber-300 bg-amber-100 text-amber-800">
                            Boleto
                          </Badge>
                        </div>

                        {boletoDetailRows.length > 0 ? (
                          <div className="mt-4 space-y-4">
                            {(["statement", "payment"] as const).map((group) => {
                              const rows = boletoDetailRows.filter((row) => row.group === group);
                              if (rows.length === 0) return null;
                              return (
                                <div key={group} className="space-y-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                                    {group === "statement" ? "Movimentação no extrato" : "Dados específicos do pagamento"}
                                  </p>
                                  <dl className="divide-y divide-amber-200/70 overflow-hidden rounded-xl border border-amber-200 bg-background/80">
                                    {rows.map((row) => (
                                      <div key={row.key} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
                                        <dt className="text-[11px] font-medium text-muted-foreground">{row.label}</dt>
                                        <dd className="break-all font-mono text-[11px] leading-relaxed text-foreground">{row.value}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="mt-3 rounded-xl border border-dashed border-amber-300 bg-background/60 px-3 py-2.5 text-xs text-amber-800">
                            Os detalhes completos serão preenchidos na próxima sincronização do extrato do Inter.
                          </p>
                        )}
                      </div>
                    ) : null}

                    {item.status === "completed" ? (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
                        Esta movimentação está efetivada. Reabra o item para alterar os dados da auditoria.
                      </div>
                    ) : null}

                    <fieldset disabled={item.status === "completed"} className="contents disabled:opacity-75">
                    <div className={cn("min-w-0 overflow-hidden rounded-2xl border border-sky-100 bg-sky-50/50 p-4", auditStep !== 0 && "hidden")}>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-800">
                        {isIncomingMovement ? "Destino do recebimento" : "Origem do pagamento"}
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

                    <div className={cn("rounded-2xl border border-violet-100 bg-violet-50/50 p-4", auditStep !== 0 && "hidden")}>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-800">
                        Conferência do extrato
                      </p>
                      <div className="grid gap-3 grid-cols-[110px_1fr]">
                        <Input
                          type="date"
                          value={item.date}
                          readOnly
                          aria-readonly="true"
                          className="h-9 cursor-default rounded-xl bg-muted/35 text-xs"
                        />
                        <Input
                          value={item.rawDescription}
                          readOnly
                          aria-readonly="true"
                          className="h-9 cursor-default rounded-xl bg-muted/35 text-xs"
                          placeholder="Descrição original do extrato"
                        />
                      </div>
                      <p className="mt-2 text-[10.5px] text-violet-700/80">
                        Dados originais enviados pelo banco. A classificação financeira é feita nas etapas acima e abaixo.
                      </p>
                    </div>

                    {isTransferMovement ? (
                      <div className={cn("space-y-4 rounded-2xl border border-sky-100 bg-sky-50/50 p-4", auditStep !== 1 && "hidden")}>
                        <div>
                          <p className="text-sm font-semibold text-sky-900">Conta de destino</p>
                          <p className="mt-1 text-xs leading-relaxed text-sky-700">
                            A transferência movimenta saldo entre contas próprias e não cria despesa nem receita.
                          </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">Para onde foi</p>
                            <Select
                              value={item.financialDraft.counterpartyAccountId || "none"}
                              onValueChange={(value) => {
                                const accountId = value === "none" ? "" : value;
                                const accountName = accountId ? getAccountName(accountId) : "";
                                updateItem(item.id, (current) => ({
                                  ...current,
                                  financialDraft: {
                                    ...current.financialDraft,
                                    counterpartyAccountId: accountId,
                                    counterpartyAccountName: accountName,
                                    counterpartyPaymentMethodId: "",
                                    counterpartyPaymentMethodLabel: "",
                                  },
                                }));
                              }}
                            >
                              <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Selecione a conta de destino" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Selecione a conta de destino</SelectItem>
                                {accounts.map((account) => (
                                  <SelectItem key={account.id} value={account.id} disabled={account.id === item.financialDraft.accountId}>
                                    {getAccountOptionLabel(account, unitNameById)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">Como entrou</p>
                            <Select
                              value={item.financialDraft.counterpartyPaymentMethodId || "none"}
                              onValueChange={(value) => {
                                const methodId = value === "none" ? "" : value;
                                updateItem(item.id, (current) => ({
                                  ...current,
                                  financialDraft: {
                                    ...current.financialDraft,
                                    counterpartyPaymentMethodId: methodId,
                                    counterpartyPaymentMethodLabel: methodId
                                      ? getMethodLabel(current.financialDraft.counterpartyAccountId, methodId)
                                      : "",
                                  },
                                }));
                              }}
                            >
                              <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Selecione como entrou" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Selecione como entrou</SelectItem>
                                {counterpartyMethods.map((method: any) => (
                                  <SelectItem key={method.id} value={method.id}>{method.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ) : item.amount >= 0 ? (
                      <div className={cn("rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm", auditStep !== 1 && "hidden")}>
                        <p className="font-semibold text-emerald-800">Classificar recebimento</p>
                        <p className="mt-1 text-xs text-emerald-700">
                          Esta entrada será registrada como receita bancária no fluxo de caixa usando a conta, forma e descrição acima.
                        </p>
                      </div>
                    ) : isCardStatementSettlementItem(item) ? (
                      <div className={cn("rounded-2xl border border-violet-100 bg-violet-50/60 p-4 text-sm", auditStep !== 1 && "hidden")}>
                        <p className="font-semibold text-violet-800">Liquidação de fatura</p>
                        <p className="mt-1 text-xs leading-relaxed text-violet-700">
                          Esta saída será registrada como pagamento de fatura, sem criar uma nova despesa. A associação com o cartão e a competência será concluída em Faturas de cartão.
                        </p>
                      </div>
                    ) : (
                      <div className={cn("space-y-4 rounded-2xl border border-amber-100 bg-amber-50/50 p-4", auditStep !== 1 && "hidden")}>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                          Como tratar esta despesa
                        </p>
                        {item.suggestedExpenseId ? (
                          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-background p-3">
                            <Badge
                              variant="outline"
                              className={cn("shrink-0 rounded-full border-0 text-[10px] font-semibold", itemSuggestion.className)}
                            >
                              {itemSuggestion.badge}
                            </Badge>
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Despesa sugerida pelo sistema
                              </p>
                              <p className="mt-0.5 break-words text-xs font-semibold text-foreground">
                                {item.suggestedExpenseDescription || suggestedExistingExpense?.description || "Despesa existente"}
                              </p>
                              <p className="mt-1 text-[10.5px] text-muted-foreground">
                                {item.suggestedInstallmentNumber ? `Parcela ${item.suggestedInstallmentNumber}` : "Parcela não identificada"}
                                {typeof item.suggestedInstallmentValue === "number"
                                  ? ` · ${formatCurrency(item.suggestedInstallmentValue)}`
                                  : ""}
                                {item.suggestedConfidence === "high"
                                  ? " · valor exato e vencimento compatível"
                                  : " · valor ou vencimento aproximado"}
                              </p>
                            </div>
                            {suggestedExpenseApplied ? (
                              <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
                                <Check className="mr-1 h-3 w-3" /> Sugestão aplicada
                              </Badge>
                            ) : suggestedExistingExpense ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-xl text-xs"
                                onClick={() => applyExistingExpense(item.id, suggestedExistingExpense)}
                              >
                                Usar sugestão
                              </Button>
                            ) : (
                              <span className="text-[10.5px] text-muted-foreground">Sugestão indisponível para vínculo</span>
                            )}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          {([
                            ["existing", "Vincular existente"],
                            ["new", "Gerar despesa"],
                            ["purchase", "Vincular compra"],
                            ["split", "Dividir lançamento"],
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
                                  expenseDraft: {
                                    ...current.expenseDraft,
                                    mode,
                                    ...(mode === "purchase"
                                      ? { hasAccountAllocations: false, accountAllocations: [] }
                                      : {}),
                                  },
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
                            {selectedExistingExpense ? (
                              <div className="grid gap-2 rounded-xl border bg-background p-3 sm:grid-cols-2 lg:grid-cols-4">
                                <div className="sm:col-span-2">
                                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Descrição</p>
                                  <p className="mt-1 text-xs font-medium">{selectedExistingExpense.description || "—"}</p>
                                </div>
                                <div>
                                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Fornecedor</p>
                                  <p className="mt-1 truncate text-xs">{selectedExistingExpense.supplier || "—"}</p>
                                </div>
                                <div>
                                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Valor</p>
                                  <p className="mt-1 font-mono text-xs font-semibold">{formatCurrency(Number(selectedExistingExpense.totalValue) || 0)}</p>
                                </div>
                                <div className="sm:col-span-2">
                                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Plano de contas</p>
                                  <p className="mt-1 text-xs">{selectedExistingExpense.accountPlanName || selectedExistingExpense.accountName || "—"}</p>
                                </div>
                                <div className="sm:col-span-2">
                                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Unidade</p>
                                  <p className="mt-1 text-xs">{selectedExistingExpense.resultCenter || "—"}</p>
                                </div>
                                <div>
                                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Competência</p>
                                  <p className="mt-1 text-xs">{formatStoredExpenseDate(selectedExistingExpense.competenceDate)}</p>
                                </div>
                                <div>
                                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Vencimento</p>
                                  <p className="mt-1 text-xs">{formatStoredExpenseDate(selectedExistingExpense.dueDate)}</p>
                                </div>
                                <div className="sm:col-span-2">
                                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Observações</p>
                                  <p className="mt-1 text-xs text-muted-foreground">{selectedExistingExpense.notes || "—"}</p>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {item.expenseDraft.mode === "new" ? (
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Valor total
                              </p>
                              <Input
                                value={formatCurrency(Math.abs(item.amount))}
                                readOnly
                                className="h-10 rounded-xl bg-muted/35 font-mono text-sm font-semibold"
                                aria-label="Valor total definido pelo extrato"
                              />
                              <p className="text-[10px] text-muted-foreground">Definido pela movimentação bancária.</p>
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Tipo de lançamento
                              </p>
                              <Input
                                value="Despesa realizada pelo extrato"
                                readOnly
                                className="h-10 rounded-xl bg-muted/35 text-sm"
                                aria-label="Tipo de lançamento"
                              />
                              <p className="text-[10px] text-muted-foreground">Será criada já liquidada na efetivação.</p>
                            </div>

                            <div className="space-y-1.5 md:col-span-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Descrição da despesa <span className="text-rose-500">*</span>
                              </p>
                              <Input
                                value={getExpenseDescriptionValue(item)}
                                onChange={(event) => setExpenseDescription(item.id, event.target.value)}
                                onFocus={() => setDescriptionFocusedItemId(item.id)}
                                onBlur={() => {
                                  setDescriptionFocusedItemId((current) => current === item.id ? null : current);
                                  clearExpenseDescriptionDraft(item.id, item.expenseDraft.description);
                                }}
                                className="h-10 rounded-xl text-sm"
                                placeholder="Ex.: Aluguel | Quiosque João Paulo"
                              />
                              {descriptionFocusedItemId === item.id && expenseDescriptionsData?.length ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {expenseDescriptionsData
                                    .filter((entry: any) => entry.active !== false && typeof entry.label === "string")
                                    .filter((entry: any) => entry.label.toLocaleLowerCase("pt-BR").includes(getExpenseDescriptionValue(item).toLocaleLowerCase("pt-BR")))
                                    .slice(0, 5)
                                    .map((entry: any) => (
                                      <button
                                        key={entry.id}
                                        type="button"
                                        className="rounded-full border bg-background px-2 py-1 text-[10.5px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => setExpenseDescription(item.id, entry.label)}
                                      >
                                        {entry.label}
                                      </button>
                                    ))}
                                </div>
                              ) : null}
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Fornecedor <span className="text-rose-500">*</span>
                              </p>
                              <Popover
                                open={supplierOpenItemId === item.id}
                                onOpenChange={(open) => setSupplierOpenItemId(open ? item.id : null)}
                              >
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className={cn(
                                      "h-10 w-full justify-between rounded-xl px-3 text-left text-sm font-normal",
                                      item.expenseDraft.supplier.trim().length < 3 && "border-amber-300",
                                    )}
                                  >
                                    <span className={cn("truncate", !item.expenseDraft.supplier && "text-muted-foreground")}>
                                      {item.expenseDraft.supplier || "Selecione ou informe o fornecedor"}
                                    </span>
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
                                  <Input
                                    value={supplierSearch}
                                    onChange={(event) => setSupplierSearch(event.target.value)}
                                    placeholder="Buscar fornecedor ou colaborador..."
                                    className="h-9 rounded-lg text-xs"
                                  />
                                  <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                                    {supplierSearch.trim() ? (
                                      <button
                                        type="button"
                                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted"
                                        onClick={() => {
                                          updateItem(item.id, (current) => ({
                                            ...current,
                                            expenseDraft: { ...current.expenseDraft, supplier: supplierSearch.trim() },
                                          }));
                                          setSupplierOpenItemId(null);
                                        }}
                                      >
                                        <PlusCircle className="h-4 w-4 text-primary" />
                                        Usar “{supplierSearch.trim()}”
                                      </button>
                                    ) : null}
                                    {filteredEntities.slice(0, 8).map((entity) => {
                                      const label = entity.fantasyName || entity.name;
                                      return (
                                        <button
                                          key={entity.id}
                                          type="button"
                                          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted"
                                          onClick={() => {
                                            updateItem(item.id, (current) => ({
                                              ...current,
                                              expenseDraft: { ...current.expenseDraft, supplier: label },
                                            }));
                                            setSupplierOpenItemId(null);
                                          }}
                                        >
                                          <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                                          <span className="truncate">{label}</span>
                                        </button>
                                      );
                                    })}
                                    {filteredUsers.slice(0, 5).map((entry) => (
                                      <button
                                        key={entry.id}
                                        type="button"
                                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted"
                                        onClick={() => {
                                          updateItem(item.id, (current) => ({
                                            ...current,
                                            expenseDraft: { ...current.expenseDraft, supplier: entry.username || entry.email },
                                          }));
                                          setSupplierOpenItemId(null);
                                        }}
                                      >
                                        <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                                        <span className="truncate">{entry.username || entry.email}</span>
                                      </button>
                                    ))}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Competência <span className="text-rose-500">*</span>
                              </p>
                              <Input
                                type="month"
                                value={item.expenseDraft.competenceDate.slice(0, 7)}
                                onChange={(event) => updateItem(item.id, (current) => ({
                                  ...current,
                                  expenseDraft: {
                                    ...current.expenseDraft,
                                    competenceDate: event.target.value ? `${event.target.value}-01` : "",
                                  },
                                }))}
                                className="h-10 rounded-xl text-sm"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Vencimento original <span className="text-rose-500">*</span>
                              </p>
                              <Input
                                type="date"
                                value={item.expenseDraft.dueDate}
                                onChange={(event) => updateItem(item.id, (current) => ({
                                  ...current,
                                  expenseDraft: {
                                    ...current.expenseDraft,
                                    dueDate: event.target.value,
                                  },
                                }))}
                                className="h-10 rounded-xl text-sm"
                              />
                              <p className="text-[10px] text-muted-foreground">
                                Vem preenchido com a data do extrato e pode ser corrigido.
                              </p>
                            </div>

                            <div className="flex items-center justify-between rounded-xl border bg-background px-3 py-2.5 md:col-span-2">
                              <div>
                                <p className="text-sm font-medium">Desmembrar em subcontas</p>
                                <p className="text-[11px] text-muted-foreground">
                                  Mantém uma única despesa e distribui o valor entre contas filhas, como no DAS.
                                </p>
                              </div>
                              <Switch
                                checked={item.expenseDraft.hasAccountAllocations}
                                onCheckedChange={(checked) => setAccountAllocationMode(item.id, checked)}
                              />
                            </div>

                            <div className="space-y-1.5 md:col-span-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                {item.expenseDraft.hasAccountAllocations ? "Conta-mãe do título" : "Plano de contas"}{" "}
                                <span className="text-rose-500">*</span>
                              </p>
                              <AccountPlanTreeSelect
                                value={item.expenseDraft.accountPlanId}
                                onChange={(value) => {
                                  const account = flattenedAccounts.find((entry) => entry.id === value);
                                  const children = flattenedAccounts.filter(
                                    (entry) => entry.parentId === value && entry.active !== false,
                                  );
                                  const half = Number((Math.abs(item.amount) / 2).toFixed(2));
                                  updateItem(item.id, (current) => ({
                                    ...current,
                                    expenseDraft: {
                                      ...current.expenseDraft,
                                      accountPlanId: value,
                                      accountPlanName: account?.name || "",
                                      accountAllocations: current.expenseDraft.hasAccountAllocations
                                        ? [
                                            createAccountAllocationEntry({
                                              accountPlanId: children[0]?.id || "",
                                              accountPlanName: children[0]?.name || "",
                                              amount: half,
                                            }),
                                            createAccountAllocationEntry({
                                              accountPlanId: children[1]?.id || "",
                                              accountPlanName: children[1]?.name || "",
                                              amount: Number((Math.abs(item.amount) - half).toFixed(2)),
                                            }),
                                          ]
                                        : current.expenseDraft.accountAllocations,
                                    },
                                  }));
                                }}
                                options={accountPlansList}
                                placeholder={item.expenseDraft.hasAccountAllocations ? "Selecione a conta-mãe" : "Selecione o plano de contas"}
                                triggerClassName="h-10 rounded-xl text-sm"
                              />
                            </div>

                            {item.expenseDraft.hasAccountAllocations ? (
                              <div className="space-y-3 rounded-xl border bg-background p-3 md:col-span-2">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-medium">Apropriações contábeis</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      Cada subconta alimentará sua posição na DRE sem criar outro pagamento.
                                    </p>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-xl text-xs"
                                    disabled={
                                      accountAllocationOptions.length === 0 ||
                                      item.expenseDraft.accountAllocations.length >= accountAllocationOptions.length
                                    }
                                    onClick={() => appendAccountAllocation(item.id)}
                                  >
                                    <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar subconta
                                  </Button>
                                </div>
                                {item.expenseDraft.accountAllocations.map((allocation) => (
                                  <div key={allocation.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_36px]">
                                    <Select
                                      value={allocation.accountPlanId || "none"}
                                      onValueChange={(value) => {
                                        const account = accountAllocationOptions.find((entry) => entry.id === value);
                                        updateAccountAllocation(item.id, allocation.id, (current) => ({
                                          ...current,
                                          accountPlanId: value === "none" ? "" : value,
                                          accountPlanName: value === "none" ? "" : account?.name || "",
                                        }));
                                      }}
                                    >
                                      <SelectTrigger className="h-9 rounded-xl text-xs">
                                        <SelectValue placeholder="Selecione a subconta" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none">Selecione a subconta</SelectItem>
                                        {accountAllocationOptions.map((account) => (
                                          <SelectItem
                                            key={account.id}
                                            value={account.id}
                                            disabled={item.expenseDraft.accountAllocations.some(
                                              (entry) => entry.id !== allocation.id && entry.accountPlanId === account.id,
                                            )}
                                          >
                                            {account.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={allocation.amount}
                                      onChange={(event) => updateAccountAllocation(item.id, allocation.id, (current) => ({
                                        ...current,
                                        amount: Number(event.target.value) || 0,
                                      }))}
                                      className="h-9 rounded-xl font-mono text-xs"
                                      aria-label="Valor apropriado na subconta"
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9 rounded-xl text-muted-foreground"
                                      disabled={item.expenseDraft.accountAllocations.length <= 2}
                                      onClick={() => removeAccountAllocation(item.id, allocation.id)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                                <div className="flex items-center justify-between rounded-lg bg-muted/35 px-3 py-2 text-xs">
                                  <span>Apropriado: <strong>{formatCurrency(accountAllocationTotal)}</strong></span>
                                  <span className={cn(
                                    "font-semibold",
                                    Math.abs(accountAllocationTotal - Math.abs(item.amount)) < 0.01
                                      ? "text-emerald-700"
                                      : "text-amber-700",
                                  )}>
                                    {accountAllocationTotal <= Math.abs(item.amount) ? "Restante" : "Excedente"}: {formatCurrency(Math.abs(Math.abs(item.amount) - accountAllocationTotal))}
                                  </span>
                                </div>
                              </div>
                            ) : null}

                            {!item.expenseDraft.isApportioned ? (
                              <div className="space-y-1.5">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                  Unidade <span className="text-rose-500">*</span>
                                </p>
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
                                  placeholder="Selecione a unidade"
                                  searchPlaceholder="Buscar unidade..."
                                  triggerClassName="h-10 rounded-xl text-sm"
                                />
                              </div>
                            ) : null}

                            <div className="flex items-center justify-between rounded-xl border bg-background px-3 py-2.5 md:col-span-2">
                              <div>
                                <p className="text-sm font-medium">Ratear entre unidades</p>
                                <p className="text-[11px] text-muted-foreground">Distribua esta despesa por centro de resultado.</p>
                              </div>
                              <Switch
                                checked={item.expenseDraft.isApportioned}
                                onCheckedChange={(checked) => {
                                  setApportionmentPercentageDrafts({});
                                  updateItem(item.id, (current) => ({
                                    ...current,
                                    expenseDraft: {
                                      ...current.expenseDraft,
                                      isApportioned: checked,
                                      resultCenterId: checked ? "" : current.expenseDraft.resultCenterId,
                                      resultCenterName: checked ? "" : current.expenseDraft.resultCenterName,
                                      apportionments: checked
                                        ? distributeApportionmentsEvenly(
                                            current.expenseDraft.apportionments.length > 0
                                              ? current.expenseDraft.apportionments
                                              : [createApportionmentEntry()],
                                          )
                                        : current.expenseDraft.apportionments,
                                    },
                                  }));
                                }}
                              />
                            </div>

                            {item.expenseDraft.isApportioned ? (
                              <div className="space-y-2 rounded-xl border bg-background p-3 md:col-span-2">
                                <div className="hidden gap-2 px-1 pb-1 sm:grid sm:grid-cols-[minmax(0,1fr)_100px_140px_36px]">
                                  <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Unidade</span>
                                  <span className="text-right text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">%</span>
                                  <span className="text-right text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Valor</span>
                                  <span />
                                </div>
                                {item.expenseDraft.apportionments.map((entry) => (
                                  <div key={entry.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_140px_36px]">
                                    <ResultCenterSelect
                                      value={entry.resultCenterId}
                                      onChange={(value) => {
                                        const unit = units.find((candidate) => candidate.id === value);
                                        updateApportionment(item.id, entry.id, (current) => ({
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
                                    <div className="relative">
                                      <Input
                                        inputMode="decimal"
                                        value={getApportionmentPercentageValue(entry)}
                                        onChange={(event) => {
                                          const rawValue = event.target.value;
                                          setApportionmentPercentageDraft(entry.id, rawValue);
                                          updateApportionment(item.id, entry.id, (current) => ({
                                            ...current,
                                            percentage: Number(rawValue.replace(",", ".")) || 0,
                                          }));
                                        }}
                                        onBlur={() => clearApportionmentPercentageDraft(entry.id, entry.percentage)}
                                        className="h-9 rounded-xl pr-7 text-xs"
                                      />
                                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                                    </div>
                                    <div className="flex h-9 items-center justify-end rounded-xl border bg-muted/25 px-3 font-mono text-xs font-semibold">
                                      {formatCurrency(Math.abs(item.amount) * (Number(entry.percentage) || 0) / 100)}
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9 rounded-xl text-muted-foreground"
                                      onClick={() => removeApportionment(item.id, entry.id)}
                                      disabled={item.expenseDraft.apportionments.length <= 1}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                                  <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => appendApportionment(item.id)}>
                                    <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar unidade
                                  </Button>
                                  <div className="text-right">
                                    <p className="text-[10px] text-muted-foreground">Total distribuído</p>
                                    <p className={cn(
                                      "mt-0.5 font-mono text-xs font-semibold",
                                      Math.abs(apportionmentPercentageTotal - 100) < 0.01 ? "text-emerald-700" : "text-amber-700"
                                    )}>
                                      {apportionmentPercentageTotal.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% · {formatCurrency(Math.abs(item.amount) * apportionmentPercentageTotal / 100)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            <div className="space-y-1.5 md:col-span-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Observações
                              </p>
                              <Textarea
                                value={item.expenseDraft.notes}
                                onChange={(event) => updateItem(item.id, (current) => ({
                                  ...current,
                                  expenseDraft: { ...current.expenseDraft, notes: event.target.value },
                                }))}
                                placeholder="Informações complementares para o histórico da despesa"
                                className="min-h-24 rounded-xl text-sm"
                              />
                            </div>
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
                                <p className="text-sm font-semibold">Divisão do lançamento</p>
                                <p className="text-xs text-muted-foreground">
                                  Separe o valor entre unidades e/ou categorias.
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
                            <div className="flex items-center justify-between gap-3 rounded-xl border bg-background p-2">
                              <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Forma de divisão">
                                {(["percentage", "amount"] as const).map((mode) => (
                                  <Button
                                    key={mode}
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className={cn(
                                      "h-7 rounded-md px-3 text-[11px]",
                                      item.expenseDraft.splitAllocationMode === mode && "bg-background shadow-sm hover:bg-background",
                                    )}
                                    onClick={() => setSplitAllocationMode(item.id, mode)}
                                  >
                                    {mode === "percentage" ? "Percentual" : "Valor"}
                                  </Button>
                                ))}
                              </div>
                              <div className="min-w-0 text-right text-[11px] text-muted-foreground">
                                {item.expenseDraft.splitAllocationMode === "percentage" ? (
                                  <>
                                    <span className={cn("font-semibold", Math.abs(splitPercentageTotal - 100) < 0.01 ? "text-emerald-700" : "text-amber-700")}>
                                      {splitPercentageTotal.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                                    </span>
                                    <span> de 100%</span>
                                  </>
                                ) : (
                                  <>
                                    <span className={cn("font-semibold", Math.abs(splitValueTotal - Math.abs(item.amount)) < 0.01 ? "text-emerald-700" : "text-amber-700")}>
                                      {formatCurrency(splitValueTotal)}
                                    </span>
                                    <span> de {formatCurrency(Math.abs(item.amount))}</span>
                                  </>
                                )}
                              </div>
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
                                    <div className="col-span-2 space-y-1">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                        Descrição <span className="text-rose-500">*</span>
                                      </p>
                                      <Input
                                        value={split.description}
                                        onChange={(event) =>
                                          updateSplitExpense(item.id, split.id, (current) => ({
                                            ...current,
                                            description: event.target.value,
                                          }))
                                        }
                                        className={cn("h-9 rounded-xl text-xs", split.description.trim().length < 10 && "border-amber-300")}
                                        placeholder="Descrição da despesa"
                                      />
                                    </div>
                                    <div className="col-span-2 space-y-1">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                        Fornecedor <span className="text-rose-500">*</span>
                                      </p>
                                      <Input
                                        value={split.supplier}
                                        onChange={(event) =>
                                          updateSplitExpense(item.id, split.id, (current) => ({
                                            ...current,
                                            supplier: event.target.value,
                                          }))
                                        }
                                        className={cn("h-9 rounded-xl text-xs", split.supplier.trim().length < 3 && "border-amber-300")}
                                        placeholder="Fornecedor"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                        {item.expenseDraft.splitAllocationMode === "percentage" ? "Percentual" : "Valor"}
                                      </p>
                                      <div className="relative">
                                        <Input
                                          type="number"
                                          min="0"
                                          max={item.expenseDraft.splitAllocationMode === "percentage" ? "100" : undefined}
                                          step="0.01"
                                          value={item.expenseDraft.splitAllocationMode === "percentage" ? split.percentage : split.value}
                                          onChange={(event) => {
                                            const value = Number(event.target.value) || 0;
                                            if (item.expenseDraft.splitAllocationMode === "percentage") {
                                              updateSplitPercentage(item.id, split.id, value);
                                              return;
                                            }
                                            updateSplitExpense(item.id, split.id, (current) => ({ ...current, value }));
                                          }}
                                          className={cn("h-9 rounded-xl text-xs", item.expenseDraft.splitAllocationMode === "percentage" && "pr-8")}
                                          placeholder={item.expenseDraft.splitAllocationMode === "percentage" ? "0" : "Valor"}
                                        />
                                        {item.expenseDraft.splitAllocationMode === "percentage" ? (
                                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                                        ) : null}
                                      </div>
                                      {item.expenseDraft.splitAllocationMode === "percentage" ? (
                                        <p className="text-[10px] text-muted-foreground">{formatCurrency(split.value)}</p>
                                      ) : null}
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                        Competência <span className="text-rose-500">*</span>
                                      </p>
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
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                        Vencimento <span className="text-rose-500">*</span>
                                      </p>
                                      <Input
                                        type="date"
                                        value={split.dueDate}
                                        onChange={(event) =>
                                          updateSplitExpense(item.id, split.id, (current) => ({
                                            ...current,
                                            dueDate: event.target.value,
                                          }))
                                        }
                                        className="h-9 rounded-xl text-xs"
                                      />
                                    </div>
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
                            <Textarea
                              value={item.expenseDraft.notes}
                              onChange={(event) => updateItem(item.id, (current) => ({
                                ...current,
                                expenseDraft: { ...current.expenseDraft, notes: event.target.value },
                              }))}
                              placeholder="Observações comuns às despesas divididas"
                              className="min-h-20 rounded-xl text-xs"
                            />
                          </div>
                        ) : null}
                      </div>
                    )}
                    </fieldset>

                    <div className={cn("space-y-4", auditStep !== 2 && "hidden")}>
                      {!validation.ready && item.status !== "completed" && item.status !== "ignored" ? (
                        <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>Há campos obrigatórios pendentes nas etapas anteriores. {validation.issues.join(" ")}</span>
                        </div>
                      ) : null}
                      <div className="rounded-2xl border bg-background p-4 shadow-sm">
                        <div className="mb-4 flex items-center gap-2">
                          <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                            <Check className="h-4 w-4" />
                          </span>
                          <p className="text-sm font-semibold">Revisar e efetivar</p>
                        </div>
                        <dl className="divide-y overflow-hidden rounded-xl border">
                          {reviewRows.map(([label, value]) => (
                            <div key={label} className={cn(
                              "grid gap-1 px-4 py-2.5 sm:grid-cols-[170px_minmax(0,1fr)] sm:items-center sm:gap-4",
                              label === "Valor" && "bg-muted/35"
                            )}>
                              <dt className="text-[11px] text-muted-foreground">{label}</dt>
                              <dd className={cn(
                                "break-words text-xs font-semibold sm:text-right",
                                label === "Valor" && "font-mono text-sm",
                                label === "Valor" && (isIncomingMovement ? "text-emerald-700" : "text-rose-700")
                              )}>
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        <div className="mt-4 rounded-xl border bg-muted/20 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            O que acontece ao efetivar
                          </p>
                          <div className="mt-3 space-y-2">
                            {effectConsequences.map((consequence) => (
                              <div key={consequence} className="flex items-start gap-2 text-xs text-foreground/80">
                                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                                  <Check className="h-3 w-3" />
                                </span>
                                <span>{consequence}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="sticky bottom-0 z-20 rounded-2xl border border-zinc-200 bg-background/95 p-4 shadow-lg backdrop-blur">
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-700">
                        {auditStep < 2 ? `${auditStep + 1}. ${auditStepLabels[auditStep]}` : "3. Auditoria e efetivação"}
                      </p>
                      {auditStep === 2 && !validation.ready && item.status !== "completed" && item.status !== "ignored" ? (
                        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {validation.issues.join(" ")}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-xl text-rose-700"
                          disabled={!selectedSessionEditable || isSavingSession || isProcessing || item.status === "completed"}
                          onClick={() => setItemStatus(item.id, "ignored")}
                        >
                          Ignorar
                        </Button>
                        <div className="flex flex-wrap justify-end gap-2">
                        {auditStep < 2 ? (
                          <>
                            {auditStep > 0 ? (
                              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setAuditStep((auditStep - 1) as 0 | 1)}>
                                Voltar
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              className="rounded-xl"
                              disabled={auditStep === 0 ? !originStepComplete : !validation.ready}
                              onClick={() => setAuditStep((auditStep + 1) as 1 | 2)}
                            >
                              Avançar <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                          </>
                        ) : item.status === "completed" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-xl"
                            disabled={!selectedSessionEditable || isProcessing}
                            onClick={() => {
                              setReopenReason("");
                              setReopenItemId(item.id);
                            }}
                          >
                            Reabrir item
                          </Button>
                        ) : item.status === "ignored" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-xl"
                            disabled={!selectedSessionEditable || isSavingSession}
                            onClick={() => setItemStatus(item.id, "pending")}
                          >
                            Reabrir item
                          </Button>
                        ) : (
                          <>
                            {item.status === "audited" ? (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="rounded-xl"
                                  disabled={!validation.ready || !selectedSessionEditable || isProcessing || isSavingSession}
                                  onClick={() => void effectuateItem(item.id, false)}
                                >
                                  Efetivar e fechar
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="rounded-xl"
                                  disabled={!validation.ready || !selectedSessionEditable || isProcessing || isSavingSession}
                                  onClick={() => void effectuateItem(item.id)}
                                >
                                  {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  Efetivar e próximo
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                className="rounded-xl"
                                disabled={!validation.ready || !selectedSessionEditable || isSavingSession || isProcessing}
                                onClick={() => void confirmAuditItem(item.id)}
                              >
                                {isSavingSession ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Confirmar auditoria
                              </Button>
                            )}
                          </>
                        )}
                        </div>
                      </div>
                    </div>

                    <div className={cn("rounded-2xl border bg-background p-4 shadow-sm", auditStep !== 2 && "hidden")}>
                      <div className="flex items-center gap-2">
                        <History className="h-4 w-4 text-muted-foreground" />
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Histórico da movimentação
                        </p>
                      </div>
                      {item.auditHistory?.length ? (
                        <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
                          {[...item.auditHistory].reverse().map((entry, historyIndex) => (
                            <div
                              key={`${entry.action}-${entry.at}-${historyIndex}`}
                              className="relative border-l-2 border-border pl-3"
                            >
                              <span
                                className={cn(
                                  "absolute -left-[5px] top-1 h-2 w-2 rounded-full ring-2 ring-background",
                                  entry.action === "effectuated"
                                    ? "bg-emerald-500"
                                    : entry.action === "reopened"
                                    ? "bg-amber-500"
                                    : "bg-blue-500"
                                )}
                              />
                              <p className="text-xs font-medium leading-relaxed text-foreground">
                                {getAuditHistoryMessage(entry, item.amount < 0)}
                              </p>
                              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                                {formatAuditHistoryDate(entry.at)}
                              </p>
                              {entry.reason ? (
                                <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1.5 text-[10.5px] text-amber-900">
                                  Motivo: {entry.reason}
                                </p>
                              ) : null}
                              {entry.changes?.length ? (
                                <div className="mt-2 space-y-1 rounded-lg bg-muted/55 px-2.5 py-2">
                                  {entry.changes.map((change) => (
                                    <p key={change.field} className="break-words text-[10.5px] leading-relaxed text-muted-foreground">
                                      <span className="font-semibold text-foreground">{change.label}:</span>{" "}
                                      <span className="line-through">{change.previousValue}</span>{" "}
                                      <span aria-hidden="true">→</span>{" "}
                                      <span className="text-foreground">{change.nextValue}</span>
                                    </p>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">
                          O histórico começa na primeira confirmação desta auditoria.
                        </p>
                      )}
                    </div>

                    <div className={cn("rounded-2xl border bg-background p-4 shadow-sm", auditStep !== 2 && "hidden")}>
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
              </SheetContent>
            </Sheet>
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

      <AlertDialog
        open={reopenItemId !== null}
        onOpenChange={(open) => {
          if (open) return;
          setReopenItemId(null);
          setReopenReason("");
        }}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Reabrir movimentação efetivada?</AlertDialogTitle>
            <AlertDialogDescription>
              A conciliação será desfeita somente para este item. A movimentação bancária permanece no extrato e volta para Pendente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label htmlFor="reopen-audit-reason" className="text-sm font-medium">Motivo da reabertura</label>
            <Textarea
              id="reopen-audit-reason"
              value={reopenReason}
              onChange={(event) => setReopenReason(event.target.value)}
              placeholder="Explique por que este lançamento precisa ser revisto."
              className="min-h-24 rounded-xl"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={reopenReason.trim().length < 5 || isProcessing || !reopenItemId}
              onClick={(event) => {
                event.preventDefault();
                if (!reopenItemId) return;
                void reopenEffectuatedItem(reopenItemId, reopenReason.trim())
                  .then(() => {
                    setReopenItemId(null);
                    setReopenReason("");
                  })
                  .catch(() => undefined);
              }}
            >
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Reabrir item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={closeStatementDialogOpen} onOpenChange={setCloseStatementDialogOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar e consolidar o extrato?</AlertDialogTitle>
            <AlertDialogDescription>
              Serão consolidados {currentSession?.summary.completed ?? 0} itens efetivados e {currentSession?.summary.ignored ?? 0} ignorados. Depois do fechamento, os itens não poderão ser alterados isoladamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isProcessing || !currentSession}
              onClick={(event) => {
                event.preventDefault();
                void closeStatement().then(() => setCloseStatementDialogOpen(false));
              }}
            >
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Fechar extrato
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
