"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, Loader2, RefreshCw } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHero } from "@/components/patterns/page-hero";
import { PageContainer } from "@/components/layout/page-container";
import { CashControlNavigation } from "./cash-control-navigation";
import { formatBRL } from "../money";
import { formatClosureMonthLabel, todayInClosureTimezone } from "../date";
import type { CashClosure } from "../types";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function statusInfo(closure: CashClosure | undefined) {
  if (!closure) return { label: "Não sincronizado", className: "border-ds-border bg-ds-muted text-ds-ink-faint", icon: Clock3 };
  if (closure.status === "sync_error") return { label: "Erro de sincronização", className: "border-ds-confirm-border bg-ds-danger-bg text-ds-confirm-ink", icon: CircleAlert };
  if (["draft", "reopened"].includes(closure.status)) return { label: "Rascunho", className: "border-ds-border bg-ds-muted text-ds-ink-muted", icon: CircleAlert };
  const icon = closure.status === "approved" ? CheckCircle2 : Clock3;
  if (closure.status === "pending_review") return { label: `${closure.finalizedOperatorCount}/${closure.operatorCount} operadores finalizados`, className: "border-ds-alert-border bg-ds-warn-bg text-ds-alert-ink", icon };
  if (closure.differenceTotalCents !== 0) return { label: closure.differenceTotalCents < 0 ? `Falta ${formatBRL(Math.abs(closure.differenceTotalCents))}` : `Sobra ${formatBRL(closure.differenceTotalCents)}`, className: "border-ds-confirm-border bg-ds-danger-bg text-ds-confirm-ink", icon };
  return { label: "Bateu", className: "border-ds-border bg-ds-ok-bg text-ds-ok", icon };
}

function depositBatchSequence(closure: CashClosure | undefined) {
  const batchId = closure?.cashDeposit.batchId
    ?? closure?.cashDeposit.manualSplitBatchIds?.[0]
    ?? null;
  return batchId?.match(/_(\d+)$/)?.[1] ?? null;
}

export function CashClosureCalendarPage({ kioskId, year, month, sessionId }: { kioskId: string; year: number; month: number; sessionId?: string }) {
  const { firebaseUser, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const [closures, setClosures] = useState<CashClosure[]>([]);
  const [activeCountingSessionId, setActiveCountingSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ kioskId, year: String(year), month: String(month) });
      const response = await fetch(`/api/financial/cash-closures?${params}`, {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar calendário.");
      setClosures(payload.closures ?? []);
      setActiveCountingSessionId(payload.activeCountingSessionId ?? null);
    } catch (error) { toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." }); }
    finally { setLoading(false); }
  }, [firebaseUser, kioskId, month, toast, year]);

  useEffect(() => { void load(); }, [load]);

  const byDate = useMemo(() => new Map(closures.map((closure) => [closure.date, closure])), [closures]);
  const days = useMemo(() => {
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  }, [month, year]);
  const totals = useMemo(() => ({
    expected: closures.reduce((sum, item) => sum + item.expectedTotalCents, 0),
    counted: closures.reduce((sum, item) => sum + item.finalizedCountedTotalCents, 0),
    difference: closures.reduce((sum, item) => sum + item.finalizedDifferenceTotalCents, 0),
  }), [closures]);
  const today = todayInClosureTimezone();
  const monthLabel = formatClosureMonthLabel(year, month);
  const kiosk = kiosks.find((item) => item.id === kioskId);
  const kioskName = kiosk?.name
    ?? closures[0]?.kioskName
    ?? kioskId;
  const hasFinalizedClosure = closures.some((closure) => closure.status === "approved" || closure.finalizedOperatorCount > 0);
  const countingSessionId = sessionId ?? activeCountingSessionId;
  const sessionQuery = countingSessionId ? `?sessionId=${encodeURIComponent(countingSessionId)}` : "";
  if (!permissions.financial?.cashClosures?.view) return null;
  return <PageContainer variant="wide" surface className="space-y-4 pb-10">
    <CashControlNavigation crumbs={[{ label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" }, { label: kioskName, href: `/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}` }, { label: monthLabel }]} />
<PageHero kicker="Financeiro · Fechamento do caixa" title={monthLabel} subtitle={<>{kioskName}{countingSessionId && <span className="ml-2 rounded-full bg-ds-accent-soft px-2 py-1 text-[10px] font-bold uppercase text-ds-accent-ink">Sessão ativa</span>}</>} actions={<>{countingSessionId && <Button asChild variant="on-dark-secondary" size="md"><Link href={`/dashboard/financial/cash-closures/sessions/${countingSessionId}`}>Voltar à sessão</Link></Button>}<Button variant="on-dark-secondary" size="md" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></>} />
    <div className="grid gap-3">
      <Card className="overflow-hidden rounded-2xl border-ds-border bg-ds-warm shadow-[0_2px_10px_rgba(15,23,42,.04)]">
        <CardContent className="!p-0">
          <p className="px-[18px] pt-3 text-[9.5px] font-extrabold uppercase tracking-[.08em] text-ds-ink-faint">Fechamento</p>
          <div className="grid min-h-[54px] grid-cols-3 items-center px-[18px] pb-3 pt-1.5">{[
            ["Esperado para conferência", formatBRL(totals.expected), ""],
            ["Conferido", hasFinalizedClosure ? formatBRL(totals.counted) : "—", ""],
            ["Diferença", !hasFinalizedClosure ? "—" : formatBRL(totals.difference), totals.difference === 0 ? "text-ds-ok" : "text-ds-danger"],
          ].map(([label, value, valueClass], index) => <div key={label} className={cn("min-w-0 px-3 first:pl-0", index > 0 && "border-l border-ds-border")}><p className="whitespace-nowrap text-[10.5px] font-semibold leading-4 text-ds-ink-faint">{label}</p><strong className={cn("mt-0.5 block whitespace-nowrap font-mono text-[14px] leading-5 xl:text-[16px]", valueClass)}>{value}</strong></div>)}</div>
        </CardContent>
      </Card>
    </div>
    {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : <Card className="rounded-[18px] border-ds-border bg-ds-warm shadow-[0_2px_10px_rgba(15,23,42,.05)]"><CardContent className="p-3 sm:p-4"><div className="grid grid-cols-7 gap-1.5">{WEEKDAYS.map((day) => <div key={day} className="px-1 py-1 text-center text-[11px] font-extrabold uppercase tracking-wide text-ds-ink-faint">{day}</div>)}{days.map((day, index) => {
      if (day === null) return <div key={`empty-${index}`} />;
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const closure = byDate.get(date);
      const future = date > today;
      const info = statusInfo(closure);
      const Icon = info.icon;
      const batchSequence = depositBatchSequence(closure);
      const isToday = date === today;
      return <Link key={date} aria-disabled={future} href={future ? "#" : `/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}${sessionQuery}`} className={cn("flex min-h-24 flex-col rounded-xl border px-2.5 py-2 text-left transition-colors", future ? "pointer-events-none border-ds-border bg-ds-muted text-ds-ink-faint" : "hover:brightness-[.98]", info.className, isToday && !future && "ring-2 ring-inset ring-ds-accent")}><div className="flex items-center justify-between"><strong className={cn("text-sm", isToday && "text-ds-accent-ink")}>{day}</strong>{isToday && !future ? <span className="text-[8px] font-black uppercase tracking-wide text-ds-accent-ink">Hoje</span> : !future && <Icon className="h-3.5 w-3.5" />}</div>{closure && <div className="mt-auto pt-1.5 text-[10.5px] leading-4"><p><span className="text-[9px] font-bold opacity-70">PDV</span> <strong className="font-mono">{formatBRL(closure.expectedTotalCents)}</strong></p><p className="truncate font-mono font-extrabold">{info.label}</p>{batchSequence && <span className="mt-1 inline-flex rounded-full border border-black/5 bg-white/70 px-1.5 py-px text-[9px] font-extrabold">Bloco #{batchSequence}</span>}</div>}{!closure && !future && <p className="mt-auto truncate pt-1.5 text-[10px] font-bold">{info.label}</p>}</Link>;
    })}</div><div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-ds-border pt-3 text-[11px] font-semibold text-ds-ink-muted"><Legend color="border-ds-border bg-ds-ok-bg" label="Bateu" /><Legend color="border-ds-confirm-border bg-ds-danger-bg" label="Diferença final" /><Legend color="border-ds-alert-border bg-ds-warn-bg" label="Contagem pendente" /><Legend color="border-ds-border bg-ds-muted" label="Rascunho" /><span className="hidden h-3.5 w-px bg-ds-muted sm:block" /><span className="flex items-center gap-1.5"><span className="rounded-full border border-ds-border bg-ds-muted px-1.5 py-px text-[9px] font-extrabold">Bloco #N</span>dinheiro em depósito</span></div></CardContent></Card>}
  </PageContainer>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn("h-2.5 w-3.5 rounded-[3px] border", color)} />{label}</span>;
}
