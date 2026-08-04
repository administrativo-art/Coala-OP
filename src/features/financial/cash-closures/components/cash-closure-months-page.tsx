"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "../money";
import { todayInClosureTimezone } from "../date";
import type { CashClosureMonthlySummary } from "../types";

export function CashClosureMonthsPage({ kioskId }: { kioskId: string }) {
  const { firebaseUser, permissions } = useAuth();
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

  if (!permissions.financial?.cashClosures?.view) return null;
  return <div className="space-y-5">
    <div className="flex items-center gap-3"><Button asChild size="icon" variant="outline"><Link href="/dashboard/financial/cash-closures"><ArrowLeft className="h-4 w-4" /><span className="sr-only">Voltar</span></Link></Button><div><h1 className="text-2xl font-bold tracking-tight">Meses da unidade</h1><p className="text-sm text-muted-foreground">{kioskId}</p></div></div>
    {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((summary) => {
      const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(summary.year, summary.month - 1, 1)));
      return <Link key={summary.id} href={`/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${summary.year}/${String(summary.month).padStart(2, "0")}`}>
        <Card className="h-full transition-colors hover:border-primary/50"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base capitalize"><CalendarDays className="h-4 w-4" />{label}</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg bg-amber-50 p-2"><strong className="block text-lg text-amber-800">{summary.pendingCount ?? 0}</strong>Pendentes</div><div className="rounded-lg bg-rose-50 p-2"><strong className="block text-lg text-rose-800">{summary.divergentCount ?? 0}</strong>Divergentes</div><div className="rounded-lg bg-emerald-50 p-2"><strong className="block text-lg text-emerald-800">{summary.approvedCount ?? 0}</strong>Aprovados</div></div><div className="flex justify-between text-sm"><span className="text-muted-foreground">PDV</span><strong>{formatBRL(summary.expectedTotalCents ?? 0)}</strong></div><div className="flex justify-between text-sm"><span className="text-muted-foreground">Físico</span><strong>{formatBRL(summary.countedTotalCents ?? 0)}</strong></div></CardContent></Card>
      </Link>;
    })}</div>}
  </div>;
}
