"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Banknote, CheckCircle2, Loader2, RefreshCw, Store, XCircle } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Controle de caixa</p><h1 className="text-2xl font-bold tracking-tight">Fechamento do caixa</h1><p className="text-sm text-muted-foreground">Pendências, divergências e aprovações por unidade.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div>
    {latestJobRun && latestJobRun.status !== "success" && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><strong>Falha no job diário de {latestJobRun.date.split("-").reverse().join("/")}.</strong> {latestJobRun.failureCount} unidade(s) não sincronizada(s). Use “Sincronizar ontem” nos cards afetados.</div>}
    {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : units.length === 0 ? <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Nenhuma unidade disponível para seu perfil.</CardContent></Card> : <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{units.map((unit) => {
      const summary = unit.summary;
      const danger = (summary?.divergentCount ?? 0) > 0 || (summary?.syncErrorCount ?? 0) > 0;
      const pending = (summary?.pendingCount ?? 0) > 0;
      return <Card key={unit.id} className={`overflow-hidden rounded-xl shadow-sm ${danger ? "border-l-4 border-l-rose-500" : pending ? "border-l-4 border-l-amber-500" : summary ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-slate-300"}`}>
        <CardHeader className="p-2.5 pb-2"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><CardTitle className="flex items-center gap-1.5 truncate text-xs font-black"><Store className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{unit.name}</span></CardTitle><p className="mt-0.5 truncate text-[9px] font-medium text-muted-foreground">Filial PDV {unit.pdvFilialId ?? "não configurada"}</p></div>{danger ? <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" /> : pending ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" /> : summary ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-slate-400" />}</div></CardHeader>
        <CardContent className="space-y-2 px-2.5 pb-2.5">
          <div className="grid grid-cols-4 gap-1.5 text-center"><div className="rounded-md bg-amber-50 px-1 py-1.5"><p className="text-sm font-black leading-none text-amber-800">{summary?.pendingCount ?? 0}</p><p className="mt-1 truncate text-[9px] font-medium text-amber-700">Pendentes</p></div><div className="rounded-md bg-rose-50 px-1 py-1.5"><p className="text-sm font-black leading-none text-rose-800">{summary?.divergentCount ?? 0}</p><p className="mt-1 truncate text-[9px] font-medium text-rose-700">Divergentes</p></div><div className="rounded-md bg-emerald-50 px-1 py-1.5"><p className="text-sm font-black leading-none text-emerald-800">{summary?.approvedCount ?? 0}</p><p className="mt-1 truncate text-[9px] font-medium text-emerald-700">Aprovados</p></div><div className="rounded-md bg-slate-50 px-1 py-1.5"><p className="text-sm font-black leading-none">{summary?.syncErrorCount ?? 0}</p><p className="mt-1 truncate text-[9px] font-medium text-muted-foreground">Erros</p></div></div>
          <div className="flex items-center justify-between rounded-md border px-2 py-1.5 text-[11px]"><span className="flex items-center gap-1.5 truncate text-muted-foreground"><Banknote className="h-3.5 w-3.5 shrink-0" />Dinheiro contado</span><strong className="shrink-0">{formatBRL(summary?.countedCashCents ?? 0)}</strong></div>
          <div className="flex items-center justify-between gap-2 border-t pt-1.5 text-[9px] font-medium text-muted-foreground"><span className="truncate">Sync: {summary?.lastSyncedAt ? new Date(summary.lastSyncedAt).toLocaleString("pt-BR") : "—"}</span><span className="shrink-0">Aprovado: {summary?.lastApprovedDate?.split("-").reverse().join("/") ?? "—"}</span></div>
          <div className="flex flex-wrap justify-end gap-1.5"><Button asChild variant="outline" size="sm" className="h-7 rounded-md px-2 text-[10px]"><Link href={`/dashboard/financial/cash-closures/${encodeURIComponent(unit.id)}`}>Abrir unidade</Link></Button>{permissions.financial.cashClosures.resync && unit.pdvFilialId && <Button size="sm" className="h-7 rounded-md px-2 text-[10px]" onClick={() => void syncYesterday(unit)} disabled={working === unit.id}>{working === unit.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Sincronizar ontem</Button>}</div>
        </CardContent>
      </Card>;
    })}</div>}
  </div>;
}
