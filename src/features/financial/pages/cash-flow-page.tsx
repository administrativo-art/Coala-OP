"use client";

import { useCallback, useMemo, useState } from "react";
import { format } from "date-fns";
import { Download, Plus, Wallet } from "lucide-react";
import { NewTransactionDialog } from "@/features/financial/components/cash-flow/new-transaction-dialog";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { MovementsTab } from "@/features/financial/components/cash-flow/movements-tab";
import {
  autoPastGranularity, movementsInRange, PAST_PRESETS, pastPresetRange, summarizeMovements, type CashMovement, type PastPreset,
} from "@/features/financial/components/cash-flow/movements-model";
import { RangePicker, type PickerPreset } from "@/features/financial/components/cash-flow/range-picker";
import { financialCollection } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { buildCashFlowCsv } from "@/features/financial/lib/cash-flow-analysis";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import type { Account } from "@/features/financial/types/account";
import type { Transaction } from "@/features/financial/types/transaction";
import { useAuth } from "@/hooks/use-auth";
import { PageHero } from "@/components/patterns/page-hero";
import { HeroChip } from "@/components/patterns/hero-chip";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CashFlowTabStrip, StudyGaps, StudyHeroChips, StudyHeroControls, StudyLoading, useCashFlowStudy, useStudyControls, type CashFlowTab,
} from "@/features/financial/cash-flow-study/cash-flow-study-view";
import { EntriesTab } from "@/features/financial/cash-flow-study/entries-tab";
import { HealthTab } from "@/features/financial/cash-flow-study/health-tab";
import { addMonths } from "@/features/financial/cash-flow-study/model";
import type { Granularity, StudyRange } from "@/features/financial/cash-flow-study/periods";
import { dm, dmy } from "@/features/financial/cash-flow-study/study-ui";
import { WeeksTab } from "@/features/financial/cash-flow-study/weeks-tab";

export function CashFlowPage() {
  const { permissions, isDefaultAdmin } = useAuth();
  const [accountFilter, setAccountFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  // O estudo (projeção) é só do administrador padrão (a rota revalida no servidor); os demais veem as Movimentações.
  const showStudy = Boolean(isDefaultAdmin);
  const [tab, setTab] = useState<CashFlowTab>(showStudy ? "weeks" : "movements");
  const study = useCashFlowStudy(showStudy);
  const controls = useStudyControls(study.data);
  const studyTab = showStudy && tab !== "movements";
  const today = controls.today;

  // Período das Movimentações: só o passado, até hoje.
  const [movPreset, setMovPreset] = useState<PastPreset>("current_month");
  const [movCustom, setMovCustom] = useState<StudyRange | null>(null);
  const [movGranularity, setMovGranularity] = useState<Granularity | null>(null);
  const movRange = useMemo<StudyRange>(() => (movPreset === "custom" && movCustom ? movCustom : pastPresetRange(movPreset === "custom" ? "current_month" : movPreset, today)), [movCustom, movPreset, today]);
  const movGranularityValue = movGranularity ?? autoPastGranularity(movRange);
  const applyMovRange = useCallback((value: { preset: string; from: string; to: string }) => {
    const known = PAST_PRESETS.find(option => option.value === value.preset);
    setMovPreset(known ? known.value : "custom");
    setMovCustom(known ? null : { from: value.from, to: value.to });
    setMovGranularity(null);
  }, []);

  const { data: accountsData } = useFinancialCollection<Account>(financialCollection("bankAccounts"));
  const { data: transactionsData, loading: loadingTransactions } = useFinancialCollection<Transaction>(financialCollection("transactions"));
  const { data: paymentsData, loading: loadingPayments } = useFinancialCollection<any>(financialCollection("payments"));
  const { data: expensesData, loading: loadingExpenses } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: accountPlansData, loading: loadingAccountPlans } = useFinancialCollection<any>(financialCollection("accounts"));
  const canView = Boolean(permissions.financial?.cashFlow?.view || permissions.financial?.financialFlow);
  const accounts = accountsData || [];
  const expenseMap = useMemo(() => new Map((expensesData || []).map(expense => [expense.id, expense])), [expensesData]);
  const accountPlanMap = useMemo(() => new Map((accountPlansData || []).map(plan => [plan.id, plan.name])), [accountPlansData]);

  // Movimentos realizados: transações do banco e pagamentos ainda sem confirmação bancária. Transferências entre contas ficam de fora.
  const realizedMovements = useMemo<CashMovement[]>(() => {
    const periodStart = new Date(`${movRange.from}T00:00:00`);
    const periodEnd = new Date(`${movRange.to}T23:59:59`);
    const expensesConfirmedByTransactions = new Set(
      (transactionsData || [])
        .filter((transaction: any) => transaction.reversed !== true && transaction.auditStatus !== "reversed")
        .flatMap((transaction: any) => [transaction.expenseId, transaction.linkedExpenseId, ...(Array.isArray(transaction.splitExpenseIds) ? transaction.splitExpenseIds : [])])
        .filter(Boolean),
    );
    const paymentTransactions = (paymentsData || []).flatMap(payment => {
      const confirmedByBank = payment.status === "MATCHED" || payment.reconciliationStatus === "MATCHED" || Boolean(payment.bankTransactionId || payment.linkedBankTransactionId);
      if (confirmedByBank || expensesConfirmedByTransactions.has(payment.expenseId)) return [];
      return (payment.splits || []).map((split: any, splitIndex: number) => ({
        id: `payment-${payment.id}-${splitIndex}`, type: "expense_payment", direction: "out", accountId: split.accountId, accountName: split.accountName,
        paymentMethodLabel: split.paymentMethodLabel, amount: Number(split.amount) || 0, date: payment.paidAt, description: payment.description,
        expenseId: payment.expenseId, createdBy: payment.createdBy, createdAt: payment.createdAt, paymentEvidenceStatus: payment.status || "REPORTED",
      }));
    });
    return [...(transactionsData || []), ...paymentTransactions].flatMap((transaction: any): CashMovement[] => {
      if (transaction.reversed === true || transaction.auditStatus === "reversed") return [];
      const date = toDate(transaction.date);
      if (!date || date < periodStart || date > periodEnd) return [];
      if (transaction.type === "transfer_in" || transaction.type === "transfer_out") return [];
      const direction = transaction.direction || (String(transaction.type).includes("expense") ? "out" : "in");
      const expenseId = transaction.expenseId || transaction.linkedExpenseId;
      const expense = expenseId ? expenseMap.get(expenseId) : undefined;
      const accountPlanId = transaction.accountPlanId || expense?.accountId || expense?.accountPlan;
      return [{
        id: transaction.id.startsWith?.("payment-") ? transaction.id : `realized-${transaction.id}`,
        date, description: transaction.description || expense?.description || "Movimentação financeira",
        accountId: transaction.accountId, accountName: transaction.accountName, accountPlanId,
        accountPlanName: transaction.accountPlanName || expense?.accountPlanName || accountPlanMap.get(accountPlanId) || undefined,
        supplier: transaction.supplier || expense?.supplier || undefined, expenseId,
        competenceDate: toDate(transaction.competenceDate) || toDate(expense?.competenceDate), dueDate: toDate(expense?.dueDate),
        direction, status: "realized" as const, amount: Number(transaction.amount) || 0,
      }];
    });
  }, [accountPlanMap, expenseMap, movRange, paymentsData, transactionsData]);

  const scopedMovements = useMemo(() => movementsInRange(realizedMovements, movRange, accountFilter), [accountFilter, movRange, realizedMovements]);
  const movSummary = useMemo(() => summarizeMovements(scopedMovements), [scopedMovements]);

  function exportCsv() {
    if (scopedMovements.length === 0) return;
    const csv = buildCashFlowCsv([...scopedMovements].sort((left, right) => right.date.getTime() - left.date.getTime()));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fluxo-de-caixa-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  if (!canView) return <FinancialAccessGuard title="Fluxo de caixa" description="Seu perfil não possui permissão para consultar o fluxo de caixa." />;

  const loading = loadingTransactions || loadingPayments || loadingExpenses || loadingAccountPlans;
  const pastPresets: PickerPreset[] = PAST_PRESETS.map(option => ({ value: option.value, label: option.label, range: pastPresetRange(option.value, today) }));
  const movLabel = movPreset === "custom" ? `${dm(movRange.from)} a ${dmy(movRange.to)}` : `${PAST_PRESETS.find(option => option.value === movPreset)?.label} · ${dm(movRange.from)} a ${dm(movRange.to)}`;
  const subtitle = studyTab
    ? tab === "health" ? "Indicadores dos meses fechados e das últimas semanas." : `Realizado, a receber e projeção ${controls.range.from === today ? "de hoje" : `de ${dmy(controls.range.from)}`} até ${dmy(controls.range.to)}.`
    : `O que já entrou e saiu das contas de ${dmy(movRange.from)} a ${dmy(movRange.to)}.`;

  return (
    <PageContainer variant="default" surface className="space-y-6 pb-10">
      <PageHero
        kicker="Financeiro"
        title="Fluxo de caixa"
        subtitle={subtitle}
        actions={<>
          {!studyTab && <Button variant="on-dark-secondary" size="md" onClick={exportCsv} disabled={scopedMovements.length === 0}><Download className="mr-2 h-4 w-4" /> Exportar CSV</Button>}
          {permissions.financial?.cashFlow?.create && <Button variant="primary-page" size="md" onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Novo lançamento</Button>}
        </>}
        chips={studyTab ? <StudyHeroChips data={study.data} controls={controls} /> : <>
          <HeroChip value={formatCurrency(movSummary.resultAmount)} label="Resultado do período" tone={movSummary.resultAmount >= 0 ? "info" : "danger"} />
          <HeroChip value={formatCurrency(movSummary.inAmount)} label="Entrou" />
          <HeroChip value={formatCurrency(movSummary.outAmount)} label="Saiu" tone="warning" />
        </>}
      >
        {studyTab ? <StudyHeroControls data={study.data} controls={controls} showPeriod={tab !== "health"} loading={study.loading} onReload={() => void study.reload()} /> : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger aria-label="Conta" className="h-10 w-44 rounded-ds-btn border-white/10 bg-white/[0.07] px-3 text-[13px] font-semibold text-white shadow-none hover:bg-white/10 hover:text-white focus:ring-ds-accent-kicker"><Wallet className="mr-2 h-3.5 w-3.5" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contas</SelectItem>
                {accounts.filter(account => account.active).map(account => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <RangePicker value={{ preset: movPreset, ...movRange }} presets={pastPresets} minDate={`${addMonths(today.slice(0, 7), -24)}-01`} maxDate={today} label={movLabel} onApply={applyMovRange} />
          </div>
        )}
      </PageHero>
      {showStudy && <CashFlowTabStrip value={tab} onChange={setTab} />}
      {studyTab && (!study.data ? <StudyLoading error={study.error} onRetry={() => void study.reload()} /> : <>
        {tab === "weeks" && <WeeksTab data={study.data} controls={controls} />}
        {tab === "entries" && <EntriesTab data={study.data} controls={controls} />}
        {tab === "health" && <HealthTab data={study.data} />}
        <StudyGaps data={study.data} />
      </>)}
      {!studyTab && <MovementsTab movements={scopedMovements} range={movRange} granularity={movGranularityValue} onGranularity={setMovGranularity} loading={loading} today={today} />}
      {permissions.financial?.cashFlow?.create && <NewTransactionDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </PageContainer>
  );
}
