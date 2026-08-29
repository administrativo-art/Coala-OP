"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Banknote, CheckCircle2, Coins, Loader2, LockKeyhole, PackageCheck, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/page-container";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { formatBRL } from "@/features/financial/cash-closures/money";
import { formatClosureMonthLabel } from "@/features/financial/cash-closures/date";
import { CashControlNavigation } from "@/features/financial/cash-closures/components/cash-control-navigation";
import {
  CASH_COUNTING_COIN_VALUES_CENTS,
  CASH_COUNTING_DENOMINATION_VALUES_CENTS,
  CASH_COUNTING_NOTE_VALUES_CENTS,
  type CashCountingSession,
  type CashCountingSessionOperator,
} from "../types";

type OperatorCursor = { finalizedAt: string; id: string };
type Payload = {
  session: CashCountingSession;
  operators: CashCountingSessionOperator[];
  nextOperatorCursor: OperatorCursor | null;
};
const STATUS_LABEL: Record<CashCountingSession["status"], string> = {
  open: "Contagem em andamento",
  counted: "Contagem encerrada",
  deposit_ready: "Malotes preparados",
  completed: "Concluída",
  cancelled: "Cancelada",
};

function quantityRecord(values: readonly number[]) {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<number, number>;
}

function DenominationGrid({
  values,
  quantities,
  setQuantities,
}: {
  values: readonly number[];
  quantities: Record<number, number>;
  setQuantities: React.Dispatch<React.SetStateAction<Record<number, number>>>;
}) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{values.map((valueCents) => <label key={valueCents} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
    <span className="block text-xs font-bold text-zinc-500">{formatBRL(valueCents)}</span>
    <Input className="mt-2 bg-white" type="number" min={0} step={1} value={quantities[valueCents] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [valueCents]: Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0) }))} />
    <span className="mt-1 block text-right font-mono text-xs text-zinc-400">{formatBRL(valueCents * (quantities[valueCents] ?? 0))}</span>
  </label>)}</div>;
}

export function CashCountingSessionPage({ sessionId }: { sessionId: string }) {
  const { permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [working, setWorking] = useState(false);
  const [quantities, setQuantities] = useState(() => quantityRecord(CASH_COUNTING_DENOMINATION_VALUES_CENTS));
  const [exchangeQuantities, setExchangeQuantities] = useState(() => quantityRecord(CASH_COUNTING_NOTE_VALUES_CENTS));
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Payload>(`/api/financial/cash-counting-sessions/${sessionId}`));
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar a sessão." });
    } finally {
      setLoading(false);
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

  const denominationTotal = useMemo(() => CASH_COUNTING_DENOMINATION_VALUES_CENTS.reduce((total, value) => total + value * (quantities[value] ?? 0), 0), [quantities]);
  const exchangeTotal = useMemo(() => CASH_COUNTING_NOTE_VALUES_CENTS.reduce((total, value) => total + value * (exchangeQuantities[value] ?? 0), 0), [exchangeQuantities]);

  async function action(path: string, json: unknown, success: string) {
    setWorking(true);
    try {
      await api(`/api/financial/cash-counting-sessions/${sessionId}${path}`, { method: "POST", json });
      toast({ title: success });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "A operação falhou." });
    } finally {
      setWorking(false);
    }
  }

  if (!permissions.financial?.cashClosures?.view) return null;
  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!data) return null;
  const { session, operators } = data;
  const liveCountedCashCents = session.countedCashCents;
  const liveDepositEligibleCents = session.depositEligibleCents;
  const liveDreOnlyCashCents = session.dreOnlyCashCents;
  return <PageContainer variant="default" className="space-y-5 pb-10">
    <CashControlNavigation active="closures" crumbs={[
      { label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" },
      { label: `Sessão ${session.id.slice(0, 8)}` },
    ]} />
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-black tracking-tight">Sessão de contagem</h1><Badge variant="outline" className="rounded-full px-3 py-1">{STATUS_LABEL[session.status]}</Badge></div><p className="mt-1.5 font-mono text-xs text-zinc-400">ID {session.id}</p></div>
      {session.status === "open" && permissions.financial.cashClosures.approve && <div className="flex gap-2">{session.finalizedOperatorCount === 0 && <Button variant="outline" className="rounded-xl border-rose-200 text-rose-700" disabled={working} onClick={() => setCancelOpen(true)}><XCircle className="mr-2 h-4 w-4" />Cancelar sessão</Button>}<Button className="rounded-xl bg-emerald-700 font-bold hover:bg-emerald-800" disabled={working || session.finalizedOperatorCount === 0} onClick={() => void action("/finish", {}, "Contagem da sessão encerrada.")}><CheckCircle2 className="mr-2 h-4 w-4" />Encerrar contagem da sessão</Button></div>}
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
      ["Operadores finalizados", String(session.finalizedOperatorCount)],
      ["Dinheiro contado", formatBRL(liveCountedCashCents)],
      ["Elegível para depósito", formatBRL(liveDepositEligibleCents)],
      ["Somente DRE", formatBRL(liveDreOnlyCashCents)],
    ].map(([label, value]) => <Card key={label} className="rounded-2xl border-stone-200"><CardContent className="p-4"><p className="text-xs font-semibold text-zinc-400">{label}</p><strong className="mt-1 block font-mono text-lg">{value}</strong></CardContent></Card>)}</div>

    <Card className="rounded-2xl border-stone-200">
      <CardHeader><CardTitle className="text-lg">Unidades e competências</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{session.scopes.map((scope) => <Link key={scope.key} href={`/dashboard/financial/cash-closures/${encodeURIComponent(scope.kioskId)}/${scope.year}/${String(scope.month).padStart(2, "0")}?sessionId=${encodeURIComponent(session.id)}`} className="group flex items-center justify-between rounded-xl border border-stone-200 p-4 hover:border-pink-400">
        <span><strong className="block text-sm">{scope.kioskName}</strong><span className="mt-1 block text-xs text-zinc-400">{formatClosureMonthLabel(scope.year, scope.month)}</span></span><ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-pink-600" />
      </Link>)}</CardContent>
    </Card>

    {session.status === "open" && <Card className="rounded-2xl border-stone-200"><CardHeader><CardTitle className="text-lg">Contagens vinculadas</CardTitle></CardHeader><CardContent>{operators.length === 0 ? <p className="text-sm text-zinc-500">Abra uma competência acima e finalize os operadores já conferidos.</p> : <><div className="divide-y divide-stone-100">{operators.map((operator) => <div key={operator.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span><strong className="block text-sm">{operator.operatorName}</strong><span className="text-xs text-zinc-400">{operator.kioskName} · {operator.closureDate.split("-").reverse().join("/")}</span></span><strong className="font-mono text-sm">{formatBRL(operator.countedCashCents)}</strong></div>)}</div>{data.nextOperatorCursor && <div className="flex justify-center border-t pt-4"><Button variant="outline" disabled={loadingMore} onClick={() => void loadMoreOperators()}>{loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Carregar mais operadores</Button></div>}</>}</CardContent></Card>}

    {session.status === "counted" && permissions.financial?.cashDeposits?.issue && <Card className="rounded-2xl border-stone-200">
      <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Banknote className="h-5 w-5 text-emerald-600" />Informar cédulas e moedas</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div><p className="mb-2 text-xs font-black uppercase tracking-wide text-zinc-400">Cédulas</p><DenominationGrid values={CASH_COUNTING_NOTE_VALUES_CENTS} quantities={quantities} setQuantities={setQuantities} /></div>
        <div><p className="mb-2 text-xs font-black uppercase tracking-wide text-zinc-400">Moedas — incluindo R$ 1,00</p><DenominationGrid values={CASH_COUNTING_COIN_VALUES_CENTS} quantities={quantities} setQuantities={setQuantities} /></div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-900 p-4 text-white"><span><span className="block text-xs text-zinc-400">Total físico</span><strong className="font-mono text-xl">{formatBRL(denominationTotal)}</strong></span><span className={denominationTotal === session.depositEligibleCents ? "text-emerald-300" : "text-amber-300"}>{denominationTotal === session.depositEligibleCents ? "Valor confere" : `Esperado: ${formatBRL(session.depositEligibleCents)}`}</span><Button disabled={working || denominationTotal !== session.depositEligibleCents} onClick={() => void action("/denominations", { denominations: CASH_COUNTING_DENOMINATION_VALUES_CENTS.map((valueCents) => ({ valueCents, quantity: quantities[valueCents] ?? 0 })) }, "Malotes preparados a partir das cédulas.")}><PackageCheck className="mr-2 h-4 w-4" />Confirmar físico</Button></div>
      </CardContent>
    </Card>}

    {["deposit_ready", "completed"].includes(session.status) && <Card className="rounded-2xl border-stone-200"><CardHeader><CardTitle className="text-lg">Malotes da sessão</CardTitle></CardHeader><CardContent className="space-y-3">{session.bags.length === 0 ? <p className="text-sm text-zinc-500">Nenhum malote com cédulas.</p> : session.bags.map((bag) => <div key={bag.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 p-4"><span><strong className="block">Malote {String(bag.sequence).padStart(2, "0")}</strong><span className="text-xs text-zinc-400">{bag.denominations.filter((item) => item.quantity > 0).map((item) => `${item.quantity}× ${formatBRL(item.valueCents)}`).join(" · ")}</span></span><strong className="font-mono text-lg">{formatBRL(bag.totalCents)}</strong></div>)}</CardContent></Card>}

    {session.status === "deposit_ready" && session.coinPendingExchangeCents > 0 && permissions.financial?.cashDeposits?.issue && <Card className="rounded-2xl border-amber-200 bg-amber-50/50"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Coins className="h-5 w-5 text-amber-700" />Moedas aguardando troca</CardTitle></CardHeader><CardContent className="space-y-4"><div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-white p-3 text-sm"><LockKeyhole className="h-4 w-4 text-amber-700" />Saldo separado: <strong>{formatBRL(session.coinPendingExchangeCents)}</strong>. Após a troca, informe somente as cédulas recebidas.</div><DenominationGrid values={CASH_COUNTING_NOTE_VALUES_CENTS} quantities={exchangeQuantities} setQuantities={setExchangeQuantities} /><div className="flex justify-end"><Button disabled={working || exchangeTotal <= 0 || exchangeTotal > session.coinPendingExchangeCents} onClick={() => void action("/coins/exchange", { denominations: CASH_COUNTING_NOTE_VALUES_CENTS.map((valueCents) => ({ valueCents, quantity: exchangeQuantities[valueCents] ?? 0 })) }, "Troca registrada e novo malote preparado.")}>Registrar troca de {formatBRL(exchangeTotal)}</Button></div></CardContent></Card>}
    <Dialog open={cancelOpen} onOpenChange={setCancelOpen}><DialogContent><DialogHeader><DialogTitle>Cancelar sessão vazia</DialogTitle><DialogDescription>O cancelamento libera imediatamente as unidades e competências para outra sessão.</DialogDescription></DialogHeader><Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Motivo do cancelamento" /><DialogFooter><Button variant="outline" onClick={() => setCancelOpen(false)}>Voltar</Button><Button variant="destructive" disabled={working || cancelReason.trim().length < 3} onClick={() => { void action("/cancel", { reason: cancelReason }, "Sessão cancelada."); setCancelOpen(false); }}>Cancelar sessão</Button></DialogFooter></DialogContent></Dialog>
  </PageContainer>;
}
