"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Loader2, LockKeyhole, RefreshCw, Save, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isCurrentDraftLoad, isCurrentDraftRevision, persistLatestDraft } from "@/features/financial/cash-closures/latest-draft-save";
import { formatBRL } from "@/features/financial/cash-closures/money";
import { todayInClosureTimezone } from "@/features/financial/cash-closures/date";
import { CentsInput } from "@/features/financial/cash-closures/components/cents-input";
import { isPdvAutoCountedChannel } from "@/features/financial/cash-closures/channel-normalization";
import type {
  CashClosureLine,
  CashClosureOperator,
  CashClosureWithLines,
} from "@/features/financial/cash-closures/types";
import type { CashCountingSession } from "../types";

type Unit = { id: string; name: string };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type ClosurePayload = CashClosureWithLines & {
  activeCountingSessionId?: string | null;
};

type Props = {
  open: boolean;
  session: CashCountingSession;
  unit: Unit;
  editable: boolean;
  onClose: () => void;
  onSessionChanged: () => void | Promise<void>;
};

function groupsFromPayload(data: CashClosureWithLines | null) {
  if (!data) return [];
  const linesByOperator = new Map<string, CashClosureLine[]>();
  for (const line of data.lines) {
    linesByOperator.set(line.operatorId, [...(linesByOperator.get(line.operatorId) ?? []), line]);
  }
  const operatorById = new Map(data.operators.map((operator) => [operator.operatorId, operator]));
  return [...linesByOperator.entries()].map(([operatorId, lines]) => ({
    operatorId,
    name: lines[0]?.operatorName ?? operatorId,
    lines,
    operator: operatorById.get(operatorId) ?? null,
  }));
}

function updatedLine(
  line: CashClosureLine,
  patch: Partial<Pick<CashClosureLine, "reportedCents" | "reportedNote" | "countedCents" | "note">>,
) {
  const next = { ...line, ...patch };
  const reportedDifferenceCents = next.reportedCents === null
    ? null
    : next.reportedCents - next.expectedCents;
  const conferenceDifferenceCents = next.countedCents === null || next.reportedCents === null
    ? null
    : next.countedCents - next.reportedCents;
  const differenceCents = next.countedCents === null ? null : next.countedCents - next.expectedCents;
  return {
    ...next,
    reportedDifferenceCents,
    conferenceDifferenceCents,
    differenceCents,
    status: differenceCents === null ? "pending" as const : differenceCents === 0 ? "matched" as const : "divergent" as const,
  };
}

function differenceLabel(value: number | null) {
  if (value === null) return "Aguardando";
  if (value === 0) return "Confere";
  return value > 0 ? `Sobra ${formatBRL(value)}` : `Falta ${formatBRL(Math.abs(value))}`;
}

function differenceClass(value: number | null) {
  if (value === null) return "bg-stone-100 text-zinc-500";
  if (value === 0) return "bg-emerald-50 text-emerald-700";
  return value > 0 ? "bg-blue-50 text-blue-700" : "bg-rose-50 text-rose-700";
}

export function CashCountingDialog({ open, session, unit, editable, onClose, onSessionChanged }: Props) {
  const { permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [date, setDate] = useState("");
  const [data, setData] = useState<CashClosureWithLines | null>(null);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [changingDate, setChangingDate] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const latestData = useRef<CashClosureWithLines | null>(null);
  const draftRevision = useRef(0);
  const dirtyLineIds = useRef<Set<string>>(new Set());
  const saveInFlight = useRef<Promise<void> | null>(null);
  const dateChangeInFlight = useRef<Promise<void> | null>(null);
  const closeInFlight = useRef<Promise<void> | null>(null);
  const loadRequestId = useRef(0);
  const activeDate = useRef("");
  const initializedKey = useRef<string | null>(null);

  useEffect(() => { latestData.current = data; }, [data]);

  const loadClosure = useCallback(async (targetDate: string) => {
    const targetClosureId = `${unit.id}_${targetDate}`;
    const targetKey = `${unit.id}:${targetDate}`;
    const requestId = ++loadRequestId.current;
    const requestRevision = draftRevision.current;
    setLoading(true);
    setMissing(false);
    setLoadError(false);
    try {
      const payload = await api<ClosurePayload>(`/api/financial/cash-closures/${encodeURIComponent(targetClosureId)}`);
      if (!isCurrentDraftLoad(
        { id: requestId, targetKey },
        { id: loadRequestId.current, targetKey: `${unit.id}:${activeDate.current}` },
      )) return;
      if (!isCurrentDraftRevision(requestRevision, draftRevision.current)) {
        setSaveState("dirty");
        return;
      }
      const next = { closure: payload.closure, lines: payload.lines, operators: payload.operators };
      dirtyLineIds.current.clear();
      latestData.current = next;
      setData(next);
      setSaveState("idle");
    } catch (error) {
      if (!isCurrentDraftLoad(
        { id: requestId, targetKey },
        { id: loadRequestId.current, targetKey: `${unit.id}:${activeDate.current}` },
      )) return;
      if (error instanceof Error && error.message.toLocaleLowerCase("pt-BR").includes("não encontrad")) {
        dirtyLineIds.current.clear();
        latestData.current = null;
        setData(null);
        setMissing(true);
      } else {
        setLoadError(true);
        toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar a contagem." });
      }
    } finally {
      if (isCurrentDraftLoad(
        { id: requestId, targetKey },
        { id: loadRequestId.current, targetKey: `${unit.id}:${activeDate.current}` },
      )) setLoading(false);
    }
  }, [api, toast, unit.id]);

  useEffect(() => {
    if (!open) {
      initializedKey.current = null;
      loadRequestId.current += 1;
      return;
    }
    const key = `${session.id}:${unit.id}`;
    if (initializedKey.current === key) return;
    initializedKey.current = key;
    const resumeDate = session.lastDraftKioskId === unit.id ? session.lastDraftDate ?? "" : "";
    activeDate.current = resumeDate;
    setDate(resumeDate);
    dirtyLineIds.current.clear();
    latestData.current = null;
    setData(null);
    setMissing(false);
    setLoadError(false);
    setSaveState("idle");
    draftRevision.current = 0;
    if (resumeDate) void loadClosure(resumeDate);
  }, [loadClosure, open, session.id, session.lastDraftDate, session.lastDraftKioskId, unit.id]);

  const save = useCallback(async () => {
    if (saveInFlight.current) return saveInFlight.current;
    const current = latestData.current;
    const targetDate = activeDate.current;
    if (!current || !targetDate || dirtyLineIds.current.size === 0 || !["draft", "reopened", "pending_review"].includes(current.closure.status)) return;
    const targetClosureId = `${unit.id}_${targetDate}`;

    const request = (async () => {
      setSaveState("saving");
      try {
        const didCommit = await persistLatestDraft({
          read: () => {
            const draft = latestData.current;
            const lineIds = [...dirtyLineIds.current];
            if (!draft || activeDate.current !== targetDate || lineIds.length === 0) return null;
            return { revision: draftRevision.current, value: { draft, lineIds } };
          },
          persist: ({ draft, lineIds }) => {
            const dirtyIds = new Set(lineIds);
            return api<ClosurePayload>(`/api/financial/cash-closures/${encodeURIComponent(targetClosureId)}`, {
            method: "PATCH",
            json: {
              countingSessionId: session.id,
              lines: draft.lines.filter((line) => dirtyIds.has(line.id)).map((line) => ({
                id: line.id,
                reportedCents: line.reportedCents,
                reportedNote: line.reportedNote,
                countedCents: line.countedCents,
                note: line.note,
              })),
            },
            });
          },
          commit: (payload) => {
            const next = { closure: payload.closure, lines: payload.lines, operators: payload.operators };
            dirtyLineIds.current.clear();
            latestData.current = next;
            setData(next);
            setSaveState("saved");
            setLastSavedAt(new Date().toISOString());
          },
        });
        if (!didCommit) setSaveState("idle");
      } catch (error) {
        setSaveState("error");
        toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha no salvamento automático." });
        throw error;
      }
    })();

    saveInFlight.current = request;
    try {
      await request;
    } finally {
      if (saveInFlight.current === request) saveInFlight.current = null;
    }
  }, [api, session.id, toast, unit.id]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = window.setTimeout(() => { void save().catch(() => undefined); }, 800);
    return () => window.clearTimeout(timer);
  }, [data?.lines, save, saveState]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!["dirty", "saving", "error"].includes(saveState)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  function updateClosureLine(
    lineId: string,
    patch: Partial<Pick<CashClosureLine, "reportedCents" | "reportedNote" | "countedCents" | "note">>,
  ) {
    if (!editable || changingDate) return;
    const current = latestData.current;
    if (!current) return;
    const next = {
      ...current,
      lines: current.lines.map((line) => {
        if (line.id !== lineId) return line;
        return updatedLine(line, patch);
      }),
    };
    draftRevision.current += 1;
    dirtyLineIds.current.add(lineId);
    latestData.current = next;
    setData(next);
    setSaveState("dirty");
  }

  async function changeDate(nextDate: string) {
    if (!editable || !nextDate || nextDate === activeDate.current || dateChangeInFlight.current) return;
    const request = (async () => {
      setChangingDate(true);
      try {
        if (dirtyLineIds.current.size > 0 || saveInFlight.current) await save();
        await api(`/api/financial/cash-counting-sessions/${session.id}/draft-position`, {
          method: "PATCH",
          json: { kioskId: unit.id, date: nextDate },
        });
        loadRequestId.current += 1;
        activeDate.current = nextDate;
        setDate(nextDate);
        dirtyLineIds.current.clear();
        latestData.current = null;
        setData(null);
        setMissing(false);
        setLoadError(false);
        setSaveState("idle");
        setLastSavedAt(null);
        draftRevision.current = 0;
        void Promise.resolve(onSessionChanged()).catch(() => undefined);
        await loadClosure(nextDate);
      } catch (error) {
        toast({ variant: "destructive", title: error instanceof Error ? error.message : "Não foi possível abrir esta data." });
      } finally {
        setChangingDate(false);
      }
    })();
    dateChangeInFlight.current = request;
    try {
      await request;
    } finally {
      if (dateChangeInFlight.current === request) dateChangeInFlight.current = null;
    }
  }

  async function syncClosure() {
    if (!date) return;
    setWorking("sync");
    try {
      const payload = await api<ClosurePayload>("/api/financial/cash-closures/sync", {
        method: "POST",
        json: { kioskId: unit.id, date },
      });
      const next = { closure: payload.closure, lines: payload.lines, operators: payload.operators };
      if (activeDate.current !== date) return;
      loadRequestId.current += 1;
      dirtyLineIds.current.clear();
      latestData.current = next;
      setData(next);
      setMissing(false);
      setSaveState("idle");
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao sincronizar o PDV." });
    } finally {
      setWorking(null);
    }
  }

  async function finalizeOperator(operator: CashClosureOperator) {
    const targetDate = activeDate.current;
    if (!editable || !targetDate) return;
    const closureId = `${unit.id}_${targetDate}`;
    setWorking(`finalize:${operator.operatorId}`);
    try {
      if (dirtyLineIds.current.size > 0 || saveInFlight.current) await save();
      await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/finalize`, {
        method: "POST",
        json: { operatorId: operator.operatorId, countingSessionId: session.id },
      });
      toast({ title: `Contagem de ${operator.operatorName} finalizada.` });
      await Promise.all([loadClosure(targetDate), onSessionChanged()]);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao finalizar o operador." });
    } finally {
      setWorking(null);
    }
  }

  async function requestClose() {
    if (closeInFlight.current) return closeInFlight.current;
    const request = (async () => {
      try {
        if (dateChangeInFlight.current) await dateChangeInFlight.current;
        if (dirtyLineIds.current.size > 0 || saveInFlight.current) await save();
        onClose();
      } catch {
        // O erro já foi exibido e o modal permanece aberto para preservar o rascunho.
      }
    })();
    closeInFlight.current = request;
    try {
      await request;
    } finally {
      if (closeInFlight.current === request) closeInFlight.current = null;
    }
  }

  const groups = useMemo(() => groupsFromPayload(data), [data]);
  const savedTime = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return <Dialog open={open} onOpenChange={(next) => { if (!next) void requestClose(); }}>
    <DialogContent hideClose className="h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[1080px] gap-0 overflow-hidden rounded-2xl p-0 sm:h-[min(860px,calc(100dvh-2rem))]">
      <DialogHeader className="border-b border-stone-100 px-4 py-4 text-left sm:px-6">
        <div className="flex items-start justify-between gap-4 pr-1">
          <div><DialogTitle className="text-xl font-black">Contar malote</DialogTitle><DialogDescription className="mt-1">{unit.name} · o rascunho é salvo sem finalizar o operador.</DialogDescription></div>
          <Button type="button" size="icon" variant="ghost" className="shrink-0 rounded-full" aria-label="Fechar contagem" disabled={changingDate} onClick={() => void requestClose()}><X className="h-4 w-4" /></Button>
        </div>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="grid gap-3 border-b border-stone-100 bg-stone-50/70 px-4 py-3 sm:grid-cols-[minmax(220px,320px)_1fr] sm:items-end sm:px-6">
          <label><span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-zinc-500">Data do malote</span><Input type="date" max={todayInClosureTimezone()} value={date} disabled={!editable || changingDate || !!working} onChange={(event) => void changeDate(event.target.value)} className="h-11 bg-white" /></label>
          <div className="flex min-h-8 items-center gap-2 text-xs text-zinc-500 sm:justify-end">
            {changingDate && <><Loader2 className="h-4 w-4 animate-spin" />Abrindo a data…</>}
            {saveState === "dirty" && <><AlertTriangle className="h-4 w-4 text-amber-600" />Alterações pendentes</>}
            {saveState === "saving" && <><Loader2 className="h-4 w-4 animate-spin" />Salvando automaticamente…</>}
            {saveState === "saved" && <><Check className="h-4 w-4 text-emerald-600" />Salvo{savedTime ? ` às ${savedTime}` : ""}</>}
            {saveState === "error" && <><AlertTriangle className="h-4 w-4 text-rose-600" />Falha ao salvar; o modal permanecerá aberto</>}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {!date ? <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-stone-300 bg-stone-50 text-center"><div><Save className="mx-auto h-9 w-9 text-zinc-300" /><p className="mt-3 font-bold">Informe a data impressa no malote</p><p className="mt-1 text-sm text-zinc-500">Ao voltar, esta será a última data aberta da sessão.</p></div></div>
            : loading ? <div className="grid min-h-72 place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
            : loadError ? <div className="grid min-h-72 place-items-center rounded-2xl border border-rose-200 bg-rose-50/30 text-center"><div><AlertTriangle className="mx-auto h-8 w-8 text-rose-500" /><p className="mt-3 font-bold">Não foi possível carregar esta data</p><p className="mt-1 text-sm text-zinc-500">O rascunho local foi preservado. Tente carregar novamente.</p><Button variant="outline" className="mt-4 bg-white" onClick={() => void loadClosure(date)}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button></div></div>
            : missing ? <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-stone-300 text-center"><div><p className="font-bold">Fechamento ainda não sincronizado</p><p className="mt-1 text-sm text-zinc-500">Não há dados do PDV para {date.split("-").reverse().join("/")}.</p>{editable && permissions.financial?.cashClosures?.resync && <Button className="mt-4" onClick={() => void syncClosure()} disabled={working === "sync"}>{working === "sync" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sincronizar PDV</Button>}</div></div>
            : groups.length === 0 ? <div className="rounded-2xl border border-stone-200 p-8 text-center text-sm text-zinc-500">Nenhum operador encontrado nesta data.</div>
            : <div className="space-y-4">{groups.map((group) => {
              const operatorFinalized = group.operator?.status === "approved";
              const incomplete = group.lines.some((line) => line.reportedCents === null || line.countedCents === null);
              const missingReportedNote = group.lines.some((line) => (line.reportedDifferenceCents ?? 0) < 0 && !line.reportedNote?.trim());
              const missingFinanceNote = group.lines.some((line) => (line.differenceCents ?? 0) < 0 && !line.note?.trim());
              const missingNote = missingReportedNote || missingFinanceNote;
              const canEditReported = editable && !!permissions.financial?.cashClosures?.edit && !operatorFinalized;
              const canEditCounted = editable && !!permissions.financial?.cashClosures?.approve && !operatorFinalized;
              return <Card key={group.operatorId} className={cn("overflow-hidden rounded-2xl border-stone-200 transition-colors", operatorFinalized && "border-emerald-200 bg-emerald-50/20")}>
                <CardHeader className="border-b border-stone-100 px-4 py-3 sm:px-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-base">{group.name}</CardTitle><p className="mt-1 text-xs text-zinc-400">{group.lines.length} canal(is) do fechamento</p></div><div className="flex items-center gap-2">{operatorFinalized ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Finalizado</Badge> : <Button className="bg-emerald-700 font-bold hover:bg-emerald-800" disabled={!editable || !!working || !group.operator || incomplete || missingNote} onClick={() => group.operator && void finalizeOperator(group.operator)}>{working === `finalize:${group.operatorId}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Finalizar operador</Button>}</div></div></CardHeader>
                <CardContent className="space-y-4 p-4 sm:p-5">
                  <div className="space-y-3">{group.lines.map((line) => {
                    const automatic = isPdvAutoCountedChannel(line.channel);
                    const reportedShortage = (line.reportedDifferenceCents ?? 0) < 0;
                    const financeShortage = (line.differenceCents ?? 0) < 0;
                    return <div key={line.id} className={cn("space-y-3 rounded-xl border border-stone-200 p-3 sm:p-4", (reportedShortage || financeShortage) && "border-rose-200 bg-rose-50/20")}>
                      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{line.channelLabel}</strong>{automatic && <Badge variant="outline" className="border-stone-200 bg-stone-50 text-zinc-500"><LockKeyhole className="mr-1.5 h-3 w-3" />Conferido pelo PDV</Badge>}</div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-xl bg-stone-50 p-3"><span className="text-xs font-semibold text-zinc-500">PDV · esperado</span><strong className="mt-1 block font-mono text-lg">{formatBRL(line.expectedCents)}</strong></div>
                        <div className="rounded-xl bg-stone-50 p-3"><span className="text-xs font-semibold text-zinc-500">Caixa · informado</span><CentsInput value={line.reportedCents} onChange={(value) => updateClosureLine(line.id, { reportedCents: value })} disabled={!canEditReported || automatic} ariaLabel={`Valor informado pelo Caixa em ${line.channelLabel} para ${group.name}`} className={cn("mt-1 h-10 bg-white font-mono", !canEditReported && "border-transparent bg-transparent px-0 shadow-none")} /></div>
                        <div className="rounded-xl border border-pink-200 bg-pink-50/40 p-3"><span className="text-xs font-semibold text-pink-800">Financeiro · contado agora</span><CentsInput value={line.countedCents} onChange={(value) => updateClosureLine(line.id, { countedCents: value })} disabled={!canEditCounted || automatic} ariaLabel={`Valor contado agora em ${line.channelLabel} para ${group.name}`} className={cn("mt-1 h-10 bg-white font-mono", !canEditCounted && "border-transparent bg-transparent px-0 shadow-none")} /></div>
                      </div>
                      <div className="grid gap-2 text-xs font-bold sm:grid-cols-3">
                        <div className={cn("rounded-lg px-3 py-2", differenceClass(line.reportedDifferenceCents))}>Caixa × PDV: {differenceLabel(line.reportedDifferenceCents)}</div>
                        <div className={cn("rounded-lg px-3 py-2", differenceClass(line.conferenceDifferenceCents))}>Financeiro × Caixa: {differenceLabel(line.conferenceDifferenceCents)}</div>
                        <div className={cn("rounded-lg px-3 py-2", differenceClass(line.differenceCents))}>Financeiro × PDV: {differenceLabel(line.differenceCents)}</div>
                      </div>
                      {(reportedShortage || line.reportedNote) && <label className="block"><span className="mb-1.5 block text-xs font-bold text-zinc-600">Justificativa do Caixa</span><Textarea value={line.reportedNote ?? ""} onChange={(event) => updateClosureLine(line.id, { reportedNote: event.target.value })} disabled={!canEditReported || automatic} placeholder="Obrigatória quando o Caixa informou falta em relação ao PDV" className="min-h-16 resize-y bg-white" /></label>}
                      {(financeShortage || line.note) && <label className="block"><span className="mb-1.5 block text-xs font-bold text-zinc-600">Justificativa do Financeiro</span><Textarea value={line.note ?? ""} onChange={(event) => updateClosureLine(line.id, { note: event.target.value })} disabled={!canEditCounted || automatic} placeholder="Obrigatória quando a conferência encontrou falta em relação ao PDV" className="min-h-16 resize-y bg-white" /></label>}
                    </div>;
                  })}</div>
                  {!operatorFinalized && incomplete && <p className="text-xs font-medium text-amber-700">Preencha todos os canais manuais do Caixa e do Financeiro. Campos em branco permanecem como rascunho; R$ 0,00 pode ser finalizado normalmente.</p>}
                  {!operatorFinalized && missingReportedNote && <p className="text-xs font-medium text-rose-700">O Caixa precisa justificar cada falta em relação ao PDV antes da finalização.</p>}
                  {!operatorFinalized && missingFinanceNote && <p className="text-xs font-medium text-rose-700">Justifique cada falta confirmada pelo Financeiro antes da finalização.</p>}
                </CardContent>
              </Card>;
            })}</div>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
