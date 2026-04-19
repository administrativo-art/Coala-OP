"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { deleteDoc } from "firebase/firestore";
import { format, isPast, startOfDay, addDays, endOfDay } from "date-fns";
import {
  CircleDollarSign,
  Clock,
  Download,
  FilePlus2,
  FileUp,
  Filter,
  MoreHorizontal,
  Search,
  Trash2,
} from "lucide-react";
import { PayExpenseDialog } from "@/features/financial/components/pay-expense-dialog";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCompactCurrency, formatCurrency, toDate } from "@/features/financial/lib/utils";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_LABELS: Record<string, string> = {
  paid: "Pago",
  cancelled: "Cancelado",
  overdue: "Vencido",
  pending: "Em aberto",
  due_soon: "Vence hoje",
};

function KpiCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export function ExpensesPage() {
  const { permissions } = useAuth();
  const { toast } = useToast();
  const { data: expensesData, loading } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accountPlans"));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  if (!permissions.financial?.expenses?.view) {
    return (
      <FinancialAccessGuard
        title="Despesas"
        description="Seu perfil não possui permissão para consultar despesas, contas a pagar e histórico de liquidações."
      />
    );
  }

  const expenses = expensesData || [];
  const accountPlanMap = useMemo(() => {
    const map: Record<string, string> = {};
    (accountPlans || []).forEach((plan) => {
      map[plan.id] = plan.name;
    });
    return map;
  }, [accountPlans]);

  const filtered = useMemo(() => {
    const now = startOfDay(new Date());
    return expenses
      .filter((expense) => {
        const planName = accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan || "";
        const normalizedSearch = search.toLowerCase();
        const matchesSearch =
          !search ||
          expense.description.toLowerCase().includes(normalizedSearch) ||
          planName.toLowerCase().includes(normalizedSearch) ||
          (expense.supplier || "").toLowerCase().includes(normalizedSearch);

        const due = toDate(expense.dueDate);
        let computedStatus = expense.status;
        if (expense.status === "pending" && due) {
          if (isPast(due) && due < now) computedStatus = "overdue";
          else if (format(due, "yyyy-MM-dd") === format(now, "yyyy-MM-dd")) computedStatus = "due_soon";
        }

        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "pending" && ["pending", "due_soon", "overdue"].includes(computedStatus)) ||
          computedStatus === statusFilter;

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  }, [accountPlanMap, expenses, search, statusFilter]);

  const kpis = useMemo(() => {
    const now = startOfDay(new Date());
    const in7Days = endOfDay(addDays(now, 7));

    let open = 0;
    let overdue = 0;
    let paid = 0;
    let dueSoon = 0;

    expenses.forEach((expense) => {
      const due = toDate(expense.dueDate);
      if (expense.status === "pending") {
        open += expense.totalValue || 0;
        if (due && due < now) overdue += expense.totalValue || 0;
        if (due && due >= now && due <= in7Days) dueSoon += expense.totalValue || 0;
      }
      if (expense.status === "paid") {
        paid += expense.totalValue || 0;
      }
    });

    return { open, overdue, paid, dueSoon };
  }, [expenses]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDoc(financialDoc("expenses", deleteTarget.id));
      toast({ title: "Despesa excluída." });
    } catch {
      toast({ variant: "destructive", title: "Erro ao excluir a despesa." });
    } finally {
      setDeleteTarget(null);
    }
  }

  function exportCsv() {
    const header = "Descrição,Fornecedor,Plano de contas,Valor,Vencimento,Status\n";
    const rows = filtered
      .map((expense) =>
        [
          `"${expense.description}"`,
          `"${expense.supplier || ""}"`,
          `"${accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan || ""}"`,
          (expense.totalValue || 0).toFixed(2),
          toDate(expense.dueDate) ? format(toDate(expense.dueDate)!, "dd/MM/yyyy") : "",
          expense.status,
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `despesas-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Despesas</h1>
          <p className="text-muted-foreground">Painel consolidado de despesas, contas a pagar e histórico de liquidações.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.financial?.expenses?.import && (
            <Button variant="outline" size="sm" asChild>
              <Link href={FINANCIAL_ROUTES.importExpenses}>
                <FileUp className="mr-2 h-4 w-4" /> Importar extrato
              </Link>
            </Button>
          )}
          {permissions.financial?.expenses?.create && (
            <Button size="sm" asChild>
              <Link href={FINANCIAL_ROUTES.newExpense}>
                <FilePlus2 className="mr-2 h-4 w-4" /> Novo lançamento
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Em aberto" value={formatCurrency(kpis.open)} description="Total de compromissos pendentes." />
        <KpiCard label="Vencido" value={formatCurrency(kpis.overdue)} description="Despesas que já passaram do vencimento." />
        <KpiCard label="Vence em 7 dias" value={formatCurrency(kpis.dueSoon)} description="Monitoramento do curto prazo." />
        <KpiCard label="Pago" value={formatCurrency(kpis.paid)} description="Histórico já liquidado." />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por descrição, fornecedor ou plano de contas..."
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Filter className="mr-2 h-4 w-4 opacity-50" />
                <SelectValue placeholder="Filtrar por status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pending">Em aberto</SelectItem>
                <SelectItem value="overdue">Vencidos</SelectItem>
                <SelectItem value="paid">Pagos</SelectItem>
                <SelectItem value="cancelled">Cancelados</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="mr-2 h-4 w-4" /> Exportar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium">Fornecedor</th>
                  <th className="px-4 py-3 font-medium">Plano de contas</th>
                  <th className="px-4 py-3 font-medium">Vencimento</th>
                  <th className="px-4 py-3 text-right font-medium">Valor</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <tr key={index} className="border-b">
                      <td colSpan={7} className="p-4">
                        <Skeleton className="h-10 w-full" />
                      </td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-muted-foreground">
                      Nenhuma despesa encontrada.
                    </td>
                  </tr>
                ) : (
                  filtered.map((expense) => {
                    const due = toDate(expense.dueDate);
                    const now = startOfDay(new Date());
                    let statusKey = expense.status;
                    if (expense.status === "pending" && due) {
                      if (due < now) statusKey = "overdue";
                      else if (format(due, "yyyy-MM-dd") === format(now, "yyyy-MM-dd")) statusKey = "due_soon";
                    }

                    return (
                      <tr key={expense.id} className="border-b">
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium">{expense.description}</p>
                            {expense.notes && <p className="text-xs text-muted-foreground">{expense.notes}</p>}
                          </div>
                        </td>
                        <td className="px-4 py-3">{expense.supplier || "—"}</td>
                        <td className="px-4 py-3">
                          {accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan || "—"}
                        </td>
                        <td className="px-4 py-3">{due ? format(due, "dd/MM/yyyy") : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{formatCompactCurrency(expense.totalValue || 0)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="rounded-full border px-2 py-1 text-[11px]">
                            {STATUS_LABELS[statusKey] || statusKey}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Ações</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                              {permissions.financial?.expenses?.pay && expense.status === "pending" && (
                                <DropdownMenuItem onClick={() => setPayTarget(expense)}>Registrar pagamento</DropdownMenuItem>
                              )}
                              {permissions.financial?.expenses?.edit && (
                                <DropdownMenuItem asChild>
                                  <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${expense.id}`}>Editar</Link>
                                </DropdownMenuItem>
                              )}
                              {permissions.financial?.expenses?.delete && (
                                <DropdownMenuItem onClick={() => setDeleteTarget(expense)}>
                                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <PayExpenseDialog expense={payTarget} open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir despesa?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação remove a despesa <strong>{deleteTarget?.description}</strong> do banco financeiro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
