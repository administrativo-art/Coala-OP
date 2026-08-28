"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Banknote, Loader2, RefreshCw, Store } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/layout/page-container";
import { CashControlNavigation } from "./cash-control-navigation";
import { formatBRL } from "../money";
import { todayInClosureTimezone } from "../date";
import type { CashClosureUnitSummary } from "../types";

type UnitItem = {
  id: string;
  name: string;
  pdvFilialId: string | null;
  summary: CashClosureUnitSummary | null;
};
type JobRun = { status: "success" | "partial" | "failed"; date: string; failureCount: number; completedAt: string };

function yesterday() {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 1);
  return todayInClosureTimezone(now);
}

export function CashClosuresOverviewPage() {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestJobRun, setLatestJobRun] = useState<JobRun | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    if (!firebaseUser) throw new Error("Sessão não disponível.");
    const response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${await firebaseUser.getIdToken()}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Falha na operação.");
    return payload;
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const payload = await api("/api/financial/cash-closures/overview");
      setUnits(payload.units ?? []);
      setLatestJobRun(payload.latestJobRun ?? null);
    }
    catch (error) { toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." }); }
    finally { setLoading(false); }
  }, [api, firebaseUser, toast]);

  useEffect(() => { void load(); }, [load]);

  async function syncYesterday(unit: UnitItem) {
    setWorking(unit.id);
    try {
      await api("/api/financial/cash-closures/sync", {
        method: "POST",
        body: JSON.stringify({ kioskId: unit.id, date: yesterday() }),
      });
      toast({ title: `${unit.name}: fechamento de ontem sincronizado.` });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao sincronizar." });
    } finally { setWorking(null); }
  }

  if (!permissions.financial?.cashClosures?.view) return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui acesso a fechamentos de caixa.</div>;

  return <PageContainer variant="default" className="space-y-[18px] pb-10">
    <CashControlNavigation active="closures" />
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11.5px] font-extrabold uppercase tracking-[.12em] text-emerald-700">Controle de caixa</p><h1 className="mt-1.5 text-3xl font-black tracking-tight">Fechamento do caixa</h1><p className="mt-1.5 text-sm font-medium text-zinc-500">Pendências, divergências e finalizações por unidade.</p></div><Button variant="outline" className="h-[42px] rounded-xl border-stone-200 px-4 font-bold" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div>
    {latestJobRun && latestJobRun.status !== "success" && <div className="flex items-start gap-3 rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] leading-5 text-rose-900"><AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-rose-700" /><span><strong>Falha no job diário de {latestJobRun.date.split("-").reverse().join("/")}.</strong> {latestJobRun.failureCount} unidade(s) não sincronizada(s). Use “Sincronizar ontem” nos cards afetados.</span></div>}
    {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : units.length === 0 ? <Card className="rounded-2xl border-stone-200"><CardContent className="p-10 text-center text-sm text-muted-foreground">Nenhuma unidade disponível para seu perfil.</CardContent></Card> : <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-4">{units.map((unit) => {
      const summary = unit.summary;
      const danger = (summary?.divergentCount ?? 0) > 0 || (summary?.syncErrorCount ?? 0) > 0;
      const pending = (summary?.pendingCount ?? 0) > 0;
      return <Card key={unit.id} className={`overflow-hidden rounded-[18px] border-stone-200 bg-white shadow-[0_2px_10px_rgba(15,23,42,.05)] ${danger ? "border-l-4 border-l-rose-500" : pending ? "border-l-4 border-l-amber-500" : summary ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-stone-300"}`}>
        <CardHeader className="p-3.5 pb-2.5"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><CardTitle className="flex items-center gap-2 truncate text-[15px] font-black tracking-tight"><Store className="h-[15px] w-[15px] shrink-0 text-zinc-500" /><span className="truncate">{unit.name}</span></CardTitle><p className="mt-1 truncate text-[11px] font-semibold text-zinc-400">Filial PDV {unit.pdvFilialId ?? "não configurada"}</p></div>{danger ? <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-rose-500 shadow-[0_0_0_4px_#fdecef]" /> : pending ? <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-amber-500 shadow-[0_0_0_4px_#fff6e6]" /> : summary ? <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_4px_#e9f9f0]" /> : <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-stone-300 shadow-[0_0_0_4px_#f4f3ef]" />}</div></CardHeader>
        <CardContent className="space-y-2.5 px-3.5 pb-3.5">
          <div className="grid grid-cols-4 gap-1.5 text-center"><div className="rounded-xl bg-amber-50 px-1 py-2"><p className="text-[17px] font-black leading-none text-amber-800">{summary?.pendingCount ?? 0}</p><p className="mt-1 truncate text-[9.5px] font-bold text-amber-700">Pendentes</p></div><div className="rounded-xl bg-rose-50 px-1 py-2"><p className="text-[17px] font-black leading-none text-rose-800">{summary?.divergentCount ?? 0}</p><p className="mt-1 truncate text-[9.5px] font-bold text-rose-700">Divergentes</p></div><div className="rounded-xl bg-emerald-50 px-1 py-2"><p className="text-[17px] font-black leading-none text-emerald-800">{summary?.approvedCount ?? 0}</p><p className="mt-1 truncate text-[9.5px] font-bold text-emerald-700">Finalizados</p></div><div className="rounded-xl bg-stone-100 px-1 py-2"><p className="text-[17px] font-black leading-none text-zinc-600">{summary?.syncErrorCount ?? 0}</p><p className="mt-1 truncate text-[9.5px] font-bold text-zinc-400">Erros</p></div></div>
          <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50/70 px-3 py-2 text-xs"><span className="flex items-center gap-2 truncate font-semibold text-zinc-500"><Banknote className="h-[15px] w-[15px] shrink-0 text-emerald-700" />Dinheiro contado</span><strong className="shrink-0 font-mono text-[13px]">{formatBRL(summary?.countedCashCents ?? 0)}</strong></div>
          <div className="space-y-1 text-[10.5px] font-semibold text-zinc-400">
            <div className="flex items-center justify-between gap-2"><span>Sincronizado:</span><span className="truncate text-right">{summary?.lastSyncedAt ? new Date(summary.lastSyncedAt).toLocaleString("pt-BR") : "—"}</span></div>
            <div className="flex items-center justify-between gap-2"><span>Finalizado:</span><span>{summary?.lastApprovedDate?.split("-").reverse().join("/") ?? "—"}</span></div>
          </div>
          <div className="flex flex-nowrap justify-end gap-2 pt-0.5"><Button asChild variant="outline" size="sm" className="h-8 shrink-0 rounded-[10px] border-stone-200 px-3 text-xs font-bold"><Link href={`/dashboard/financial/cash-closures/${encodeURIComponent(unit.id)}`}>Abrir unidade</Link></Button>{permissions.financial.cashClosures.resync && unit.pdvFilialId && <Button size="sm" className="h-8 shrink-0 rounded-[10px] bg-pink-600 px-3 text-xs font-extrabold text-white hover:bg-pink-700" onClick={() => void syncYesterday(unit)} disabled={working === unit.id}>{working === unit.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Sincronizar ontem</Button>}</div>
        </CardContent>
      </Card>;
    })}</div>}
  </PageContainer>;
}
