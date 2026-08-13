"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, Download, LayoutDashboard, Table2 } from "lucide-react";
import { addMonths, format, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { financialCollection } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { expenseValueForResultCenter } from "@/features/financial/lib/expense-rateio";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { db } from "@/lib/firebase";
import type { SalesReport } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ── helpers ──────────────────────────────────────────────────────────────────

function pct(value: number, base: number) {
  if (base <= 0) return "—";
  return `${((value / base) * 100).toFixed(1)}%`;
}

function KpiCard({ label, value, sub, color = "" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export function DrePage() {
  const { permissions } = useAuth();
  const { kiosks } = useKiosks();

  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [unitFilter, setUnitFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"dashboard" | "classic">("dashboard");

  const { data: transactions, loading: loadingTx } = useFinancialCollection<any>(financialCollection("transactions"));
  const { data: expenses, loading: loadingExp } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: accounts } = useFinancialCollection<any>(financialCollection("accounts"));

  const [salesReports, setSalesReports] = useState<SalesReport[]>([]);
  const [simulationCmvMap, setSimulationCmvMap] = useState<Record<string, number>>({});
  const [loadingCmv, setLoadingCmv] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [salesSnap, simSnap] = await Promise.all([
          getDocs(collection(db, "salesReports")),
          getDocs(collection(db, "productSimulations")),
        ]);
        if (cancelled) return;
        setSalesReports(salesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SalesReport)));
        const map: Record<string, number> = {};
        simSnap.docs.forEach((d) => { map[d.id] = (d.data() as any).totalCmv || 0; });
        setSimulationCmvMap(map);
      } finally {
        if (!cancelled) setLoadingCmv(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const loading = loadingTx || loadingExp || loadingCmv;

  if (!permissions.financial?.dre) {
    return <FinancialAccessGuard title="DRE" description="Seu perfil não possui permissão para acessar o demonstrativo de resultado." />;
  }

  // ── derived maps ────────────────────────────────────────────────────────────

  const kioskNameById = useMemo(() => {
    const m: Record<string, string> = {};
    kiosks.forEach((k) => { m[k.id] = k.name; });
    return m;
  }, [kiosks]);

  // accountId → dre_position (flat, no inheritance needed)
  const accountDrePosMap = useMemo(() => {
    const m: Record<string, string | null> = {};
    (accounts || []).forEach((a: any) => { m[a.id] = a.dre_position ?? null; });
    return m;
  }, [accounts]);

  // accountId → is_dre_account (false = patrimonial: never appears in DRE, not even as "Não classificado")
  const accountIsDreMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    (accounts || []).forEach((a: any) => { m[a.id] = a.is_dre_account !== false; });
    return m;
  }, [accounts]);

  const selectedUnitName = unitFilter === "all" ? null : (kioskNameById[unitFilter] ?? null);
  const selectedKioskId = unitFilter === "all" ? null : unitFilter;

  // ── computation helpers ─────────────────────────────────────────────────────

  function matchesUnit(exp: any): boolean {
    return expenseValueForResultCenter(exp, selectedUnitName) > 0;
  }

  function getRevenue(monthKey: string): number {
    return (transactions || []).reduce((sum: number, tx: any) => {
      if (tx.direction !== "in" || tx.type === "transfer_in") return sum;
      const d = toDate(tx.date);
      if (!d || format(d, "yyyy-MM") !== monthKey) return sum;
      if (selectedUnitName && tx.resultCenterName !== selectedUnitName) return sum;
      return sum + (tx.amount || 0);
    }, 0);
  }

  function getCmv(monthKey: string): number {
    const [y, m] = monthKey.split("-").map(Number);
    return salesReports.reduce((sum, r) => {
      if (r.year !== y || r.month !== m) return sum;
      if (selectedKioskId && r.kioskId !== selectedKioskId) return sum;
      return sum + r.items.reduce((s, i) => s + i.quantity * (simulationCmvMap[i.simulationId] || 0), 0);
    }, 0);
  }

  function getExpensesByDrePos(pos: string | null, monthKey: string): number {
    return (expenses || []).reduce((sum: number, exp: any) => {
      if (exp.status !== "paid") return sum;
      const d = toDate(exp.paidAt);
      if (!d || format(d, "yyyy-MM") !== monthKey) return sum;
      if (!matchesUnit(exp)) return sum;
      const accountKey = exp.accountId ?? exp.accountPlan;
      // Contas patrimoniais (is_dre_account: false) nunca entram na DRE, nem em "Não classificado"
      if (accountIsDreMap[accountKey] === false) return sum;
      const p = accountDrePosMap[accountKey] ?? null;
      if (p !== pos) return sum;
      return sum + expenseValueForResultCenter(exp, selectedUnitName);
    }, 0);
  }

  function getDreMetrics(monthKey: string) {
    const revBruta = getRevenue(monthKey);
    const impostos = getExpensesByDrePos("impostos_deducoes", monthKey);
    const recLiq = revBruta - impostos;

    const cmv = getCmv(monthKey);
    const margBruta = recLiq - cmv;

    const custVar = getExpensesByDrePos("custos_variaveis", monthKey);
    const margContr = margBruta - custVar;

    const pessoal = getExpensesByDrePos("pessoal", monthKey);
    const despOp = getExpensesByDrePos("despesas_operacionais", monthKey);
    const ocupacao = getExpensesByDrePos("ocupacao", monthKey);
    const semCategoria = getExpensesByDrePos(null, monthKey);
    const totalFixos = pessoal + despOp + ocupacao + semCategoria;
    const resOp = margContr - totalFixos;

    const recFin = getExpensesByDrePos("receita_financeira", monthKey);
    const despFin = getExpensesByDrePos("despesas_financeiras", monthKey);
    const recNaoOp = getExpensesByDrePos("receita_nao_operacional", monthKey);
    const despNaoOp = getExpensesByDrePos("despesa_nao_operacional", monthKey);
    const lair = resOp + recFin - despFin + recNaoOp - despNaoOp;
    const irCsll = getExpensesByDrePos("impostos_resultado", monthKey);
    const lucroLiq = lair - irCsll;

    const margContPct = recLiq > 0 ? margContr / recLiq : 0;
    const pe = margContPct > 0 ? totalFixos / margContPct : 0;

    return { revBruta, impostos, recLiq, cmv, custVar, margBruta, margContr, pessoal, despOp, ocupacao, semCategoria, totalFixos, resOp, recFin, despFin, recNaoOp, despNaoOp, lair, irCsll, lucroLiq, pe, margContPct };
  }

  // ── per-month data ───────────────────────────────────────────────────────────

  const chartMonthKeys = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const end = new Date(y, m - 1, 1);
    return Array.from({ length: 6 }, (_, i) => format(subMonths(end, 5 - i), "yyyy-MM"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  const chartData = useMemo(() => {
    return chartMonthKeys.map((key) => {
      const { revBruta, cmv, margBruta, margContr, resOp, lucroLiq, totalFixos } = getDreMetrics(key);
      const [y, m] = key.split("-").map(Number);
      return {
        month: format(new Date(y, m - 1, 1), "MMM/yy", { locale: ptBR }),
        receita: revBruta,
        cmv,
        margBruta,
        despesas: totalFixos,
        resultado: lucroLiq,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartMonthKeys, transactions, expenses, salesReports, simulationCmvMap, selectedUnitName, selectedKioskId, accountDrePosMap, accountIsDreMap]);

  const metrics = useMemo(
    () => getDreMetrics(selectedMonth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMonth, transactions, expenses, salesReports, simulationCmvMap, selectedUnitName, selectedKioskId, accountDrePosMap, accountIsDreMap]
  );

  const accountNameById = useMemo(() => {
    const m: Record<string, string> = {};
    (accounts || []).forEach((a: any) => { m[a.id] = a.name; });
    return m;
  }, [accounts]);

  const topExpensePlans = useMemo(() => {
    const totals: Record<string, number> = {};
    (expenses || []).forEach((exp: any) => {
      if (exp.status === "cancelled" || exp.status === "draft") return;
      const d = toDate(exp.dueDate || exp.createdAt);
      if (d && format(d, "yyyy-MM") !== selectedMonth) return;
      if (!matchesUnit(exp)) return;
      const name = accountNameById[exp.accountId ?? exp.accountPlan] || exp.accountPlanName || "Sem classificação";
      totals[name] = (totals[name] || 0) + expenseValueForResultCenter(exp, selectedUnitName);
    });
    return Object.entries(totals).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, accountNameById, selectedMonth, selectedUnitName]);

  const cmvByUnit = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const map: Record<string, number> = {};
    salesReports.forEach((r) => {
      if (r.year !== y || r.month !== m) return;
      const v = r.items.reduce((s, i) => s + i.quantity * (simulationCmvMap[i.simulationId] || 0), 0);
      map[r.kioskId] = (map[r.kioskId] || 0) + v;
    });
    return Object.entries(map).map(([kioskId, cmv]) => ({ kioskId, name: kioskNameById[kioskId] || kioskId, cmv })).filter((r) => r.cmv > 0).sort((a, b) => b.cmv - a.cmv);
  }, [salesReports, simulationCmvMap, selectedMonth, kioskNameById]);

  const hasDreCategories = useMemo(
    () => (accounts || []).length > 0,
    [accounts]
  );

  // ── navigation ──────────────────────────────────────────────────────────────

  function navigateMonth(delta: number) {
    const [y, m] = selectedMonth.split("-").map(Number);
    setSelectedMonth(format(addMonths(new Date(y, m - 1, 1), delta), "yyyy-MM"));
  }

  const selectedMonthLabel = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    return format(new Date(y, m - 1, 1), "MMMM 'de' yyyy", { locale: ptBR });
  }, [selectedMonth]);

  const isFutureMonth = selectedMonth >= format(addMonths(new Date(), 1), "yyyy-MM");

  // ── export ───────────────────────────────────────────────────────────────────

  function exportCsv() {
    const { revBruta, impostos, recLiq, cmv, custVar, margBruta, margContr, pessoal, despOp, ocupacao, semCategoria, resOp, recFin, despFin, recNaoOp, despNaoOp, lair, irCsll, lucroLiq, pe } = metrics;
    const rows = [
      ["DRE —", selectedMonthLabel, unitFilter === "all" ? "Todas as unidades" : (kioskNameById[unitFilter] ?? unitFilter)],
      [],
      ["Indicador", "Valor", "% Receita Líquida"],
      ["Receita Bruta", formatCurrency(revBruta), pct(revBruta, recLiq)],
      ["(-) Impostos e deduções", formatCurrency(impostos), pct(impostos, recLiq)],
      ["= Receita Líquida", formatCurrency(recLiq), "100%"],
      ["(-) CMV", formatCurrency(cmv), pct(cmv, recLiq)],
      ["= Margem Bruta", formatCurrency(margBruta), pct(margBruta, recLiq)],
      ["(-) Insumos e fretes de aquisição", formatCurrency(custVar), pct(custVar, recLiq)],
      ["= Margem de Contribuição", formatCurrency(margContr), pct(margContr, recLiq)],
      ["Ponto de Equilíbrio", formatCurrency(pe), ""],
      ["(-) Pessoal", formatCurrency(pessoal), pct(pessoal, recLiq)],
      ["(-) Despesas operacionais", formatCurrency(despOp), pct(despOp, recLiq)],
      ["(-) Ocupação", formatCurrency(ocupacao), pct(ocupacao, recLiq)],
      ["(-) Não classificado", formatCurrency(semCategoria), pct(semCategoria, recLiq)],
      ["= EBIT (Resultado Operacional)", formatCurrency(resOp), pct(resOp, recLiq)],
      ["(+) Receita financeira", formatCurrency(recFin), pct(recFin, recLiq)],
      ["(-) Despesas financeiras", formatCurrency(despFin), pct(despFin, recLiq)],
      ["(+) Receita não operacional", formatCurrency(recNaoOp), pct(recNaoOp, recLiq)],
      ["(-) Despesa não operacional", formatCurrency(despNaoOp), pct(despNaoOp, recLiq)],
      ["= LAIR", formatCurrency(lair), pct(lair, recLiq)],
      ["(-) IR / CSLL", formatCurrency(irCsll), pct(irCsll, recLiq)],
      ["= Lucro Líquido", formatCurrency(lucroLiq), pct(lucroLiq, recLiq)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c ?? ""}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dre-${selectedMonth}.csv`;
    a.click();
  }

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">DRE</h1>
          <p className="text-muted-foreground">Demonstrativo gerencial com CMV automático e categorização por plano de contas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Month nav */}
          <div className="flex items-center gap-1 rounded-xl border bg-background px-1 shadow-sm">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigateMonth(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
              className="w-36 bg-transparent py-1.5 text-center text-sm font-medium focus:outline-none"
            />
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigateMonth(1)} disabled={isFutureMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Unit filter */}
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as unidades</SelectItem>
              {kiosks.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* View toggle */}
          <div className="flex rounded-xl border bg-background p-1 shadow-sm">
            <button type="button" onClick={() => setViewMode("dashboard")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "dashboard" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <LayoutDashboard className="h-3.5 w-3.5" /> Resumo
            </button>
            <button type="button" onClick={() => setViewMode("classic")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "classic" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <Table2 className="h-3.5 w-3.5" /> DRE Clássica
            </button>
          </div>

          <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" /> Exportar</Button>
        </div>
      </div>

      {/* ── DASHBOARD ───────────────────────────────────────────────────────── */}
      {viewMode === "dashboard" && (
        <>
          {/* Top KPIs: monetários */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {loading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : (<>
              <KpiCard label="Receita Líquida" value={formatCurrency(metrics.recLiq)} color="text-emerald-600" />
              <KpiCard label="Margem Bruta" value={formatCurrency(metrics.margBruta)} sub={pct(metrics.margBruta, metrics.recLiq)} color="text-blue-600" />
              <KpiCard label="Margem de Contribuição" value={formatCurrency(metrics.margContr)} sub={pct(metrics.margContr, metrics.recLiq)} color="text-violet-600" />
              <KpiCard label="Resultado Operacional" value={formatCurrency(metrics.resOp)} sub={pct(metrics.resOp, metrics.recLiq)} color={metrics.resOp >= 0 ? "text-primary" : "text-rose-600"} />
              <KpiCard label="Lucro Líquido" value={formatCurrency(metrics.lucroLiq)} sub={pct(metrics.lucroLiq, metrics.recLiq)} color={metrics.lucroLiq >= 0 ? "text-emerald-700" : "text-rose-600"} />
            </>)}
          </div>

          {/* Secondary KPIs: percentuais */}
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {loading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />) : (<>
              <KpiCard label="CMV %" value={pct(metrics.cmv, metrics.recLiq)} sub={formatCurrency(metrics.cmv)} color="text-amber-600" />
              <KpiCard label="Pessoal %" value={pct(metrics.pessoal, metrics.recLiq)} sub={formatCurrency(metrics.pessoal)} color="text-blue-700" />
              <KpiCard label="Operacional %" value={pct(metrics.despOp, metrics.recLiq)} sub={formatCurrency(metrics.despOp)} color="text-purple-700" />
              <KpiCard label="Ocupação %" value={pct(metrics.ocupacao, metrics.recLiq)} sub={formatCurrency(metrics.ocupacao)} color="text-slate-700" />
              <KpiCard label="Desp. Financeiras %" value={pct(metrics.despFin, metrics.recLiq)} sub={formatCurrency(metrics.despFin)} color="text-rose-700" />
              <KpiCard label="Ponto de Equilíbrio" value={formatCurrency(metrics.pe)} sub="custos fixos / margem contr. %" color="text-orange-700" />
            </>)}
          </div>

          {/* Chart + top plans */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Evolução — últimos 6 meses</CardTitle>
                <CardDescription>Receita, CMV, despesas fixas e resultado líquido{unitFilter !== "all" ? ` · ${kioskNameById[unitFilter] ?? unitFilter}` : ""}.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  {loading ? <Skeleton className="h-full w-full" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
                        <XAxis dataKey="month" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${v / 1000}k`} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Legend />
                        <Area type="monotone" dataKey="receita" name="Receita bruta" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.1} />
                        <Area type="monotone" dataKey="cmv" name="CMV" stroke="#d97706" fill="#d97706" fillOpacity={0.1} />
                        <Area type="monotone" dataKey="despesas" name="Despesas fixas" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.1} />
                        <Area type="monotone" dataKey="resultado" name="Lucro líquido" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" fillOpacity={0.14} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top planos de despesa</CardTitle>
                <CardDescription>Provisionado em {selectedMonthLabel}.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {topExpensePlans.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
                  ) : topExpensePlans.map((row) => (
                    <div key={row.name} className="flex items-center justify-between rounded-lg border p-3">
                      <span className="max-w-[180px] truncate text-sm">{row.name}</span>
                      <span className="font-mono text-sm font-semibold">{formatCurrency(row.value)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* CMV por unidade */}
          {unitFilter === "all" && cmvByUnit.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>CMV por unidade</CardTitle>
                <CardDescription>Calculado via PDV + composição dos produtos — {selectedMonthLabel}.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {cmvByUnit.map((row) => {
                    const barWidth = metrics.cmv > 0 ? (row.cmv / metrics.cmv) * 100 : 0;
                    return (
                      <div key={row.kioskId} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{row.name}</span>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="text-xs text-muted-foreground">{pct(row.cmv, metrics.recLiq)} receita líq.</span>
                            <span className="font-mono text-sm font-semibold text-amber-700">{formatCurrency(row.cmv)}</span>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${barWidth}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── DRE CLÁSSICA ────────────────────────────────────────────────────── */}
      {viewMode === "classic" && (
        <Card>
          <CardHeader>
            <CardTitle>DRE — {selectedMonthLabel}</CardTitle>
            <CardDescription>
              {unitFilter !== "all" ? kioskNameById[unitFilter] ?? unitFilter : "Todas as unidades"}
              {!hasDreCategories && " · Mapeie os planos de contas nas configurações financeiras para categorizar automaticamente."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-2 p-6">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (() => {
              const { revBruta, impostos, recLiq, cmv, custVar, margBruta, margContr, pessoal, despOp, ocupacao, semCategoria, resOp, recFin, despFin, recNaoOp, despNaoOp, lair, irCsll, lucroLiq, pe } = metrics;

              type Row =
                | { type: "section"; label: string }
                | { type: "line"; label: string; value: number; negative?: boolean; muted?: boolean }
                | { type: "subtotal"; label: string; value: number; variant: "blue" | "violet" | "green" | "rose" | "slate" }
                | { type: "kpi"; label: string; value: string }
                | { type: "divider" };

              const rows: Row[] = [
                { type: "section", label: "RECEITA" },
                { type: "line", label: "Receita Bruta", value: revBruta },
                { type: "line", label: "(-) Impostos e deduções", value: impostos, negative: true },
                { type: "subtotal", label: "= RECEITA LÍQUIDA", value: recLiq, variant: "blue" },
                { type: "divider" },
                { type: "section", label: "CUSTO DE MERCADORIA VENDIDA" },
                { type: "line", label: "(-) CMV (PDV + composição automática)", value: cmv, negative: true },
                { type: "subtotal", label: "= MARGEM BRUTA", value: margBruta, variant: "blue" },
                { type: "kpi", label: "Margem Bruta %", value: pct(margBruta, recLiq) },
                { type: "divider" },
                { type: "section", label: "CUSTOS VARIÁVEIS" },
                { type: "line", label: "(-) Insumos e fretes de aquisição", value: custVar, negative: true },
                { type: "subtotal", label: "= MARGEM DE CONTRIBUIÇÃO", value: margContr, variant: "violet" },
                { type: "kpi", label: "Margem de Contribuição %", value: pct(margContr, recLiq) },
                { type: "kpi", label: "Ponto de Equilíbrio", value: formatCurrency(pe) },
                { type: "divider" },
                { type: "section", label: "DESPESAS OPERACIONAIS" },
                { type: "line", label: "(-) Pessoal", value: pessoal, negative: true },
                { type: "line", label: "(-) Despesas operacionais", value: despOp, negative: true },
                { type: "line", label: "(-) Ocupação", value: ocupacao, negative: true },
                ...(semCategoria > 0 ? [{ type: "line" as const, label: "(-) Não classificado", value: semCategoria, negative: true, muted: true }] : []),
                { type: "subtotal", label: "= EBIT (Resultado Operacional)", value: resOp, variant: resOp >= 0 ? "green" : "rose" },
                { type: "kpi", label: "Margem Operacional %", value: pct(resOp, recLiq) },
                { type: "divider" },
                { type: "section", label: "RESULTADO FINANCEIRO" },
                ...(recFin > 0 ? [{ type: "line" as const, label: "(+) Receita financeira", value: recFin }] : []),
                { type: "line", label: "(-) Despesas financeiras", value: despFin, negative: true },
                ...(recNaoOp > 0 ? [{ type: "line" as const, label: "(+) Receita não operacional", value: recNaoOp }] : []),
                ...(despNaoOp > 0 ? [{ type: "line" as const, label: "(-) Despesa não operacional", value: despNaoOp, negative: true }] : []),
                { type: "subtotal", label: "= LAIR", value: lair, variant: lair >= 0 ? "slate" : "rose" },
                { type: "divider" },
                { type: "section", label: "IR / CSLL" },
                { type: "line", label: "(-) IR / CSLL", value: irCsll, negative: true },
                { type: "subtotal", label: "= LUCRO LÍQUIDO", value: lucroLiq, variant: lucroLiq >= 0 ? "green" : "rose" },
                { type: "kpi", label: "Margem Líquida %", value: pct(lucroLiq, recLiq) },
              ];

              const variantClasses = {
                blue: "bg-blue-50/70 font-semibold",
                violet: "bg-violet-50/70 font-semibold",
                green: "bg-emerald-50/70 font-semibold",
                rose: "bg-rose-50/70 font-semibold",
                slate: "bg-slate-50/70 font-semibold",
              };
              const variantTextClasses = {
                blue: "text-blue-700",
                violet: "text-violet-700",
                green: "text-emerald-700",
                rose: "text-rose-700",
                slate: "text-slate-700",
              };

              return (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Descrição</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Valor</th>
                      <th className="w-24 px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">% RL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      if (row.type === "divider") return <tr key={i}><td colSpan={3} className="h-px bg-border/60" /></tr>;
                      if (row.type === "section") return (
                        <tr key={i} className="bg-muted/20">
                          <td colSpan={3} className="px-6 py-2 text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">{row.label}</td>
                        </tr>
                      );
                      if (row.type === "kpi") return (
                        <tr key={i} className="border-b border-dashed border-border/40 bg-muted/5">
                          <td className="px-6 py-2 pl-10 text-xs text-muted-foreground italic">{row.label}</td>
                          <td colSpan={2} className="px-6 py-2 text-right text-xs font-semibold text-muted-foreground">{row.value}</td>
                        </tr>
                      );
                      if (row.type === "subtotal") {
                        const isNeg = row.value < 0;
                        return (
                          <tr key={i} className={`border-b ${variantClasses[row.variant]}`}>
                            <td className={`px-6 py-3 font-semibold ${variantTextClasses[row.variant]}`}>{row.label}</td>
                            <td className={`px-6 py-3 text-right font-mono font-bold ${isNeg ? "text-rose-700" : variantTextClasses[row.variant]}`}>{formatCurrency(row.value)}</td>
                            <td className={`px-6 py-3 text-right font-medium ${variantTextClasses[row.variant]}`}>{pct(Math.abs(row.value), recLiq)}</td>
                          </tr>
                        );
                      }
                      // line
                      const valColor = row.negative ? "text-rose-600" : "text-emerald-600";
                      return (
                        <tr key={i} className={`border-b border-border/40 transition-colors hover:bg-muted/20 ${row.muted ? "opacity-60" : ""}`}>
                          <td className="px-6 py-2.5 pl-10 text-muted-foreground">{row.label}</td>
                          <td className={`px-6 py-2.5 text-right font-mono font-medium ${row.negative ? "text-rose-600" : "text-emerald-600"}`}>
                            {row.negative ? `(${formatCurrency(row.value)})` : formatCurrency(row.value)}
                          </td>
                          <td className="px-6 py-2.5 text-right text-muted-foreground">{pct(row.value, recLiq)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
