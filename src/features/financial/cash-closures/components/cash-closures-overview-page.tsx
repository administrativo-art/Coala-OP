"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarRange, CheckCircle2, CircleAlert, Clock3, Loader2, Plus, RefreshCw, Store } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHero } from "@/components/patterns/page-hero";
import { PageContainer } from "@/components/layout/page-container";
import type { CashCountingSession } from "@/features/financial/cash-counting-sessions/types";
import {
  filterCashCountingSessions,
  type CashCountingSessionFilter,
} from "@/features/financial/cash-counting-sessions/session-filter";
import { formatBRL } from "../money";

type UnitItem = {
  id: string;
  name: string;
  pdvFilialId: string | null;
};

function sessionStatus(status: CashCountingSession["status"]) {
  if (status === "open") return { label: "Contagem em andamento", className: "bg-ds-warn-bg text-ds-alert-ink", icon: Clock3 };
  if (status === "counted") return { label: "Aguardando composição física", className: "bg-ds-info-bg text-ds-info", icon: CircleAlert };
  if (status === "deposit_ready") return { label: "Malotes preparados", className: "bg-ds-info-bg text-ds-info", icon: CheckCircle2 };
  if (status === "completed") return { label: "Concluída", className: "bg-ds-ok-bg text-ds-ok", icon: CheckCircle2 };
  return { label: "Cancelada", className: "bg-ds-muted text-ds-ink-muted", icon: CircleAlert };
}

export function CashClosuresOverviewPage() {
  const { firebaseUser, permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [sessions, setSessions] = useState<CashCountingSession[]>([]);
  const [sessionFilter, setSessionFilter] = useState<CashCountingSessionFilter>("active");
  const [loading, setLoading] = useState(true);
  const canBrowseCatalog = permissions.financial?.view === true;
  const canViewClosures = permissions.financial?.cashClosures?.view === true;

  const load = useCallback(async () => {
    if (!firebaseUser || !canBrowseCatalog) return;
    setLoading(true);
    try {
      const [unitPayload, sessionPayload] = await Promise.all([
        api<{ units?: UnitItem[] }>("/api/financial/cash-closures/overview", { fallbackError: "Falha ao carregar unidades." }),
        canViewClosures
          ? api<{ sessions?: CashCountingSession[] }>("/api/financial/cash-counting-sessions", { fallbackError: "Falha ao carregar sessões." })
          : Promise.resolve({ sessions: [] }),
      ]);
      setUnits(unitPayload.units ?? []);
      setSessions(sessionPayload.sessions ?? []);
    }
    catch (error) { toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." }); }
    finally { setLoading(false); }
  }, [api, canBrowseCatalog, canViewClosures, firebaseUser, toast]);

  useEffect(() => { void load(); }, [load]);

  const filteredSessions = useMemo(
    () => filterCashCountingSessions(sessions, sessionFilter),
    [sessionFilter, sessions],
  );
  const sessionCounts = useMemo(() => ({
    active: filterCashCountingSessions(sessions, "active").length,
    completed: filterCashCountingSessions(sessions, "completed").length,
    cancelled: filterCashCountingSessions(sessions, "cancelled").length,
  }), [sessions]);

  if (!canBrowseCatalog) return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui acesso ao módulo financeiro.</div>;

  return <PageContainer variant="wide" surface className="space-y-[18px] pb-10">
<PageHero kicker="Financeiro · Controle de caixa" title="Fechamento do caixa" subtitle={canViewClosures ? "Abra uma sessão para contar malotes ou consulte uma unidade." : "Consulte as unidades e suas competências disponíveis."} actions={<>{canViewClosures && permissions.financial?.cashClosures?.approve && <Button asChild variant="primary-page" size="md"><Link href="/dashboard/financial/cash-closures/sessions/new"><Plus className="mr-2 h-4 w-4" />Nova sessão</Link></Button>}<Button variant="on-dark-secondary" size="md" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></>} />
    {canViewClosures && !loading && sessions.length > 0 && <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-black">Sessões de contagem</h2><p className="text-xs font-medium text-ds-ink-faint">Por padrão, somente sessões ativas ficam visíveis.</p></div>
        <div className="flex flex-wrap gap-2" aria-label="Filtrar sessões de contagem">{([
          ["active", "Ativas"],
          ["completed", "Concluídas"],
          ["cancelled", "Canceladas"],
        ] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={sessionFilter === value ? "default" : "outline"} className="h-8 rounded-lg px-3 text-xs font-bold" onClick={() => setSessionFilter(value)}>{label}<span className="ml-1.5 opacity-70">{sessionCounts[value]}</span></Button>)}</div>
      </div>
      {filteredSessions.length === 0
        ? <Card className="rounded-2xl border-ds-border"><CardContent className="grid min-h-24 w-full place-items-center !p-0 text-center text-sm text-muted-foreground">Nenhuma sessão neste filtro.</CardContent></Card>
        : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filteredSessions.slice(0, 9).map((session) => {
          const state = sessionStatus(session.status);
          const StateIcon = state.icon;
          const progress = session.status === "cancelled" ? "Unidades liberadas" : `${session.finalizedOperatorCount} operador(es) finalizado(s)`;
          return <Link key={session.id} href={`/dashboard/financial/cash-closures/sessions/${session.id}`} className="group rounded-[17px] border border-ds-border bg-ds-warm p-4 shadow-[0_2px_10px_rgba(15,23,42,.04)] transition-all hover:-translate-y-0.5 hover:border-ds-accent-soft hover:shadow-[0_12px_24px_-18px_rgba(29,29,38,.75)] motion-reduce:transform-none motion-reduce:transition-none">
            <div className="flex items-start justify-between gap-3"><span className="grid h-9 w-9 place-items-center rounded-[11px] bg-ds-accent-soft text-ds-accent-ink"><CalendarRange className="h-4 w-4" /></span><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-black ${state.className}`}><StateIcon className="h-3 w-3" />{state.label}</span></div>
            <strong className="mt-3 block truncate text-sm font-extrabold">{session.kioskNames.join(" · ")}</strong>
            <p className="mt-1 text-xs font-semibold text-ds-ink-faint">{session.periodKeys.length > 0 ? session.periodKeys.join(" · ") : "Datas escolhidas durante a contagem"} · {session.openedByName}</p>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-dashed border-ds-border pt-2.5"><span className="text-[11px] font-bold text-ds-ink-muted">{progress}</span><strong className="font-mono text-[13px] font-bold tabular-nums">{formatBRL(session.countedCashCents)}</strong></div>
          </Link>;
        })}</div>}
    </section>}
    <div><h2 className="text-lg font-black">Unidades</h2><p className="text-xs font-medium text-ds-ink-faint">Os indicadores ficam dentro de cada competência.</p></div>
    {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : units.length === 0 ? <Card className="rounded-2xl border-ds-border"><CardContent className="p-10 text-center text-sm text-muted-foreground">Nenhuma unidade disponível para seu perfil.</CardContent></Card> : <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">{units.map((unit) => <Link key={unit.id} href={`/dashboard/financial/cash-closures/${encodeURIComponent(unit.id)}`} className="group rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent focus-visible:ring-offset-2">
      <Card className="h-full rounded-[18px] border-ds-border bg-ds-warm shadow-[0_2px_10px_rgba(15,23,42,.05)] transition-all group-hover:-translate-y-0.5 group-hover:border-ds-accent-soft group-hover:shadow-[0_8px_24px_rgba(15,23,42,.08)] motion-reduce:transform-none motion-reduce:transition-none">
        <CardHeader className="p-[18px]"><div className="flex items-center gap-3.5"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ds-accent-soft text-ds-accent-ink"><Store className="h-5 w-5" /></span><div className="min-w-0 flex-1"><CardTitle className="truncate text-base font-black tracking-tight">{unit.name}</CardTitle><p className="mt-1 truncate text-xs font-semibold text-ds-ink-faint">Filial PDV {unit.pdvFilialId ?? "não configurada"}</p><span className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-ds-ink-muted"><span className="h-2 w-2 rounded-full bg-ds-neutral" />Consulte as competências</span></div><ArrowRight className="h-5 w-5 shrink-0 text-ds-ink-faint transition-transform group-hover:translate-x-1 group-hover:text-ds-accent-ink motion-reduce:transform-none motion-reduce:transition-none" /></div></CardHeader>
      </Card>
    </Link>)}</div>}
  </PageContainer>;
}
