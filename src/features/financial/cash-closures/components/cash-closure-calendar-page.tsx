"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, Clock3, Loader2, RefreshCw } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatBRL } from "../money";
import { todayInClosureTimezone } from "../date";
import type { CashClosure } from "../types";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function statusInfo(closure: CashClosure | undefined) {
  if (!closure) return { label: "Não sincronizado", className: "bg-slate-50 text-slate-500", icon: Clock3 };
  if (closure.status === "approved") return { label: "Aprovado", className: "bg-emerald-50 text-emerald-800", icon: CheckCircle2 };
  if (closure.status === "sync_error") return { label: "Erro de sync", className: "bg-rose-50 text-rose-800", icon: CircleAlert };
  if (closure.divergentLineCount > 0) return { label: "Divergente", className: "bg-rose-50 text-rose-800", icon: CircleAlert };
  return { label: closure.status === "pending_review" ? "Em revisão" : closure.status === "reopened" ? "Reaberto" : "Rascunho", className: "bg-amber-50 text-amber-800", icon: Clock3 };
}

export function CashClosureCalendarPage({ kioskId, year, month }: { kioskId: string; year: number; month: number }) {
  const { firebaseUser, permissions } = useAuth();
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
  const totals = useMemo(() => ({
    expected: closures.reduce((sum, item) => sum + item.expectedTotalCents, 0),
    counted: closures.reduce((sum, item) => sum + item.countedTotalCents, 0),
    difference: closures.reduce((sum, item) => sum + item.differenceTotalCents, 0),
    cash: closures.reduce((sum, item) => sum + item.countedCashCents, 0),
    allocated: closures.filter((item) => ["allocated", "issued", "paid", "adjusted"].includes(item.cashDeposit.status)).reduce((sum, item) => sum + item.cashDeposit.eligibleCents, 0),
    issued: closures.filter((item) => ["issued", "paid"].includes(item.cashDeposit.status)).reduce((sum, item) => sum + item.cashDeposit.eligibleCents, 0),
    paid: closures.filter((item) => item.cashDeposit.status === "paid").reduce((sum, item) => sum + item.cashDeposit.eligibleCents, 0),
  }), [closures]);
  const today = todayInClosureTimezone();
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));

  if (!permissions.financial?.cashClosures?.view) return null;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Button asChild size="icon" variant="outline"><Link href={`/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}`}><ArrowLeft className="h-4 w-4" /></Link></Button><div><h1 className="text-2xl font-bold capitalize">{monthLabel}</h1><p className="text-sm text-muted-foreground">{kioskId}</p></div></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div>
    <div className="grid gap-3 lg:grid-cols-2"><Card><CardContent className="grid grid-cols-3 gap-3 p-4"><div><p className="text-xs text-muted-foreground">PDV</p><strong>{formatBRL(totals.expected)}</strong></div><div><p className="text-xs text-muted-foreground">Físico</p><strong>{formatBRL(totals.counted)}</strong></div><div><p className="text-xs text-muted-foreground">Diferença</p><strong>{formatBRL(totals.difference)}</strong></div></CardContent></Card><Card><CardContent className="grid grid-cols-4 gap-3 p-4"><div><p className="text-xs text-muted-foreground">Dinheiro</p><strong>{formatBRL(totals.cash)}</strong></div><div><p className="text-xs text-muted-foreground">Alocado</p><strong>{formatBRL(totals.allocated)}</strong></div><div><p className="text-xs text-muted-foreground">Emitido</p><strong>{formatBRL(totals.issued)}</strong></div><div><p className="text-xs text-muted-foreground">Pago</p><strong>{formatBRL(totals.paid)}</strong></div></CardContent></Card></div>
    {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : <Card><CardContent className="p-3 sm:p-5"><div className="grid grid-cols-7 gap-1">{WEEKDAYS.map((day) => <div key={day} className="p-2 text-center text-xs font-semibold text-muted-foreground">{day}</div>)}{days.map((day, index) => {
      if (day === null) return <div key={`empty-${index}`} />;
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const closure = byDate.get(date);
      const future = date > today;
      const info = statusInfo(closure);
      const Icon = info.icon;
      return <Link key={date} aria-disabled={future} href={future ? "#" : `/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`} className={cn("min-h-28 rounded-lg border p-2 transition-colors sm:min-h-32", future ? "pointer-events-none bg-slate-50 opacity-40" : "hover:border-primary/50", info.className)}><div className="flex items-center justify-between"><strong>{day}</strong><Icon className="h-3.5 w-3.5" /></div><Badge variant="outline" className="mt-2 max-w-full truncate text-[10px]">{info.label}</Badge>{closure && <div className="mt-2 space-y-1 text-[11px]"><p>PDV <strong>{formatBRL(closure.expectedTotalCents)}</strong></p>{closure.pendingLineCount > 0 ? <p>{closure.pendingLineCount} linha(s) pendente(s)</p> : <p>Dif. <strong>{formatBRL(closure.differenceTotalCents)}</strong></p>}{closure.cashDeposit.batchId && <p className="truncate">Bloco {closure.cashDeposit.batchId}</p>}</div>}</Link>;
    })}</div></CardContent></Card>}
  </div>;
}
