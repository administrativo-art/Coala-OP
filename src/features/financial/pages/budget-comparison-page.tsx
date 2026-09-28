"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FinancialAccessGuard } from "../components/financial-access-guard";
import { BudgetDetails } from "../components/settings/budget-details";
import { budgetRequest } from "../components/settings/budget-api";
import { budgetComparisonTotals, canViewBudgetComparison } from "../budgets/comparison";
import type { FinancialBudgetSummary } from "../budgets/types";
import { FINANCIAL_ROUTES } from "../lib/constants";
import { financialDateKey } from "../lib/financial-dates";
import { formatCurrency } from "../lib/utils";

export function BudgetComparisonPage() {
  const { permissions, isDefaultAdmin } = useAuth();
  return canViewBudgetComparison(permissions, isDefaultAdmin) ? <BudgetComparisonContent />
    : <FinancialAccessGuard title="Orçamento × despesas" description="Seu perfil precisa de acesso à consulta de orçamentos pelo fluxo de caixa ou pelas configurações financeiras." />;
}

function BudgetComparisonContent() {
  const { permissions, isDefaultAdmin } = useAuth();
  const params = useSearchParams();
  const initialMonth = params.get("month") ?? "";
  const [month, setMonth] = useState(/^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth) ? initialMonth : financialDateKey(new Date())!.slice(0, 7));
  const [centers, setCenters] = useState<Array<{ id: string; name: string }>>([]);
  const [center, setCenter] = useState("");
  const [allUnits, setAllUnits] = useState(false);
  const [ready, setReady] = useState(false);
  const [budgets, setBudgets] = useState<FinancialBudgetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const scope = `${month}:${center}`;
  const requestVersion = useRef(0);
  const canViewPersonnel = isDefaultAdmin || Boolean(permissions.financial?.view && permissions.financial.personnelCosts?.view);
  const canViewExpenses = isDefaultAdmin || Boolean(permissions.financial?.view && permissions.financial.expenses?.view);

  useEffect(() => {
    let live = true;
    void budgetRequest<{ centers: Array<{ id: string; name: string }>; allUnits: boolean }>("/api/financial/budgets/centers")
      .then((result) => { if (live) { setCenters(result.centers); setAllUnits(result.allUnits); setCenter(result.allUnits ? "all" : result.centers[0]?.id ?? ""); setReady(true); } })
      .catch(() => { if (live) { setCatalogError("Não foi possível carregar os centros autorizados. Reabra esta página para tentar novamente."); setLoading(false); } });
    return () => { live = false; };
  }, []);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!ready || !center || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { setBudgets([]); setLoading(!ready); return; }
    setLoading(true); setError(null);
    try {
      const response = await budgetRequest<{ budgets: FinancialBudgetSummary[] }>(`/api/financial/budgets?month=${month}${center === "all" ? "" : `&resultCenterId=${encodeURIComponent(center)}`}`);
      if (version === requestVersion.current) { setBudgets(response.budgets); setLoadedScope(scope); }
    } catch (cause) { if (version === requestVersion.current) { setBudgets([]); setError(cause instanceof Error ? cause.message : "Não foi possível consultar a comparação."); } }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [ready, center, month, scope]);
  useEffect(() => { void refresh(); return () => { requestVersion.current++; }; }, [refresh]);
  const visible = loadedScope === scope && !loading ? budgets.filter((budget) => budget.active) : [];
  const totals = budgetComparisonTotals(visible);

  const expensesHref = `${FINANCIAL_ROUTES.expenses}?competence=${month}`;

  return <PageContainer variant="wide" surface className="space-y-6 pb-10">
    <PageHeader
      title="Orçamento × despesas"
      description="Compare o planejamento com os boletos e despesas da mesma competência."
      back={{ fallbackHref: expensesHref, parentLabel: "Despesas" }}
    />
    <div className="grid gap-4 rounded-[18px] border border-[#e3e1dc] bg-white p-4 shadow-sm sm:grid-cols-[176px_minmax(240px,360px)_auto] sm:items-end">
      <div className="space-y-1.5"><Label htmlFor="comparison-month" className="text-[13px] font-bold">Competência</Label><Input id="comparison-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 w-full rounded-[11px]" /></div>
      <div className="space-y-1.5"><Label htmlFor="comparison-center" className="text-[13px] font-bold">Centro de custo</Label><Select value={center} onValueChange={setCenter}><SelectTrigger id="comparison-center" className="h-10 rounded-[11px]"><SelectValue placeholder="Selecione um centro" /></SelectTrigger><SelectContent>
        {allUnits && <SelectItem value="all">Todos os centros</SelectItem>}{centers.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
      </SelectContent></Select></div>
      <Button className="h-10 rounded-[11px] px-4 text-[13px] font-extrabold sm:justify-self-start" variant="outline" disabled={loading || !ready || !center} onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
    </div>
    {(error || catalogError) && <p role="alert" className="rounded-[14px] border border-red-200 bg-red-50 p-4 text-red-700">{catalogError || error}</p>}
    {loading && !catalogError ? <p role="status">Carregando comparação…</p> : !error && !catalogError && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Previsto no orçamento", totals.planned], ["Valor em despesas", totals.committed], ["Diferença orçamentária", totals.difference], ["Compra ainda esperada", totals.expected],
      ].map(([label, value]) => <Card key={String(label)} className="rounded-[18px] border-[#e3e1dc] shadow-sm"><CardContent className="p-4"><p className="text-[13px] font-bold text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl font-semibold">{typeof value === "number" ? formatCurrency(value / 100) : "Não definida"}</p></CardContent></Card>)}</div>
      <p className="rounded-[14px] bg-white/60 px-4 py-3 text-sm text-muted-foreground">{totals.documentCount} documento(s) distinto(s). O valor em despesas considera boletos abertos e pagos; pagar não soma esse valor novamente. A compra ainda esperada considera os encerramentos confirmados.</p>
      {!visible.length && <p className="rounded-[18px] border border-[#e3e1dc] bg-white p-10 text-center text-muted-foreground shadow-sm">{ready && !center ? "Nenhum centro autorizado disponível." : "Nenhum orçamento ativo nesta competência e centro."}</p>}
      {visible.map((budget) => <Card key={budget.id} className="rounded-[18px] border-[#e3e1dc] shadow-sm"><CardHeader><CardTitle className="text-base font-bold">{budget.name}</CardTitle><p className="text-sm text-muted-foreground">{budget.resultCenterName || "Todos os centros"}</p></CardHeader><CardContent>
        <div className="grid gap-3 sm:grid-cols-3">{[["Previsto", budget.budgetedAmountCents], ["Valor em despesas", budget.consumedAmountCents], ["Diferença", budget.balanceAmountCents]].map(([label, value]) => <div key={String(label)}><p className="text-xs text-muted-foreground">{label}</p><strong className="font-mono">{formatCurrency(Number(value) / 100)}</strong></div>)}</div>
        {budget.issues.length > 0 && <p role="status" className="mt-3 text-sm text-amber-700">{budget.issues.join(" ")}</p>}
        <BudgetDetails budget={budget} accounts={[]} canManage={false} canViewPersonnel={canViewPersonnel} canEditPersonnel={false} canViewExpenses={canViewExpenses} defaultOpen onSaved={refresh} />
      </CardContent></Card>)}
    </>}
  </PageContainer>;
}
