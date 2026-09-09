"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { setDoc, Timestamp, updateDoc, writeBatch } from "firebase/firestore";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileSearch,
  Loader2,
  RefreshCw,
  Repeat2,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import {
  buildCardStatementGroups,
  buildCardStatementAllocations,
  cardStatementLineAuditIssues as cardLineAuditIssues,
  cardStatementLineAuditStatus as getCardLineAuditStatus,
  findCardStatementPaymentCandidates,
  resolveCardStatementCycleFromMonth,
  resolveCardStatementDatesFromDueDate,
  type CardStatementLine,
  type CardStatementGroup,
  type CardStatementAllocation,
  type CreditCardInstrument,
} from "@/features/financial/lib/card-invoices";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import type { CardStatementImportPreview } from "@/features/financial/lib/card-statement-import";
import {
  buildCardStatementExpenseCandidates,
  matchCardStatementExpenses,
} from "@/features/financial/lib/card-statement-expense-matcher";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { financialDb } from "@/lib/firebase-financial";
import { cn } from "@/lib/utils";

type StatementDocument = {
  id: string;
  key?: string;
  monthKey?: string;
  officialTotal?: number;
  status?: "open" | "closed" | "paid";
  linkedBankTransactionId?: string;
  linkedBankTransactionIds?: string[];
  allocations?: CardStatementAllocation[];
  settlements?: Array<{
    transactionId: string;
    amount: number;
    paidAt: string;
  }>;
  paidAt?: unknown;
  closingDate?: unknown;
  dueDate?: unknown;
  notes?: string;
};

type CardStatementsWorkspaceProps = {
  embedded?: boolean;
  fixedMonthKey?: string;
  accountId?: string;
  paymentMethodId?: string;
  returnTo?: string;
};

type CardLineStatusFilter = "all" | "pending" | "audited" | "reconciled";
type CardLineSourceFilter = "all" | "forecast" | "actual";

const COPILOT_STATUS_LABELS = {
  ready: "Pronta para revisão",
  review_required: "Requer atenção",
  blocked: "Importação bloqueada",
} as const;

const EXCLUDED_KIND_LABELS = {
  payment: "Pagamento da fatura",
  credit: "Crédito ou abatimento",
  refund: "Estorno",
  metadata: "Informação da fatura",
  summary: "Totalizador",
  unsupported: "Não importável",
} as const;

function statementDocumentId(key: string) {
  return key.replaceAll(":", "__");
}

function paymentMethodCards(bankAccounts: any[]): CreditCardInstrument[] {
  return bankAccounts
    .filter((account) => account.active !== false)
    .flatMap((account) =>
      (account.paymentMethods || [])
        .filter((method: any) => method.type === "credit_card")
        .map((method: any) => ({
          accountId: account.id,
          accountName: account.name,
          methodId: method.id,
          methodLabel: method.label,
          lastDigits: method.lastDigits,
          closingDay: method.closingDay,
          dueDay: method.dueDay,
        }))
    );
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const label = format(new Date(year, month - 1, 1, 12), "MMMM | yyyy", { locale: ptBR });
  return label.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function changeMonth(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  return format(new Date(year, month - 1 + delta, 1, 12), "yyyy-MM");
}

function statusLabel(status: StatementDocument["status"]) {
  if (status === "paid") return "Fatura paga";
  if (status === "closed") return "Fatura fechada";
  return "Fatura aberta";
}

function isCardLineForecast(line: CardStatementLine) {
  return line.expense.provisionType === "forecast" && line.expense.status === "provisioned";
}

function expenseEditHref(expenseId: string, returnTo?: string) {
  const params = new URLSearchParams({ edit: expenseId });
  if (returnTo) params.set("returnTo", returnTo);
  return `${FINANCIAL_ROUTES.newExpense}?${params.toString()}`;
}

function lineReconciliationUpdate(
  line: CardStatementLine,
  reconciled: boolean,
  statementKey: string | null,
  statementMonthKey: string | null,
  userId: string,
) {
  const reconciledAt = reconciled ? Timestamp.now() : null;
  const installments = Array.isArray(line.expense.installments) ? line.expense.installments : [];
  const nextInstallments = line.installmentNumber
    ? installments.map((installment, index) =>
        (Number(installment.number) || index + 1) === line.installmentNumber
          ? {
              ...installment,
              cardReconciliationStatus: reconciled ? "reconciled" : "pending",
              cardReconciledAt: reconciledAt,
              cardStatementKey: statementKey,
            }
          : installment
      )
    : installments.length === 1
      ? installments.map((installment) => ({
          ...installment,
          cardReconciliationStatus: reconciled ? "reconciled" : "pending",
          cardReconciledAt: reconciledAt,
          cardStatementKey: statementKey,
        }))
      : installments;

  return {
    ...(line.installmentNumber ? {} : { cardReconciliationStatus: reconciled ? "reconciled" : "pending" }),
    ...(nextInstallments.length > 0 ? { installments: nextInstallments } : {}),
    cardReconciledAt: reconciledAt,
    cardReconciledBy: reconciled ? userId : null,
    cardStatementKey: statementKey,
    cardStatementId: statementKey ? statementDocumentId(statementKey) : null,
    cardStatementMonthKey: statementMonthKey,
    updatedAt: Timestamp.now(),
  };
}

export function CardStatementsWorkspace({
  embedded = false,
  fixedMonthKey,
  accountId,
  paymentMethodId,
  returnTo,
}: CardStatementsWorkspaceProps = {}) {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [monthKey, setMonthKey] = useState(() => fixedMonthKey || format(new Date(), "yyyy-MM"));
  const [selectedCardKey, setSelectedCardKey] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [lineStatusFilter, setLineStatusFilter] = useState<CardLineStatusFilter>("all");
  const [lineSourceFilter, setLineSourceFilter] = useState<CardLineSourceFilter>("all");
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<CardStatementImportPreview | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedImportLineIds, setSelectedImportLineIds] = useState<string[]>([]);
  const [importResolutionByLineId, setImportResolutionByLineId] = useState<Record<string, string>>({});
  const [importingStatement, setImportingStatement] = useState(false);
  const cardStatementFileRef = useRef<HTMLInputElement>(null);
  const cardStatementPermissions = permissions.financial?.cardStatements;
  const canViewCardStatements = cardStatementPermissions?.view === true;
  const canImportCardStatements = canViewCardStatements && cardStatementPermissions?.import === true;
  const canAuditCardStatements = canViewCardStatements && cardStatementPermissions?.audit === true;
  const canCloseCardStatements = canViewCardStatements && cardStatementPermissions?.close === true;
  const canReconcileCardStatements = canViewCardStatements && cardStatementPermissions?.reconcile === true;

  const { data: expensesData, loading: expensesLoading, refresh: refreshExpenses } = useFinancialCollection<any>(
    financialCollection("expenses")
  );
  const { data: bankAccountsData, loading: accountsLoading } = useFinancialCollection<any>(
    financialCollection("bankAccounts")
  );
  const { data: statementsData, loading: statementsLoading, refresh: refreshStatements } = useFinancialCollection<StatementDocument>(
    financialCollection("cardStatements")
  );
  const canViewBankTransactions = canReconcileCardStatements;
  const { data: transactionsData, loading: transactionsLoading } = useFinancialCollection<any>(
    canViewBankTransactions ? financialCollection("transactions") : null
  );

  const cards = useMemo(
    () => paymentMethodCards(bankAccountsData || []).filter((card) => (
      (!accountId || card.accountId === accountId) &&
      (!paymentMethodId || card.methodId === paymentMethodId)
    )),
    [accountId, bankAccountsData, paymentMethodId]
  );
  const generatedGroups = useMemo(
    () => buildCardStatementGroups(expensesData || [], cards),
    [cards, expensesData]
  );
  const statementByKey = useMemo(
    () => new Map((statementsData || []).map((statement) => [statement.key || statement.id, statement])),
    [statementsData]
  );
  const monthGroups = useMemo<CardStatementGroup[]>(() => {
    const generatedByCard = new Map(
      generatedGroups
        .filter((group) => group.monthKey === monthKey)
        .map((group) => [`${group.card.accountId}:${group.card.methodId}`, group])
    );

    return cards.map((card) => {
      const cardKey = `${card.accountId}:${card.methodId}`;
      const generated = generatedByCard.get(cardKey);
      const baseGroup = generated ?? {
        ...resolveCardStatementCycleFromMonth(monthKey, card),
        card,
        lines: [],
        projectedTotal: 0,
        reconciledTotal: 0,
        recurringCount: 0,
        provisionCount: 0,
        provisionedTotal: 0,
      };
      const statement = statementByKey.get(baseGroup.key);
      return {
        ...baseGroup,
        closingDate: toDate(statement?.closingDate) || baseGroup.closingDate,
        dueDate: toDate(statement?.dueDate) || baseGroup.dueDate,
      };
    });
  }, [cards, generatedGroups, monthKey, statementByKey]);
  const selectedGroup = monthGroups.find(
    (group) => `${group.card.accountId}:${group.card.methodId}` === selectedCardKey
  ) ?? monthGroups[0] ?? null;
  const selectedStatement = selectedGroup ? statementByKey.get(selectedGroup.key) ?? null : null;
  const officialTotal = Number(selectedStatement?.officialTotal || 0);
  const postedTotal = selectedGroup?.lines
    .filter((line) => !isCardLineForecast(line))
    .reduce((total, line) => total + line.value, 0) ?? 0;
  const difference = officialTotal > 0 && selectedGroup
    ? Number((officialTotal - postedTotal).toFixed(2))
    : null;
  const reconciledCount = selectedGroup?.lines.filter((line) => line.reconciled).length ?? 0;
  const selectedLineCounts = useMemo(() => {
    const counts = { all: 0, pending: 0, audited: 0, reconciled: 0 };
    for (const line of selectedGroup?.lines || []) {
      counts.all += 1;
      counts[getCardLineAuditStatus(line)] += 1;
    }
    return counts;
  }, [selectedGroup]);
  const visibleCardLines = useMemo(() => {
    return (selectedGroup?.lines || []).filter((line) => {
      if (lineStatusFilter !== "all" && getCardLineAuditStatus(line) !== lineStatusFilter) return false;
      if (lineSourceFilter === "forecast") return isCardLineForecast(line);
      if (lineSourceFilter === "actual") return !isCardLineForecast(line);
      return true;
    });
  }, [lineSourceFilter, lineStatusFilter, selectedGroup]);
  const visibleCardLineGroups = useMemo(() => {
    const groups = new Map<string, { date: Date; lines: CardStatementLine[]; total: number }>();
    for (const line of visibleCardLines) {
      const dateKey = format(line.chargeDate, "yyyy-MM-dd");
      const current = groups.get(dateKey) || { date: line.chargeDate, lines: [], total: 0 };
      current.lines.push(line);
      current.total += line.value;
      groups.set(dateKey, current);
    }
    return [...groups.values()].sort((left, right) => right.date.getTime() - left.date.getTime());
  }, [visibleCardLines]);
  const selectedLineIdSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);
  const selectedCardLines = useMemo(
    () => (selectedGroup?.lines || []).filter((line) => selectedLineIdSet.has(line.lineId)),
    [selectedGroup, selectedLineIdSet]
  );
  const selectedReadyLines = useMemo(
    () => selectedCardLines.filter((line) => getCardLineAuditStatus(line) === "audited"),
    [selectedCardLines]
  );
  const allVisibleLinesSelected = visibleCardLines.length > 0
    && visibleCardLines.every((line) => selectedLineIdSet.has(line.lineId));
  const allLinesReconciled = !!selectedGroup?.lines.length && reconciledCount === selectedGroup.lines.length;
  const allLinesAuditComplete = !!selectedGroup?.lines.length && selectedGroup.lines.every(
    (line) => cardLineAuditIssues(line).length === 0
  );
  const canClose = allLinesReconciled && allLinesAuditComplete && officialTotal > 0 && Math.abs(difference || 0) <= 0.05;
  const linkedTransactionIds = useMemo(
    () => new Set(
      (statementsData || []).flatMap((statement) => [
        statement.linkedBankTransactionId,
        ...(statement.linkedBankTransactionIds || []),
      ]).filter(Boolean) as string[]
    ),
    [statementsData]
  );
  const paymentCandidates = useMemo(
    () => selectedGroup && officialTotal > 0
      ? findCardStatementPaymentCandidates(
          officialTotal,
          selectedGroup.dueDate,
          transactionsData || [],
          linkedTransactionIds
        )
      : [],
    [linkedTransactionIds, officialTotal, selectedGroup, transactionsData]
  );
  const existingImportFingerprints = useMemo(
    () => new Set((expensesData || []).flatMap((expense) => [
      String(expense.cardStatementImportFingerprint || ""),
      ...(Array.isArray(expense.cardStatementImportFingerprints)
        ? expense.cardStatementImportFingerprints.map(String)
        : []),
    ]).filter(Boolean)),
    [expensesData]
  );
  const revisionRemovedFingerprintSet = useMemo(
    () => new Set((importPreview?.revision?.removed || []).map((line) => line.fingerprint)),
    [importPreview]
  );
  const importExpenseCandidates = useMemo(
    () => buildCardStatementExpenseCandidates(expensesData || [], revisionRemovedFingerprintSet),
    [expensesData, revisionRemovedFingerprintSet]
  );
  const importExpenseMatches = useMemo(
    () => matchCardStatementExpenses(importPreview?.transactions || [], importExpenseCandidates),
    [importExpenseCandidates, importPreview]
  );
  const importExpenseMatchByLineId = useMemo(
    () => new Map(importExpenseMatches.map((match) => [match.lineId, match])),
    [importExpenseMatches]
  );
  const revisionLineByFingerprint = useMemo(
    () => new Map((importPreview?.revision?.lines || []).map((line) => [line.fingerprint, line])),
    [importPreview]
  );
  const availableImportLines = useMemo(
    () => (importPreview?.transactions || []).filter((line) => importPreview?.revision
      ? revisionLineByFingerprint.get(line.fingerprint)?.status !== "unchanged"
      : !existingImportFingerprints.has(line.fingerprint)),
    [existingImportFingerprints, importPreview, revisionLineByFingerprint]
  );
  const selectedImportLineIdSet = useMemo(() => new Set(selectedImportLineIds), [selectedImportLineIds]);
  const selectedImportLines = useMemo(
    () => availableImportLines.filter((line) => selectedImportLineIdSet.has(line.id)),
    [availableImportLines, selectedImportLineIdSet]
  );
  const revisionRemovedCount = importPreview?.revision?.summary.removed || 0;
  const hasImportChanges = selectedImportLines.length > 0 || revisionRemovedCount > 0;
  const importBlocked = importPreview?.revision?.blockedReason === "paid_statement";
  const importNeedsUnavailableReopen = importPreview?.revision?.requiresReopen && !canCloseCardStatements;

  useEffect(() => {
    if (!importPreview) {
      setImportResolutionByLineId({});
      return;
    }
    setImportResolutionByLineId((current) => Object.fromEntries(
      importPreview.transactions.map((line) => {
        const match = importExpenseMatchByLineId.get(line.id);
        const revision = revisionLineByFingerprint.get(line.fingerprint);
        const currentValue = current[line.id];
        const available = match?.candidates.some((candidate) => candidate.lineId === currentValue);
        return [
          line.id,
          revision?.status === "changed" && revision.previousExpenseId
            ? `revision:${line.fingerprint}`
            : available ? currentValue : match?.confidence === "high" && match.recommendedCandidateId
            ? match.recommendedCandidateId
            : "create",
        ];
      })
    ));
  }, [importExpenseMatchByLineId, importPreview, revisionLineByFingerprint]);

  useEffect(() => {
    if (fixedMonthKey && fixedMonthKey !== monthKey) setMonthKey(fixedMonthKey);
  }, [fixedMonthKey, monthKey]);

  useEffect(() => {
    if (!monthGroups.length) {
      setSelectedCardKey("");
      return;
    }
    if (!monthGroups.some((group) => `${group.card.accountId}:${group.card.methodId}` === selectedCardKey)) {
      const first = monthGroups[0];
      setSelectedCardKey(`${first.card.accountId}:${first.card.methodId}`);
    }
  }, [monthGroups, selectedCardKey]);

  useEffect(() => {
    setSelectedLineIds([]);
  }, [monthKey, selectedCardKey]);

  if (!canViewCardStatements) {
    return (
      <FinancialAccessGuard
        title="Faturas de cartão"
        description="Seu perfil não possui permissão para consultar despesas e faturas corporativas."
      />
    );
  }

  const loading = expensesLoading || accountsLoading || statementsLoading || transactionsLoading;

  async function closeStatement() {
    if (!firebaseUser || !selectedGroup || !canCloseCardStatements) return;
    if (!Number.isFinite(officialTotal) || officialTotal <= 0) {
      toast({ variant: "destructive", title: "A fatura ainda não possui um total válido." });
      return;
    }
    if (!canClose) {
      toast({
        variant: "destructive",
        title: "A fatura ainda possui divergências.",
        description: "Confira todas as linhas e elimine a diferença entre o total da fatura e os itens lançados.",
      });
      return;
    }

    setWorking("statement");
    try {
      await setDoc(
        financialDoc("cardStatements", statementDocumentId(selectedGroup.key)),
        {
          key: selectedGroup.key,
          monthKey: selectedGroup.monthKey,
          accountId: selectedGroup.card.accountId,
          accountName: selectedGroup.card.accountName,
          paymentMethodId: selectedGroup.card.methodId,
          paymentMethodLabel: selectedGroup.card.methodLabel,
          closingDate: Timestamp.fromDate(selectedGroup.closingDate),
          dueDate: Timestamp.fromDate(selectedGroup.dueDate),
          projectedTotal: selectedGroup.projectedTotal,
          provisionedTotal: selectedGroup.provisionedTotal,
          officialTotal,
          status: "closed",
          allocations: buildCardStatementAllocations(selectedGroup.lines),
          updatedAt: Timestamp.now(),
          updatedBy: firebaseUser.uid,
          ...(selectedStatement ? {} : { createdAt: Timestamp.now(), createdBy: firebaseUser.uid }),
        },
        { merge: true }
      );
      refreshStatements();
      toast({ title: "Fatura conferida e fechada." });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Não foi possível salvar a fatura." });
    } finally {
      setWorking(null);
    }
  }

  async function toggleLine(line: CardStatementLine, reconciled: boolean) {
    if (!firebaseUser || !canAuditCardStatements || selectedStatement?.status === "paid") return;
    const issues = cardLineAuditIssues(line);
    if (reconciled && issues.length > 0) {
      toast({
        variant: "destructive",
        title: "Complete a auditoria deste item.",
        description: `Revise: ${issues.join(", ")}.`,
      });
      return;
    }
    setWorking(line.lineId);
    try {
      await updateDoc(
        financialDoc("expenses", line.expense.id),
        lineReconciliationUpdate(
          line,
          reconciled,
          selectedGroup?.key || null,
          selectedGroup?.monthKey || null,
          firebaseUser.uid,
        ),
      );
      refreshExpenses();
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Não foi possível atualizar a conferência." });
    } finally {
      setWorking(null);
    }
  }

  async function confirmSelectedLines() {
    if (!firebaseUser || !selectedGroup || !canAuditCardStatements || selectedStatement?.status === "paid") return;
    if (selectedReadyLines.length === 0) {
      toast({
        variant: "destructive",
        title: "Nenhuma cobrança está pronta para conferência.",
        description: "Conclua a auditoria dos itens pendentes ou selecione cobranças auditadas.",
      });
      return;
    }

    setWorking("bulk-lines");
    try {
      const batch = writeBatch(financialDb);
      for (const line of selectedReadyLines) {
        batch.update(
          financialDoc("expenses", line.expense.id),
          lineReconciliationUpdate(line, true, selectedGroup.key, selectedGroup.monthKey, firebaseUser.uid),
        );
      }
      await batch.commit();
      setSelectedLineIds([]);
      refreshExpenses();
      toast({
        title: `${selectedReadyLines.length} cobrança${selectedReadyLines.length === 1 ? " conferida" : "s conferidas"}.`,
        description: selectedReadyLines.length < selectedCardLines.length
          ? "Os demais itens selecionados ainda precisam de auditoria ou já estavam conferidos."
          : undefined,
      });
    } catch {
      toast({ variant: "destructive", title: "Não foi possível concluir a conferência em lote." });
    } finally {
      setWorking(null);
    }
  }

  async function reconcilePayment(candidate: ReturnType<typeof findCardStatementPaymentCandidates>[number]) {
    if (!firebaseUser || !selectedGroup || !selectedStatement || !canClose || !canReconcileCardStatements) return;
    const paidAtDate = toDate(candidate.transaction.date);
    if (!paidAtDate) return;

    setWorking(`payment-${candidate.transaction.id}`);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/financial/card-statements/${encodeURIComponent(statementDocumentId(selectedGroup.key))}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transactionId: candidate.transaction.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao conciliar o pagamento da fatura.");
      refreshStatements();
      refreshExpenses();
      toast({
        title: "Pagamento da fatura conciliado.",
        description: `${selectedGroup.lines.length} despesa${selectedGroup.lines.length === 1 ? " foi liquidada" : "s foram liquidadas"} sem criar uma nova despesa.`,
      });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Não foi possível conciliar o pagamento.", description: error instanceof Error ? error.message : undefined });
    } finally {
      setWorking(null);
    }
  }

  async function readCardStatementFile(file: File) {
    if (!firebaseUser || !selectedGroup || !canImportCardStatements) return;
    const lowerName = file.name.toLocaleLowerCase("pt-BR");
    if (!lowerName.endsWith(".pdf") && !lowerName.endsWith(".csv")) {
      toast({ variant: "destructive", title: "Envie a fatura em PDF ou CSV." });
      return;
    }
    setImportingStatement(true);
    try {
      const form = new FormData();
      form.set("file", file, file.name);
      form.set("accountId", selectedGroup.card.accountId);
      form.set("accountName", selectedGroup.card.accountName);
      form.set("paymentMethodId", selectedGroup.card.methodId);
      form.set("paymentMethodLabel", selectedGroup.card.methodLabel);
      form.set("monthKey", selectedGroup.monthKey);
      const response = await fetch("/api/financial/card-statements/import-preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        body: form,
      });
      const payload = await response.json() as { preview?: CardStatementImportPreview; error?: string };
      if (!response.ok || !payload.preview) throw new Error(payload.error || "O copiloto não conseguiu analisar a fatura.");
      setImportPreview(payload.preview);
      setSelectedImportLineIds(
        payload.preview.analysis.status === "blocked" ? [] : payload.preview.transactions.map((line) => line.id),
      );
      setImportDialogOpen(true);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Não foi possível analisar a fatura.",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setImportingStatement(false);
      if (cardStatementFileRef.current) cardStatementFileRef.current.value = "";
    }
  }

  async function confirmCardStatementImport() {
    if (!firebaseUser || !selectedGroup || !importPreview || !importPreview.revision || !hasImportChanges || importBlocked || importNeedsUnavailableReopen || !canImportCardStatements) return;
    setImportingStatement(true);
    try {
      const importedDueDate = importPreview.dueDate
        ? new Date(`${importPreview.dueDate}T12:00:00`)
        : selectedGroup.dueDate;
      const importedClosingDate = importPreview.closingDate
        ? new Date(`${importPreview.closingDate}T12:00:00`)
        : resolveCardStatementDatesFromDueDate(importedDueDate, selectedGroup.card).closingDate;
      const response = await fetch("/api/financial/card-statements/import", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await firebaseUser.getIdToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          importId: importPreview.revision.importId,
          fileSha256: importPreview.revision.fileSha256,
          revisionAction: importPreview.revision.requiresReopen ? "reopen" : "none",
          accountId: selectedGroup.card.accountId,
          accountName: selectedGroup.card.accountName,
          paymentMethodId: selectedGroup.card.methodId,
          paymentMethodLabel: selectedGroup.card.methodLabel,
          monthKey: selectedGroup.monthKey,
          statementKey: selectedGroup.key,
          fileName: importPreview.fileName,
          officialTotal: importPreview.officialTotal,
          dueDate: format(importedDueDate, "yyyy-MM-dd"),
          closingDate: format(importedClosingDate, "yyyy-MM-dd"),
          analysis: importPreview.analysis,
          lines: selectedImportLines.map((line) => {
            const revision = revisionLineByFingerprint.get(line.fingerprint);
            const selectedCandidateId = importResolutionByLineId[line.id] || "create";
            const candidate = importExpenseMatchByLineId.get(line.id)?.candidates
              .find((entry) => entry.lineId === selectedCandidateId);
            return {
              ...line,
              resolution: revision?.status === "changed" && revision.previousExpenseId
                ? {
                    mode: "existing",
                    expenseId: revision.previousExpenseId,
                    candidateLineId: revision.previousLineId || revision.previousExpenseId,
                    installmentNumber: revision.previousInstallmentNumber ?? null,
                  }
                : candidate
                ? {
                    mode: "existing",
                    expenseId: candidate.expenseId,
                    candidateLineId: candidate.lineId,
                    installmentNumber: candidate.installmentNumber ?? null,
                  }
                : { mode: "create" },
            };
          }),
        }),
      });
      const result = await response.json().catch(() => null) as {
        error?: string;
        created?: number;
        linked?: number;
        replacedForecasts?: number;
        skipped?: number;
        removed?: number;
        reopened?: boolean;
      } | null;
      if (!response.ok) throw new Error(result?.error || "Não foi possível registrar os itens da fatura.");
      setImportDialogOpen(false);
      setImportPreview(null);
      setSelectedImportLineIds([]);
      setImportResolutionByLineId({});
      refreshStatements();
      refreshExpenses();
      toast({
        title: "Fatura importada para auditoria.",
        description: [
          result?.created ? `${result.created} nova(s)` : null,
          result?.linked ? `${result.linked} vinculada(s)` : null,
          result?.replacedForecasts ? `${result.replacedForecasts} previsão(ões) substituída(s)` : null,
          result?.removed ? `${result.removed} removida(s) da versão ativa` : null,
          result?.skipped ? `${result.skipped} já importada(s)` : null,
          result?.reopened ? "fatura reaberta" : null,
        ].filter(Boolean).join(" · ") || "Itens registrados sem efetivação automática.",
      });
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Não foi possível registrar os itens da fatura.",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setImportingStatement(false);
    }
  }

  const statementStatus = selectedStatement?.status || "open";
  const selectedGroupLineCount = selectedGroup?.lines.length || 0;
  const valuesBalanced = difference !== null && Math.abs(difference) <= 0.05;
  const reconciledTotal = selectedGroup?.lines
    .filter((line) => line.reconciled)
    .reduce((total, line) => total + line.value, 0) || 0;
  const postedProgress = officialTotal > 0
    ? Math.min(100, Math.round((postedTotal / officialTotal) * 100))
    : 0;
  const auditStepDone = selectedGroupLineCount > 0 && allLinesAuditComplete;
  const workflowBase = [
    {
      label: "Importar",
      meta: officialTotal > 0 ? "total oficial lido" : "aguardando arquivo",
      done: officialTotal > 0,
    },
    {
      label: "Auditar",
      meta: selectedLineCounts.pending === 0 && selectedGroupLineCount > 0
        ? "cadastros completos"
        : selectedGroupLineCount === 0
          ? "aguardando cobranças"
          : `${selectedLineCounts.pending} com pendência`,
      done: auditStepDone,
    },
    {
      label: "Conferir",
      meta: `${reconciledCount} de ${selectedGroupLineCount}`,
      done: allLinesReconciled,
    },
    {
      label: "Fechar",
      meta: statementStatus === "open" ? (canClose ? "liberado" : "bloqueado") : "fatura fechada",
      done: statementStatus === "closed" || statementStatus === "paid",
    },
    {
      label: "Conciliar",
      meta: statementStatus === "paid" ? "pagamento conciliado" : "aguardando extrato",
      done: statementStatus === "paid",
    },
  ];
  let currentWorkflowStepAssigned = false;
  const workflowSteps = workflowBase.map((step) => {
    const current = !step.done && !currentWorkflowStepAssigned;
    if (current) currentWorkflowStepAssigned = true;
    return { ...step, current };
  });
  const closeChecklist = [
    {
      label: "Cadastros auditados",
      meta: auditStepDone
        ? "Nenhuma cobrança com cadastro incompleto."
        : `${selectedLineCounts.pending} cobrança(s) exigem auditoria antes da conferência.`,
      done: auditStepDone,
    },
    {
      label: "Cobranças conferidas",
      meta: `${reconciledCount} de ${selectedGroupLineCount} conferidas.`,
      done: allLinesReconciled,
    },
    {
      label: "Total oficial informado",
      meta: officialTotal > 0
        ? `Lido da fatura: ${formatCurrency(officialTotal)}.`
        : "Importe a fatura para registrar o total.",
      done: officialTotal > 0,
    },
    {
      label: "Diferença zerada",
      meta: valuesBalanced
        ? "Itens lançados batem com a fatura."
        : difference === null
          ? "Informe o total oficial da fatura."
          : difference > 0
            ? `Faltam ${formatCurrency(Math.abs(difference))} em cobranças lançadas.`
            : `Os lançamentos excedem a fatura em ${formatCurrency(Math.abs(difference))}.`,
      done: valuesBalanced,
    },
  ];

  return (
    <div className={cn(
      "mx-auto w-full",
      embedded
        ? "h-full max-w-none overflow-hidden bg-white"
        : "max-w-[1360px] space-y-4 rounded-[22px] bg-[#f4f2ec] px-4 py-5 pb-8 shadow-sm sm:px-6"
    )}>
      <input
        ref={cardStatementFileRef}
        type="file"
        accept=".pdf,.csv,application/pdf,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void readCardStatementFile(file);
        }}
      />
      {!embedded ? <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
            <Link href={FINANCIAL_ROUTES.expenses}><ArrowLeft className="mr-2 h-4 w-4" />Voltar às despesas</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Faturas de cartão</h1>
          <p className="mt-1 text-sm text-muted-foreground">Previsão mensal, conferência das cobranças e conciliação do pagamento bancário.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canImportCardStatements && selectedGroup ? (
            <Button
              type="button"
              className="h-10 rounded-xl"
              disabled={importingStatement}
              onClick={() => cardStatementFileRef.current?.click()}
            >
              {importingStatement ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {importingStatement ? "Analisando fatura..." : "Importar fatura"}
            </Button>
          ) : null}
          <Button variant="outline" className="h-10 rounded-xl bg-white" asChild>
            <Link href={FINANCIAL_ROUTES.importExpenses}><FileSearch className="mr-2 h-4 w-4" />Conferência do extrato</Link>
          </Button>
        </div>
      </div> : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : embedded && selectedGroup ? (
        <div className="flex h-full min-h-0 min-w-0 flex-col bg-white">
          <div className="space-y-2 border-b px-4 py-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Despesas da fatura</p>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                  <p className="truncate text-[11px] text-muted-foreground">
                    {selectedGroup.card.methodLabel} · {monthKey.split("-").reverse().join("/")}
                  </p>
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0 text-[9.5px] font-medium text-violet-700">
                    Fatura do cartão
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canImportCardStatements ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl bg-white px-3 text-[10.5px]"
                    disabled={importingStatement}
                    onClick={() => cardStatementFileRef.current?.click()}
                  >
                    {importingStatement ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                    {importingStatement ? "Copiloto analisando..." : "Analisar fatura com copiloto"}
                  </Button>
                ) : null}
                <span className="text-[11px] text-muted-foreground">{selectedGroup.lines.length} itens</span>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Status <span className="normal-case tracking-normal text-muted-foreground/60">· fluxo da conferência</span>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  ["all", "Todos", selectedLineCounts.all, "border-zinc-300 bg-zinc-100 text-zinc-800", "bg-zinc-500"],
                  ["pending", "Pendentes", selectedLineCounts.pending, "border-amber-300 bg-amber-50 text-amber-700", "bg-amber-500"],
                  ["audited", "Auditadas", selectedLineCounts.audited, "border-sky-300 bg-sky-50 text-sky-700", "bg-sky-500"],
                  ["reconciled", "Conferidas", selectedLineCounts.reconciled, "border-emerald-300 bg-emerald-50 text-emerald-700", "bg-emerald-500"],
                ] as const).map(([value, label, count, activeClass, dotClass], index) => (
                  <div key={value} className="flex items-center gap-1.5">
                    {index > 0 ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" /> : null}
                    <button
                      type="button"
                      onClick={() => setLineStatusFilter(value)}
                      className={cn(
                        "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10.5px] font-semibold transition-colors",
                        lineStatusFilter === value
                          ? activeClass
                          : "border-border bg-white text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {value !== "all" ? <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} /> : null}
                      {label}
                      <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[9px] leading-none">{count}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-end justify-between gap-3">
              <div className="space-y-1">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Cobranças</p>
                <div className="flex rounded-full bg-muted/50 p-1">
                  {([
                    ["all", "Todas"],
                    ["forecast", "Previsões"],
                    ["actual", "Lançadas"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLineSourceFilter(value)}
                      className={cn(
                        "rounded-full px-3 py-1 text-[10.5px] font-medium transition-colors",
                        lineSourceFilter === value ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <span className="pb-1.5 whitespace-nowrap text-[10.5px] text-muted-foreground">
                Exibindo {visibleCardLines.length} de {selectedGroup.lines.length}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_116px_140px] items-center gap-2 border-b bg-muted/20 px-4 py-2.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:grid-cols-[minmax(0,1fr)_100px_116px_170px]">
            <span>Descrição</span>
            <span className="hidden lg:block">Origem</span>
            <span className="text-right">Valor</span>
            <span className="text-right">Status</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleCardLineGroups.length === 0 ? (
              <div className="grid min-h-44 place-items-center px-6 text-center">
                <div>
                  <CreditCard className="mx-auto h-8 w-8 text-muted-foreground/50" />
                  <p className="mt-3 text-sm font-medium">Nenhuma despesa nesta visualização</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedGroup.lines.length === 0
                      ? "As despesas vinculadas a este cartão aparecerão aqui na competência da fatura."
                      : "Altere os filtros para visualizar outras cobranças."}
                  </p>
                </div>
              </div>
            ) : visibleCardLineGroups.map((group) => (
              <div key={format(group.date, "yyyy-MM-dd")}>
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-[#fbfaf7]/95 px-4 py-2 backdrop-blur">
                  <span className="text-[11px] font-semibold text-foreground">{format(group.date, "dd/MM")}</span>
                  <span className="text-[10.5px] capitalize text-muted-foreground">{format(group.date, "EEEE", { locale: ptBR })}</span>
                  <span className="h-px flex-1 bg-border/60" />
                  <span className="whitespace-nowrap font-mono text-[10.5px] font-medium text-rose-600">
                    Total −{formatCurrency(group.total)}
                  </span>
                </div>
                {group.lines.map((line) => {
                  const status = getCardLineAuditStatus(line);
                  const issues = cardLineAuditIssues(line);
                  const forecast = isCardLineForecast(line);
                  const installmentNumber = Number(line.installmentNumber || line.expense.installmentNumber || 0);
                  const installmentTotal = Number(line.installmentTotal || line.expense.installmentTotal || 0);
                  const statusMeta = status === "pending"
                    ? { label: "Pendente", className: "border-amber-200 bg-amber-50 text-amber-700" }
                    : status === "audited"
                    ? { label: "Auditada", className: "border-sky-200 bg-sky-50 text-sky-700" }
                    : { label: "Conferida", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
                  return (
                    <div
                      key={line.lineId}
                      className="group grid grid-cols-[minmax(0,1fr)_116px_140px] items-center gap-2 border-b px-4 py-3 transition-colors hover:bg-primary/[0.035] lg:grid-cols-[minmax(0,1fr)_100px_116px_170px]"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="truncate text-[13px] font-semibold leading-tight">{line.expense.description || "Despesa sem descrição"}</p>
                          {installmentTotal > 1 ? (
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0 text-[8.5px] text-muted-foreground">
                              {installmentNumber || 1}/{installmentTotal}
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-[10.5px] leading-tight text-muted-foreground">
                          {line.expense.supplier || "Sem favorecido"}{issues.length > 0 ? ` · revisar ${issues.join(", ")}` : ""}
                        </p>
                      </div>
                      <div className="hidden lg:block">
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[9.5px] font-medium",
                          forecast ? "bg-cyan-50 text-cyan-700" : "bg-violet-50 text-violet-700"
                        )}>
                          {forecast ? "Previsão" : "Lançada"}
                        </span>
                      </div>
                      <p className="whitespace-nowrap text-right font-mono text-xs font-semibold text-rose-600">
                        − {formatCurrency(line.value)}
                      </p>
                      <div className="flex items-center justify-end gap-1.5">
                        {canAuditCardStatements && selectedStatement?.status !== "paid" ? (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 max-w-0 overflow-hidden px-0 text-[10px] opacity-0 transition-all group-hover:max-w-24 group-hover:px-2 group-hover:opacity-100" asChild>
                              <Link href={expenseEditHref(line.expense.id, returnTo)}>Auditar</Link>
                            </Button>
                            {status === "audited" ? (
                              <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" disabled={working === line.lineId} onClick={() => void toggleLine(line, true)}>
                                {working === line.lineId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Conferir"}
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9.5px] font-semibold", statusMeta.className)}>
                          {statusMeta.label}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 border-t bg-muted/20 px-4 py-3 sm:grid-cols-4 sm:items-center">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Itens lançados</p>
              <p className="mt-1 font-mono text-xs font-semibold">{formatCurrency(postedTotal)}</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Provisionado</p>
              <p className="mt-1 font-mono text-xs font-semibold">{formatCurrency(selectedGroup.provisionedTotal)}</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Conferido</p>
              <p className="mt-1 font-mono text-xs font-semibold">{formatCurrency(selectedGroup.reconciledTotal)}</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Total da fatura</p>
              <p className="mt-1 font-mono text-xs font-semibold">{formatCurrency(officialTotal)}</p>
            </div>
          </div>

          {selectedStatement?.status === "paid" ? (
            <div className="flex items-center gap-2 border-t border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Pagamento conciliado em {toDate(selectedStatement.paidAt) ? format(toDate(selectedStatement.paidAt)!, "dd/MM/yyyy") : "data não informada"}.
            </div>
          ) : selectedStatement?.status === "closed" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-800">
              <span>{paymentCandidates.length > 0 ? `${paymentCandidates.length} pagamento(s) compatível(is) encontrado(s) no extrato.` : "Nenhum pagamento compatível encontrado no extrato."}</span>
              {canReconcileCardStatements ? paymentCandidates.slice(0, 1).map((candidate) => (
                <Button key={candidate.transaction.id} size="sm" className="h-7 text-[10px]" disabled={!!working} onClick={() => void reconcilePayment(candidate)}>
                  {working === `payment-${candidate.transaction.id}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Conciliar {formatCurrency(Math.abs(Number(candidate.transaction.amount) || 0))}
                </Button>
              )) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t bg-white px-4 py-2.5">
            <span className="text-xs text-muted-foreground">
              Fecha em {format(selectedGroup.closingDate, "dd/MM/yyyy")} · vence em {format(selectedGroup.dueDate, "dd/MM/yyyy")}
            </span>
            {canCloseCardStatements ? (
              <div>
                <Button size="sm" className="h-8 rounded-xl text-[11px]" disabled={!canClose || working === "statement"} onClick={() => void closeStatement()}>
                  {working === "statement" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Fechar fatura
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : cards.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="py-16 text-center">
            <CreditCard className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Nenhum cartão de crédito cadastrado</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              Cadastre o cartão dentro da conta bancária, com dia de fechamento e vencimento, para montar as faturas mensais.
            </p>
            {permissions.financial?.settings?.view && <Button asChild className="mt-5"><Link href={FINANCIAL_ROUTES.settings}>Abrir configurações financeiras</Link></Button>}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col items-stretch gap-3 lg:flex-row">
            <div className="flex w-full shrink-0 flex-col justify-between rounded-[14px] border bg-white p-3.5 shadow-sm lg:w-44">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Competência</p>
                <p className="mt-2 flex items-center gap-2 text-sm font-extrabold capitalize tracking-tight">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  {monthLabel(monthKey)}
                </p>
              </div>
              <div className="mt-3 flex gap-1.5">
                <Button variant="outline" size="sm" className="h-8 flex-1 rounded-lg bg-[#faf9f6] px-2 text-[11px]" onClick={() => setMonthKey(changeMonth(monthKey, -1))}>
                  ← Anterior
                </Button>
                <Button variant="outline" size="sm" className="h-8 flex-1 rounded-lg bg-[#faf9f6] px-2 text-[11px]" onClick={() => setMonthKey(changeMonth(monthKey, 1))}>
                  Próxima →
                </Button>
              </div>
            </div>

            <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {monthGroups.map((group) => {
                const cardKey = `${group.card.accountId}:${group.card.methodId}`;
                const statement = statementByKey.get(group.key);
                const selected = cardKey === `${selectedGroup?.card.accountId}:${selectedGroup?.card.methodId}`;
                const status = statement?.status || "open";
                const total = status === "open" ? group.projectedTotal : Number(statement?.officialTotal || group.projectedTotal);
                const groupReconciledCount = group.lines.filter((line) => line.reconciled).length;
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => {
                      setSelectedCardKey(cardKey);
                      setLineStatusFilter("all");
                      setLineSourceFilter("all");
                    }}
                    className={cn(
                      "rounded-[14px] border bg-white p-3.5 text-left shadow-sm transition-all",
                      selected
                        ? "border-primary shadow-[0_8px_24px_rgba(219,39,119,0.14)]"
                        : "hover:border-primary/40 hover:shadow-md"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[10px]", selected ? "bg-pink-50 text-primary" : "bg-muted text-muted-foreground")}>
                          <CreditCard className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-extrabold tracking-tight">{group.card.methodLabel}</p>
                          <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{group.card.accountName}{group.card.lastDigits ? ` · final ${group.card.lastDigits}` : ""}</p>
                        </div>
                      </div>
                      <span className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[9.5px] font-extrabold",
                        status === "paid"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : status === "closed"
                            ? "border-sky-200 bg-sky-50 text-sky-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                      )}>
                        {statusLabel(status)}
                      </span>
                    </div>
                    <div className="mt-3.5 flex items-end justify-between gap-2">
                      <div>
                        <p className="text-[8.5px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">{status === "open" ? "Total previsto" : "Total da fatura"}</p>
                        <p className="mt-1 font-mono text-lg font-extrabold tracking-tight">{formatCurrency(total)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10.5px] text-muted-foreground">Vence {format(group.dueDate, "dd/MM")}</p>
                        <p className={cn("mt-0.5 text-[10.5px] font-extrabold", groupReconciledCount === group.lines.length && group.lines.length > 0 ? "text-emerald-700" : "text-amber-700")}>
                          {groupReconciledCount}/{group.lines.length} conferidas
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedGroup ? (
            <div className="overflow-x-auto rounded-[14px] border bg-white px-4 py-3 shadow-sm">
              <div className="flex min-w-[720px] items-center gap-2">
                {workflowSteps.map((step, index) => (
                  <div key={step.label} className="contents">
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className={cn(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white",
                        step.done ? "bg-emerald-600" : step.current ? "bg-primary" : "bg-zinc-300"
                      )}>
                        {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                      </span>
                      <div>
                        <p className={cn("text-xs font-extrabold tracking-tight", !step.done && !step.current && "text-muted-foreground")}>{step.label}</p>
                        <p className={cn("mt-0.5 text-[10.5px]", step.current ? "text-primary" : "text-muted-foreground")}>{step.meta}</p>
                      </div>
                    </div>
                    {index < workflowSteps.length - 1 ? <span className="h-px min-w-4 flex-1 bg-border" /> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {selectedGroup && (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_348px]">
              <Card className="overflow-hidden rounded-2xl border-[#e9e5dc] shadow-sm">
                <div className="px-4 pt-4 sm:px-[18px]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-extrabold tracking-tight">{selectedGroup.card.methodLabel}</CardTitle>
                      <p className="mt-1 text-[11.5px] text-muted-foreground">
                        Fecha em {format(selectedGroup.closingDate, "dd/MM/yyyy")} · vence em {format(selectedGroup.dueDate, "dd/MM/yyyy")} · {selectedGroup.lines.length} cobranças
                      </p>
                    </div>
                    {canImportCardStatements ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-xl border-violet-200 bg-violet-50/70 px-3.5 text-xs font-extrabold text-violet-700 hover:bg-violet-100 hover:text-violet-800"
                        disabled={importingStatement}
                        onClick={() => cardStatementFileRef.current?.click()}
                      >
                        {importingStatement ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                        {importingStatement
                          ? "Copiloto analisando..."
                          : statementStatus === "paid"
                            ? "Analisar nova versão"
                            : officialTotal > 0
                              ? "Revisar fatura com copiloto"
                              : "Analisar fatura com copiloto"}
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Fluxo</span>
                    {([
                      ["all", "Todos", selectedLineCounts.all, "border-zinc-300 bg-zinc-100 text-zinc-800", "bg-zinc-500"],
                      ["pending", "Pendentes", selectedLineCounts.pending, "border-amber-300 bg-amber-50 text-amber-700", "bg-amber-500"],
                      ["audited", "Auditadas", selectedLineCounts.audited, "border-sky-300 bg-sky-50 text-sky-700", "bg-sky-500"],
                      ["reconciled", "Conferidas", selectedLineCounts.reconciled, "border-emerald-300 bg-emerald-50 text-emerald-700", "bg-emerald-500"],
                    ] as const).map(([value, label, count, activeClass, dotClass], index) => (
                      <div key={value} className="flex items-center gap-1.5">
                        {index > 0 ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" /> : null}
                        <button
                          type="button"
                          onClick={() => setLineStatusFilter(value)}
                          className={cn(
                            "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10.5px] font-extrabold transition-colors",
                            lineStatusFilter === value ? activeClass : "border-border bg-white text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {value !== "all" ? <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} /> : null}
                          {label}
                          <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[9px] leading-none">{count}</span>
                        </button>
                      </div>
                    ))}

                    <span className="mx-1 h-5 w-px bg-border" />
                    <div className="flex rounded-full bg-muted/60 p-1">
                      {([
                        ["all", "Todas"],
                        ["forecast", "Previsões"],
                        ["actual", "Lançadas"],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setLineSourceFilter(value)}
                          className={cn(
                            "rounded-full px-3 py-1 text-[10.5px] font-bold transition-colors",
                            lineSourceFilter === value ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <span className="ml-auto whitespace-nowrap text-[10.5px] text-muted-foreground">Exibindo {visibleCardLines.length} de {selectedGroup.lines.length}</span>
                  </div>
                </div>

                {selectedCardLines.length > 0 ? (
                  <div className="mx-4 mt-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-pink-200 bg-pink-50/70 px-3 py-2.5 sm:mx-[18px]">
                    <span className="text-xs font-extrabold text-pink-700">{selectedCardLines.length} cobrança(s) selecionada(s)</span>
                    <span className="text-[11.5px] text-pink-700/70">
                      {selectedReadyLines.length} pronta(s) · {selectedCardLines.length - selectedReadyLines.length} precisam de auditoria ou já foram conferidas
                    </span>
                    <div className="ml-auto flex gap-2">
                      <Button variant="outline" size="sm" className="h-8 rounded-lg bg-white text-[11px]" disabled={working === "bulk-lines"} onClick={() => setSelectedLineIds([])}>
                        Limpar
                      </Button>
                      <Button size="sm" className="h-8 rounded-lg text-[11px] font-extrabold" disabled={working === "bulk-lines" || selectedReadyLines.length === 0} onClick={() => void confirmSelectedLines()}>
                        {working === "bulk-lines" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                        Conferir selecionadas
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 overflow-x-auto">
                  <div className="min-w-[760px]">
                    <div className="grid grid-cols-[26px_minmax(0,1fr)_104px_118px_180px] items-center gap-3 border-y bg-[#faf9f6] px-[18px] py-2.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
                      <input
                        type="checkbox"
                        aria-label="Selecionar cobranças visíveis"
                        checked={allVisibleLinesSelected}
                        disabled={!canAuditCardStatements || statementStatus === "paid" || visibleCardLines.length === 0 || working === "bulk-lines"}
                        onChange={() => setSelectedLineIds((current) => {
                          const visibleIds = new Set(visibleCardLines.map((line) => line.lineId));
                          return allVisibleLinesSelected
                            ? current.filter((lineId) => !visibleIds.has(lineId))
                            : [...new Set([...current, ...visibleIds])];
                        })}
                        className="h-3.5 w-3.5 rounded border-border accent-primary"
                      />
                      <span>Descrição</span>
                      <span>Origem</span>
                      <span className="text-right">Valor</span>
                      <span className="text-right">Conferência</span>
                    </div>

                    <div className="max-h-[560px] overflow-y-auto">
                      {visibleCardLineGroups.length === 0 ? (
                        <div className="py-16 text-center">
                          <p className="text-sm font-semibold text-muted-foreground">Nenhuma cobrança nesta visualização</p>
                          <p className="mt-1 text-xs text-muted-foreground">Altere os filtros para visualizar outras cobranças.</p>
                        </div>
                      ) : visibleCardLineGroups.map((group) => (
                        <div key={format(group.date, "yyyy-MM-dd")}>
                          <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-[#fbfaf7]/95 px-[18px] py-2 backdrop-blur">
                            <span className="font-mono text-[11.5px] font-bold">{format(group.date, "dd/MM")}</span>
                            <span className="text-[11px] capitalize text-muted-foreground">{format(group.date, "EEEE", { locale: ptBR })}</span>
                            <span className="h-px flex-1 bg-border/70" />
                            <span className="font-mono text-[11px] font-bold text-rose-700">Total − {formatCurrency(group.total)}</span>
                          </div>
                          {group.lines.map((line) => {
                            const status = getCardLineAuditStatus(line);
                            const issues = cardLineAuditIssues(line);
                            const forecast = isCardLineForecast(line);
                            const recurring = line.expense.paymentMethod === "recurring" || !!line.expense.recurrenceGroupId;
                            const imported = Boolean((line.expense as any).cardStatementImportFingerprint);
                            const installmentNumber = Number(line.installmentNumber || line.expense.installmentNumber || 0);
                            const installmentTotal = Number(line.installmentTotal || line.expense.installmentTotal || 0);
                            const selected = selectedLineIdSet.has(line.lineId);
                            const statusMeta = status === "pending"
                              ? { label: "Pendente", className: "border-amber-200 bg-amber-50 text-amber-700" }
                              : status === "audited"
                                ? { label: "Auditada", className: "border-sky-200 bg-sky-50 text-sky-700" }
                                : { label: "Conferida", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
                            return (
                              <div
                                key={line.lineId}
                                className={cn(
                                  "group grid grid-cols-[26px_minmax(0,1fr)_104px_118px_180px] items-start gap-3 border-b px-[18px] py-3 transition-colors hover:bg-pink-50/40",
                                  selected && "bg-pink-50/60"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  aria-label={`Selecionar ${line.expense.description || "cobrança"}`}
                                  checked={selected}
                                  disabled={!canAuditCardStatements || statementStatus === "paid" || working === "bulk-lines"}
                                  onChange={(event) => setSelectedLineIds((current) => event.target.checked
                                    ? [...new Set([...current, line.lineId])]
                                    : current.filter((lineId) => lineId !== line.lineId))}
                                  className="mt-1 h-3.5 w-3.5 rounded border-border accent-primary"
                                />
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="truncate text-[13px] font-bold tracking-tight">{line.expense.description || "Despesa sem descrição"}</span>
                                    {installmentTotal > 1 ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{installmentNumber || 1}/{installmentTotal}</span> : null}
                                    {recurring ? <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold text-violet-700"><Repeat2 className="h-2.5 w-2.5" />Recorrente</span> : null}
                                    {imported ? <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold text-sky-700"><Sparkles className="h-2.5 w-2.5" />Importada</span> : null}
                                  </div>
                                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{line.expense.supplier || "Sem favorecido"} · cobrança em {format(line.chargeDate, "dd/MM/yyyy")}</p>
                                  {issues.length > 0 ? (
                                    <p className="mt-1.5 inline-block rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10.5px] font-bold text-amber-700">⚠ Revisar {issues.join(", ")}</p>
                                  ) : null}
                                </div>
                                <div>
                                  <span className={cn(
                                    "rounded-full border px-2 py-0.5 text-[9.5px] font-extrabold",
                                    forecast ? "border-cyan-200 bg-cyan-50 text-cyan-700" : "border-violet-200 bg-violet-50 text-violet-700"
                                  )}>
                                    {forecast ? "Previsão" : "Lançada"}
                                  </span>
                                </div>
                                <span className="whitespace-nowrap text-right font-mono text-[13px] font-extrabold text-rose-700">− {formatCurrency(line.value)}</span>
                                <div className="flex items-center justify-end gap-1.5">
                                  {canAuditCardStatements && statementStatus !== "paid" ? (
                                    status === "pending" ? (
                                      <Button asChild variant="outline" size="sm" className="h-7 rounded-lg px-2.5 text-[10.5px] font-bold">
                                        <Link href={expenseEditHref(line.expense.id, returnTo)}>Auditar item</Link>
                                      </Button>
                                    ) : (
                                      <Button
                                        variant={status === "audited" ? "default" : "outline"}
                                        size="sm"
                                        className={cn("h-7 rounded-lg px-2.5 text-[10.5px] font-bold", status === "reconciled" && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}
                                        disabled={working === line.lineId || working === "bulk-lines"}
                                        onClick={() => void toggleLine(line, status !== "reconciled")}
                                      >
                                        {working === line.lineId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === "audited" ? "Conferir" : "Desfazer"}
                                      </Button>
                                    )
                                  ) : null}
                                  <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9.5px] font-extrabold", statusMeta.className)}>{statusMeta.label}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t bg-[#faf9f6] px-[18px] py-3 sm:grid-cols-4">
                  {[
                    ["Itens lançados", postedTotal, "text-foreground"],
                    ["Provisionado", selectedGroup.provisionedTotal, "text-cyan-700"],
                    ["Conferido", reconciledTotal, "text-emerald-700"],
                    ["Total da fatura", officialTotal, "text-foreground"],
                  ].map(([label, value, color]) => (
                    <div key={String(label)}>
                      <p className="text-[8.5px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
                      <p className={cn("mt-1 font-mono text-sm font-extrabold tracking-tight", color)}>{formatCurrency(Number(value))}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="space-y-3.5">
                <Card className="rounded-2xl border-[#e9e5dc] shadow-sm">
                  <CardContent className="p-[18px] sm:p-[18px]">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-[14.5px] font-extrabold tracking-tight">Reconciliação</CardTitle>
                      <span className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold",
                        valuesBalanced
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      )}>
                        {valuesBalanced
                          ? "Valores conferem"
                          : difference === null
                            ? "Total não informado"
                            : `Diferença de ${formatCurrency(Math.abs(difference))}`}
                      </span>
                    </div>

                    <div className="mt-3.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[11.5px] text-muted-foreground">Itens lançados</span>
                        <span className="font-mono text-[13.5px] font-extrabold">{formatCurrency(postedTotal)}</span>
                      </div>
                      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#f0eae4]">
                        <div
                          className={cn("h-full", valuesBalanced ? "bg-emerald-500" : "bg-primary")}
                          style={{ width: `${postedProgress}%` }}
                        />
                        <div
                          className="h-full bg-[repeating-linear-gradient(135deg,#f6cfe4,#f6cfe4_4px,#f0eae4_4px,#f0eae4_8px)]"
                          style={{ width: `${Math.max(0, 100 - postedProgress)}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-baseline justify-between gap-3">
                        <span className="text-[11.5px] text-muted-foreground">Total oficial da fatura</span>
                        <span className="font-mono text-[13.5px] font-extrabold">{formatCurrency(officialTotal)}</span>
                      </div>
                    </div>

                    <div className={cn(
                      "mt-3.5 rounded-xl border px-3.5 py-3",
                      valuesBalanced ? "border-emerald-200 bg-emerald-50" : "border-violet-200 bg-violet-50/70"
                    )}>
                      <p className={cn("text-xs font-extrabold", valuesBalanced ? "text-emerald-700" : "text-violet-700")}>
                        {valuesBalanced
                          ? "✓ Fatura reconciliada"
                          : difference === null
                            ? "Importe a fatura para começar"
                            : difference > 0
                              ? `Faltam ${formatCurrency(Math.abs(difference))} em cobranças`
                              : `Os lançamentos excedem ${formatCurrency(Math.abs(difference))}`}
                      </p>
                      <p className={cn("mt-1.5 text-[11.5px] leading-relaxed", valuesBalanced ? "text-emerald-700/80" : "text-violet-700/75")}>
                        {valuesBalanced
                          ? "Os itens lançados somam exatamente o total oficial da fatura."
                          : difference === null
                            ? "O copiloto lê o arquivo, registra o total oficial e sugere o tratamento de cada compra."
                            : difference > 0
                              ? "O total oficial é maior que a soma dos lançamentos. Analise a fatura para identificar as cobranças ausentes."
                              : "A soma dos lançamentos está acima do total oficial. Revise duplicidades, créditos e estornos."}
                      </p>
                      {!valuesBalanced && canImportCardStatements ? (
                        <Button variant="outline" size="sm" className="mt-2.5 h-8 rounded-lg border-violet-300 bg-white text-[11px] font-extrabold text-violet-700 hover:bg-violet-50 hover:text-violet-800" disabled={importingStatement} onClick={() => cardStatementFileRef.current?.click()}>
                          {importingStatement ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                          Analisar fatura com o copiloto
                        </Button>
                      ) : null}
                    </div>

                    <p className="mt-4 text-[8.5px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Para fechar a fatura</p>
                    <div className="mt-2">
                      {closeChecklist.map((item) => (
                        <div key={item.label} className="flex items-start gap-2.5 border-b border-[#f7f4ee] py-2 last:border-b-0">
                          <span className={cn("mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] font-extrabold text-white", item.done ? "bg-emerald-500" : "bg-amber-500")}>
                            {item.done ? "✓" : "!"}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold">{item.label}</p>
                            <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{item.meta}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {canCloseCardStatements ? (
                      <Button
                        className={cn(
                          "mt-3.5 h-11 w-full rounded-xl text-[13px] font-extrabold",
                          statementStatus === "paid" && "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
                          statementStatus === "closed" && "border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50"
                        )}
                        disabled={statementStatus !== "open" || !canClose || working === "statement"}
                        onClick={() => void closeStatement()}
                      >
                        {working === "statement" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {statementStatus === "paid" ? "Fatura paga e arquivada" : statementStatus === "closed" ? "Fatura fechada" : "Fechar fatura"}
                      </Button>
                    ) : (
                      <p className="mt-3.5 rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">Seu perfil pode acompanhar o fechamento, mas não fechar a fatura.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border-[#e9e5dc] shadow-sm">
                  <CardContent className="p-[18px] sm:p-[18px]">
                    <CardTitle className="text-[14.5px] font-extrabold tracking-tight">Pagamento no extrato</CardTitle>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                      {statementStatus === "paid"
                        ? "A saída bancária foi conciliada e as despesas da fatura já estão liquidadas."
                        : statementStatus === "closed"
                          ? paymentCandidates.length > 0
                            ? `${paymentCandidates.length} débito(s) compatível(is) encontrado(s) no extrato.`
                            : "Nenhum débito compatível foi encontrado no extrato."
                          : "Feche a fatura antes de procurar a saída bancária correspondente no extrato."}
                    </p>

                    {statementStatus === "paid" ? (
                      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
                        <p className="flex items-center gap-2 text-xs font-extrabold"><CheckCircle2 className="h-4 w-4" />Pagamento conciliado</p>
                        <p className="mt-1.5 text-[11.5px] leading-relaxed">
                          Conciliado em {toDate(selectedStatement?.paidAt) ? format(toDate(selectedStatement?.paidAt)!, "dd/MM/yyyy") : "data não informada"} · {selectedGroup.lines.length} despesas liquidadas pela fatura.
                        </p>
                      </div>
                    ) : !canReconcileCardStatements ? (
                      <p className="mt-3 rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">Seu perfil pode consultar a fatura, mas não conciliar o pagamento bancário.</p>
                    ) : statementStatus !== "closed" ? null : paymentCandidates.length === 0 ? (
                      <div className="mt-3 rounded-xl border bg-[#faf9f6] p-3 text-xs text-muted-foreground">
                        <RefreshCw className="mb-2 h-4 w-4" />
                        <p>Importe ou confira o extrato bancário para localizar o pagamento.</p>
                        {permissions.financial?.audits?.view ? (
                          <Button asChild variant="outline" size="sm" className="mt-3 h-8 rounded-lg bg-white text-[11px]">
                            <Link href={FINANCIAL_ROUTES.importExpenses}>Abrir conferência</Link>
                          </Button>
                        ) : null}
                      </div>
                    ) : paymentCandidates.slice(0, 3).map((candidate) => (
                      <div key={candidate.transaction.id} className="mt-3 rounded-xl border bg-[#faf9f6] p-3">
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-extrabold">{String(candidate.transaction.description || "Pagamento da fatura")}</p>
                            <p className="mt-1 text-[10.5px] text-muted-foreground">
                              {toDate(candidate.transaction.date) ? format(toDate(candidate.transaction.date)!, "dd/MM/yyyy") : "—"} · {candidate.confidence === "high" ? "correspondência exata" : "valor próximo"}
                            </p>
                          </div>
                          <p className="shrink-0 font-mono text-[13px] font-extrabold">{formatCurrency(Math.abs(Number(candidate.transaction.amount) || 0))}</p>
                        </div>
                        <Button className="mt-3 h-9 w-full rounded-xl text-xs font-extrabold" disabled={!!working} onClick={() => void reconcilePayment(candidate)}>
                          {working === `payment-${candidate.transaction.id}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          Conciliar pagamento
                        </Button>
                        <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">{selectedGroup.lines.length} despesas serão liquidadas sem criar uma nova despesa no plano de contas.</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={importDialogOpen} onOpenChange={(open) => {
        if (importingStatement) return;
        setImportDialogOpen(open);
        if (!open) {
          setImportPreview(null);
          setSelectedImportLineIds([]);
          setImportResolutionByLineId({});
        }
      }}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-[20px] border-[#e9e5dc] p-0 shadow-2xl sm:max-w-[820px]">
          <DialogHeader className="shrink-0 border-b border-[#f0ece3] px-6 py-5 pr-14 text-left">
            <DialogTitle className="flex items-center gap-2 text-[16.5px] font-extrabold tracking-tight">
              <Sparkles className="h-4.5 w-4.5 text-violet-600" />
              Revisar análise do copiloto
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-xs leading-relaxed">
              O copiloto interpreta a fatura, mas você decide o que será adicionado. Nada é auditado, efetivado ou pago automaticamente.
            </DialogDescription>
          </DialogHeader>
          {importPreview ? (
            <div className="min-h-0 flex-1 space-y-[13px] overflow-y-auto px-6 py-[18px] overscroll-contain">
              <div className={cn(
                "rounded-[13px] border px-[15px] py-[13px]",
                importPreview.analysis.status === "ready"
                  ? "border-emerald-200 bg-emerald-50/70"
                  : importPreview.analysis.status === "blocked"
                    ? "border-red-200 bg-red-50/70"
                    : "border-amber-200 bg-amber-50/70",
              )}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-[12.5px] font-extrabold">
                    <Sparkles className="h-4 w-4 text-violet-600" />
                    Análise do Copiloto Financeiro
                  </p>
                  <span className="rounded-full border bg-white/80 px-2.5 py-0.5 text-[9.5px] font-extrabold">
                    {COPILOT_STATUS_LABELS[importPreview.analysis.status]}
                  </span>
                </div>
                <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">{importPreview.analysis.summary}</p>
                <div className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-1 text-[10.5px] text-muted-foreground">
                  {importPreview.analysis.detectedFormat ? <span>Formato: {importPreview.analysis.detectedFormat}</span> : null}
                  <span>Compras: {importPreview.transactions.length}</span>
                  <span>Soma das compras: {formatCurrency(importPreview.analysis.includedTotal)}</span>
                  <span>Excluídos: {importPreview.analysis.excludedCount}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[13px] border border-[#e9e5dc] bg-[#faf9f6] px-[15px] py-3">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-extrabold">{importPreview.fileName}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {importPreview.transactions.length} compra(s) identificada(s)
                    {importPreview.officialTotal ? ` · total ${formatCurrency(importPreview.officialTotal)}` : ""}
                    {importPreview.dueDate ? ` · vencimento ${format(new Date(`${importPreview.dueDate}T12:00:00`), "dd/MM/yyyy")}` : ""}
                    {importPreview.cardLastDigits ? ` · cartão final ${importPreview.cardLastDigits}` : ""}
                  </p>
                  {importPreview.revision ? (
                    <p className="mt-1 text-[10px] font-medium text-violet-700">
                      Versão {importPreview.revision.version} · arquivo original arquivado
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-[10px] bg-white text-[11.5px] font-bold"
                  disabled={availableImportLines.length === 0}
                  onClick={() => {
                    setSelectedImportLineIds(
                      selectedImportLines.length === availableImportLines.length ? [] : availableImportLines.map((line) => line.id),
                    );
                  }}
                >
                  {selectedImportLines.length === availableImportLines.length
                    ? "Desmarcar todas"
                    : "Selecionar todas"}
                </Button>
              </div>

              {importPreview.revision ? (
                <div className={cn(
                  "rounded-xl border px-4 py-3 text-xs",
                  importPreview.revision.blockedReason === "paid_statement"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : importPreview.revision.requiresReopen
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-violet-200 bg-violet-50/70 text-violet-900",
                )}>
                  <p className="font-extrabold">
                    {importPreview.revision.exactFileReimport && !importPreview.revision.hasChanges
                      ? "Este mesmo arquivo já está aplicado. Nenhuma alteração será feita."
                      : importPreview.revision.version === 1
                        ? "Primeira versão da fatura"
                        : "Comparação com a versão ativa"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    <span>{importPreview.revision.summary.unchanged} preservado(s)</span>
                    <span>{importPreview.revision.summary.changed} alterado(s)</span>
                    <span>{importPreview.revision.summary.added} novo(s)</span>
                    <span>{importPreview.revision.summary.removed} removido(s)</span>
                  </div>
                  {importPreview.revision.requiresReopen ? (
                    <p className="mt-2 font-medium">
                      A fatura está fechada e será reaberta ao aplicar esta versão.
                      {!canCloseCardStatements ? " Seu perfil não possui permissão para reabri-la." : ""}
                    </p>
                  ) : null}
                  {importPreview.revision.blockedReason === "paid_statement" ? (
                    <p className="mt-2 font-medium">
                      A fatura já foi paga. A versão ficou arquivada, mas as despesas liquidadas não serão alteradas.
                      {importPreview.revision.adjustment
                        ? ` Revisão: ${importPreview.revision.adjustment.kind === "additional_charge" ? "complemento" : importPreview.revision.adjustment.kind === "credit" ? "crédito" : "redistribuição"} de ${formatCurrency(importPreview.revision.adjustment.amount)}.`
                        : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {importPreview.revision?.removed.length ? (
                <details className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-xs text-rose-900">
                  <summary className="cursor-pointer font-semibold">
                    {importPreview.revision.removed.length} item(ns) ausente(s) na nova versão
                  </summary>
                  <div className="mt-2 space-y-1">
                    {importPreview.revision.removed.slice(0, 20).map((line) => (
                      <p key={line.fingerprint}>{line.description} · {formatCurrency(line.amount)}</p>
                    ))}
                    <p className="pt-1 text-rose-700">
                      Se algum item novo substituir um destes, escolha a despesa anterior no vínculo para preservar o tratamento.
                    </p>
                  </div>
                </details>
              ) : null}

              {importPreview.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  {importPreview.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
                </div>
              ) : null}

              <div className="max-h-[380px] overflow-auto rounded-[13px] border border-[#e9e5dc]">
                <div className="grid min-w-[750px] grid-cols-[26px_58px_minmax(0,1fr)_232px_92px] gap-2.5 border-b bg-[#faf9f6] px-[13px] py-2.5 text-[8.5px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
                  <span />
                  <span>Data</span>
                  <span>Descrição</span>
                  <span>Tratamento</span>
                  <span className="text-right">Valor</span>
                </div>
                {importPreview.transactions.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhuma compra foi identificada no arquivo.</div>
                ) : importPreview.transactions.map((line) => {
                  const revision = revisionLineByFingerprint.get(line.fingerprint);
                  const duplicate = importPreview.revision
                    ? revision?.status === "unchanged"
                    : existingImportFingerprints.has(line.fingerprint);
                  const selected = selectedImportLineIdSet.has(line.id) && !duplicate;
                  const match = importExpenseMatchByLineId.get(line.id);
                  const resolution = importResolutionByLineId[line.id] || "create";
                  return (
                    <div key={line.id} className={cn("grid min-w-[750px] grid-cols-[26px_58px_minmax(0,1fr)_232px_92px] items-start gap-2.5 border-b px-[13px] py-3 text-xs last:border-b-0", duplicate ? "bg-muted/35 text-muted-foreground" : selected ? "bg-white" : "bg-[#fbfaf7] hover:bg-primary/[0.03]")}>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${line.description}`}
                        checked={selected}
                        disabled={duplicate}
                        onChange={(event) => setSelectedImportLineIds((current) => event.target.checked
                          ? [...current, line.id]
                          : current.filter((id) => id !== line.id))}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <span className="font-mono text-[11.5px] font-semibold">{format(new Date(`${line.date}T12:00:00`), "dd/MM")}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{line.description}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {duplicate
                            ? "Já importada nesta fatura"
                            : [
                                line.supplier,
                                revision?.status === "changed" ? "alterada na nova versão" : revision?.status === "new" ? "nova na versão" : null,
                                line.installmentNumber && line.installmentTotal ? `parcela ${line.installmentNumber}/${line.installmentTotal}` : null,
                                line.confidence === "low" ? "baixa confiança" : line.confidence === "medium" ? "confiança média" : null,
                              ].filter(Boolean).join(" · ")}
                        </span>
                        {!duplicate && line.reviewNotes.length > 0 ? (
                          <span className="mt-0.5 block truncate text-[10px] text-amber-700">{line.reviewNotes.join(" · ")}</span>
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        {duplicate ? (
                          <span className="text-[10px]">Já vinculada</span>
                        ) : revision?.status === "changed" && revision.previousExpenseId ? (
                          <div className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 text-[10px] text-violet-800">
                            <p className="font-semibold">Reaproveitar tratamento anterior</p>
                            <p className="mt-0.5 truncate">
                              {revision.previousDescription || "Despesa vinculada"} · {formatCurrency(revision.previousAmount || 0)} → {formatCurrency(line.amount)}
                            </p>
                            <p className="mt-0.5">A linha voltará para conferência.</p>
                          </div>
                        ) : (
                          <>
                            <Select
                              value={resolution}
                              onValueChange={(value) => setImportResolutionByLineId((current) => ({
                                ...Object.fromEntries(Object.entries(current).map(([currentLineId, currentValue]) => [
                                  currentLineId,
                                  value !== "create" && currentLineId !== line.id && currentValue === value ? "create" : currentValue,
                                ])),
                                [line.id]: value,
                              }))}
                            >
                              <SelectTrigger className="h-8 rounded-lg text-[10.5px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="create">Criar nova despesa</SelectItem>
                                {(match?.candidates || []).map((candidate) => (
                                  <SelectItem key={candidate.lineId} value={candidate.lineId}>
                                    {candidate.isForecast ? "Substituir previsão" : "Vincular existente"} · {candidate.description} · {formatCurrency(candidate.amount)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {match?.confidence ? (
                              <span className={cn(
                                "mt-1 block truncate text-[9.5px]",
                                match.ambiguous ? "text-amber-700" : match.confidence === "high" ? "text-emerald-700" : "text-sky-700",
                              )}>
                                {match.ambiguous
                                  ? "Mais de uma correspondência possível"
                                  : match.confidence === "high"
                                    ? "Correspondência forte sugerida"
                                    : "Correspondência possível para revisão"}
                              </span>
                            ) : (
                              <span className="mt-1 block text-[9.5px] text-muted-foreground">Nenhuma correspondência segura</span>
                            )}
                          </>
                        )}
                      </span>
                      <span className="text-right font-mono font-semibold">{formatCurrency(line.amount)}</span>
                    </div>
                  );
                })}
              </div>

              {importPreview.excludedEntries.length > 0 ? (
                <details className="rounded-[13px] border border-[#e9e5dc] bg-[#fbfaf7] px-[15px] py-3 text-xs">
                  <summary className="cursor-pointer text-[11.5px] font-extrabold text-muted-foreground">
                    {importPreview.excludedEntries.length} movimento(s) não serão importados
                  </summary>
                  <div className="mt-2.5 space-y-1.5">
                    {importPreview.excludedEntries.map((entry) => (
                      <div key={entry.sourceReference} className="flex items-start justify-between gap-3 rounded-lg border border-[#f0ece3] bg-white px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[11.5px] font-bold">{entry.description}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {EXCLUDED_KIND_LABELS[entry.kind]} · {entry.reason}
                          </p>
                        </div>
                        {entry.amount ? <span className="shrink-0 font-mono text-[11.5px] font-bold text-muted-foreground">{formatCurrency(entry.amount)}</span> : null}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="shrink-0 flex-col gap-3 border-t border-[#f0ece3] bg-[#faf9f6] px-6 py-[15px] sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-md text-left text-[11.5px] leading-relaxed text-muted-foreground">
              Os itens entram como pendentes de auditoria. Nada é efetivado ou pago automaticamente.
            </p>
            <div className="flex shrink-0 justify-end gap-2">
              <Button variant="outline" className="h-10 rounded-xl bg-white px-4 text-[12.5px] font-bold" disabled={importingStatement} onClick={() => setImportDialogOpen(false)}>Cancelar</Button>
              <Button
              className="h-10 rounded-xl px-4 text-[12.5px] font-extrabold"
              disabled={importingStatement || !hasImportChanges || importPreview?.analysis.status === "blocked" || importBlocked || importNeedsUnavailableReopen}
              onClick={() => void confirmCardStatementImport()}
            >
              {importingStatement ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {importBlocked
                ? "Revisão arquivada — ajuste necessário"
                : !hasImportChanges
                  ? "Nenhuma alteração para aplicar"
                  : importPreview?.revision?.requiresReopen
                    ? `Reabrir e aplicar versão ${importPreview.revision.version}`
                    : importPreview?.revision?.version === 1
                      ? `Adicionar ${selectedImportLines.length} como pendente(s)`
                      : `Aplicar versão ${importPreview?.revision?.version || ""}`}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CardStatementsPage() {
  const searchParams = useSearchParams();
  return (
    <CardStatementsWorkspace
      fixedMonthKey={searchParams.get("month") || undefined}
      accountId={searchParams.get("accountId") || undefined}
      paymentMethodId={searchParams.get("paymentMethodId") || undefined}
    />
  );
}
