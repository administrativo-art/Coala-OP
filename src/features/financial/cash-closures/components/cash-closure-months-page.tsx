"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CashControlNavigation } from "./cash-control-navigation";
import { formatBRL } from "../money";
import { formatClosureMonthLabel, todayInClosureTimezone } from "../date";
import type { CashClosureMonthlySummary } from "../types";

export function CashClosureMonthsPage({ kioskId }: { kioskId: string }) {
  const { firebaseUser, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const [summaries, setSummaries] = useState<CashClosureMonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/financial/cash-closures/months?kioskId=${encodeURIComponent(kioskId)}`, {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar meses.");
      setSummaries(payload.summaries ?? []);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally { setLoading(false); }
  }, [firebaseUser, kioskId, toast]);

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

  if (!permissions.financial?.cashClosures?.view) return null;
  return <div className="mx-auto w-full max-w-[1180px] space-y-5 pb-10">
    <CashControlNavigation active="closures" crumbs={[{ label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" }, { label: kioskName }]} />
    <div><h1 className="text-[26px] font-black tracking-tight">Meses da unidade</h1><p className="mt-1.5 text-sm font-semibold text-zinc-500">{kioskName}</p></div>
    {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">{items.map((summary) => {
      const label = formatClosureMonthLabel(summary.year, summary.month);
      const waitingForConference = (summary.pendingCount ?? 0) > 0 && (summary.countedTotalCents ?? 0) === 0;
      return <Link key={summary.id} href={`/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${summary.year}/${String(summary.month).padStart(2, "0")}`}>
        <Card className="h-full rounded-[18px] border-stone-200 bg-white shadow-[0_2px_10px_rgba(15,23,42,.05)] transition-colors hover:border-pink-500"><CardHeader className="px-[18px] pb-0 pt-[17px]"><CardTitle className="flex items-center gap-2 text-base font-black tracking-tight"><CalendarDays className="h-[17px] w-[17px] text-pink-600" />{label}</CardTitle></CardHeader><CardContent className="p-[18px] pt-3.5"><div className="grid grid-cols-3 gap-2 text-center text-[10px] font-bold"><div className="rounded-xl bg-amber-50 px-1 py-2"><strong className="block text-lg font-black text-amber-800">{summary.pendingCount ?? 0}</strong><span className="text-amber-700">Pendentes</span></div><div className="rounded-xl bg-rose-50 px-1 py-2"><strong className="block text-lg font-black text-rose-800">{summary.divergentCount ?? 0}</strong><span className="text-rose-700">Divergentes</span></div><div className="rounded-xl bg-emerald-50 px-1 py-2"><strong className="block text-lg font-black text-emerald-800">{summary.approvedCount ?? 0}</strong><span className="text-emerald-700">Aprovados</span></div></div><div className="mt-3.5 space-y-1.5 border-t border-stone-100 pt-3 text-[13px]"><div className="flex justify-between"><span className="font-semibold text-zinc-400">Vendas no PDV</span><strong className="font-mono">{formatBRL(summary.expectedTotalCents ?? 0)}</strong></div><div className="flex justify-between"><span className="font-semibold text-zinc-400">Conferido</span><strong className="font-mono">{waitingForConference ? "—" : formatBRL(summary.countedTotalCents ?? 0)}</strong></div></div></CardContent></Card>
      </Link>;
    })}</div>}
  </div>;
}
