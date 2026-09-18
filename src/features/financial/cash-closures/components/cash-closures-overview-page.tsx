"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarRange, CheckCircle2, CircleAlert, Clock3, Loader2, Plus, RefreshCw, Store } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/layout/page-container";
import type { CashCountingSession } from "@/features/financial/cash-counting-sessions/types";
import {
  filterCashCountingSessions,
  type CashCountingSessionFilter,
} from "@/features/financial/cash-counting-sessions/session-filter";
import { CashControlNavigation } from "./cash-control-navigation";
import { formatBRL } from "../money";

type UnitItem = {
  id: string;
  name: string;
  pdvFilialId: string | null;
};

function sessionStatus(status: CashCountingSession["status"]) {
  if (status === "open") return { label: "Contagem em andamento", className: "bg-amber-50 text-amber-800", icon: Clock3 };
  if (status === "counted") return { label: "Aguardando composição física", className: "bg-blue-50 text-blue-700", icon: CircleAlert };
  if (status === "deposit_ready") return { label: "Malotes preparados", className: "bg-violet-50 text-violet-700", icon: CheckCircle2 };
  if (status === "completed") return { label: "Concluída", className: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 };
  return { label: "Cancelada", className: "bg-stone-100 text-zinc-500", icon: CircleAlert };
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

  return <PageContainer variant="default" className="max-w-[1320px] space-y-[18px] pb-10">
    <CashControlNavigation active="closures" />
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11.5px] font-extrabold uppercase tracking-[.12em] text-emerald-700">Controle de caixa</p><h1 className="mt-1.5 text-3xl font-black tracking-tight">Fechamento do caixa</h1><p className="mt-1.5 text-sm font-medium text-zinc-500">{canViewClosures ? "Abra uma sessão para contar malotes ou consulte uma unidade." : "Consulte as unidades e suas competências disponíveis."}</p></div><div className="flex gap-2">{canViewClosures && permissions.financial?.cashClosures?.approve && <Button asChild className="h-[42px] rounded-xl bg-pink-600 px-4 font-bold hover:bg-pink-700"><Link href="/dashboard/financial/cash-closures/sessions/new"><Plus className="mr-2 h-4 w-4" />Nova sessão</Link></Button>}<Button variant="outline" className="h-[42px] rounded-xl border-stone-200 px-4 font-bold" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div></div>
    {canViewClosures && !loading && sessions.length > 0 && <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-black">Sessões de contagem</h2><p className="text-xs font-medium text-zinc-400">Por padrão, somente sessões ativas ficam visíveis.</p></div>
        <div className="flex flex-wrap gap-2" aria-label="Filtrar sessões de contagem">{([
          ["active", "Ativas"],
          ["completed", "Concluídas"],
          ["cancelled", "Canceladas"],
        ] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={sessionFilter === value ? "default" : "outline"} className="h-8 rounded-lg px-3 text-xs font-bold" onClick={() => setSessionFilter(value)}>{label}<span className="ml-1.5 opacity-70">{sessionCounts[value]}</span></Button>)}</div>
      </div>
      {filteredSessions.length === 0
        ? <Card className="rounded-2xl border-stone-200"><CardContent className="p-6 text-center text-sm text-muted-foreground">Nenhuma sessão neste filtro.</CardContent></Card>
        : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filteredSessions.slice(0, 9).map((session) => {
          const state = sessionStatus(session.status);
          const StateIcon = state.icon;
          const progress = session.status === "cancelled" ? "Unidades liberadas" : `${session.finalizedOperatorCount} operador(es) finalizado(s)`;
          return <Link key={session.id} href={`/dashboard/financial/cash-closures/sessions/${session.id}`} className="group rounded-[17px] border border-stone-200 bg-[#fffefb] p-4 shadow-[0_2px_10px_rgba(15,23,42,.04)] transition-all hover:-translate-y-0.5 hover:border-pink-400 hover:shadow-[0_12px_24px_-18px_rgba(29,29,38,.75)] motion-reduce:transform-none motion-reduce:transition-none">
            <div className="flex items-start justify-between gap-3"><span className="grid h-9 w-9 place-items-center rounded-[11px] bg-pink-50 text-pink-600"><CalendarRange className="h-4 w-4" /></span><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-black ${state.className}`}><StateIcon className="h-3 w-3" />{state.label}</span></div>
            <strong className="mt-3 block truncate text-sm font-extrabold">{session.kioskNames.join(" · ")}</strong>
            <p className="mt-1 text-xs font-semibold text-zinc-400">{session.periodKeys.length > 0 ? session.periodKeys.join(" · ") : "Datas escolhidas durante a contagem"} · {session.openedByName}</p>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-dashed border-stone-200 pt-2.5"><span className="text-[11px] font-bold text-zinc-500">{progress}</span><strong className="font-mono text-[13px] font-bold tabular-nums">{formatBRL(session.countedCashCents)}</strong></div>
          </Link>;
        })}</div>}
    </section>}
    <div><h2 className="text-lg font-black">Unidades</h2><p className="text-xs font-medium text-zinc-400">Os indicadores ficam dentro de cada competência.</p></div>
    {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : units.length === 0 ? <Card className="rounded-2xl border-stone-200"><CardContent className="p-10 text-center text-sm text-muted-foreground">Nenhuma unidade disponível para seu perfil.</CardContent></Card> : <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">{units.map((unit) => <Link key={unit.id} href={`/dashboard/financial/cash-closures/${encodeURIComponent(unit.id)}`} className="group rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-600 focus-visible:ring-offset-2">
      <Card className="h-full rounded-[18px] border-stone-200 bg-[#fffefb] shadow-[0_2px_10px_rgba(15,23,42,.05)] transition-all group-hover:-translate-y-0.5 group-hover:border-pink-400 group-hover:shadow-[0_8px_24px_rgba(15,23,42,.08)] motion-reduce:transform-none motion-reduce:transition-none">
        <CardHeader className="p-[18px]"><div className="flex items-center gap-3.5"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-pink-50 text-pink-600"><Store className="h-5 w-5" /></span><div className="min-w-0 flex-1"><CardTitle className="truncate text-base font-black tracking-tight">{unit.name}</CardTitle><p className="mt-1 truncate text-xs font-semibold text-zinc-400">Filial PDV {unit.pdvFilialId ?? "não configurada"}</p><span className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-zinc-500"><span className="h-2 w-2 rounded-full bg-zinc-300" />Consulte as competências</span></div><ArrowRight className="h-5 w-5 shrink-0 text-zinc-300 transition-transform group-hover:translate-x-1 group-hover:text-pink-600 motion-reduce:transform-none motion-reduce:transition-none" /></div></CardHeader>
      </Card>
    </Link>)}</div>}
  </PageContainer>;
}
