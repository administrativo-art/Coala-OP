"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CalendarRange, CircleDollarSign, Download, Plus, RefreshCw, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { NewTransactionDialog } from "@/features/financial/components/cash-flow/new-transaction-dialog";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { formatBRL } from "@/features/financial/cash-closures/money";
import type { CashFlowOpeningBalance, CashFlowProjectionItem } from "@/features/financial/cash-flow/projection";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { filterUnitsByAccess } from "@/lib/unit-access";
import { cn } from "@/lib/utils";

type DailyProjection = {
  date: string;
  incomingCents: number;
  outgoingCents: number;
  closingBalanceCents: number | null;
};

type CashFlowProjectionResponse = {
  generatedAt: string;
  asOf: string;
  endDate: string;
  days: number;
  openingBalances: CashFlowOpeningBalance[];
  openingBalanceCents: number | null;
  balanceComplete: boolean;
  balanceIncompleteReason: string | null;
  futureSalesIncluded: false;
  items: CashFlowProjectionItem[];
  unprogrammedItems: CashFlowProjectionItem[];
  daily: DailyProjection[];
  minimumBalanceDay: DailyProjection | null;
  firstNegativeDay: DailyProjection | null;
  cutoffs: {
    receivables: number;
    obligations: number;
    paymentRequests: number;
    transactions: number;
  };
};

type ChartMode = "daily" | "weekly";

const STATUS_LABELS: Record<CashFlowProjectionItem["status"], string> = {
  scheduled: "Programado",
  unprogrammed: "Sem data",
  overdue: "Vencido",
  realized: "Realizado",
  cancelled: "Cancelado",
  replaced: "Substituído",
};

const SOURCE_LABELS: Record<CashFlowProjectionItem["sourceType"], string> = {
  stone_receivable: "Recebível Stone",
  financial_obligation: "Obrigação",
  bank_transaction: "Transação bancária",
};

function currentBelemDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Sem data";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { message?: unknown; error?: { message?: unknown } | string };
  if (typeof value.error === "string") return value.error;
  if (typeof value.error?.message === "string") return value.error.message;
  if (typeof value.message === "string") return value.message;
  return fallback;
}

function Kpi({ label, valueCents, detail, tone, icon: Icon }: {
  label: string;
  valueCents: number | null;
  detail: string;
  tone: "neutral" | "positive" | "negative" | "warning";
  icon: typeof Wallet;
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-white text-slate-950",
    positive: "border-emerald-200 bg-emerald-50/60 text-emerald-700",
    negative: "border-rose-200 bg-rose-50/60 text-rose-700",
    warning: "border-amber-200 bg-amber-50/60 text-amber-700",
  }[tone];
  return (
    <Card className={cn("rounded-2xl shadow-sm", toneClass)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4" />
      </CardHeader>
      <CardContent>
        <p className="font-mono text-xl font-bold tracking-tight">{valueCents === null ? "Indisponível" : formatBRL(valueCents)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function CashFlowPage() {
  const { firebaseUser, isDefaultAdmin, permissions, user } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const [asOf, setAsOf] = useState(currentBelemDate);
  const [scopeValue, setScopeValue] = useState("consolidated");
  const [statusFilter, setStatusFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [chartMode, setChartMode] = useState<ChartMode>("weekly");
  const [projection, setProjection] = useState<CashFlowProjectionResponse | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<CashFlowOpeningBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const canView = permissions.financial?.view === true
    && Boolean(permissions.financial?.cashFlow?.view || permissions.financial?.financialFlow);
  const authorizedUnits = useMemo(
    () => filterUnitsByAccess(kiosks, user ?? {}, { isDefaultAdmin }),
    [isDefaultAdmin, kiosks, user],
  );

  const load = useCallback(async () => {
    if (!firebaseUser || !canView) return;
    setLoading(true);
    try {
      const [scope, scopeId] = scopeValue.split(":", 2);
      const params = new URLSearchParams({ asOf, days: "91", scope });
      if (scopeId) params.set("scopeId", scopeId);
      const response = await fetch(`/api/financial/cash-flow/projection?${params}`, {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(payload, "Não foi possível carregar a projeção."));
      const next = payload as CashFlowProjectionResponse;
      setProjection(next);
      setKnownAccounts((current) => {
        const byId = new Map(current.map((account) => [account.accountId, account]));
        next.openingBalances.forEach((account) => byId.set(account.accountId, account));
        return [...byId.values()].sort((left, right) => left.accountName.localeCompare(right.accountName));
      });
    } catch (error) {
      setProjection(null);
      toast({
        variant: "destructive",
        title: "Não foi possível carregar o fluxo de caixa.",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [asOf, canView, firebaseUser, scopeValue, toast]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const filteredItems = useMemo(() => (projection?.items ?? []).filter((item) => (
    (statusFilter === "all" || item.status === statusFilter)
    && (directionFilter === "all" || item.direction === directionFilter)
  )), [directionFilter, projection?.items, statusFilter]);

  const totals = useMemo(() => {
    const items = projection?.items ?? [];
    return {
      incomingCents: items.filter((item) => item.direction === "in").reduce((sum, item) => sum + item.amountCents, 0),
      outgoingCents: items.filter((item) => item.direction === "out").reduce((sum, item) => sum + item.amountCents, 0),
      closingBalanceCents: projection?.daily.at(-1)?.closingBalanceCents ?? null,
    };
  }, [projection]);

  const chartData = useMemo(() => {
    const daily = projection?.daily ?? [];
    if (chartMode === "daily") {
      return daily.map((day) => ({
        label: formatDate(day.date).slice(0, 5),
        incomingCents: day.incomingCents,
        outgoingCents: day.outgoingCents,
        closingBalanceCents: day.closingBalanceCents,
      }));
    }
    const weeks: Array<{
      label: string;
      incomingCents: number;
      outgoingCents: number;
      closingBalanceCents: number | null;
    }> = [];
    for (let index = 0; index < daily.length; index += 7) {
      const slice = daily.slice(index, index + 7);
      const first = slice[0];
      const last = slice.at(-1);
      if (!first || !last) continue;
      weeks.push({
        label: `${formatDate(first.date).slice(0, 5)}–${formatDate(last.date).slice(0, 5)}`,
        incomingCents: slice.reduce((sum, day) => sum + day.incomingCents, 0),
        outgoingCents: slice.reduce((sum, day) => sum + day.outgoingCents, 0),
        closingBalanceCents: last.closingBalanceCents,
      });
    }
    return weeks;
  }, [chartMode, projection?.daily]);

  function exportCsv() {
    if (filteredItems.length === 0) return;
    const rows = [
      ["Data projetada", "Data original", "Status", "Origem", "Descrição", "Direção", "Valor (centavos)", "Conta", "Unidades", "ID da origem", "Revisão", "Hash"],
      ...filteredItems.map((item) => [
        item.projectionDate ?? "",
        item.originalExpectedDate ?? "",
        STATUS_LABELS[item.status],
        SOURCE_LABELS[item.sourceType],
        item.description,
        item.direction,
        String(item.amountCents),
        item.accountId ?? "",
        item.kioskIds.join("|"),
        item.sourceId,
        item.sourceRevision ?? "",
        item.sourceHash ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `fluxo-de-caixa-${asOf}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  if (!canView) {
    return <FinancialAccessGuard title="Fluxo de caixa" description="Seu perfil não possui permissão para consultar o fluxo de caixa." />;
  }

  return (
    <PageContainer variant="wide" className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fluxo de caixa</h1>
          <p className="text-muted-foreground">Projeção contratada dos próximos 91 dias, sem estimar vendas que ainda não aconteceram.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={scopeValue} onValueChange={setScopeValue}>
            <SelectTrigger className="w-56"><Wallet className="mr-2 h-3.5 w-3.5" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="consolidated">Consolidado</SelectItem>
              {knownAccounts.map((account) => <SelectItem key={account.accountId} value={`account:${account.accountId}`}>Conta · {account.accountName}</SelectItem>)}
              {authorizedUnits.map((unit) => <SelectItem key={unit.id} value={`unit:${unit.id}`}>Unidade · {unit.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <CalendarRange className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Data inicial da projeção" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} className="w-44 pl-9" />
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} /> Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filteredItems.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
          {permissions.financial?.cashFlow?.create && <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Novo lançamento</Button>}
        </div>
      </div>

      {!loading && projection && !projection.balanceComplete && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Saldo projetado indisponível</AlertTitle>
          <AlertDescription>{projection.balanceIncompleteReason} Entradas e saídas continuam visíveis, mas o sistema não presume saldo inicial zero.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Saldo inicial" valueCents={projection?.openingBalanceCents ?? null} detail={projection?.openingBalances.length ? `${projection.openingBalances.length} conta(s) no escopo` : "Sem saldo confirmado"} tone="neutral" icon={Wallet} />
        <Kpi label="Entradas conhecidas" valueCents={projection ? totals.incomingCents : null} detail="Recebíveis e entradas realizadas" tone="positive" icon={TrendingUp} />
        <Kpi label="Saídas conhecidas" valueCents={projection ? totals.outgoingCents : null} detail="Obrigações e saídas realizadas" tone="negative" icon={TrendingDown} />
        <Kpi label="Menor saldo" valueCents={projection?.minimumBalanceDay?.closingBalanceCents ?? null} detail={projection?.minimumBalanceDay ? formatDate(projection.minimumBalanceDay.date) : "Depende do saldo confirmado"} tone={(projection?.minimumBalanceDay?.closingBalanceCents ?? 0) < 0 ? "negative" : "warning"} icon={CircleDollarSign} />
        <Kpi label="Saldo em 91 dias" valueCents={projection ? totals.closingBalanceCents : null} detail={projection?.firstNegativeDay ? `Primeiro negativo em ${formatDate(projection.firstNegativeDay.date)}` : "Sem saldo negativo conhecido"} tone={(totals.closingBalanceCents ?? 0) < 0 ? "negative" : "positive"} icon={Wallet} />
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>Entradas, saídas e saldo</CardTitle>
            <CardDescription>{projection ? `${formatDate(projection.asOf)} a ${formatDate(projection.endDate)}` : "Janela de 91 dias"}</CardDescription>
          </div>
          <Select value={chartMode} onValueChange={(value) => setChartMode(value as ChartMode)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="daily">Diário</SelectItem><SelectItem value="weekly">Semanal</SelectItem></SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <div className="h-[340px] w-full">
            {loading ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 8, bottom: chartMode === "daily" ? 36 : 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.12} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} angle={chartMode === "daily" ? -45 : 0} textAnchor={chartMode === "daily" ? "end" : "middle"} interval={chartMode === "daily" ? 6 : 0} />
                  <YAxis tickLine={false} axisLine={false} fontSize={10} tickFormatter={(value) => `R$${Math.round(Number(value) / 100_000)}k`} />
                  <Tooltip formatter={(value: number) => formatBRL(value)} />
                  <Legend />
                  <Bar dataKey="incomingCents" name="Entradas" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outgoingCents" name="Saídas" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="closingBalanceCents" name="Saldo" stroke="#6366f1" strokeWidth={3} dot={chartMode === "weekly"} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>Agenda conhecida</CardTitle>
            <CardDescription>{projection ? `${projection.items.length} item(ns) datado(s) e ${projection.unprogrammedItems.length} sem data · atualização ${new Date(projection.generatedAt).toLocaleString("pt-BR")}` : "Recebíveis, obrigações e movimentos realizados sem dupla contagem de transferências internas."}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os estados</SelectItem>
                <SelectItem value="scheduled">Programados</SelectItem>
                <SelectItem value="overdue">Vencidos</SelectItem>
                <SelectItem value="realized">Realizados</SelectItem>
                <SelectItem value="unprogrammed">Sem data</SelectItem>
              </SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={setDirectionFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Entradas e saídas</SelectItem><SelectItem value="in">Entradas</SelectItem><SelectItem value="out">Saídas</SelectItem></SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-56 w-full" /> : filteredItems.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">Nenhum item encontrado para os filtros selecionados.</div>
          ) : (
            <div className="divide-y rounded-xl border">
              {filteredItems.slice(0, 100).map((item) => (
                <div key={item.id} className="grid gap-3 px-4 py-3 md:grid-cols-[105px_minmax(0,1fr)_140px_140px] md:items-center">
                  <div>
                    <p className="text-xs font-semibold">{formatDate(item.projectionDate)}</p>
                    {item.originalExpectedDate && item.originalExpectedDate !== item.currentExpectedDate && <p className="text-[10px] text-muted-foreground">Original {formatDate(item.originalExpectedDate)}</p>}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.description}</p>
                    <p className="truncate text-xs text-muted-foreground">{SOURCE_LABELS[item.sourceType]} · {item.accountId || "Conta não definida"}{item.kioskIds.length ? ` · ${item.kioskIds.join(", ")}` : ""}</p>
                  </div>
                  <Badge variant="outline" className={cn(
                    "w-fit",
                    item.status === "realized" && "border-emerald-200 bg-emerald-50 text-emerald-700",
                    item.status === "overdue" && "border-rose-200 bg-rose-50 text-rose-700",
                    item.status === "scheduled" && "border-blue-200 bg-blue-50 text-blue-700",
                    item.status === "unprogrammed" && "border-amber-200 bg-amber-50 text-amber-700",
                  )}>{STATUS_LABELS[item.status]}</Badge>
                  <span className={cn("text-right font-mono text-sm font-bold", item.direction === "in" ? "text-emerald-600" : "text-rose-600")}>{item.direction === "in" ? "+" : "-"}{formatBRL(item.amountCents)}</span>
                </div>
              ))}
              {filteredItems.length > 100 && <p className="px-4 py-3 text-center text-xs text-muted-foreground">Exibindo 100 de {filteredItems.length} itens. Use a exportação para consultar todos.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {projection && (
        <p className="text-xs text-muted-foreground">
          Cobertura da consulta: {projection.cutoffs.receivables} recebíveis, {projection.cutoffs.obligations} obrigações, {projection.cutoffs.paymentRequests} solicitações e {projection.cutoffs.transactions} transações. Vendas futuras ainda não realizadas não fazem parte desta projeção.
        </p>
      )}

      {permissions.financial?.cashFlow?.create && dialogOpen && <NewTransactionDialog open={dialogOpen} onOpenChange={setDialogOpen} onSuccess={() => void load()} />}
    </PageContainer>
  );
}
