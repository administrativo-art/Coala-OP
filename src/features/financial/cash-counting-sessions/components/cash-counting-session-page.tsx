"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Play, Store, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/layout/page-container";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/features/financial/cash-closures/money";
import { CashControlNavigation } from "@/features/financial/cash-closures/components/cash-control-navigation";
import type { CashCountingSession, CashCountingSessionOperator } from "../types";
import { CashCountingDialog } from "./cash-counting-dialog";

type OperatorCursor = { finalizedAt: string; id: string };
type Payload = {
  session: CashCountingSession;
  operators: CashCountingSessionOperator[];
  nextOperatorCursor: OperatorCursor | null;
};
type Unit = { id: string; name: string };

const STATUS_LABEL: Record<CashCountingSession["status"], string> = {
  open: "Contagem em andamento",
  counted: "Aguardando composição física",
  deposit_ready: "Malotes preparados",
  completed: "Concluída",
  cancelled: "Cancelada",
};

export function CashCountingSessionPage({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { firebaseUser, isDefaultAdmin, permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [working, setWorking] = useState(false);
  const [dialogUnit, setDialogUnit] = useState<Unit | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      setData(await api<Payload>(`/api/financial/cash-counting-sessions/${sessionId}`));
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar a sessão." });
    } finally {
      if (!background) setLoading(false);
    }
  }, [api, sessionId, toast]);
  useEffect(() => { void load(); }, [load]);

  async function loadMoreOperators() {
    if (!data?.nextOperatorCursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: "100",
        afterFinalizedAt: data.nextOperatorCursor.finalizedAt,
        afterId: data.nextOperatorCursor.id,
      });
      const next = await api<Payload>(`/api/financial/cash-counting-sessions/${sessionId}?${params}`);
      setData((current) => current ? {
        session: next.session,
        operators: Array.from(new Map([...current.operators, ...next.operators].map((operator) => [operator.id, operator])).values()),
        nextOperatorCursor: next.nextOperatorCursor,
      } : next);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar mais operadores." });
    } finally {
      setLoadingMore(false);
    }
  }

  async function finishSession() {
    setWorking(true);
    try {
      await api(`/api/financial/cash-counting-sessions/${sessionId}/finish`, { method: "POST", json: {} });
      toast({ title: "Contagem encerrada. Informe agora as cédulas e moedas." });
      router.push(`/dashboard/financial/cash-deposits?sessionId=${encodeURIComponent(sessionId)}`);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao encerrar a contagem." });
    } finally {
      setWorking(false);
    }
  }

  async function cancelSession() {
    setWorking(true);
    try {
      await api(`/api/financial/cash-counting-sessions/${sessionId}/cancel`, {
        method: "POST",
        json: { reason: cancelReason },
      });
      toast({ title: "Sessão cancelada e unidades liberadas." });
      setCancelOpen(false);
      await load(true);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao cancelar a sessão." });
    } finally {
      setWorking(false);
    }
  }

  const units = useMemo<Unit[]>(() => {
    if (!data) return [];
    return data.session.kioskIds.map((id, index) => ({ id, name: data.session.kioskNames[index] ?? id }));
  }, [data]);

  if (!permissions.financial?.cashClosures?.view) return null;
  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!data) return null;
  const { session, operators } = data;
  const canManageSession = session.openedBy === firebaseUser?.uid
    || isDefaultAdmin
    || permissions.financial.cashClosures.reopen;
  const canCount = permissions.financial.cashClosures.approve && canManageSession;
  const canComposeDeposit = permissions.financial.cashDeposits.view
    && permissions.financial.cashDeposits.issue
    && canManageSession;
  const resumeUnit = session.lastDraftKioskId
    ? units.find((unit) => unit.id === session.lastDraftKioskId) ?? null
    : null;

  return <PageContainer variant="default" className="space-y-5 pb-10">
    <CashControlNavigation active="closures" crumbs={[
      { label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" },
      { label: `Sessão ${session.id.slice(0, 8)}` },
    ]} />
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-black tracking-tight">Sessão de contagem</h1><Badge variant="outline" className="rounded-full px-3 py-1">{STATUS_LABEL[session.status]}</Badge></div><p className="mt-1.5 text-sm text-zinc-500">Aberta por {session.openedByName}</p></div>
      {session.status === "open" && canCount && <div className="flex flex-wrap gap-2">{session.finalizedOperatorCount === 0 && <Button variant="outline" className="rounded-xl border-rose-200 text-rose-700" disabled={working} onClick={() => setCancelOpen(true)}><XCircle className="mr-2 h-4 w-4" />Cancelar sessão</Button>}<Button className="rounded-xl bg-emerald-700 font-bold hover:bg-emerald-800" disabled={working || session.finalizedOperatorCount === 0} onClick={() => void finishSession()}>{working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Finalizar sessão de contagem</Button></div>}
      {session.status === "counted" && canComposeDeposit && <Button asChild className="rounded-xl bg-pink-600 font-bold hover:bg-pink-700"><Link href={`/dashboard/financial/cash-deposits?sessionId=${encodeURIComponent(session.id)}`}>Continuar no depósito<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>}
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
      ["Operadores finalizados", String(session.finalizedOperatorCount)],
      ["Dinheiro contado", formatBRL(session.countedCashCents)],
      ["Elegível para depósito", formatBRL(session.depositEligibleCents)],
      ["Somente DRE", formatBRL(session.dreOnlyCashCents)],
    ].map(([label, value]) => <Card key={label} className="rounded-2xl border-stone-200"><div className="flex min-h-24 flex-col justify-center px-5 py-4"><p className="text-xs font-semibold text-zinc-400">{label}</p><strong className="mt-1 block font-mono text-lg">{value}</strong></div></Card>)}</div>

    {session.status === "open" && canCount && resumeUnit && session.lastDraftDate && <button type="button" className="group flex w-full items-center justify-between rounded-2xl border border-pink-200 bg-gradient-to-r from-pink-50 to-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-pink-400 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none" onClick={() => setDialogUnit(resumeUnit)}><span><span className="text-xs font-black uppercase tracking-wide text-pink-600">Continuar de onde parou</span><strong className="mt-1 block">{resumeUnit.name} · {session.lastDraftDate.split("-").reverse().join("/")}</strong><span className="mt-1 block text-xs text-zinc-500">Os valores preenchidos serão recuperados automaticamente.</span></span><Play className="h-5 w-5 text-pink-600 transition-transform group-hover:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none" /></button>}

    {session.status === "open" && !canCount && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Você pode acompanhar esta sessão, mas somente o responsável ou quem possui permissão para reabrir sessões alheias pode fazer a contagem.</div>}

    <Card className="rounded-2xl border-stone-200">
      <CardHeader><CardTitle className="text-lg">Unidades da sessão</CardTitle><p className="text-sm text-zinc-500">Abra uma unidade e informe a data impressa no malote.</p></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{units.map((unit) => {
        const finalizedCount = operators.filter((operator) => operator.kioskId === unit.id).length;
        const isResume = session.lastDraftKioskId === unit.id && !!session.lastDraftDate;
        return <button key={unit.id} type="button" disabled={session.status !== "open" || !canCount} onClick={() => setDialogUnit(unit)} className={cn("group flex min-h-24 items-center justify-between rounded-xl border p-4 text-left transition-all motion-reduce:transform-none motion-reduce:transition-none", session.status === "open" && canCount ? "border-stone-200 hover:-translate-y-0.5 hover:border-pink-400 hover:shadow-sm" : "cursor-default border-stone-200 bg-stone-50", isResume && "border-pink-300 bg-pink-50/40")}><span className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pink-50 text-pink-600"><Store className="h-4 w-4" /></span><span className="min-w-0"><strong className="block truncate text-sm">{unit.name}</strong><span className="mt-1 block text-xs text-zinc-400">{isResume ? `Última data: ${session.lastDraftDate?.split("-").reverse().join("/")}` : `${finalizedCount} operador(es) finalizado(s)`}</span></span></span>{session.status === "open" && canCount && <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300 transition-transform group-hover:translate-x-1 group-hover:text-pink-600 motion-reduce:transform-none motion-reduce:transition-none" />}</button>;
      })}</CardContent>
    </Card>

    <Card className="rounded-2xl border-stone-200"><CardHeader><CardTitle className="text-lg">Operadores finalizados</CardTitle></CardHeader><CardContent>{operators.length === 0 ? <p className="text-sm text-zinc-500">Nenhum operador foi finalizado. Os rascunhos salvos não entram nos totais.</p> : <><div className="divide-y divide-stone-100">{operators.map((operator) => <div key={operator.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span><strong className="block text-sm">{operator.operatorName}</strong><span className="text-xs text-zinc-400">{operator.kioskName} · {operator.closureDate.split("-").reverse().join("/")}</span></span><strong className="font-mono text-sm">{formatBRL(operator.countedCashCents)}</strong></div>)}</div>{data.nextOperatorCursor && <div className="flex justify-center border-t pt-4"><Button variant="outline" disabled={loadingMore} onClick={() => void loadMoreOperators()}>{loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Carregar mais operadores</Button></div>}</>}</CardContent></Card>

    {["deposit_ready", "completed"].includes(session.status) && <Card className="rounded-2xl border-stone-200"><CardHeader><CardTitle className="text-lg">Composição da sessão</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-emerald-50 p-4"><span className="text-xs font-semibold text-emerald-800">Cédulas destinadas ao depósito</span><strong className="mt-1 block font-mono text-lg text-emerald-950">{formatBRL(session.noteTotalCents)}</strong></div><div className="rounded-xl bg-amber-50 p-4"><span className="text-xs font-semibold text-amber-800">Moedas devolvidas ao caixa</span><strong className="mt-1 block font-mono text-lg text-amber-950">{formatBRL(session.coinReturnedToTillCents)}</strong></div></div>{session.bags.map((bag) => <div key={bag.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 p-4"><span><strong className="block">Malote {String(bag.sequence).padStart(2, "0")}</strong><span className="text-xs text-zinc-400">{bag.denominations.filter((item) => item.quantity > 0).map((item) => `${item.quantity}× ${formatBRL(item.valueCents)}`).join(" · ")}</span></span><strong className="font-mono text-lg">{formatBRL(bag.totalCents)}</strong></div>)}</CardContent></Card>}

    {dialogUnit && canCount && <CashCountingDialog open={!!dialogUnit} session={session} unit={dialogUnit} editable={canCount} onClose={() => { setDialogUnit(null); void load(true); }} onSessionChanged={() => load(true)} />}

    <Dialog open={cancelOpen} onOpenChange={setCancelOpen}><DialogContent><DialogHeader><DialogTitle>Cancelar sessão vazia</DialogTitle><DialogDescription>O cancelamento libera imediatamente as unidades para outra sessão.</DialogDescription></DialogHeader><Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Motivo do cancelamento" /><DialogFooter><Button variant="outline" onClick={() => setCancelOpen(false)}>Voltar</Button><Button variant="destructive" disabled={working || cancelReason.trim().length < 3} onClick={() => void cancelSession()}>Cancelar sessão</Button></DialogFooter></DialogContent></Dialog>
  </PageContainer>;
}
