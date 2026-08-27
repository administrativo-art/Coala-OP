"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { setDoc, Timestamp, updateDoc } from "firebase/firestore";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileSearch,
  Loader2,
  ReceiptText,
  RefreshCw,
  Repeat2,
  Sparkles,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  matchCardStatementExpenses,
  type CardStatementExpenseCandidate,
} from "@/features/financial/lib/card-statement-expense-matcher";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
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
  return format(new Date(year, month - 1, 1, 12), "MMMM 'de' yyyy", { locale: ptBR });
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
  const importExpenseCandidates = useMemo<CardStatementExpenseCandidate[]>(
    () => (selectedGroup?.lines || []).flatMap((line) => {
      const fingerprints = [
        String((line.expense as any).cardStatementImportFingerprint || ""),
        ...(Array.isArray((line.expense as any).cardStatementImportFingerprints)
          ? (line.expense as any).cardStatementImportFingerprints.map(String)
          : []),
      ].filter(Boolean);
      if (line.reconciled || fingerprints.length > 0 || line.expense.status === "paid") return [];
      return [{
        lineId: line.lineId,
        expenseId: line.expense.id,
        description: String(line.expense.description || ""),
        supplier: String(line.expense.supplier || ""),
        amount: line.value,
        chargeDate: line.chargeDate,
        installmentNumber: line.installmentNumber,
        installmentTotal: line.installmentTotal,
        isForecast: isCardLineForecast(line),
      }];
    }),
    [selectedGroup]
  );
  const importExpenseMatches = useMemo(
    () => matchCardStatementExpenses(importPreview?.transactions || [], importExpenseCandidates),
    [importExpenseCandidates, importPreview]
  );
  const importExpenseMatchByLineId = useMemo(
    () => new Map(importExpenseMatches.map((match) => [match.lineId, match])),
    [importExpenseMatches]
  );
  const selectedImportLineIdSet = useMemo(() => new Set(selectedImportLineIds), [selectedImportLineIds]);
  const selectedImportLines = useMemo(
    () => (importPreview?.transactions || []).filter(
      (line) => selectedImportLineIdSet.has(line.id) && !existingImportFingerprints.has(line.fingerprint)
    ),
    [existingImportFingerprints, importPreview, selectedImportLineIdSet]
  );

  useEffect(() => {
    if (!importPreview) {
      setImportResolutionByLineId({});
      return;
    }
    setImportResolutionByLineId((current) => Object.fromEntries(
      importPreview.transactions.map((line) => {
        const match = importExpenseMatchByLineId.get(line.id);
        const currentValue = current[line.id];
        const available = match?.candidates.some((candidate) => candidate.lineId === currentValue);
        return [
          line.id,
          available ? currentValue : match?.confidence === "high" && match.recommendedCandidateId
            ? match.recommendedCandidateId
            : "create",
        ];
      })
    ));
  }, [importExpenseMatchByLineId, importPreview]);

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
      const installments = Array.isArray(line.expense.installments) ? line.expense.installments : [];
      const nextInstallments = line.installmentNumber
        ? installments.map((installment, index) =>
            (Number(installment.number) || index + 1) === line.installmentNumber
              ? {
                  ...installment,
                  cardReconciliationStatus: reconciled ? "reconciled" : "pending",
                  cardReconciledAt: reconciled ? Timestamp.now() : null,
                  cardStatementKey: selectedGroup?.key || null,
                }
              : installment
          )
        : installments.length === 1
        ? installments.map((installment) => ({
            ...installment,
            cardReconciliationStatus: reconciled ? "reconciled" : "pending",
            cardReconciledAt: reconciled ? Timestamp.now() : null,
            cardStatementKey: selectedGroup?.key || null,
          }))
        : installments;
      await updateDoc(financialDoc("expenses", line.expense.id), {
        ...(line.installmentNumber ? {} : { cardReconciliationStatus: reconciled ? "reconciled" : "pending" }),
        ...(nextInstallments.length > 0 ? { installments: nextInstallments } : {}),
        cardReconciledAt: reconciled ? Timestamp.now() : null,
        cardReconciledBy: reconciled ? firebaseUser.uid : null,
        cardStatementKey: selectedGroup?.key || null,
        cardStatementId: selectedGroup ? statementDocumentId(selectedGroup.key) : null,
        cardStatementMonthKey: selectedGroup?.monthKey || null,
        updatedAt: Timestamp.now(),
      });
      refreshExpenses();
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Não foi possível atualizar a conferência." });
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
      form.set("paymentMethodId", selectedGroup.card.methodId);
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
    if (!firebaseUser || !selectedGroup || !importPreview || selectedImportLines.length === 0 || !canImportCardStatements) return;
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
            const selectedCandidateId = importResolutionByLineId[line.id] || "create";
            const candidate = importExpenseMatchByLineId.get(line.id)?.candidates
              .find((entry) => entry.lineId === selectedCandidateId);
            return {
              ...line,
              resolution: candidate
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
          result?.skipped ? `${result.skipped} já importada(s)` : null,
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

  return (
    <div className={cn(
      "mx-auto w-full",
      embedded ? "h-full max-w-none overflow-hidden bg-white" : "max-w-[1220px] space-y-6 pb-10"
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
          <p className="text-muted-foreground">Previsão mensal, conferência das cobranças e conciliação do pagamento bancário.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={FINANCIAL_ROUTES.importExpenses}><FileSearch className="mr-2 h-4 w-4" />Conferência do extrato</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={FINANCIAL_ROUTES.newExpense}><ReceiptText className="mr-2 h-4 w-4" />Nova despesa</Link>
          </Button>
        </div>
      </div> : null}

      {!embedded ? <div className="flex items-center justify-between rounded-2xl border bg-background px-3 py-2 shadow-sm">
        <Button variant="ghost" size="sm" onClick={() => setMonthKey(changeMonth(monthKey, -1))}>Anterior</Button>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold capitalize">{monthLabel(monthKey)}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setMonthKey(changeMonth(monthKey, 1))}>Próxima</Button>
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
          {!embedded || monthGroups.length > 1 ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {monthGroups.map((group) => {
              const cardKey = `${group.card.accountId}:${group.card.methodId}`;
              const statement = statementByKey.get(group.key);
              const selected = cardKey === `${selectedGroup?.card.accountId}:${selectedGroup?.card.methodId}`;
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setSelectedCardKey(cardKey)}
                  className={cn("rounded-2xl border bg-background p-4 text-left shadow-sm transition-colors", selected ? "border-primary ring-2 ring-primary/10" : "hover:border-primary/40")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="rounded-xl bg-sky-50 p-2 text-sky-700"><CreditCard className="h-5 w-5" /></span>
                      <div><p className="font-semibold">{group.card.methodLabel}</p><p className="text-xs text-muted-foreground">{group.card.accountName}{group.card.lastDigits ? ` · final ${group.card.lastDigits}` : ""}</p></div>
                    </div>
                    <span className={cn("rounded-full px-2 py-1 text-[10px] font-medium", statement?.status === "paid" ? "bg-emerald-50 text-emerald-700" : statement?.status === "closed" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700")}>{statusLabel(statement?.status)}</span>
                  </div>
                  <div className="mt-5 flex items-end justify-between"><div><p className="text-xs text-muted-foreground">Total previsto</p><p className="font-mono text-xl font-bold">{formatCurrency(group.projectedTotal)}</p></div><p className="text-xs text-muted-foreground">Vence {format(group.dueDate, "dd/MM")}</p></div>
                </button>
              );
            })}
          </div> : null}

          {selectedGroup && (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <Card className="overflow-hidden rounded-2xl">
                <CardHeader className="border-b bg-muted/20">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><CardTitle>{selectedGroup.card.methodLabel}</CardTitle><p className="mt-1 text-sm text-muted-foreground">Fecha em {format(selectedGroup.closingDate, "dd/MM/yyyy")} · vence em {format(selectedGroup.dueDate, "dd/MM/yyyy")}</p></div>
                    <span className="rounded-full border px-3 py-1 text-xs">{reconciledCount}/{selectedGroup.lines.length} conferidas</span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {selectedGroup.lines.length === 0 ? (
                    <div className="py-16 text-center text-sm text-muted-foreground">Nenhuma despesa vinculada a este cartão nesta fatura.</div>
                  ) : (
                    <div className="divide-y">
                      {selectedGroup.lines.map((line) => {
                        const recurring = line.expense.paymentMethod === "recurring" || !!line.expense.recurrenceGroupId;
                        const provision = line.expense.provisionType === "forecast" && line.expense.status === "provisioned";
                        const issues = cardLineAuditIssues(line);
                        const installmentNumber = Number(line.installmentNumber || line.expense.installmentNumber || 0);
                        const installmentTotal = Number(line.installmentTotal || line.expense.installmentTotal || 0);
                        return (
                          <div key={line.lineId} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium">{line.expense.description || "Despesa sem descrição"}</p>
                                {provision && <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] text-cyan-700">Previsão</span>}
                                {recurring && <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700"><Repeat2 className="h-3 w-3" />Recorrente</span>}
                                {installmentTotal > 1 && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{installmentNumber || 1}/{installmentTotal}</span>}
                                {issues.length > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">Cadastro incompleto</span>}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">{line.expense.supplier || "Sem fornecedor"} · cobrança prevista em {format(line.chargeDate, "dd/MM/yyyy")}</p>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                              <p className="mr-2 font-mono font-semibold">{formatCurrency(line.value)}</p>
                              {canAuditCardStatements && selectedStatement?.status !== "paid" ? (
                                <>
                                  <Button size="sm" variant="ghost" asChild>
                                    <Link href={expenseEditHref(line.expense.id, returnTo)}><FileSearch className="mr-1.5 h-4 w-4" />Auditar item</Link>
                                  </Button>
                                  <Button size="sm" variant={line.reconciled ? "default" : "outline"} disabled={working === line.lineId || issues.length > 0} onClick={() => void toggleLine(line, !line.reconciled)}>{working === line.lineId ? <Loader2 className="h-4 w-4 animate-spin" /> : line.reconciled ? <><Check className="mr-1.5 h-4 w-4" />Conferida</> : "Conferir"}</Button>
                                </>
                              ) : <span className={cn("text-xs", line.reconciled ? "text-emerald-600" : "text-muted-foreground")}>{line.reconciled ? "Conferida" : "Pendente"}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Conferência da fatura</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><p className="text-muted-foreground">Itens lançados</p><p className="font-mono font-semibold">{formatCurrency(postedTotal)}</p></div><div><p className="text-muted-foreground">Provisionado</p><p className="font-mono font-semibold">{formatCurrency(selectedGroup.provisionedTotal)}</p></div><div><p className="text-muted-foreground">Itens conferidos</p><p className="font-mono font-semibold">{formatCurrency(selectedGroup.reconciledTotal)}</p></div><div><p className="text-muted-foreground">Total da fatura</p><p className="font-mono font-semibold">{formatCurrency(officialTotal)}</p></div></div>{difference !== null && <div className={cn("rounded-lg px-3 py-2 text-sm", Math.abs(difference) <= 0.05 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>{Math.abs(difference) <= 0.05 ? <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Valores conferem.</span> : <span className="flex items-center gap-2"><TriangleAlert className="h-4 w-4" />Diferença de {formatCurrency(difference)}.</span>}</div>}{canCloseCardStatements && <Button className="w-full" disabled={!canClose || working === "statement"} onClick={() => void closeStatement()}>{working === "statement" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Fechar fatura</Button>} {!canClose && selectedGroup.lines.length > 0 && <p className="text-xs leading-relaxed text-muted-foreground">Para fechar, audite e confira todas as cobranças e elimine a diferença entre o total da fatura e os itens lançados.</p>}</CardContent></Card>

                <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Pagamento no extrato</CardTitle></CardHeader><CardContent className="space-y-3">{selectedStatement?.status === "paid" ? <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="mb-2 h-5 w-5" /><p className="font-semibold">Pagamento conciliado</p><p className="mt-1 text-xs">{toDate(selectedStatement.paidAt) ? format(toDate(selectedStatement.paidAt)!, "dd/MM/yyyy") : "Data não informada"}</p></div> : !canReconcileCardStatements ? <p className="text-sm text-muted-foreground">Seu perfil pode consultar a fatura, mas não conciliar o pagamento bancário.</p> : selectedStatement?.status !== "closed" ? <p className="text-sm text-muted-foreground">Feche a fatura antes de procurar a saída bancária correspondente.</p> : paymentCandidates.length === 0 ? <div className="text-sm text-muted-foreground"><RefreshCw className="mb-2 h-5 w-5" /><p>Nenhum débito compatível foi encontrado. Importe ou confira o extrato bancário.</p>{permissions.financial?.audits?.view && <Button asChild variant="outline" size="sm" className="mt-3"><Link href={FINANCIAL_ROUTES.importExpenses}>Abrir conferência</Link></Button>}</div> : paymentCandidates.map((candidate) => <div key={candidate.transaction.id} className="rounded-xl border p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{String(candidate.transaction.description || "Pagamento da fatura")}</p><p className="mt-1 text-xs text-muted-foreground">{toDate(candidate.transaction.date) ? format(toDate(candidate.transaction.date)!, "dd/MM/yyyy") : "—"} · {candidate.confidence === "high" ? "correspondência exata" : "valor próximo"}</p></div><p className="font-mono text-sm font-semibold">{formatCurrency(Math.abs(Number(candidate.transaction.amount) || 0))}</p></div><Button className="mt-3 w-full" size="sm" disabled={!!working} onClick={() => void reconcilePayment(candidate)}>{working === `payment-${candidate.transaction.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Conciliar pagamento</Button></div>)}</CardContent></Card>
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
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-600" />
              Revisar análise do copiloto
            </DialogTitle>
            <DialogDescription>
              O copiloto interpreta a fatura, mas você decide o que será adicionado. Nada é auditado, efetivado ou pago automaticamente.
            </DialogDescription>
          </DialogHeader>
          {importPreview ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 overscroll-contain">
              <div className={cn(
                "rounded-xl border px-4 py-3",
                importPreview.analysis.status === "ready"
                  ? "border-emerald-200 bg-emerald-50/70"
                  : importPreview.analysis.status === "blocked"
                    ? "border-red-200 bg-red-50/70"
                    : "border-amber-200 bg-amber-50/70",
              )}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="h-4 w-4 text-violet-600" />
                    Análise do Copiloto Financeiro
                  </p>
                  <span className="rounded-full border bg-white/80 px-2 py-0.5 text-[10px] font-semibold">
                    {COPILOT_STATUS_LABELS[importPreview.analysis.status]}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{importPreview.analysis.summary}</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  {importPreview.analysis.detectedFormat ? <span>Formato: {importPreview.analysis.detectedFormat}</span> : null}
                  <span>Compras: {importPreview.transactions.length}</span>
                  <span>Soma das compras: {formatCurrency(importPreview.analysis.includedTotal)}</span>
                  <span>Excluídos: {importPreview.analysis.excludedCount}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/25 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{importPreview.fileName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {importPreview.transactions.length} compra(s) identificada(s)
                    {importPreview.officialTotal ? ` · total ${formatCurrency(importPreview.officialTotal)}` : ""}
                    {importPreview.dueDate ? ` · vencimento ${format(new Date(`${importPreview.dueDate}T12:00:00`), "dd/MM/yyyy")}` : ""}
                    {importPreview.cardLastDigits ? ` · cartão final ${importPreview.cardLastDigits}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => {
                    const available = importPreview.transactions.filter((line) => !existingImportFingerprints.has(line.fingerprint));
                    setSelectedImportLineIds(
                      selectedImportLines.length === available.length ? [] : available.map((line) => line.id),
                    );
                  }}
                >
                  {selectedImportLines.length === importPreview.transactions.filter((line) => !existingImportFingerprints.has(line.fingerprint)).length
                    ? "Desmarcar todas"
                    : "Selecionar todas"}
                </Button>
              </div>

              {importPreview.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  {importPreview.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
                </div>
              ) : null}

              {importPreview.excludedEntries.length > 0 ? (
                <details className="rounded-xl border bg-muted/15 px-4 py-3 text-xs">
                  <summary className="cursor-pointer font-semibold">
                    {importPreview.excludedEntries.length} movimento(s) não serão importados
                  </summary>
                  <div className="mt-3 space-y-2">
                    {importPreview.excludedEntries.map((entry) => (
                      <div key={entry.sourceReference} className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{entry.description}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {EXCLUDED_KIND_LABELS[entry.kind]} · {entry.reason}
                          </p>
                        </div>
                        {entry.amount ? <span className="shrink-0 font-mono font-semibold">{formatCurrency(entry.amount)}</span> : null}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              <div className="max-h-[380px] overflow-y-auto rounded-xl border">
                <div className="grid grid-cols-[28px_70px_minmax(170px,1fr)_minmax(210px,260px)_100px] gap-2 border-b bg-muted/25 px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <span />
                  <span>Data</span>
                  <span>Descrição</span>
                  <span>Tratamento</span>
                  <span className="text-right">Valor</span>
                </div>
                {importPreview.transactions.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhuma compra foi identificada no arquivo.</div>
                ) : importPreview.transactions.map((line) => {
                  const duplicate = existingImportFingerprints.has(line.fingerprint);
                  const selected = selectedImportLineIdSet.has(line.id) && !duplicate;
                  const match = importExpenseMatchByLineId.get(line.id);
                  const resolution = importResolutionByLineId[line.id] || "create";
                  return (
                    <div key={line.id} className={cn("grid grid-cols-[28px_70px_minmax(170px,1fr)_minmax(210px,260px)_100px] items-center gap-2 border-b px-3 py-3 text-xs last:border-b-0", duplicate ? "bg-muted/35 text-muted-foreground" : "hover:bg-primary/[0.03]")}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={duplicate}
                        onChange={(event) => setSelectedImportLineIds((current) => event.target.checked
                          ? [...current, line.id]
                          : current.filter((id) => id !== line.id))}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <span>{format(new Date(`${line.date}T12:00:00`), "dd/MM")}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{line.description}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {duplicate
                            ? "Já importada nesta fatura"
                            : [
                                line.supplier,
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
            </div>
          ) : null}
          <DialogFooter className="shrink-0 border-t bg-muted/20 px-6 py-4">
            <Button variant="outline" disabled={importingStatement} onClick={() => setImportDialogOpen(false)}>Cancelar</Button>
            <Button
              disabled={importingStatement || selectedImportLines.length === 0 || importPreview?.analysis.status === "blocked"}
              onClick={() => void confirmCardStatementImport()}
            >
              {importingStatement ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Adicionar {selectedImportLines.length} como pendente(s)
            </Button>
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
