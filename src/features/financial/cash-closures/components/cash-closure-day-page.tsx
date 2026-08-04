"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Info,
  Loader2,
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
import type { CashClosure, CashClosureLine, CashClosureWithLines } from "../types";
import { cashDepositBatchReferenceFromId } from "../../cash-deposits/references";
import { CentsInput } from "./cents-input";

type Props = { kioskId: string; date: string };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const STATUS_LABEL: Record<CashClosure["status"], string> = {
  not_synced: "Não sincronizado",
  draft: "Rascunho",
  pending_review: "Aguardando revisão",
  approved: "Aprovado",
  reopened: "Reaberto",
  sync_error: "Erro de sincronização",
};

const DEPOSIT_STATUS_LABEL: Record<CashClosure["cashDeposit"]["status"], string> = {
  not_eligible: "Sem dinheiro elegível",
  not_allocated: "Aguardando alocação",
  allocated: "Alocado",
  issued: "Cobrança emitida",
  paid: "Pago",
  adjusted: "Ajustado",
};

function resultText(differenceCents: number | null) {
  if (differenceCents === null) return { label: "Pendente", className: "text-amber-700" };
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
  const closureId = `${kioskId}_${date}`;

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
      setData({ closure: payload.closure, lines: payload.lines });
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

  const editable = !!data && ["draft", "reopened"].includes(data.closure.status) && permissions.financial?.cashClosures?.edit;
  const requiresSeniorApproval = !!data && data.lines.some(
    (line) => Math.abs(line.differenceCents ?? 0) > seniorDivergenceCents,
  );

  const save = useCallback(async () => {
    const current = latestData.current;
    if (!current || !["draft", "reopened"].includes(current.closure.status)) return;
    setSaveState("saving");
    try {
      const payload = await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          lines: current.lines.map((line) => ({ id: line.id, countedCents: line.countedCents, note: line.note })),
        }),
      });
      setData({ closure: payload.closure, lines: payload.lines });
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

  function updateLine(id: string, patch: Partial<Pick<CashClosureLine, "countedCents" | "note">>) {
    setData((current) => {
      if (!current) return current;
      const lines = current.lines.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        next.differenceCents = next.countedCents === null ? null : next.countedCents - next.expectedCents;
        next.status = next.differenceCents === null ? "pending" : next.differenceCents === 0 ? "matched" : "divergent";
        return next;
      });
      return { ...current, lines };
    });
    setSaveState("dirty");
  }

  async function sync() {
    setWorking("sync");
    try {
      const payload = await api("/api/financial/cash-closures/sync", {
        method: "POST",
        body: JSON.stringify({ kioskId, date }),
      });
      setData({ closure: payload.closure, lines: payload.lines });
      setSaveState("idle");
      toast({ title: payload.created ? "Fechamento criado a partir do PDV." : "Fechamento ressincronizado." });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na sincronização." });
    } finally {
      setWorking(null);
    }
  }

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
      counted: lines.reduce((total, line) => total + (line.countedCents ?? 0), 0),
      difference: lines.reduce((total, line) => total + (line.differenceCents ?? 0), 0),
      pending: lines.filter((line) => line.countedCents === null).length,
      divergent: lines.filter((line) => line.differenceCents !== null && line.differenceCents !== 0).length,
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

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight">{data.closure.kioskName}</h1><Badge variant={data.closure.status === "approved" ? "default" : "outline"}>{STATUS_LABEL[data.closure.status]}</Badge></div>
        <p className="text-sm text-muted-foreground">Fechamento de {date.split("-").reverse().join("/")} · filial PDV {data.closure.pdvFilialId}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {permissions.financial.cashClosures.resync && <Button variant="outline" onClick={() => void sync()} disabled={!!working}><RefreshCw className="mr-2 h-4 w-4" />Ressincronizar</Button>}
        {editable && <Button variant="outline" onClick={() => void save()} disabled={saveState === "saving" || !!working}><Save className="mr-2 h-4 w-4" />Salvar</Button>}
        {editable && <Button onClick={() => void submit()} disabled={!!working}><Send className="mr-2 h-4 w-4" />Finalizar</Button>}
        {permissions.financial.cashClosures.approve && ["pending_review", "reopened"].includes(data.closure.status) && <Button onClick={() => setReasonAction("approve")}><CheckCircle2 className="mr-2 h-4 w-4" />Aprovar</Button>}
        {permissions.financial.cashClosures.reopen && ["pending_review", "approved"].includes(data.closure.status) && <Button variant="outline" onClick={() => setReasonAction("reopen")}><RotateCcw className="mr-2 h-4 w-4" />Reabrir</Button>}
      </div>
    </div>

    <div className="flex min-h-6 items-center gap-2 text-xs text-muted-foreground">
      {saveState === "dirty" && <><AlertTriangle className="h-3.5 w-3.5 text-amber-600" />Alterações pendentes</>}
      {saveState === "saving" && <><Loader2 className="h-3.5 w-3.5 animate-spin" />Salvando automaticamente</>}
      {saveState === "saved" && <><Check className="h-3.5 w-3.5 text-emerald-600" />Salvo automaticamente</>}
      {saveState === "error" && <><AlertTriangle className="h-3.5 w-3.5 text-rose-600" />Falha ao salvar; não feche a página</>}
      {data.closure.pdvChangedAfterApproval && <span className="rounded bg-rose-50 px-2 py-1 font-semibold text-rose-700">O PDV mudou após a aprovação</span>}
    </div>

    {data.closure.source.unknownPaymentNames.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Formas não mapeadas:</strong> {data.closure.source.unknownPaymentNames.join(", ")}</div>}
    {requiresSeniorApproval && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><strong>Aprovação sênior necessária.</strong> Há uma linha com divergência acima de {formatBRL(seniorDivergenceCents)}; a aprovação exige também permissão de reabertura.</div>}
    {data.closure.cashDeposit.manualSplitRequired && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><div><strong>Dinheiro acima de R$ 5.000,00.</strong><p>O fechamento tem {formatBRL(data.closure.cashDeposit.eligibleCents)} e precisa ser dividido manualmente em partes de até R$ 5.000,00.</p></div>{permissions.financial?.cashDeposits?.adjust && <Button variant="outline" onClick={() => void splitOversizedDeposit()} disabled={!!working}>{working === "split-deposit" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar divisão sugerida</Button>}</div>}
    {data.closure.status === "approved" && <Card>
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
      const counted = group.lines.reduce((total, line) => total + (line.countedCents ?? 0), 0);
      const pending = group.lines.some((line) => line.countedCents === null);
      const difference = group.lines.reduce((total, line) => total + (line.differenceCents ?? 0), 0);
      return <Card key={group.key}>
        <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="text-base">{group.name}</CardTitle><div className="text-sm tabular-nums"><span className="text-muted-foreground">PDV {formatBRL(expected)} · Físico {formatBRL(counted)} · </span><strong className={resultText(pending ? null : difference).className}>{resultText(pending ? null : difference).label}</strong></div></div></CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden grid-cols-[minmax(180px,1fr)_140px_160px_150px] gap-3 border-b pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid"><span>Canal</span><span className="text-right">PDV</span><span className="text-right">Físico</span><span>Resultado</span></div>
          {group.lines.map((line) => {
            const result = resultText(line.differenceCents);
            return <div key={line.id} className={cn("grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(180px,1fr)_140px_160px_150px] md:items-center", line.differenceCents !== null && line.differenceCents !== 0 && "border-amber-200 bg-amber-50/40")}>
              <div className="flex items-center gap-2 font-semibold">{channelName(line)}{line.channel === "cash" && <Popover><PopoverTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7"><Info className="h-4 w-4" /><span className="sr-only">Ver composição do dinheiro</span></Button></PopoverTrigger><PopoverContent align="start" className="space-y-2 text-sm"><p className="font-semibold">Composição do dinheiro</p><div className="flex justify-between"><span>Recebido</span><strong>{formatBRL(line.metadata.grossCashCents ?? line.expectedCents)}</strong></div><div className="flex justify-between"><span>Troco</span><strong>- {formatBRL(line.metadata.changeCents ?? 0)}</strong></div><div className="flex justify-between border-t pt-2"><span>Líquido esperado</span><strong>{formatBRL(line.expectedCents)}</strong></div></PopoverContent></Popover>}</div>
              <div className="text-right font-mono text-sm">{formatBRL(line.expectedCents)}</div>
              <CentsInput value={line.countedCents} onChange={(value) => updateLine(line.id, { countedCents: value })} disabled={!editable} ariaLabel={`Valor físico de ${channelName(line)} para ${group.name}`} />
              <strong className={cn("text-sm", result.className)}>{result.label}</strong>
              {line.differenceCents !== null && line.differenceCents !== 0 && <div className="md:col-span-4"><Textarea value={line.note ?? ""} onChange={(event) => updateLine(line.id, { note: event.target.value })} disabled={!editable} placeholder="Observação obrigatória para esta divergência" className="min-h-20" /></div>}
            </div>;
          })}
        </CardContent>
      </Card>;
    })}

    <Card className="sticky bottom-3 border-slate-300 shadow-lg"><CardContent className="grid gap-4 p-4 sm:grid-cols-5">
      <div><p className="text-xs text-muted-foreground">PDV</p><p className="font-bold tabular-nums">{formatBRL(liveSummary.expected)}</p></div>
      <div><p className="text-xs text-muted-foreground">Físico</p><p className="font-bold tabular-nums">{formatBRL(liveSummary.counted)}</p></div>
      <div><p className="text-xs text-muted-foreground">Diferença</p><p className={cn("font-bold tabular-nums", resultText(liveSummary.pending ? null : liveSummary.difference).className)}>{liveSummary.pending ? "—" : formatBRL(liveSummary.difference)}</p></div>
      <div><p className="text-xs text-muted-foreground">Pendentes</p><p className="font-bold">{liveSummary.pending}</p></div>
      <div><p className="text-xs text-muted-foreground">Divergentes</p><p className="font-bold">{liveSummary.divergent}</p></div>
    </CardContent></Card>

    <Dialog open={reasonAction !== null} onOpenChange={(open) => { if (!open) { setReasonAction(null); setReason(""); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{reasonAction === "approve" ? "Aprovar fechamento" : "Reabrir fechamento"}</DialogTitle><DialogDescription>{reasonAction === "approve" ? "Registre o parecer usado na aprovação." : "A reabertura volta a permitir alterações e exige justificativa."}</DialogDescription></DialogHeader>
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo obrigatório" />
        <DialogFooter><Button variant="outline" onClick={() => setReasonAction(null)}>Cancelar</Button><Button onClick={() => void runReasonAction()} disabled={reason.trim().length < 3 || !!working}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
