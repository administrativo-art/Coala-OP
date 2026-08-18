"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { setDoc, Timestamp, updateDoc, writeBatch } from "firebase/firestore";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  CreditCard,
  FileSearch,
  Loader2,
  ReceiptText,
  RefreshCw,
  Repeat2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import {
  buildCardStatementGroups,
  buildCardStatementAllocations,
  findCardStatementPaymentCandidates,
  resolveCardStatementCycleFromMonth,
  type CardStatementLine,
  type CardStatementGroup,
  type CardStatementAllocation,
  type CreditCardInstrument,
} from "@/features/financial/lib/card-invoices";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
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
  notes?: string;
};

type CardStatementsWorkspaceProps = {
  embedded?: boolean;
  fixedMonthKey?: string;
  accountId?: string;
  paymentMethodId?: string;
  returnTo?: string;
};

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

function cardLineAuditIssues(line: CardStatementLine) {
  const expense = line.expense;
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
  if (!toDate(expense.competenceDate)) issues.push("competência");
  return issues;
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
  const [officialTotalInput, setOfficialTotalInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [working, setWorking] = useState<string | null>(null);

  const { data: expensesData, loading: expensesLoading, refresh: refreshExpenses } = useFinancialCollection<any>(
    financialCollection("expenses")
  );
  const { data: bankAccountsData, loading: accountsLoading } = useFinancialCollection<any>(
    financialCollection("bankAccounts")
  );
  const { data: statementsData, loading: statementsLoading, refresh: refreshStatements } = useFinancialCollection<StatementDocument>(
    financialCollection("cardStatements")
  );
  const canViewBankTransactions = Boolean(
    permissions.financial?.cashFlow?.view ||
    permissions.financial?.financialFlow ||
    permissions.financial?.dre ||
    permissions.financial?.dashboard
  );
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
  const monthGroups = useMemo<CardStatementGroup[]>(() => {
    const generatedByCard = new Map(
      generatedGroups
        .filter((group) => group.monthKey === monthKey)
        .map((group) => [`${group.card.accountId}:${group.card.methodId}`, group])
    );

    return cards.map((card) => {
      const cardKey = `${card.accountId}:${card.methodId}`;
      const generated = generatedByCard.get(cardKey);
      if (generated) return generated;
      const cycle = resolveCardStatementCycleFromMonth(monthKey, card);
      return {
        ...cycle,
        card,
        lines: [],
        projectedTotal: 0,
        reconciledTotal: 0,
        recurringCount: 0,
        provisionCount: 0,
        provisionedTotal: 0,
      };
    });
  }, [cards, generatedGroups, monthKey]);
  const statementByKey = useMemo(
    () => new Map((statementsData || []).map((statement) => [statement.key || statement.id, statement])),
    [statementsData]
  );
  const selectedGroup = monthGroups.find(
    (group) => `${group.card.accountId}:${group.card.methodId}` === selectedCardKey
  ) ?? monthGroups[0] ?? null;
  const selectedStatement = selectedGroup ? statementByKey.get(selectedGroup.key) ?? null : null;
  const officialTotal = Number(selectedStatement?.officialTotal || 0);
  const difference = officialTotal > 0 && selectedGroup
    ? Number((officialTotal - selectedGroup.projectedTotal).toFixed(2))
    : null;
  const reconciledCount = selectedGroup?.lines.filter((line) => line.reconciled).length ?? 0;
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
    setOfficialTotalInput(selectedStatement?.officialTotal ? String(selectedStatement.officialTotal) : "");
    setNotesInput(selectedStatement?.notes || "");
  }, [selectedStatement?.id, selectedStatement?.notes, selectedStatement?.officialTotal]);

  if (!permissions.financial?.expenses?.view) {
    return (
      <FinancialAccessGuard
        title="Faturas de cartão"
        description="Seu perfil não possui permissão para consultar despesas e faturas corporativas."
      />
    );
  }

  const loading = expensesLoading || accountsLoading || statementsLoading || transactionsLoading;

  async function saveStatement(status: "open" | "closed" = "open") {
    if (!firebaseUser || !selectedGroup) return;
    const parsedOfficialTotal = Number(officialTotalInput.replace(",", "."));
    if (!Number.isFinite(parsedOfficialTotal) || parsedOfficialTotal < 0) {
      toast({ variant: "destructive", title: "Informe um valor oficial válido." });
      return;
    }
    if (status === "closed" && !canClose) {
      toast({
        variant: "destructive",
        title: "A fatura ainda possui divergências.",
        description: "Confira todas as linhas e iguale o valor oficial ao total registrado.",
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
          officialTotal: parsedOfficialTotal,
          status,
          ...(status === "closed" ? { allocations: buildCardStatementAllocations(selectedGroup.lines) } : {}),
          notes: notesInput.trim(),
          updatedAt: Timestamp.now(),
          updatedBy: firebaseUser.uid,
          ...(selectedStatement ? {} : { createdAt: Timestamp.now(), createdBy: firebaseUser.uid }),
        },
        { merge: true }
      );
      refreshStatements();
      toast({ title: status === "closed" ? "Fatura conferida e fechada." : "Fatura salva." });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Não foi possível salvar a fatura." });
    } finally {
      setWorking(null);
    }
  }

  async function toggleLine(line: CardStatementLine, reconciled: boolean) {
    if (!firebaseUser || !permissions.financial?.expenses?.edit || selectedStatement?.status === "paid") return;
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
    if (!firebaseUser || !selectedGroup || !selectedStatement || !canClose) return;
    const paidAtDate = toDate(candidate.transaction.date);
    if (!paidAtDate) return;

    setWorking(`payment-${candidate.transaction.id}`);
    try {
      const batch = writeBatch(financialDb);
      batch.set(
        financialDoc("cardStatements", statementDocumentId(selectedGroup.key)),
        {
          status: "paid",
          linkedBankTransactionId: candidate.transaction.id,
          linkedBankTransactionIds: [candidate.transaction.id],
          settlements: [{
            transactionId: candidate.transaction.id,
            amount: Number(Math.abs(Number(candidate.transaction.amount) || 0).toFixed(2)),
            paidAt: format(paidAtDate, "yyyy-MM-dd"),
          }],
          allocations: buildCardStatementAllocations(selectedGroup.lines),
          paidAt: Timestamp.fromDate(paidAtDate),
          paidBy: firebaseUser.uid,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      const linesByExpense = new Map<string, CardStatementLine[]>();
      selectedGroup.lines.forEach((line) => {
        const current = linesByExpense.get(line.expense.id) || [];
        current.push(line);
        linesByExpense.set(line.expense.id, current);
      });
      linesByExpense.forEach((lines, expenseId) => {
        const expense = lines[0]!.expense;
        const installments = Array.isArray(expense.installments) ? expense.installments : [];
        const paidInstallmentNumbers = new Set(
          lines
            .map((line) => line.installmentNumber)
            .filter((number): number is number => Number.isFinite(number))
        );
        if (paidInstallmentNumbers.size === 0 && installments.length === 1) {
          paidInstallmentNumbers.add(Number(installments[0]?.number) || 1);
        }
        const nextInstallments = installments.map((installment, index) =>
          paidInstallmentNumbers.has(Number(installment.number) || index + 1)
            ? {
                ...installment,
                status: "paid",
                paidAt: Timestamp.fromDate(paidAtDate),
                cardReconciliationStatus: "reconciled",
                cardStatementKey: selectedGroup.key,
                linkedBankTransactionId: candidate.transaction.id,
              }
            : installment
        );
        const fullyPaid =
          nextInstallments.length === 0 ||
          nextInstallments.every((installment) => installment.status === "paid" || installment.status === "cancelled");
        batch.update(financialDoc("expenses", expenseId), {
          ...(nextInstallments.length > 0 ? { installments: nextInstallments } : {}),
          ...(fullyPaid ? { status: "paid", paidAt: Timestamp.fromDate(paidAtDate) } : {}),
          paidByCardStatement: true,
          cardStatementKey: selectedGroup.key,
          cardStatementId: statementDocumentId(selectedGroup.key),
          linkedBankTransactionId: candidate.transaction.id,
          updatedAt: Timestamp.now(),
        });
      });
      await batch.commit();
      refreshStatements();
      refreshExpenses();
      toast({
        title: "Pagamento da fatura conciliado.",
        description: `${selectedGroup.lines.length} despesa${selectedGroup.lines.length === 1 ? " foi liquidada" : "s foram liquidadas"} sem criar uma nova despesa.`,
      });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Não foi possível conciliar o pagamento." });
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className={cn(
      "mx-auto w-full space-y-6",
      embedded ? "h-full max-w-none overflow-y-auto p-4" : "max-w-[1220px] pb-10"
    )}>
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
                              {permissions.financial?.expenses?.edit && selectedStatement?.status !== "paid" ? (
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
                <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Conferência da fatura</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-3 gap-3 text-sm"><div><p className="text-muted-foreground">Previsto</p><p className="font-mono font-semibold">{formatCurrency(selectedGroup.projectedTotal)}</p></div><div><p className="text-muted-foreground">Provisionado</p><p className="font-mono font-semibold">{formatCurrency(selectedGroup.provisionedTotal)}</p></div><div><p className="text-muted-foreground">Conferido</p><p className="font-mono font-semibold">{formatCurrency(selectedGroup.reconciledTotal)}</p></div></div><div><label className="text-xs font-medium">Total oficial da fatura</label><Input className="mt-1" inputMode="decimal" placeholder="0,00" value={officialTotalInput} onChange={(event) => setOfficialTotalInput(event.target.value)} /></div>{difference !== null && <div className={cn("rounded-lg px-3 py-2 text-sm", Math.abs(difference) <= 0.05 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>{Math.abs(difference) <= 0.05 ? <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Valores conferem.</span> : <span className="flex items-center gap-2"><TriangleAlert className="h-4 w-4" />Diferença de {formatCurrency(difference)}.</span>}</div>}<div><label className="text-xs font-medium">Observações</label><Input className="mt-1" value={notesInput} onChange={(event) => setNotesInput(event.target.value)} /></div>{permissions.financial?.expenses?.edit && <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={working === "statement"} onClick={() => void saveStatement("open")}>{working === "statement" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button><Button disabled={!canClose || working === "statement"} onClick={() => void saveStatement("closed")}>Fechar fatura</Button></div>} {!canClose && selectedGroup.lines.length > 0 && <p className="text-xs leading-relaxed text-muted-foreground">Para fechar, audite e confira todas as cobranças e elimine a diferença entre o total oficial e o previsto.</p>}</CardContent></Card>

                <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Pagamento no extrato</CardTitle></CardHeader><CardContent className="space-y-3">{selectedStatement?.status === "paid" ? <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="mb-2 h-5 w-5" /><p className="font-semibold">Pagamento conciliado</p><p className="mt-1 text-xs">{toDate(selectedStatement.paidAt) ? format(toDate(selectedStatement.paidAt)!, "dd/MM/yyyy") : "Data não informada"}</p></div> : selectedStatement?.status !== "closed" ? <p className="text-sm text-muted-foreground">Feche a fatura antes de procurar a saída bancária correspondente.</p> : paymentCandidates.length === 0 ? <div className="text-sm text-muted-foreground"><RefreshCw className="mb-2 h-5 w-5" /><p>Nenhum débito compatível foi encontrado. Importe ou confira o extrato bancário.</p><Button asChild variant="outline" size="sm" className="mt-3"><Link href={FINANCIAL_ROUTES.importExpenses}>Abrir conferência</Link></Button></div> : paymentCandidates.map((candidate) => <div key={candidate.transaction.id} className="rounded-xl border p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{String(candidate.transaction.description || "Pagamento da fatura")}</p><p className="mt-1 text-xs text-muted-foreground">{toDate(candidate.transaction.date) ? format(toDate(candidate.transaction.date)!, "dd/MM/yyyy") : "—"} · {candidate.confidence === "high" ? "correspondência exata" : "valor próximo"}</p></div><p className="font-mono text-sm font-semibold">{formatCurrency(Math.abs(Number(candidate.transaction.amount) || 0))}</p></div>{permissions.financial?.expenses?.pay && <Button className="mt-3 w-full" size="sm" disabled={!!working} onClick={() => void reconcilePayment(candidate)}>{working === `payment-${candidate.transaction.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Conciliar pagamento</Button>}</div>)}</CardContent></Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function CardStatementsPage() {
  return <CardStatementsWorkspace />;
}
