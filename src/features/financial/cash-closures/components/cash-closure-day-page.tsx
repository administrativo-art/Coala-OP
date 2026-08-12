"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Check,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Info,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL } from "../money";
import { formatClosureMonthLabel, formatClosureTime } from "../date";
import type { CashClosure, CashClosureLine, CashClosureWithLines } from "../types";
import { isPdvAutoCountedChannel } from "../channel-normalization";
import { cashDepositBatchReferenceFromId } from "../../cash-deposits/references";
import { CentsInput } from "./cents-input";
import { CashControlNavigation } from "./cash-control-navigation";

type Props = { kioskId: string; date: string };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const STATUS_LABEL: Record<CashClosure["status"], string> = {
  not_synced: "Não sincronizado",
  draft: "Rascunho",
  pending_review: "Em conferência financeira",
  approved: "Aprovado",
  reopened: "Reaberto",
  sync_error: "Erro de sincronização",
};

const DEPOSIT_STATUS_LABEL: Record<CashClosure["cashDeposit"]["status"], string> = {
  not_eligible: "Sem dinheiro elegível",
  not_allocated: "Aguardando alocação",
  allocated: "Alocado",
  issued: "Boleto emitido",
  paid: "Depositado",
  adjusted: "Ajustado",
};

function resultText(differenceCents: number | null) {
  if (differenceCents === null) return { label: "Não informado", className: "text-zinc-500" };
  if (differenceCents === 0) return { label: "OK", className: "text-emerald-700" };
  if (differenceCents < 0) return { label: `Falta ${formatBRL(Math.abs(differenceCents))}`, className: "text-rose-700" };
  return { label: `Sobra ${formatBRL(differenceCents)}`, className: "text-blue-700" };
}

function channelName(line: CashClosureLine) {
  const labels: Record<CashClosureLine["channel"], string> = {
    cash: "Dinheiro líquido",
    pix: "Pix",
    debit_card: "Cartão débito",
    credit_card: "Cartão crédito",
    voucher: "Voucher",
    signed_account: "Conta assinada",
    other: line.channelLabel || "Outros",
  };
  return labels[line.channel];
}

function operatorInterval(lines: CashClosureLine[]) {
  const firstCouponAt = lines.find((line) => line.metadata.firstCouponAt)?.metadata.firstCouponAt;
  const lastCouponAt = lines.find((line) => line.metadata.lastCouponAt)?.metadata.lastCouponAt;
  if (!firstCouponAt || !lastCouponAt) return null;
  const first = formatClosureTime(firstCouponAt);
  const last = formatClosureTime(lastCouponAt);
  return first && last ? `Apurado das ${first} às ${last}` : null;
}

function withPdvAutomaticCounts(lines: CashClosureLine[]) {
  return lines.map((line) => isPdvAutoCountedChannel(line.channel)
    ? {
        ...line,
        reportedCents: line.expectedCents,
        reportedDifferenceCents: 0,
        countedCents: line.expectedCents,
        conferenceDifferenceCents: 0,
        differenceCents: 0,
        status: "matched" as const,
      }
    : line);
}

function differenceLabel(value: number | null) {
  if (value === null) return "—";
  if (value === 0) return "Sem diferença";
  return value < 0 ? `Falta ${formatBRL(Math.abs(value))}` : `Sobra ${formatBRL(value)}`;
}

function ChannelIcon({ line }: { line: CashClosureLine }) {
  if (line.channel === "cash") return <Banknote className="h-[19px] w-[19px] text-emerald-600" />;
  if (line.channel === "pix") return <span className="grid h-[18px] w-[18px] rotate-45 place-items-center rounded-[3px] border-2 border-emerald-600"><span className="h-1.5 w-1.5 rounded-[2px] border border-emerald-600" /></span>;
  return <CreditCard className="h-[19px] w-[19px] text-indigo-500" />;
}

export function CashClosureDayPage({ kioskId, date }: Props) {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<CashClosureWithLines | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [seniorDivergenceCents, setSeniorDivergenceCents] = useState(1_000);
  const [reasonAction, setReasonAction] = useState<"approve" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const latestData = useRef<CashClosureWithLines | null>(null);
  const intervalBackfillAttempted = useRef(false);
  const closureId = `${kioskId}_${date}`;
  const [dateYear, dateMonth] = date.split("-").map(Number);
  const monthLabel = formatClosureMonthLabel(dateYear, dateMonth);
  const monthHref = `/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${dateYear}/${String(dateMonth).padStart(2, "0")}`;

  useEffect(() => {
    latestData.current = data;
  }, [data]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    if (!firebaseUser) throw new Error("Sessão não disponível.");
    const token = await firebaseUser.getIdToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
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
      const payload = await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}`);
      setData({ closure: payload.closure, lines: withPdvAutomaticCounts(payload.lines) });
      setSeniorDivergenceCents(payload.settings?.seniorDivergenceCents ?? 1_000);
      setSaveState("idle");
    } catch (error) {
      if (error instanceof Error && error.message.includes("não encontrado")) setData(null);
      else toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally {
      setLoading(false);
    }
  }, [api, closureId, firebaseUser, toast]);

  useEffect(() => { void load(); }, [load]);

  const cashierEditable = !!data && ["draft", "reopened"].includes(data.closure.status) && permissions.financial?.cashClosures?.edit;
  const financeEditable = !!data && data.closure.status === "pending_review" && permissions.financial?.cashClosures?.approve;
  const editable = cashierEditable || financeEditable;
  const requiresSeniorApproval = !!data && data.lines.some(
    (line) => Math.abs(line.differenceCents ?? 0) > seniorDivergenceCents,
  );

  const save = useCallback(async () => {
    const current = latestData.current;
    if (!current || !["draft", "reopened", "pending_review"].includes(current.closure.status)) return;
    setSaveState("saving");
    try {
      const payload = await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          lines: current.lines.map((line) => ({
            id: line.id,
            reportedCents: line.reportedCents,
            reportedNote: line.reportedNote,
            countedCents: line.countedCents,
            note: line.note,
          })),
        }),
      });
      setData({ closure: payload.closure, lines: withPdvAutomaticCounts(payload.lines) });
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha no autosave." });
      throw error;
    }
  }, [api, closureId, toast]);

  useEffect(() => {
    if (saveState !== "dirty" || !editable) return;
    const timer = window.setTimeout(() => { void save(); }, 1000);
    return () => window.clearTimeout(timer);
  }, [editable, save, saveState, data?.lines]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState !== "dirty" && saveState !== "saving" && saveState !== "error") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  function updateLine(id: string, patch: Partial<Pick<CashClosureLine, "reportedCents" | "reportedNote" | "countedCents" | "note">>) {
    setData((current) => {
      if (!current) return current;
      const lines = current.lines.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        next.reportedDifferenceCents = next.reportedCents === null ? null : next.reportedCents - next.expectedCents;
        next.conferenceDifferenceCents = next.countedCents === null || next.reportedCents === null
          ? null
          : next.countedCents - next.reportedCents;
        next.differenceCents = next.countedCents === null ? null : next.countedCents - next.expectedCents;
        next.status = next.differenceCents === null ? "pending" : next.differenceCents === 0 ? "matched" : "divergent";
        return next;
      });
      return { ...current, lines };
    });
    setSaveState("dirty");
  }

  const sync = useCallback(async () => {
    setWorking("sync");
    try {
      const payload = await api("/api/financial/cash-closures/sync", {
        method: "POST",
        body: JSON.stringify({ kioskId, date }),
      });
      setData({ closure: payload.closure, lines: withPdvAutomaticCounts(payload.lines) });
      setSaveState("idle");
      toast({ title: payload.created ? "Fechamento criado a partir do PDV." : "Fechamento ressincronizado." });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na sincronização." });
    } finally {
      setWorking(null);
    }
  }, [api, date, kioskId, toast]);

  useEffect(() => {
    const needsIntervalBackfill =
      !!data &&
      ["draft", "reopened"].includes(data.closure.status) &&
      data.lines.length > 0 &&
      data.lines.some((line) => !line.metadata.firstCouponAt || !line.metadata.lastCouponAt);
    if (
      !needsIntervalBackfill ||
      !permissions.financial?.cashClosures?.resync ||
      intervalBackfillAttempted.current
    ) return;
    intervalBackfillAttempted.current = true;
    void sync();
  }, [data, permissions.financial?.cashClosures?.resync, sync]);

  async function submit() {
    setWorking("submit");
    try {
      if (["dirty", "error"].includes(saveState)) await save();
      await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/submit`, { method: "POST" });
      toast({ title: "Fechamento enviado para revisão." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao finalizar." });
    } finally {
      setWorking(null);
    }
  }

  async function runReasonAction() {
    if (!reasonAction) return;
    setWorking(reasonAction);
    try {
      if (reasonAction === "approve" && ["dirty", "error"].includes(saveState)) await save();
      const payload = await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/${reasonAction}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      toast({ title: reasonAction === "approve" ? "Fechamento aprovado." : "Fechamento reaberto." });
      if (payload.allocationError) {
        toast({ variant: "destructive", title: "Fechamento aprovado, mas a alocação ficou pendente.", description: payload.allocationError });
      }
      setReasonAction(null);
      setReason("");
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na ação." });
    } finally {
      setWorking(null);
    }
  }

  async function splitOversizedDeposit() {
    if (!data) return;
    const partsCents: number[] = [];
    let remaining = data.closure.cashDeposit.eligibleCents;
    while (remaining > 0) {
      const part = Math.min(500_000, remaining);
      partsCents.push(part);
      remaining -= part;
    }
    setWorking("split-deposit");
    try {
      await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/split-deposit`, {
        method: "POST",
        body: JSON.stringify({ partsCents }),
      });
      toast({ title: `Dinheiro dividido em ${partsCents.length} partes e alocado.` });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na divisão." });
    } finally { setWorking(null); }
  }

  const groups = useMemo(() => {
    const grouped = new Map<string, CashClosureLine[]>();
    for (const line of data?.lines ?? []) {
      const key = `${line.operatorId}::${line.operatorName}`;
      grouped.set(key, [...(grouped.get(key) ?? []), line]);
    }
    return [...grouped.entries()].map(([key, lines]) => ({ key, name: lines[0].operatorName, lines }));
  }, [data?.lines]);

  const liveSummary = useMemo(() => {
    const lines = data?.lines ?? [];
    return {
      expected: lines.reduce((total, line) => total + line.expectedCents, 0),
      reported: lines.reduce((total, line) => total + (line.reportedCents ?? 0), 0),
      counted: lines.reduce((total, line) => total + (line.countedCents ?? 0), 0),
      difference: lines.reduce((total, line) => total + (line.differenceCents ?? 0), 0),
      unreported: lines.filter((line) => line.reportedCents === null).length,
      pending: lines.filter((line) => line.countedCents === null).length,
    };
  }, [data?.lines]);

  const depositBatchIds = useMemo(() => {
    const deposit = data?.closure.cashDeposit;
    if (!deposit) return [];
    return Array.from(new Set(
      deposit.manualSplitBatchIds?.length
        ? deposit.manualSplitBatchIds
        : deposit.batchId
          ? [deposit.batchId]
          : [],
    ));
  }, [data?.closure.cashDeposit]);
  if (!permissions.financial?.cashClosures?.view) {
    return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui acesso a fechamentos de caixa.</div>;
  }
  if (loading) return <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!data) {
    return <Card><CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 p-10 text-center">
      <CircleDollarSign className="h-10 w-10 text-muted-foreground" />
      <div><h1 className="text-xl font-bold">Fechamento ainda não sincronizado</h1><p className="text-sm text-muted-foreground">{kioskId} · {date}</p></div>
      {permissions.financial.cashClosures.resync && <Button onClick={() => void sync()} disabled={working === "sync"}>{working === "sync" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sincronizar PDV</Button>}
    </CardContent></Card>;
  }

  return <div className="mx-auto w-full max-w-[1180px] space-y-4 pb-10">
    <CashControlNavigation active="closures" crumbs={[{ label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" }, { label: data.closure.kioskName, href: `/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}` }, { label: monthLabel, href: monthHref }, { label: date.split("-").reverse().join("/") }]} />
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="text-[26px] font-black tracking-tight">{data.closure.kioskName}</h1><Badge variant="outline" className={cn("rounded-full px-3 py-1 text-[11.5px] font-extrabold", data.closure.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ["pending_review", "reopened"].includes(data.closure.status) ? "border-amber-200 bg-amber-50 text-amber-800" : "border-stone-200 bg-stone-100 text-zinc-500")}>{STATUS_LABEL[data.closure.status]}</Badge></div>
        <p className="mt-1.5 text-[13.5px] font-semibold text-zinc-500">
          Fechamento de {date.split("-").reverse().join("/")} · {groups.length} {groups.length === 1 ? "operador" : "operadores"} · {data.lines.length} {data.lines.length === 1 ? "lançamento" : "lançamentos"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-10 rounded-xl border-stone-200 font-bold"><Link href={monthHref}><ArrowLeft className="mr-2 h-4 w-4" />Voltar ao mês</Link></Button>
        {permissions.financial.cashClosures.resync && <Button variant="outline" className="h-10 rounded-xl border-stone-200 font-bold" onClick={() => void sync()} disabled={!!working}><RefreshCw className="mr-2 h-4 w-4" />Ressincronizar</Button>}
        {editable && <Button variant="outline" className="h-10 rounded-xl border-stone-200 font-bold" onClick={() => void save()} disabled={saveState === "saving" || !!working}><Save className="mr-2 h-4 w-4" />Salvar</Button>}
        {cashierEditable && <Button className="h-10 rounded-xl bg-pink-600 px-4 font-extrabold text-white hover:bg-pink-700" onClick={() => void submit()} disabled={!!working}><Send className="mr-2 h-4 w-4" />Enviar ao Financeiro</Button>}
        {permissions.financial.cashClosures.approve && data.closure.status === "pending_review" && <Button className="h-10 rounded-xl bg-emerald-700 px-4 font-extrabold hover:bg-emerald-800" onClick={() => setReasonAction("approve")}><CheckCircle2 className="mr-2 h-4 w-4" />Finalizar conferência</Button>}
        {permissions.financial.cashClosures.reopen && ["pending_review", "approved"].includes(data.closure.status) && <Button variant="outline" className="h-10 rounded-xl border-stone-200 font-bold" onClick={() => setReasonAction("reopen")}><RotateCcw className="mr-2 h-4 w-4" />Reabrir</Button>}
      </div>
    </div>

    <div className="flex min-h-6 items-center gap-2 text-xs text-muted-foreground">
      {saveState === "dirty" && <><AlertTriangle className="h-3.5 w-3.5 text-amber-600" />Alterações pendentes</>}
      {saveState === "saving" && <><Loader2 className="h-3.5 w-3.5 animate-spin" />Salvando automaticamente</>}
      {saveState === "saved" && <><Check className="h-3.5 w-3.5 text-emerald-600" />Salvo automaticamente</>}
      {saveState === "error" && <><AlertTriangle className="h-3.5 w-3.5 text-rose-600" />Falha ao salvar; não feche a página</>}
      {data.closure.pdvChangedAfterApproval && <span className="rounded bg-rose-50 px-2 py-1 font-semibold text-rose-700">O PDV mudou após a aprovação</span>}
    </div>

    <div className="flex items-center gap-2.5 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-[12.5px] text-zinc-500">
      <LockKeyhole className="h-4 w-4 shrink-0 text-zinc-400" />
      <span><strong className="text-zinc-900">Pix e cartões são conferidos automaticamente pelo PDV</strong> e ficam travados. Só o <strong className="text-zinc-900">dinheiro</strong> exige contagem do Caixa e do Financeiro.</span>
    </div>

    {data.closure.source.unknownPaymentNames.length > 0 && <div className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"><strong>Formas não mapeadas:</strong> {data.closure.source.unknownPaymentNames.join(", ")}</div>}
    {data.closure.cashDeposit.manualSplitRequired && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><div><strong>Dinheiro acima de R$ 5.000,00.</strong><p>O fechamento tem {formatBRL(data.closure.cashDeposit.eligibleCents)} e precisa ser dividido manualmente em partes de até R$ 5.000,00.</p></div>{permissions.financial?.cashDeposits?.adjust && <Button variant="outline" onClick={() => void splitOversizedDeposit()} disabled={!!working}>{working === "split-deposit" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar divisão sugerida</Button>}</div>}
    {data.closure.status === "approved" && <Card className="rounded-2xl border-stone-200 shadow-[0_2px_10px_rgba(15,23,42,.04)]">
      <CardHeader className="pb-3"><CardTitle className="text-base">Referência do depósito</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{DEPOSIT_STATUS_LABEL[data.closure.cashDeposit.status]}</p>
          <p className="text-xs text-muted-foreground">Dinheiro elegível: {formatBRL(data.closure.cashDeposit.eligibleCents)}</p>
        </div>
        {depositBatchIds.length > 0
          ? <div className="flex flex-wrap gap-2">{depositBatchIds.map((batchId) => <Button key={batchId} asChild size="sm" variant="outline"><Link href={`/dashboard/financial/cash-deposits#deposit-${batchId}`}>{cashDepositBatchReferenceFromId(kioskId, batchId)}</Link></Button>)}</div>
          : <span className="text-xs text-muted-foreground">A referência aparecerá após a alocação do dinheiro.</span>}
      </CardContent>
    </Card>}

    {groups.length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Dia sem movimento. O fechamento zerado pode ser finalizado diretamente.</CardContent></Card> : groups.map((group) => {
      const expected = group.lines.reduce((total, line) => total + line.expectedCents, 0);
      const financePending = group.lines.some((line) => line.countedCents === null);
      const difference = group.lines.reduce((total, line) => total + (line.differenceCents ?? 0), 0);
      const initials = group.name.split(" ").slice(0, 2).map((part) => part[0]).join("");
      const interval = operatorInterval(group.lines);
      const groupResult = financePending ? null : resultText(difference);
      return <Card key={group.key} className="overflow-hidden rounded-[18px] border-stone-200 shadow-[0_2px_10px_rgba(15,23,42,.05)]">
        <CardHeader className="border-b border-stone-100 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-pink-100 text-xs font-black text-pink-600">{initials}</span><div><CardTitle className="text-[15px] font-bold">{group.name}</CardTitle>{interval && <p className="mt-0.5 text-[11.5px] font-semibold text-zinc-400">{interval}</p>}</div></div><div className="flex flex-wrap items-center justify-end gap-2"><span className="inline-flex h-7 items-center rounded-full bg-stone-100 px-3 font-mono text-[11.5px] font-bold text-zinc-600"><span className="mr-1.5 font-sans font-semibold text-zinc-400">PDV</span>{formatBRL(expected)}</span><span className={cn("inline-flex h-7 items-center rounded-full px-3 text-[11.5px] font-extrabold", groupResult?.className ?? "bg-stone-100 text-zinc-500", !groupResult ? "bg-stone-100" : difference === 0 ? "bg-emerald-50" : "bg-rose-50")}>{!groupResult ? "Aguardando Financeiro" : difference === 0 ? <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Tudo confere</> : groupResult.label}</span></div></div></CardHeader>
        <CardContent className="space-y-0 !p-0">
          <div className="hidden grid-cols-[14px_minmax(170px,1.5fr)_130px_150px_150px_minmax(150px,190px)] gap-3 border-b border-stone-100 bg-stone-50/80 px-5 py-2.5 text-[9.5px] font-extrabold uppercase tracking-[.06em] text-zinc-400 lg:grid"><span /><span>Canal</span><span className="text-right">PDV · esperado</span><span className="text-right">Caixa · contado</span><span className="text-right">Financeiro · conferido</span><span>Resultado</span></div>
          {group.lines.map((line) => {
            const result = resultText(line.differenceCents);
            const hasReportedDifference = line.reportedDifferenceCents !== null && line.reportedDifferenceCents !== 0;
            const hasFinanceDifference = line.countedCents !== null && (line.differenceCents !== 0 || line.conferenceDifferenceCents !== 0);
            const automatic = isPdvAutoCountedChannel(line.channel);
            const complete = line.reportedCents !== null && line.countedCents !== null;
            return <div key={line.id} className={cn("grid gap-3 border-b border-stone-100 px-5 py-3.5 last:border-b-0 lg:grid-cols-[14px_minmax(170px,1.5fr)_130px_150px_150px_minmax(150px,190px)] lg:items-center", (hasReportedDifference || hasFinanceDifference) && "bg-rose-50/35")}>
              <span className={cn("hidden h-[34px] w-[5px] rounded-full lg:block", complete && line.differenceCents === 0 ? "bg-emerald-500" : complete ? "bg-rose-500" : "bg-amber-400")} />
              <div className="flex items-center gap-2.5 font-semibold"><ChannelIcon line={line} /><span>{channelName(line)}{line.channel === "cash" && <span className="mt-0.5 block text-[10.5px] font-medium text-zinc-400">{formatBRL(line.metadata.grossCashCents ?? line.expectedCents)} recebido − {formatBRL(line.metadata.changeCents ?? 0)} troco</span>}</span>{line.channel === "cash" && <Popover><PopoverTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7"><Info className="h-4 w-4" /><span className="sr-only">Ver composição do dinheiro</span></Button></PopoverTrigger><PopoverContent align="start" className="space-y-2 text-sm"><p className="font-semibold">Composição do dinheiro</p><div className="flex justify-between"><span>Recebido</span><strong>{formatBRL(line.metadata.grossCashCents ?? line.expectedCents)}</strong></div><div className="flex justify-between"><span>Troco</span><strong>- {formatBRL(line.metadata.changeCents ?? 0)}</strong></div><div className="flex justify-between border-t pt-2"><span>Líquido esperado</span><strong>{formatBRL(line.expectedCents)}</strong></div></PopoverContent></Popover>}</div>
              <div className="text-right font-mono text-sm">{formatBRL(line.expectedCents)}</div>
              <div className="relative"><CentsInput value={line.reportedCents} onChange={(value) => updateLine(line.id, { reportedCents: value })} disabled={!cashierEditable || automatic} ariaLabel={`Valor informado pelo caixa em ${channelName(line)} para ${group.name}`} className={cn("h-9 rounded-[10px] border-stone-300 bg-stone-50 font-mono text-[13px]", automatic && "border-dashed bg-stone-100 pl-8 text-zinc-500")} />{automatic && <LockKeyhole className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />}</div>
              <div className="relative"><CentsInput value={line.countedCents} onChange={(value) => updateLine(line.id, { countedCents: value })} disabled={!financeEditable || automatic} ariaLabel={`Valor conferido pelo financeiro em ${channelName(line)} para ${group.name}`} className={cn("h-9 rounded-[10px] border-stone-300 bg-stone-50 font-mono text-[13px]", automatic && "border-dashed bg-stone-100 pl-8 text-zinc-500", financeEditable && !automatic && "border-pink-500 bg-white ring-2 ring-pink-100")} />{automatic && <LockKeyhole className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />}</div>
              <div><strong className={cn("inline-flex min-h-7 items-center rounded-full px-3 text-[11.5px] font-extrabold", line.reportedCents === null || line.countedCents === null ? "bg-stone-100 text-zinc-500" : line.differenceCents === 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{line.reportedCents === null ? "Caixa não informou" : line.countedCents === null ? "Aguardando Financeiro" : automatic ? <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Conferido</> : result.label}</strong>{hasReportedDifference && <p className="mt-1 text-[10.5px] text-zinc-500">Caixa × PDV: {differenceLabel(line.reportedDifferenceCents)}</p>}{line.conferenceDifferenceCents !== null && line.conferenceDifferenceCents !== 0 && <p className="text-[10.5px] text-zinc-500">Financeiro × Caixa: {differenceLabel(line.conferenceDifferenceCents)}</p>}</div>
              {hasReportedDifference && <div className="lg:col-span-6 lg:pl-[29px]"><Textarea value={line.reportedNote ?? ""} onChange={(event) => updateLine(line.id, { reportedNote: event.target.value })} disabled={!cashierEditable} placeholder="Justificativa obrigatória do Caixa para a diferença em relação ao PDV" className="min-h-[52px] border-rose-200 bg-rose-50/40 text-[12.5px]" /></div>}
              {hasFinanceDifference && <div className="lg:col-span-6 lg:pl-[29px]"><Textarea value={line.note ?? ""} onChange={(event) => updateLine(line.id, { note: event.target.value })} disabled={!financeEditable} placeholder="Parecer obrigatório do Financeiro sobre a diferença apurada" className="min-h-[52px] border-rose-200 bg-rose-50/40 text-[12.5px]" /></div>}
            </div>;
          })}
        </CardContent>
      </Card>;
    })}

    {requiresSeniorApproval && <div className="flex items-start gap-3 rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] leading-5 text-rose-900"><AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" /><span><strong>Aprovação sênior necessária.</strong> A diferença final entre Financeiro e PDV ultrapassa {formatBRL(seniorDivergenceCents)}; a aprovação exige também permissão de reabertura.</span></div>}

    <Card className="overflow-hidden border-0 bg-zinc-900 text-white shadow-[0_14px_34px_-12px_rgba(0,0,0,.5)]"><CardContent className="grid items-stretch !p-0 sm:grid-cols-3 lg:grid-cols-[1.3fr_1fr_1fr_1fr_.9fr_.9fr]">
      <SummaryMetric label="Total PDV" value={formatBRL(liveSummary.expected)} prominent />
      <SummaryMetric label="Informado Caixa" value={liveSummary.unreported > 0 ? "—" : formatBRL(liveSummary.reported)} />
      <SummaryMetric label="Conferido Financeiro" value={liveSummary.pending > 0 ? "—" : formatBRL(liveSummary.counted)} />
      <SummaryMetric label="Diferença final" value={liveSummary.pending ? "—" : differenceLabel(liveSummary.difference)} valueClass={liveSummary.pending ? "text-zinc-500" : resultText(liveSummary.difference).className} />
      <SummaryMetric label="A informar Caixa" value={String(liveSummary.unreported)} valueClass={liveSummary.unreported ? "text-amber-300" : "text-emerald-300"} />
      <SummaryMetric label="A conferir Financeiro" value={String(liveSummary.pending)} valueClass={liveSummary.pending ? "text-amber-300" : "text-emerald-300"} />
    </CardContent></Card>

    <Dialog open={reasonAction !== null} onOpenChange={(open) => { if (!open) { setReasonAction(null); setReason(""); } }}>
      <DialogContent className="rounded-[20px] sm:max-w-[460px]">
        <DialogHeader><DialogTitle>{reasonAction === "approve" ? "Finalizar conferência financeira" : "Reabrir fechamento"}</DialogTitle><DialogDescription>{reasonAction === "approve" ? "Confirme a contagem física do Financeiro. Somente o dinheiro conferido seguirá para depósito." : "A reabertura volta a permitir alterações e exige justificativa."}</DialogDescription></DialogHeader>
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo obrigatório" />
        <DialogFooter><Button variant="outline" onClick={() => setReasonAction(null)}>Cancelar</Button><Button onClick={() => void runReasonAction()} disabled={reason.trim().length < 3 || !!working}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function SummaryMetric({ label, value, valueClass, prominent = false }: { label: string; value: string; valueClass?: string; prominent?: boolean }) {
  return <div className="flex min-w-0 flex-col justify-center border-zinc-700/70 px-5 py-4 text-left sm:border-l sm:first:border-l-0"><p className="text-[9.5px] font-extrabold uppercase tracking-[.06em] text-zinc-500">{label}</p><p className={cn("mt-1 whitespace-nowrap font-mono text-[16px] font-extrabold", prominent && "text-xl", valueClass)}>{value}</p></div>;
}
