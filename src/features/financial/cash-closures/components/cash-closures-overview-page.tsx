"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useKioskGroups } from "@/hooks/use-kiosk-groups";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHero } from "@/components/patterns/page-hero";
import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";
import type { CashCountingSession } from "@/features/financial/cash-counting-sessions/types";
import { filterCashCountingSessions } from "@/features/financial/cash-counting-sessions/session-filter";
import { formatClosureMonthLabel, todayInClosureTimezone } from "../date";
import type { CashClosure, CashClosureMonthlySummary } from "../types";
import { activeSessionScopeKeys } from "../analysis";
import { CashClosuresSessionsTab } from "./cash-closures-sessions-tab";
import { CashClosuresAnalysisTab } from "./cash-closures-analysis-tab";

type UnitItem = {
  id: string;
  name: string;
  pdvFilialId: string | null;
};

type Tab = "sessions" | "analysis";
const ALL_UNITS = "__all__";
const TAB_PARAM = "aba";

/**
 * Fechamento do caixa em duas telas: Sessões de contagem (trabalho) e Análise (consulta).
 * Os filtros de regional (quando há mais de uma) e de quiosque valem para as duas telas.
 * A contagem acontece só dentro de uma sessão; a Análise não tem ação de contagem.
 */
export function CashClosuresOverviewPage() {
  const { firebaseUser, permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const { groups } = useKioskGroups();
  const canBrowseCatalog = permissions.financial?.view === true;
  const canViewClosures = permissions.financial?.cashClosures?.view === true;
  const canOpenSession = canViewClosures && permissions.financial?.cashClosures?.approve === true;

  const today = todayInClosureTimezone();
  const [todayYear, todayMonth] = today.split("-").map(Number);
  const [tab, setTab] = useState<Tab>("sessions");
  const [period, setPeriod] = useState({ year: todayYear, month: todayMonth });
  const [groupId, setGroupId] = useState<string | null>(null);
  const [kioskId, setKioskId] = useState<string>(ALL_UNITS);
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [sessions, setSessions] = useState<CashCountingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [summariesByUnit, setSummariesByUnit] = useState<Array<{ kioskId: string; summaries: CashClosureMonthlySummary[] }>>([]);
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [closuresByUnit, setClosuresByUnit] = useState<Record<string, CashClosure[]>>({});
  const [closuresLoading, setClosuresLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const effectiveTab: Tab = canViewClosures ? tab : "analysis";

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(TAB_PARAM);
    if (requested === "analise") setTab("analysis");
  }, []);

  const changeTab = useCallback((next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "analysis") url.searchParams.set(TAB_PARAM, "analise");
    else url.searchParams.delete(TAB_PARAM);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const load = useCallback(async () => {
    if (!firebaseUser || !canBrowseCatalog) return;
    setLoading(true);
    setSummariesLoading(true);
    try {
      const [unitPayload, sessionPayload] = await Promise.all([
        api<{ units?: UnitItem[] }>("/api/financial/cash-closures/overview", { fallbackError: "Falha ao carregar unidades." }),
        canViewClosures
          ? api<{ sessions?: CashCountingSession[] }>("/api/financial/cash-counting-sessions", { fallbackError: "Falha ao carregar sessões." })
          : Promise.resolve({ sessions: [] }),
      ]);
      const loadedUnits = unitPayload.units ?? [];
      setUnits(loadedUnits);
      setSessions(sessionPayload.sessions ?? []);
      setLoading(false);
      const withPdv = loadedUnits.filter((unit) => unit.pdvFilialId);
      const summaries = await Promise.all(withPdv.map(async (unit) => {
        const payload = await api<{ summaries?: CashClosureMonthlySummary[] }>(`/api/financial/cash-closures/months?kioskId=${encodeURIComponent(unit.id)}`, {
          fallbackError: "Falha ao carregar competências.",
        });
        return { kioskId: unit.id, summaries: payload.summaries ?? [] };
      }));
      setSummariesByUnit(summaries);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally {
      setLoading(false);
      setSummariesLoading(false);
    }
  }, [api, canBrowseCatalog, canViewClosures, firebaseUser, toast]);

  useEffect(() => { void load(); }, [load, reloadToken]);

  const unitGroups = useMemo(() => {
    const unitIds = new Set(units.map((unit) => unit.id));
    return groups
      .map((group) => ({ ...group, kioskIds: group.kioskIds.filter((id) => unitIds.has(id)) }))
      .filter((group) => group.kioskIds.length > 0);
  }, [groups, units]);
  const selectedGroupId = groupId ?? (unitGroups.length > 1 ? unitGroups[0].id : ALL_UNITS);
  const groupUnits = useMemo(() => {
    if (selectedGroupId === ALL_UNITS) return units;
    const group = unitGroups.find((item) => item.id === selectedGroupId);
    return group ? units.filter((unit) => group.kioskIds.includes(unit.id)) : units;
  }, [selectedGroupId, unitGroups, units]);
  // Só quiosques com PDV geram fechamento; o filtro lista apenas esses.
  const kioskOptions = useMemo(() => groupUnits.filter((unit) => unit.pdvFilialId), [groupUnits]);
  const selectedKioskId = kioskOptions.some((unit) => unit.id === kioskId) ? kioskId : ALL_UNITS;
  const scopedUnits = useMemo(
    () => (selectedKioskId === ALL_UNITS ? groupUnits : groupUnits.filter((unit) => unit.id === selectedKioskId)),
    [groupUnits, selectedKioskId],
  );
  const isScoped = selectedGroupId !== ALL_UNITS || selectedKioskId !== ALL_UNITS;
  const changeGroup = useCallback((next: string) => {
    setGroupId(next);
    setKioskId(ALL_UNITS);
  }, []);

  const scopedUnitIds = useMemo(() => new Set(scopedUnits.map((unit) => unit.id)), [scopedUnits]);
  const scopedSessions = useMemo(
    () => sessions.filter((session) => session.kioskIds.some((id) => scopedUnitIds.has(id))),
    [scopedUnitIds, sessions],
  );
  const scopedSummaries = useMemo(
    () => summariesByUnit.filter((entry) => scopedUnitIds.has(entry.kioskId)),
    [scopedUnitIds, summariesByUnit],
  );

  const scopedPdvIds = useMemo(() => scopedUnits.filter((unit) => unit.pdvFilialId).map((unit) => unit.id).join(","), [scopedUnits]);
  useEffect(() => {
    if (effectiveTab !== "analysis" || !canViewClosures || !firebaseUser || !scopedPdvIds) return;
    let cancelled = false;
    setClosuresLoading(true);
    void Promise.all(scopedPdvIds.split(",").map(async (kioskId) => {
      const params = new URLSearchParams({ kioskId, year: String(period.year), month: String(period.month) });
      const payload = await api<{ closures?: CashClosure[] }>(`/api/financial/cash-closures?${params}`, { fallbackError: "Falha ao carregar os dias do mês." });
      return [kioskId, payload.closures ?? []] as const;
    })).then((entries) => {
      if (!cancelled) setClosuresByUnit(Object.fromEntries(entries));
    }).catch((error) => {
      if (!cancelled) toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar os dias do mês." });
    }).finally(() => {
      if (!cancelled) setClosuresLoading(false);
    });
    return () => { cancelled = true; };
  }, [api, canViewClosures, effectiveTab, firebaseUser, period.month, period.year, reloadToken, scopedPdvIds, toast]);

  const activeSessions = useMemo(() => filterCashCountingSessions(scopedSessions, "active"), [scopedSessions]);
  const sessionScopeKeys = useMemo(() => activeSessionScopeKeys(activeSessions), [activeSessions]);

  function shiftMonth(delta: number) {
    const date = new Date(Date.UTC(period.year, period.month - 1 + delta, 1));
    const next = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
    if (next.year > todayYear || (next.year === todayYear && next.month > todayMonth)) return;
    setPeriod(next);
  }
  const isCurrentMonth = period.year === todayYear && period.month === todayMonth;

  if (!canBrowseCatalog) return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui acesso ao módulo financeiro.</div>;

  const tabs = (
    <nav aria-label="Seções do fechamento" className="inline-flex rounded-ds-md bg-white/8 p-[3px]">
      {(canViewClosures ? [["sessions", "Sessões de contagem"], ["analysis", "Análise"]] as const : [["analysis", "Análise"]] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-current={effectiveTab === value ? "page" : undefined}
          onClick={() => changeTab(value)}
          className={cn(
            "h-9 whitespace-nowrap rounded-ds-sm px-4 text-[13.5px] font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-kicker",
            effectiveTab === value ? "bg-ds-on-dark text-ds-ink" : "text-ds-on-dark-2 hover:text-ds-on-dark",
          )}
        >
          {label}
          {value === "sessions" && activeSessions.length > 0 ? <span className="ml-2 rounded-full bg-ds-accent px-1.5 text-[11px] text-white">{activeSessions.length}</span> : null}
        </button>
      ))}
    </nav>
  );

  return (
    <PageContainer variant="wide" surface className="space-y-5 pb-10">
      <PageHero
        kicker="Financeiro · Controle de caixa"
        title="Fechamento do caixa"
        leading={null}
        subtitle={tabs}
        actions={(
          <>
            <Button variant="on-dark-icon" size="icon" aria-label="Atualizar" title="Atualizar" onClick={() => setReloadToken((value) => value + 1)} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            {effectiveTab === "sessions" && canOpenSession ? (
              <Button asChild variant="primary-page" size="md">
                <Link href="/dashboard/financial/cash-closures/sessions/new"><Plus className="mr-2 h-4 w-4" />Nova sessão de contagem</Link>
              </Button>
            ) : null}
          </>
        )}
        chips={(
          <>
            {effectiveTab === "analysis" ? (
            <div className="inline-flex h-9 items-center gap-0.5 rounded-full bg-white/5 px-1 ring-1 ring-inset ring-white/10">
              <button type="button" aria-label="Mês anterior" onClick={() => shiftMonth(-1)} className="grid h-7 w-7 place-items-center rounded-full text-ds-on-dark-2 hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-36 text-center text-[13px] font-bold text-ds-on-dark">{formatClosureMonthLabel(period.year, period.month).toLocaleLowerCase("pt-BR")}</span>
              <button type="button" aria-label="Próximo mês" onClick={() => shiftMonth(1)} disabled={isCurrentMonth} className="grid h-7 w-7 place-items-center rounded-full text-ds-on-dark-2 hover:bg-white/10 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
            ) : null}
            {unitGroups.length > 1 ? (
              <Select value={selectedGroupId} onValueChange={changeGroup}>
                <SelectTrigger aria-label="Regional" className="h-9 w-auto min-w-52 gap-2 rounded-full border-white/10 bg-white/5 px-3.5 text-[13px] font-bold text-ds-on-dark">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unitGroups.map((group) => <SelectItem key={group.id} value={group.id}>Regional {group.name} · {group.kioskIds.length} {group.kioskIds.length === 1 ? "unidade" : "unidades"}</SelectItem>)}
                  <SelectItem value={ALL_UNITS}>Todas as unidades · {units.length}</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {kioskOptions.length > 1 ? (
              <Select value={selectedKioskId} onValueChange={setKioskId}>
                <SelectTrigger aria-label="Quiosque" className="h-9 w-auto min-w-52 gap-2 rounded-full border-white/10 bg-white/5 px-3.5 text-[13px] font-bold text-ds-on-dark">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_UNITS}>Todos os quiosques · {kioskOptions.length}</SelectItem>
                  {kioskOptions.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}
          </>
        )}
      />

      {effectiveTab === "sessions" ? (
        <CashClosuresSessionsTab
          sessions={scopedSessions}
          units={scopedUnits}
          summariesByUnit={scopedSummaries}
          summariesLoading={summariesLoading}
          today={today}
          scopeKioskIds={isScoped ? scopedUnitIds : null}
        />
      ) : (
        <CashClosuresAnalysisTab
          units={scopedUnits}
          summariesByUnit={summariesByUnit}
          summariesLoading={summariesLoading || loading}
          closuresByUnit={closuresByUnit}
          closuresLoading={closuresLoading}
          canViewDays={canViewClosures}
          sessionScopeKeys={sessionScopeKeys}
          year={period.year}
          month={period.month}
          today={today}
          onOpenSessions={() => changeTab("sessions")}
        />
      )}
    </PageContainer>
  );
}
