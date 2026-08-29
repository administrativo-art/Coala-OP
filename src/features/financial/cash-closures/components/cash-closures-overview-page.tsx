"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarRange, Loader2, Plus, RefreshCw, Store } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/layout/page-container";
import type { CashCountingSession } from "@/features/financial/cash-counting-sessions/types";
import { CashControlNavigation } from "./cash-control-navigation";

type UnitItem = {
  id: string;
  name: string;
  pdvFilialId: string | null;
};

export function CashClosuresOverviewPage() {
  const { firebaseUser, permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [sessions, setSessions] = useState<CashCountingSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const [unitPayload, sessionPayload] = await Promise.all([
        api<{ units?: UnitItem[] }>("/api/financial/cash-closures/overview", { fallbackError: "Falha ao carregar unidades." }),
        api<{ sessions?: CashCountingSession[] }>("/api/financial/cash-counting-sessions", { fallbackError: "Falha ao carregar sessões." }),
      ]);
      setUnits(unitPayload.units ?? []);
      setSessions(sessionPayload.sessions ?? []);
    }
    catch (error) { toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." }); }
    finally { setLoading(false); }
  }, [api, firebaseUser, toast]);

  useEffect(() => { void load(); }, [load]);

  if (!permissions.financial?.cashClosures?.view) return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui acesso a fechamentos de caixa.</div>;

  return <PageContainer variant="default" className="space-y-[18px] pb-10">
    <CashControlNavigation active="closures" />
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11.5px] font-extrabold uppercase tracking-[.12em] text-emerald-700">Controle de caixa</p><h1 className="mt-1.5 text-3xl font-black tracking-tight">Fechamento do caixa</h1><p className="mt-1.5 text-sm font-medium text-zinc-500">Abra uma sessão para contar malotes ou consulte uma unidade.</p></div><div className="flex gap-2">{permissions.financial?.cashClosures?.approve && <Button asChild className="h-[42px] rounded-xl bg-pink-600 px-4 font-bold hover:bg-pink-700"><Link href="/dashboard/financial/cash-closures/sessions/new"><Plus className="mr-2 h-4 w-4" />Nova sessão</Link></Button>}<Button variant="outline" className="h-[42px] rounded-xl border-stone-200 px-4 font-bold" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div></div>
    {!loading && sessions.length > 0 && <section className="space-y-3"><div><h2 className="text-lg font-black">Sessões de contagem</h2><p className="text-xs font-medium text-zinc-400">As sessões abertas preservam a exclusividade das unidades e competências selecionadas.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{sessions.slice(0, 9).map((session) => <Link key={session.id} href={`/dashboard/financial/cash-closures/sessions/${session.id}`} className="group rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition-colors hover:border-pink-400"><div className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-50 text-pink-600"><CalendarRange className="h-4 w-4" /></span><span className={session.status === "open" ? "rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-800" : "rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-black text-zinc-500"}>{session.status === "open" ? "Em andamento" : session.status === "counted" ? "Aguardando físico" : session.status === "deposit_ready" ? "Em depósito" : session.status === "completed" ? "Concluída" : "Cancelada"}</span></div><strong className="mt-3 block truncate text-sm">{session.kioskNames.join(" · ")}</strong><p className="mt-1 text-xs text-zinc-400">{session.periodKeys.join(" · ")} · {session.openedByName}</p></Link>)}</div></section>}
    <div><h2 className="text-lg font-black">Unidades</h2><p className="text-xs font-medium text-zinc-400">Os indicadores ficam dentro de cada competência.</p></div>
    {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : units.length === 0 ? <Card className="rounded-2xl border-stone-200"><CardContent className="p-10 text-center text-sm text-muted-foreground">Nenhuma unidade disponível para seu perfil.</CardContent></Card> : <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">{units.map((unit) => <Link key={unit.id} href={`/dashboard/financial/cash-closures/${encodeURIComponent(unit.id)}`} className="group rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-600 focus-visible:ring-offset-2">
      <Card className="h-full rounded-[18px] border-stone-200 bg-white shadow-[0_2px_10px_rgba(15,23,42,.05)] transition-all group-hover:-translate-y-0.5 group-hover:border-pink-400 group-hover:shadow-[0_8px_24px_rgba(15,23,42,.08)]">
        <CardHeader className="p-[18px]"><div className="flex items-center gap-3.5"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-pink-50 text-pink-600"><Store className="h-5 w-5" /></span><div className="min-w-0 flex-1"><CardTitle className="truncate text-base font-black tracking-tight">{unit.name}</CardTitle><p className="mt-1 truncate text-xs font-semibold text-zinc-400">Filial PDV {unit.pdvFilialId ?? "não configurada"}</p></div><ArrowRight className="h-5 w-5 shrink-0 text-zinc-300 transition-transform group-hover:translate-x-1 group-hover:text-pink-600" /></div></CardHeader>
      </Card>
    </Link>)}</div>}
  </PageContainer>;
}
