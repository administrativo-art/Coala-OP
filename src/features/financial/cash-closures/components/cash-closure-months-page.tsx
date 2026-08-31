"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, LockKeyhole, RefreshCw } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/layout/page-container";
import { resolvePdvFilialId } from "@/lib/kiosk-identifiers";
import { CashControlNavigation } from "./cash-control-navigation";
import { formatBRL } from "../money";
import { formatClosureMonthLabel, shiftClosureDate, todayInClosureTimezone } from "../date";
import type { CashClosureMonthlySummary } from "../types";

export function CashClosureMonthsPage({ kioskId }: { kioskId: string }) {
  const { firebaseUser, permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const [summaries, setSummaries] = useState<CashClosureMonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const canBrowseCatalog = permissions.financial?.view === true;
  const canOpenCalendar = permissions.financial?.cashClosures?.view === true;

  const load = useCallback(async () => {
    if (!firebaseUser || !canBrowseCatalog) return;
    setLoading(true);
    try {
      const payload = await api<{ summaries?: CashClosureMonthlySummary[] }>(`/api/financial/cash-closures/months?kioskId=${encodeURIComponent(kioskId)}`, {
        fallbackError: "Falha ao carregar competências.",
      });
      setSummaries(payload.summaries ?? []);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally { setLoading(false); }
  }, [api, canBrowseCatalog, firebaseUser, kioskId, toast]);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => {
    if (summaries.length > 0) return summaries;
    const [year, month] = todayInClosureTimezone().split("-").map(Number);
    return [{ year, month, id: `${kioskId}_${year}_${month}` }] as CashClosureMonthlySummary[];
  }, [kioskId, summaries]);
  const kiosk = kiosks.find((item) => item.id === kioskId);
  const kioskName = kiosk?.name
    ?? summaries[0]?.kioskName
    ?? kioskId;
  const pdvFilialId = resolvePdvFilialId({ id: kioskId, pdvFilialId: kiosk?.pdvFilialId });

  async function syncYesterday() {
    setSyncing(true);
    try {
      const date = shiftClosureDate(todayInClosureTimezone(), -1);
      await api("/api/financial/cash-closures/sync", {
        method: "POST",
        json: { kioskId, date },
        fallbackError: "Falha ao sincronizar o fechamento de ontem.",
      });
      toast({ title: `${kioskName}: fechamento de ontem sincronizado.` });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao sincronizar." });
    } finally {
      setSyncing(false);
    }
  }

  if (!canBrowseCatalog) return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui acesso ao módulo financeiro.</div>;
  return <PageContainer variant="default" className="space-y-5 pb-10">
    <CashControlNavigation active="closures" crumbs={[{ label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" }, { label: kioskName }]} />
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-[26px] font-black tracking-tight">Competências da unidade</h1><p className="mt-1.5 text-sm font-semibold text-zinc-500">{kioskName}</p>{!canOpenCalendar && <p className="mt-2 text-xs font-medium text-amber-700">Seu perfil pode consultar as competências, mas não abrir o calendário e a auditoria.</p>}</div>{canOpenCalendar && permissions.financial.cashClosures.resync && pdvFilialId && <Button className="h-10 rounded-xl bg-pink-600 px-4 font-extrabold text-white hover:bg-pink-700" onClick={() => void syncYesterday()} disabled={syncing || loading}>{syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sincronizar ontem</Button>}</div>
    {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">{items.map((summary) => {
      const label = formatClosureMonthLabel(summary.year, summary.month);
      const waitingForCount = (summary.pendingCount ?? 0) > 0 && (summary.countedTotalCents ?? 0) === 0;
      const closureCount = summary.closureCount ?? 0;
      const separatesPartialClosures = Number.isInteger(summary.partialCount);
      const card = <Card className={cn("h-full rounded-[18px] border-stone-200 bg-white shadow-[0_2px_10px_rgba(15,23,42,.05)]", canOpenCalendar && "transition-all hover:-translate-y-0.5 hover:border-pink-500 hover:shadow-[0_8px_24px_rgba(15,23,42,.08)]", !canOpenCalendar && "cursor-not-allowed opacity-80")}><CardHeader className="px-[18px] pb-0 pt-[17px]"><CardTitle className="flex items-center gap-2 text-base font-black tracking-tight">{canOpenCalendar ? <CalendarDays className="h-[17px] w-[17px] text-pink-600" /> : <LockKeyhole className="h-[17px] w-[17px] text-zinc-400" />}{label}</CardTitle><p className="pt-1 text-[11px] font-semibold text-zinc-400">{closureCount} {closureCount === 1 ? "dia sincronizado" : "dias sincronizados"}{!canOpenCalendar && " · calendário restrito"}</p></CardHeader><CardContent className="p-[18px] pt-3.5"><div className="grid grid-cols-6 gap-1.5 text-center text-[9.5px] font-bold"><div className="col-span-2 rounded-xl bg-amber-50 px-1 py-2"><strong className="block text-lg font-black text-amber-800">{summary.pendingCount ?? 0}</strong><span className="text-amber-700">{separatesPartialClosures ? "Pendentes" : "Em aberto"}</span></div><div className="col-span-2 rounded-xl bg-orange-50 px-1 py-2"><strong className="block text-lg font-black text-orange-800">{summary.partialCount ?? "—"}</strong><span className="text-orange-700">Parciais</span></div><div className="col-span-2 rounded-xl bg-rose-50 px-1 py-2"><strong className="block text-lg font-black text-rose-800">{summary.divergentCount ?? 0}</strong><span className="text-rose-700">Divergentes</span></div><div className="col-span-3 rounded-xl bg-emerald-50 px-1 py-2"><strong className="block text-lg font-black text-emerald-800">{summary.approvedCount ?? 0}</strong><span className="text-emerald-700">Finalizados</span></div><div className="col-span-3 rounded-xl bg-stone-100 px-1 py-2"><strong className="block text-lg font-black text-zinc-600">{summary.syncErrorCount ?? 0}</strong><span className="text-zinc-500">Erros</span></div></div><div className="mt-3.5 space-y-1.5 border-t border-stone-100 pt-3 text-[13px]"><div className="flex justify-between gap-3"><span className="font-semibold text-zinc-400">Vendas no PDV</span><strong className="font-mono">{formatBRL(summary.expectedTotalCents ?? 0)}</strong></div><div className="flex justify-between gap-3"><span className="font-semibold text-zinc-400">Receita na DRE</span><strong className="font-mono text-emerald-700">{formatBRL(summary.dreRevenueTotalCents ?? (summary.expectedTotalCents ?? 0) + (summary.differenceTotalCents ?? 0))}</strong></div><div className="flex justify-between gap-3"><span className="font-semibold text-zinc-400">Conferido</span><strong className="font-mono">{waitingForCount ? "—" : formatBRL(summary.countedTotalCents ?? 0)}</strong></div><div className="flex justify-between gap-3"><span className="font-semibold text-zinc-400">Dinheiro contado</span><strong className="font-mono">{waitingForCount ? "—" : formatBRL(summary.countedCashCents ?? 0)}</strong></div></div></CardContent></Card>;
      if (!canOpenCalendar) return <div key={summary.id} aria-disabled="true" title="Sem permissão para abrir o calendário e a auditoria.">{card}</div>;
      return <Link key={summary.id} href={`/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${summary.year}/${String(summary.month).padStart(2, "0")}`}>{card}</Link>;
    })}</div>}
  </PageContainer>;
}
