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
import { PageHero } from "@/components/patterns/page-hero";
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
  return <PageContainer variant="wide" surface className="space-y-5 pb-10">
    <CashControlNavigation crumbs={[{ label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" }, { label: kioskName }]} />
<PageHero kicker="Financeiro · Fechamento do caixa" title="Competências da unidade" subtitle={kioskName} actions={<>{canOpenCalendar && permissions.financial.cashClosures.resync && pdvFilialId && <Button variant="primary-page" size="md" onClick={() => void syncYesterday()} disabled={syncing || loading}>{syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sincronizar ontem</Button>}</>}>{!canOpenCalendar && <p className="text-xs font-semibold text-ds-accent-kicker">Seu perfil pode consultar as competências, mas não abrir o calendário e a auditoria.</p>}</PageHero>
    {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">{items.map((summary) => {
      const label = formatClosureMonthLabel(summary.year, summary.month);
      const waitingForCount = (summary.pendingCount ?? 0) > 0 && (summary.countedTotalCents ?? 0) === 0;
      const closureCount = summary.closureCount ?? 0;
      const difference = summary.differenceTotalCents ?? 0;
      const inReview = (summary.pendingCount ?? 0) > 0;
      const status = inReview ? "Em conferência" : difference === 0 ? "Aprovado" : "Divergência";
      const statusClass = inReview ? "bg-ds-warn-bg text-ds-alert-ink" : difference === 0 ? "bg-ds-ok-bg text-ds-ok" : "bg-ds-danger-bg text-ds-danger";
      const card = <Card className={cn("h-full rounded-[18px] border-ds-border bg-ds-warm shadow-[0_2px_10px_rgba(15,23,42,.05)]", canOpenCalendar && "transition-all hover:-translate-y-0.5 hover:border-ds-accent-soft hover:shadow-[0_8px_24px_rgba(15,23,42,.08)]", !canOpenCalendar && "cursor-not-allowed opacity-80")}><CardHeader className="px-[18px] pb-0 pt-[17px]"><div className="flex items-center justify-between gap-3"><CardTitle className="flex items-center gap-2 text-base font-black tracking-tight">{canOpenCalendar ? <CalendarDays className="h-[17px] w-[17px] text-ds-accent-ink" /> : <LockKeyhole className="h-[17px] w-[17px] text-ds-ink-faint" />}{label}</CardTitle><span className={cn("rounded-full px-2.5 py-1 text-[10.5px] font-black", statusClass)}>{status}</span></div><p className="pt-1 text-[11px] font-semibold text-ds-ink-faint">{closureCount} {closureCount === 1 ? "dia sincronizado" : "dias sincronizados"}{!canOpenCalendar && " · calendário restrito"}</p></CardHeader><CardContent className="p-[18px] pt-4"><div className="grid gap-2.5"><div className="flex items-center justify-between gap-3"><span className="text-[11.5px] font-bold text-ds-ink-faint">Esperado para conferência</span><strong className="font-mono text-[13px] tabular-nums">{formatBRL(summary.expectedTotalCents ?? 0)}</strong></div><div className="flex items-center justify-between gap-3"><span className="text-[11.5px] font-bold text-ds-ink-faint">Conferido</span><strong className="font-mono text-[13px] tabular-nums text-ds-ok">{waitingForCount ? "—" : formatBRL(summary.countedTotalCents ?? 0)}</strong></div><div className="flex items-center justify-between gap-3 border-t border-dashed border-ds-border pt-2"><span className="text-[11.5px] font-bold text-ds-ink-faint">Diferença</span><strong className={cn("font-mono text-[13px] font-extrabold tabular-nums", difference === 0 ? "text-ds-ok" : difference > 0 ? "text-ds-info" : "text-ds-danger")}>{difference === 0 ? formatBRL(0) : `${difference > 0 ? "+" : "−"} ${formatBRL(Math.abs(difference))}`}</strong></div></div></CardContent></Card>;
      if (!canOpenCalendar) return <div key={summary.id} aria-disabled="true" title="Sem permissão para abrir o calendário e a auditoria.">{card}</div>;
      return <Link key={summary.id} href={`/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${summary.year}/${String(summary.month).padStart(2, "0")}`}>{card}</Link>;
    })}</div>}
  </PageContainer>;
}
