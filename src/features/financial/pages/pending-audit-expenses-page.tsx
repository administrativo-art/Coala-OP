"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Timestamp, updateDoc } from "firebase/firestore";
import { format, startOfDay } from "date-fns";
import { Search } from "lucide-react";
import { BackButton } from "@/components/navigation/back-button";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function PendingAuditExpensesPage() {
  const { permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const { data: expensesData, loading } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: transactionsData, loading: transactionsLoading } = useFinancialCollection<any>(financialCollection("transactions"));
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accounts"));
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [competenceMonth, setCompetenceMonth] = useState(format(new Date(), "yyyy-MM"));
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [accountPlanFilter, setAccountPlanFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [linkingTransactionId, setLinkingTransactionId] = useState<string | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState("none");
  const [isLinking, setIsLinking] = useState(false);

  if (!permissions.financial?.expenses?.view) {
    return (
      <FinancialAccessGuard
        title="Pendências de auditoria"
        description="Seu perfil não possui permissão para consultar pendências de auditoria de despesas."
      />
    );
  }

  const expenses = expensesData || [];
  const transactions = transactionsData || [];
  const accountPlanMap = useMemo(() => {
    const map: Record<string, string> = {};
    (accountPlans || []).forEach((plan) => {
      map[plan.id] = plan.name;
    });
    return map;
  }, [accountPlans]);

  const suppliers = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...expenses.map((expense) => expense.supplier),
            ...transactions.map((transaction) => transaction.supplier),
          ].filter(Boolean)
        )
      ).sort((a, b) =>
        String(a).localeCompare(String(b), "pt-BR")
      ) as string[],
    [expenses, transactions]
  );

  const accountPlanNames = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...expenses.map((expense) => accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan),
            ...transactions.map((transaction) => transaction.accountPlanName || accountPlanMap[transaction.accountPlanId]),
          ]
            .filter(Boolean)
        )
      ).sort((a, b) => String(a).localeCompare(String(b), "pt-BR")) as string[],
    [accountPlanMap, expenses, transactions]
  );

  const units = useMemo(
    () => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [kiosks]
  );

  const linkableExpenses = useMemo(
    () =>
      expenses
        .filter((expense) => expense.status !== "draft" && expense.status !== "cancelled")
        .sort((left, right) => (toDate(right.createdAt)?.getTime() || 0) - (toDate(left.createdAt)?.getTime() || 0)),
    [expenses]
  );

  const pendingItems = useMemo(() => {
    const now = startOfDay(new Date());
    const purchaseItems = expenses
      .filter((expense) => expense.originModule === "purchasing" && expense.originStatus === "pending_audit")
      .map((expense) => ({
        id: expense.id,
        source: "purchasing" as const,
        description: expense.description,
        supplier: expense.supplier || "",
        planName: accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan || "",
        dueDate: toDate(expense.dueDate),
        competenceDate: toDate(expense.competenceDate),
        unitName: expense.resultCenter || "",
        totalValue: expense.totalValue || 0,
        purchaseOrderId: expense.purchaseOrderId || "",
      }));

    const importedItems = transactions
      .filter((transaction) => transaction.importedFrom === "bank_statement")
      .filter((transaction) => transaction.direction === "out")
      .filter((transaction) => transaction.auditStatus === "pending")
      .map((transaction) => {
        const transactionDate = toDate(transaction.date);
        return {
          id: transaction.id,
          source: "bank_import" as const,
          description: transaction.description,
          supplier: transaction.supplier || "",
          planName: transaction.accountPlanName || accountPlanMap[transaction.accountPlanId] || "",
          dueDate: transactionDate,
          competenceDate: transactionDate ? new Date(transactionDate.getFullYear(), transactionDate.getMonth(), 1) : undefined,
          unitName: transaction.resultCenterName || "",
          totalValue: Number(transaction.amount) || 0,
          rawBankDescription: transaction.rawBankDescription || "",
          linkedExpenseId: transaction.linkedExpenseId || "",
        };
      });

    return [...purchaseItems, ...importedItems]
      .filter((item) => {
        const due = item.dueDate;
        const competence = item.competenceDate;
        const supplier = item.supplier || "";
        const planName = item.planName || "";
        const normalizedSearch = search.toLowerCase();

        if (
          search &&
          !item.description.toLowerCase().includes(normalizedSearch) &&
          !supplier.toLowerCase().includes(normalizedSearch) &&
          !planName.toLowerCase().includes(normalizedSearch) &&
          !(item.unitName || "").toLowerCase().includes(normalizedSearch)
        ) {
          return false;
        }
        if (dateFrom && (!due || due < new Date(`${dateFrom}T00:00:00`))) return false;
        if (dateTo && (!due || due > new Date(`${dateTo}T23:59:59`))) return false;
        if (competenceMonth && (!competence || format(competence, "yyyy-MM") !== competenceMonth)) return false;
        if (supplierFilter !== "all" && supplier !== supplierFilter) return false;
        if (accountPlanFilter !== "all" && planName !== accountPlanFilter) return false;
        if (unitFilter !== "all" && item.unitName !== unitFilter) return false;
        return true;
      })
      .sort((a, b) => (a.dueDate?.getTime() || now.getTime()) - (b.dueDate?.getTime() || now.getTime()));
  }, [accountPlanFilter, accountPlanMap, competenceMonth, dateFrom, dateTo, expenses, search, supplierFilter, transactions, unitFilter]);

  async function handleLinkImportedExpense() {
    if (!linkingTransactionId || selectedExpenseId === "none") return;

    const transaction = transactions.find((item) => item.id === linkingTransactionId);
    if (!transaction) return;

    setIsLinking(true);
    try {
      await updateDoc(financialDoc("expenses", selectedExpenseId), {
        status: "paid",
        paidAt: transaction.date || Timestamp.now(),
        paidByImport: true,
        linkedBankTransactionId: linkingTransactionId,
        updatedAt: Timestamp.now(),
      });
      await updateDoc(financialDoc("transactions", linkingTransactionId), {
        auditStatus: "resolved",
        linkedExpenseId: selectedExpenseId,
      });
      setLinkingTransactionId(null);
      setSelectedExpenseId("none");
      toast({ title: "Transação vinculada à despesa existente." });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao vincular a transação." });
    } finally {
      setIsLinking(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pendências de auditoria</h1>
          <p className="text-muted-foreground">Fila dedicada para tratar despesas de compras e despesas reconhecidas via importação de extrato.</p>
        </div>
        <BackButton fallbackHref={FINANCIAL_ROUTES.expenses} label="Voltar para despesas" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Refine a fila por período, competência, fornecedor, unidade e plano.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Buscar pendência..." />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            <Input type="month" value={competenceMonth} onChange={(event) => setCompetenceMonth(event.target.value)} />
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger><SelectValue placeholder="Fornecedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os fornecedores</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={accountPlanFilter} onValueChange={setAccountPlanFilter}>
              <SelectTrigger><SelectValue placeholder="Plano de contas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os planos</SelectItem>
                {accountPlanNames.map((accountPlan) => (
                  <SelectItem key={accountPlan} value={accountPlan}>{accountPlan}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger><SelectValue placeholder="Unidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                {units.map((unit) => (
                  <SelectItem key={unit.id} value={unit.name}>{unit.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fila de tratamento</CardTitle>
          <CardDescription>{pendingItems.length} pendência(s) no recorte atual.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading || transactionsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : pendingItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma pendência de auditoria encontrada.</p>
          ) : (
            <div className="space-y-3">
              {pendingItems.map((item) => (
                <div key={`${item.source}-${item.id}`} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{item.description}</p>
                        <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {item.source === "purchasing" ? "Compras" : "Extrato bancário"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {item.supplier || "—"} • {item.planName || "—"} •
                        Venc. {item.dueDate ? format(item.dueDate, "dd/MM/yyyy") : "—"}
                        {item.unitName ? ` • ${item.unitName}` : ""}
                      </p>
                      <p className="mt-2 text-xs text-amber-700">
                        {item.source === "purchasing"
                          ? "Revise parcelamento, conta e liquidação."
                          : "Vincule a uma despesa existente ou conclua o lançamento como nova despesa."}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{formatCurrency(item.totalValue || 0)}</span>
                      {item.source === "purchasing" && item.purchaseOrderId && (
                        <Button asChild size="sm">
                          <Link href={`/dashboard/purchasing/orders/${item.purchaseOrderId}?returnTo=${encodeURIComponent(FINANCIAL_ROUTES.pendingAuditExpenses)}`}>
                            Tratar pendência
                          </Link>
                        </Button>
                      )}
                      {item.source === "bank_import" && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setLinkingTransactionId((current) => current === item.id ? null : item.id);
                              setSelectedExpenseId("none");
                            }}
                          >
                            Vincular existente
                          </Button>
                          <Button asChild size="sm">
                            <Link href={`${FINANCIAL_ROUTES.newExpense}?importTransaction=${item.id}&returnTo=${encodeURIComponent(FINANCIAL_ROUTES.pendingAuditExpenses)}`}>
                              Tratar como nova
                            </Link>
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {item.source === "bank_import" && linkingTransactionId === item.id && (
                    <div className="mt-4 grid gap-2 rounded-xl border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                      <Select value={selectedExpenseId} onValueChange={setSelectedExpenseId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a despesa existente" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Selecione a despesa existente</SelectItem>
                          {linkableExpenses.map((expense) => (
                            <SelectItem key={expense.id} value={expense.id}>
                              {expense.description} • {expense.supplier || "—"} • {formatCurrency(expense.totalValue || 0)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="button" onClick={() => void handleLinkImportedExpense()} disabled={isLinking || selectedExpenseId === "none"}>
                        Confirmar vínculo
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
