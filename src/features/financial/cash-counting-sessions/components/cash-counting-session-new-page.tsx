"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Loader2, Store, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { PageContainer } from "@/components/layout/page-container";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatClosureMonthLabel } from "@/features/financial/cash-closures/date";
import type { CashCountingSession } from "../types";
import {
  CASH_COUNTING_MAX_SCOPES,
  CASH_COUNTING_MAX_YEAR,
  CASH_COUNTING_MIN_YEAR,
  CASH_COUNTING_MONTHS,
  cashCountingPeriodKey,
  cashCountingPeriodLimit,
  toggleCashCountingPeriod,
} from "../period-selection";
import { CashControlNavigation } from "@/features/financial/cash-closures/components/cash-control-navigation";

type Unit = { id: string; name: string; pdvFilialId: string | null };

function currentMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Belem", year: "numeric", month: "2-digit" })
    .formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

export function CashCountingSessionNewPage() {
  const router = useRouter();
  const { firebaseUser, permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [periods, setPeriods] = useState([currentMonthKey()]);
  const [selectorYear, setSelectorYear] = useState(() => Number(currentMonthKey().slice(0, 4)));
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    void api<{ units?: Unit[] }>("/api/financial/cash-closures/overview", { fallbackError: "Falha ao carregar unidades." })
      .then((payload) => { if (active) setUnits(payload.units ?? []); })
      .catch((error) => toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar unidades." }))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, firebaseUser, toast]);

  const selectedPeriods = useMemo(() => Array.from(new Set(periods)).sort(), [periods]);
  const periodLimit = cashCountingPeriodLimit(selectedUnits.length);
  const scopeCount = selectedUnits.length * selectedPeriods.length;

  async function createSession() {
    setWorking(true);
    try {
      const payload = await api<{ session: CashCountingSession }>("/api/financial/cash-counting-sessions", {
        method: "POST",
        json: {
          kioskIds: selectedUnits,
          periods: selectedPeriods.map((period) => {
            const [year, month] = period.split("-").map(Number);
            return { year, month };
          }),
        },
      });
      router.push(`/dashboard/financial/cash-closures/sessions/${payload.session.id}`);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao abrir sessão." });
    } finally {
      setWorking(false);
    }
  }

  if (!permissions.financial?.cashClosures?.approve) return null;
  return <PageContainer variant="compact" className="space-y-5 pb-10">
    <CashControlNavigation active="closures" crumbs={[
      { label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" },
      { label: "Nova sessão" },
    ]} />
    <div className="flex items-start justify-between gap-4">
      <div><h1 className="text-3xl font-black tracking-tight">Abrir sessão de contagem</h1><p className="mt-1.5 text-sm font-medium text-zinc-500">Escolha as unidades e competências dos malotes que serão conferidos juntos.</p></div>
      <Button asChild variant="outline" className="rounded-xl"><Link href="/dashboard/financial/cash-closures"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
    </div>

    <Card className="rounded-2xl border-stone-200">
      <CardHeader><CardTitle className="text-lg">1. Unidades</CardTitle></CardHeader>
      <CardContent>{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <div className="grid gap-3 sm:grid-cols-2">{units.map((unit) => {
        const checked = selectedUnits.includes(unit.id);
        return <label key={unit.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-stone-200 p-3.5 transition-colors hover:border-pink-300">
          <Checkbox checked={checked} onCheckedChange={(next) => setSelectedUnits((current) => next ? [...current, unit.id] : current.filter((id) => id !== unit.id))} />
          <Store className="h-4 w-4 text-pink-600" />
          <span className="min-w-0"><strong className="block truncate text-sm">{unit.name}</strong><span className="text-xs text-zinc-400">Filial PDV {unit.pdvFilialId ?? "não configurada"}</span></span>
        </label>;
      })}</div>}</CardContent>
    </Card>

    <Card className="rounded-2xl border-stone-200">
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-lg">2. Competências</CardTitle>
          <p className="mt-1 text-sm text-zinc-500">Marque até {periodLimit} {periodLimit === 1 ? "mês" : "meses"} para as unidades selecionadas.</p>
        </div>
        <span className="w-fit rounded-full bg-pink-50 px-3 py-1 text-xs font-black text-pink-700">
          {selectedPeriods.length}/{periodLimit} selecionadas
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3 sm:p-4">
          <div className="mb-4 flex items-center justify-between">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="rounded-xl bg-white"
              aria-label="Ano anterior"
              disabled={selectorYear <= CASH_COUNTING_MIN_YEAR}
              onClick={() => setSelectorYear((year) => Math.max(CASH_COUNTING_MIN_YEAR, year - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <strong className="text-base font-black">{selectorYear}</strong>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="rounded-xl bg-white"
              aria-label="Próximo ano"
              disabled={selectorYear >= CASH_COUNTING_MAX_YEAR}
              onClick={() => setSelectorYear((year) => Math.min(CASH_COUNTING_MAX_YEAR, year + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label={`Meses de ${selectorYear}`}>
            {CASH_COUNTING_MONTHS.map((monthLabel, monthIndex) => {
              const period = cashCountingPeriodKey(selectorYear, monthIndex + 1);
              const selected = selectedPeriods.includes(period);
              return <Button
                key={period}
                type="button"
                variant="outline"
                aria-pressed={selected}
                disabled={!selected && selectedPeriods.length >= periodLimit}
                className={cn(
                  "relative h-11 rounded-xl bg-white px-2 font-bold",
                  selected && "border-pink-600 bg-pink-50 text-pink-700 hover:bg-pink-100 hover:text-pink-800",
                )}
                onClick={() => setPeriods((current) => toggleCashCountingPeriod(current, period, periodLimit))}
              >
                {selected && <Check className="mr-1.5 h-4 w-4" />}
                {monthLabel}
              </Button>;
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-black uppercase tracking-wide text-zinc-400">Meses selecionados</p>
            {selectedPeriods.length > 0 && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-zinc-500" onClick={() => setPeriods([])}>Limpar</Button>}
          </div>
          {selectedPeriods.length > 0 ? <div className="flex flex-wrap gap-2">
            {selectedPeriods.map((period) => {
              const [year, month] = period.split("-").map(Number);
              const label = formatClosureMonthLabel(year, month);
              return <button
                key={period}
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50 px-3 text-xs font-bold text-pink-800 transition-colors hover:bg-pink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2"
                aria-label={`Remover ${label}`}
                onClick={() => setPeriods((current) => toggleCashCountingPeriod(current, period, periodLimit))}
              >
                {label}<X className="h-3.5 w-3.5" />
              </button>;
            })}
          </div> : <p className="rounded-xl border border-dashed border-stone-300 px-4 py-3 text-sm text-zinc-500">Selecione pelo menos um mês no calendário acima.</p>}
        </div>

        <div className={cn(
          "rounded-xl border px-4 py-3 text-sm",
          scopeCount > CASH_COUNTING_MAX_SCOPES ? "border-rose-200 bg-rose-50 text-rose-800" : "border-stone-200 bg-white text-zinc-600",
        )}>
          {selectedUnits.length === 0
            ? `Selecione as unidades para calcular o total de combinações. O limite da sessão é ${CASH_COUNTING_MAX_SCOPES}.`
            : <><strong>{selectedUnits.length} {selectedUnits.length === 1 ? "unidade" : "unidades"} × {selectedPeriods.length} {selectedPeriods.length === 1 ? "competência" : "competências"} = {scopeCount} combinações.</strong> Limite: {CASH_COUNTING_MAX_SCOPES}.</>}
        </div>
      </CardContent>
    </Card>

    <div className="flex justify-end"><Button className="h-11 rounded-xl bg-pink-600 px-6 font-bold hover:bg-pink-700" disabled={working || selectedUnits.length === 0 || selectedPeriods.length === 0 || scopeCount > CASH_COUNTING_MAX_SCOPES} onClick={() => void createSession()}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Abrir sessão</Button></div>
  </PageContainer>;
}
