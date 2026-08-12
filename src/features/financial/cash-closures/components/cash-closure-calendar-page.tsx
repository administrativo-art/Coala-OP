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
import { CashControlNavigation } from "./cash-control-navigation";
import { formatBRL } from "../money";
import { formatClosureMonthLabel, todayInClosureTimezone } from "../date";
import type { CashClosure } from "../types";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function statusInfo(closure: CashClosure | undefined) {
  if (!closure) return { label: "Não sincronizado", className: "border-stone-200 bg-stone-50 text-zinc-400", icon: Clock3 };
  if (closure.status === "sync_error") return { label: "Erro de sincronização", className: "border-rose-200 bg-rose-50 text-rose-800", icon: CircleAlert };
  if (["draft", "reopened"].includes(closure.status)) return { label: "Rascunho", className: "border-stone-200 bg-stone-50 text-zinc-500", icon: CircleAlert };
  const icon = closure.status === "approved" ? CheckCircle2 : Clock3;
  if (closure.status === "pending_review") return { label: "Em conferência", className: "border-amber-200 bg-amber-50 text-amber-900", icon };
  if (closure.differenceTotalCents !== 0) return { label: closure.differenceTotalCents < 0 ? `Falta ${formatBRL(Math.abs(closure.differenceTotalCents))}` : `Sobra ${formatBRL(closure.differenceTotalCents)}`, className: "border-rose-200 bg-rose-50 text-rose-800", icon };
  return { label: "Bateu", className: "border-emerald-200 bg-emerald-50 text-emerald-800", icon };
}

export function CashClosureCalendarPage({ kioskId, year, month }: { kioskId: string; year: number; month: number }) {
  const { firebaseUser, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const [closures, setClosures] = useState<CashClosure[]>([]);
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
  const finalizedClosures = useMemo(
    () => closures.filter((closure) => closure.status === "approved"),
    [closures],
  );
  const totals = useMemo(() => ({
    expected: closures.reduce((sum, item) => sum + item.expectedTotalCents, 0),
    counted: finalizedClosures.reduce((sum, item) => sum + item.countedTotalCents, 0),
    difference: finalizedClosures.reduce((sum, item) => sum + item.differenceTotalCents, 0),
    cash: finalizedClosures.reduce((sum, item) => sum + item.countedCashCents, 0),
    allocated: closures.filter((item) => ["allocated", "issued", "paid", "adjusted"].includes(item.cashDeposit.status)).reduce((sum, item) => sum + item.cashDeposit.eligibleCents, 0),
    issued: closures.filter((item) => ["issued", "paid"].includes(item.cashDeposit.status)).reduce((sum, item) => sum + item.cashDeposit.eligibleCents, 0),
    paid: closures.filter((item) => item.cashDeposit.status === "paid").reduce((sum, item) => sum + item.cashDeposit.eligibleCents, 0),
  }), [closures, finalizedClosures]);
  const today = todayInClosureTimezone();
  const monthLabel = formatClosureMonthLabel(year, month);
  const kiosk = kiosks.find((item) => item.id === kioskId);
  const kioskName = kiosk?.name
    ?? closures[0]?.kioskName
    ?? kioskId;
  const hasFinalizedClosure = finalizedClosures.length > 0;
  if (!permissions.financial?.cashClosures?.view) return null;
  return <div className="w-full max-w-none space-y-4">
    <CashControlNavigation active="closures" crumbs={[{ label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" }, { label: kioskName, href: `/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}` }, { label: monthLabel }]} />
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-[26px] font-black tracking-tight">{monthLabel}</h1><p className="mt-1.5 text-[13.5px] font-semibold text-zinc-500">{kioskName}</p></div><Button variant="outline" className="h-10 rounded-xl border-stone-200 px-4 font-bold" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div>
    <div className="grid gap-3 lg:grid-cols-[3fr_4fr]">
      <Card className="overflow-hidden rounded-2xl border-stone-200 shadow-[0_2px_10px_rgba(15,23,42,.04)]"><CardContent className="grid h-[72px] grid-cols-3 items-stretch !p-0">{[
        ["Vendas no PDV", formatBRL(totals.expected), ""],
        ["Conferido", hasFinalizedClosure ? formatBRL(totals.counted) : "—", ""],
        ["Diferença", !hasFinalizedClosure ? "—" : formatBRL(totals.difference), totals.difference === 0 ? "text-emerald-700" : "text-rose-700"],
      ].map(([label, value, valueClass]) => <div key={label} className="flex min-w-0 flex-col items-center justify-center px-3 text-center"><p className="whitespace-nowrap text-[11px] font-bold leading-4 text-zinc-400">{label}</p><strong className={cn("block whitespace-nowrap font-mono text-[14px] leading-5 xl:text-[15px]", valueClass)}>{value}</strong></div>)}</CardContent></Card>
      <Card className="overflow-hidden rounded-2xl border-stone-200 shadow-[0_2px_10px_rgba(15,23,42,.04)]"><CardContent className="grid min-h-[72px] grid-cols-2 items-stretch !p-0 sm:grid-cols-4">{[
        ["Dinheiro", formatBRL(totals.cash), ""],
        ["Em depósito", formatBRL(totals.allocated), ""],
        ["Boleto emitido", formatBRL(totals.issued), ""],
        ["Depositado", formatBRL(totals.paid), "text-emerald-700"],
      ].map(([label, value, valueClass]) => <div key={label} className="flex min-w-0 flex-col items-center justify-center px-3 text-center"><p className="whitespace-nowrap text-[11px] font-bold leading-4 text-zinc-400">{label}</p><strong className={cn("block whitespace-nowrap font-mono text-[14px] leading-5 xl:text-[15px]", valueClass)}>{value}</strong></div>)}</CardContent></Card>
    </div>
    {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : <Card className="rounded-[18px] border-stone-200 shadow-[0_2px_10px_rgba(15,23,42,.05)]"><CardContent className="p-3 sm:p-4"><div className="grid grid-cols-7 gap-1.5">{WEEKDAYS.map((day) => <div key={day} className="px-1 py-1 text-center text-[11px] font-extrabold uppercase tracking-wide text-zinc-400">{day}</div>)}{days.map((day, index) => {
      if (day === null) return <div key={`empty-${index}`} />;
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const closure = byDate.get(date);
      const future = date > today;
      const info = statusInfo(closure);
      const Icon = info.icon;
      return <Link key={date} aria-disabled={future} href={future ? "#" : `/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`} className={cn("flex min-h-24 flex-col rounded-xl border px-2.5 py-2 text-left transition-colors", future ? "pointer-events-none border-stone-200 bg-stone-100 text-stone-300" : "hover:brightness-[.98]", info.className)}><div className="flex items-center justify-between"><strong className="text-sm">{day}</strong>{!future && <Icon className="h-3.5 w-3.5" />}</div>{closure && <div className="mt-auto pt-1.5 text-[10.5px] leading-4"><p><span className="text-[9px] font-bold opacity-70">PDV</span> <strong className="font-mono">{formatBRL(closure.expectedTotalCents)}</strong></p><p className="truncate font-mono font-extrabold">{info.label}</p></div>}{!closure && !future && <p className="mt-auto truncate pt-1.5 text-[10px] font-bold">{info.label}</p>}</Link>;
    })}</div><div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-stone-100 pt-3 text-[11px] font-semibold text-zinc-500"><Legend color="border-emerald-200 bg-emerald-50" label="Bateu" /><Legend color="border-rose-200 bg-rose-50" label="Diferença final" /><Legend color="border-amber-200 bg-amber-50" label="Em conferência" /><span className="hidden h-3.5 w-px bg-stone-200 sm:block" /><span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-700" />Aprovado</span><span className="flex items-center gap-1"><Clock3 className="h-3 w-3 text-amber-700" />Em conferência</span><span className="flex items-center gap-1"><CircleAlert className="h-3 w-3 text-zinc-500" />Rascunho</span></div></CardContent></Card>}
  </div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn("h-2.5 w-3.5 rounded-[3px] border", color)} />{label}</span>;
}
