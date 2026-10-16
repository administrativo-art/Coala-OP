"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2, LockKeyhole, RefreshCw, RotateCcw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isCurrentDraftLoad, isCurrentDraftRevision, persistLatestDraft } from "@/features/financial/cash-closures/latest-draft-save";
import { formatBRL } from "@/features/financial/cash-closures/money";
import { todayInClosureTimezone } from "@/features/financial/cash-closures/date";
import { CentsInput } from "@/features/financial/cash-closures/components/cents-input";
import { CashWithdrawalsPanel } from "@/features/financial/cash-closures/components/cash-withdrawals-panel";
import { CashSuppliesPanel } from "@/features/financial/cash-closures/components/cash-supplies-panel";
import { isPdvAutoCountedChannel } from "@/features/financial/cash-closures/channel-normalization";
import {
  cashFundCentsForLine,
  cashSupplyClassificationSummary,
  financeExpectedCentsForLine,
  financeReportedCentsForLine,
} from "@/features/financial/cash-closures/supply-classification";
import type {
  CashClosureLine,
  CashClosureOperator,
  CashClosureWithLines,
  CashSupplyClassificationKind,
} from "@/features/financial/cash-closures/types";
import type { CashCountingSession } from "../types";

type Unit = { id: string; name: string };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type CountingStep = 1 | 2 | 3 | 4 | 5 | 6;
type ClosurePayload = CashClosureWithLines & {
  activeCountingSessionId?: string | null;
};

const COUNTING_GUIDE_STEPS = [
  { title: "Informe a data", description: "Use a data impressa no malote." },
  { title: "Escolha turno/operador", description: "Abra o cartão de quem entregou o malote." },
  { title: "Conte por canal", description: "Preencha os canais e classifique os movimentos do operador." },
  { title: "Revise diferenças", description: "Justifique as faltas indicadas em vermelho." },
  { title: "Classifique movimentos", description: "Confirme suprimentos e sangrias do operador." },
  { title: "Finalize o operador", description: "Finalize e repita nos demais turnos." },
] as const;

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
  const financeExpectedCents = financeExpectedCentsForLine(next);
  const financeReportedCents = financeReportedCentsForLine(next);
  const conferenceDifferenceCents = next.countedCents === null || financeReportedCents === null
    ? null
    : next.countedCents - financeReportedCents;
  const differenceCents = next.countedCents === null ? null : next.countedCents - financeExpectedCents;
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
  if (value === null) return "bg-ds-muted text-ds-ink-muted";
  if (value === 0) return "bg-ds-ok-bg text-ds-ok";
  return value > 0 ? "bg-ds-info-bg text-ds-info" : "bg-ds-danger-bg text-ds-danger";
}

export function CashCountingDialog({ open, session, unit, editable, onClose, onSessionChanged }: Props) {
  const { permissions, isDefaultAdmin } = useAuth();
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
  const [activeStep, setActiveStep] = useState<CountingStep>(1);
  const [activeOperatorIndex, setActiveOperatorIndex] = useState(0);
  const [reopenTarget, setReopenTarget] = useState<{ operatorId: string; name: string } | null>(null);
  const [reopenReason, setReopenReason] = useState("");
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
      setActiveStep(1);
      setActiveOperatorIndex(0);
      setReopenTarget(null);
      setReopenReason("");
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
    setActiveStep(1);
    setActiveOperatorIndex(0);
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
        setActiveStep(1);
        setActiveOperatorIndex(0);
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

  async function classifySupply(input: {
    lineId: string;
    movementId: string;
    classification: CashSupplyClassificationKind;
  }) {
    const targetDate = activeDate.current;
    if (!editable || !targetDate) return;
    if (dirtyLineIds.current.size > 0 || saveInFlight.current) await save();
    const payload = await api<ClosurePayload>(
      `/api/financial/cash-closures/${encodeURIComponent(`${unit.id}_${targetDate}`)}/supplies`,
      { method: "PATCH", json: input },
    );
    if (activeDate.current !== targetDate) return;
    const next = { closure: payload.closure, lines: payload.lines, operators: payload.operators };
    dirtyLineIds.current.clear();
    latestData.current = next;
    setData(next);
    setSaveState("saved");
    setLastSavedAt(new Date().toISOString());
  }

  async function finalizeOperator(operator: CashClosureOperator) {
    const targetDate = activeDate.current;
    if (!editable || !targetDate) return;
    const closureId = `${unit.id}_${targetDate}`;
    const finalizedIndex = activeOperatorIndex;
    setWorking(`finalize:${operator.operatorId}`);
    try {
      if (dirtyLineIds.current.size > 0 || saveInFlight.current) await save();
      await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/finalize`, {
        method: "POST",
        json: { operatorId: operator.operatorId, countingSessionId: session.id },
      });
      toast({ title: `Contagem de ${operator.operatorName} finalizada.` });
      await Promise.all([loadClosure(targetDate), onSessionChanged()]);
      const followingOperatorIndex = groups.findIndex((group, index) => index > finalizedIndex && group.operator?.status !== "approved");
      const remainingOperatorIndex = followingOperatorIndex >= 0
        ? followingOperatorIndex
        : groups.findIndex((group, index) => index !== finalizedIndex && group.operator?.status !== "approved");
      if (remainingOperatorIndex >= 0) {
        setActiveOperatorIndex(remainingOperatorIndex);
        setActiveStep(2);
      } else {
        setActiveStep(6);
      }
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao finalizar o operador." });
    } finally {
      setWorking(null);
    }
  }

  async function reopenOperator() {
    const target = reopenTarget;
    const targetDate = activeDate.current;
    if (!target || !targetDate || reopenReason.trim().length < 3) return;
    const targetIndex = groups.findIndex((group) => group.operatorId === target.operatorId);
    setWorking(`reopen:${target.operatorId}`);
    try {
      await api(`/api/financial/cash-closures/${encodeURIComponent(`${unit.id}_${targetDate}`)}/reopen`, {
        method: "POST",
        json: { operatorId: target.operatorId, reason: reopenReason.trim() },
      });
      toast({ title: `Contagem de ${target.name} reaberta.` });
      setReopenTarget(null);
      setReopenReason("");
      if (targetIndex >= 0) setActiveOperatorIndex(targetIndex);
      setActiveStep(2);
      await Promise.all([loadClosure(targetDate), onSessionChanged()]);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao reabrir o operador." });
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
  const activeGroup = groups[activeOperatorIndex] ?? null;
  const activeOperator = activeGroup?.operator ?? null;
  const operatorFinalized = activeOperator?.status === "approved";
  const incomplete = activeGroup?.lines.some((line) => line.reportedCents === null || line.countedCents === null) ?? true;
  const missingReportedNote = activeGroup?.lines.some((line) => (line.reportedDifferenceCents ?? 0) < 0 && !line.reportedNote?.trim()) ?? false;
  const missingFinanceNote = activeGroup?.lines.some((line) => (line.differenceCents ?? 0) < 0 && !line.note?.trim()) ?? false;
  const missingNote = missingReportedNote || missingFinanceNote;
  const supplySummary = activeGroup
    ? cashSupplyClassificationSummary(activeGroup.lines)
    : { required: false, total: 0, pending: 0, cashFundCents: 0, supplyCents: 0 };
  const missingSupplyClassification = supplySummary.required && supplySummary.pending > 0;
  const canEditReported = editable && !!permissions.financial?.cashClosures?.edit && !operatorFinalized;
  const canEditCounted = editable && !!permissions.financial?.cashClosures?.approve && !operatorFinalized;
  const canReopen = editable && (isDefaultAdmin || !!permissions.financial?.cashClosures?.reopen);
  const finalizedOperatorCount = groups.filter((group) => group.operator?.status === "approved").length;
  const allOperatorsFinalized = data?.closure.status === "approved"
    || groups.length > 0 && finalizedOperatorCount === groups.length;
  const someOperatorsFinalized = !allOperatorsFinalized
    && (finalizedOperatorCount > 0 || data?.closure.status === "pending_review");
  const dateLabel = date ? date.split("-").reverse().join("/") : "—";

  function renderOperatorChannels() {
    if (!activeGroup) return null;
    return <div className="space-y-3">{activeGroup.lines.map((line) => {
      const automatic = isPdvAutoCountedChannel(line.channel);
      const reportedShortage = (line.reportedDifferenceCents ?? 0) < 0;
      const financeShortage = (line.differenceCents ?? 0) < 0;
      const cashFundCents = cashFundCentsForLine(line);
      const financeExpectedCents = financeExpectedCentsForLine(line);
      return <div key={line.id} className={cn("space-y-3 rounded-2xl border border-ds-border bg-white p-4 shadow-xs sm:p-5", (reportedShortage || financeShortage) && "border-ds-confirm-border bg-ds-danger-bg")}>
        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{line.channelLabel}</strong>{automatic && <Badge variant="outline" className="border-ds-border bg-ds-muted text-ds-ink-muted"><LockKeyhole className="mr-1.5 h-3 w-3" />Conferido pelo PDV</Badge>}</div>
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="min-w-0 rounded-xl bg-ds-muted p-3 sm:p-4"><span className="block text-xs font-semibold text-ds-ink-muted">PDV · esperado no caixa</span><strong className="mt-1 block font-mono text-lg tabular-nums">{formatBRL(line.expectedCents)}</strong>{cashFundCents > 0 && <span className="mt-1 block text-[11px] font-bold text-ds-ok">Malote esperado: {formatBRL(financeExpectedCents)} · fundo: {formatBRL(cashFundCents)}</span>}</div>
          <div className="min-w-0 rounded-xl bg-ds-muted p-3 sm:p-4"><span className="block text-xs font-semibold text-ds-ink-muted">Caixa · informado</span><CentsInput value={line.reportedCents} onChange={(value) => updateClosureLine(line.id, { reportedCents: value })} disabled={!canEditReported || automatic} ariaLabel={`Valor informado pelo Caixa em ${line.channelLabel} para ${activeGroup.name}`} className={cn("mt-1 h-10 bg-white font-mono", !canEditReported && "border-transparent bg-transparent px-0 shadow-none")} /></div>
          <div className="min-w-0 rounded-xl border border-ds-accent-soft bg-ds-accent-soft p-3 sm:p-4"><span className="block text-xs font-semibold text-ds-accent-ink">Financeiro · contado agora</span><CentsInput value={line.countedCents} onChange={(value) => updateClosureLine(line.id, { countedCents: value })} disabled={!canEditCounted || automatic} ariaLabel={`Valor contado agora em ${line.channelLabel} para ${activeGroup.name}`} className={cn("mt-1 h-10 bg-white font-mono", !canEditCounted && "border-transparent bg-transparent px-0 shadow-none")} /></div>
        </div>
        <div className="grid gap-2 text-xs font-bold lg:grid-cols-3"><div className={cn("rounded-lg px-3 py-2", differenceClass(line.reportedDifferenceCents))}>Caixa × PDV: {differenceLabel(line.reportedDifferenceCents)}</div><div className={cn("rounded-lg px-3 py-2", differenceClass(line.conferenceDifferenceCents))}>Financeiro × Caixa após fundo: {differenceLabel(line.conferenceDifferenceCents)}</div><div className={cn("rounded-lg px-3 py-2", differenceClass(line.differenceCents))}>Financeiro × malote esperado: {differenceLabel(line.differenceCents)}</div></div>
        {(reportedShortage || line.reportedNote) && <label className="block"><span className="mb-1.5 block text-xs font-bold text-ds-ink-muted">Justificativa do Caixa</span><Textarea value={line.reportedNote ?? ""} onChange={(event) => updateClosureLine(line.id, { reportedNote: event.target.value })} disabled={!canEditReported || automatic} placeholder="Obrigatória quando o Caixa informou falta em relação ao PDV" className="min-h-16 resize-y bg-white" /></label>}
        {(financeShortage || line.note) && <label className="block"><span className="mb-1.5 block text-xs font-bold text-ds-ink-muted">Justificativa do Financeiro</span><Textarea value={line.note ?? ""} onChange={(event) => updateClosureLine(line.id, { note: event.target.value })} disabled={!canEditCounted || automatic} placeholder="Obrigatória quando a conferência encontrou falta em relação ao PDV" className="min-h-16 resize-y bg-white" /></label>}
      </div>;
    })}</div>;
  }

  function moveOperator(index: number) {
    if (index < 0 || index >= groups.length) return;
    setActiveOperatorIndex(index);
    setActiveStep(2);
  }

  function renderDateStep() {
    return <div className="mx-auto grid w-full max-w-2xl gap-5 py-4 sm:py-10">
      <div><p className="text-[11px] font-black uppercase tracking-[.14em] text-ds-accent-ink">Etapa 1 de 6 · Identificação</p><h2 className="mt-2 text-2xl font-black tracking-tight text-ds-ink">Comece pela data do malote</h2><p className="mt-2 max-w-xl text-sm leading-6 text-ds-ink-muted">Use a data impressa no malote. O sistema carregará os operadores e os valores sincronizados do PDV para esta unidade.</p></div>
      <Card className="rounded-2xl border-ds-border bg-white shadow-xs"><CardContent className="p-5 sm:p-6"><label><span className="mb-2 block text-[11px] font-black uppercase tracking-[.12em] text-ds-ink-muted">Data impressa no malote</span><Input type="date" max={todayInClosureTimezone()} value={date} disabled={!editable || changingDate || !!working} onChange={(event) => void changeDate(event.target.value)} className="h-12 bg-white text-base" /></label>{date && <div role="status" className={cn("mt-4 flex items-start gap-3 rounded-xl border px-3.5 py-3", loading || changingDate ? "border-ds-border bg-ds-muted text-ds-ink-muted" : loadError ? "border-ds-confirm-border bg-ds-danger-bg text-ds-danger" : missing ? "border-ds-alert-border bg-ds-warn-bg text-ds-alert-ink" : allOperatorsFinalized ? "border-ds-ok/30 bg-ds-ok-bg text-ds-ok" : someOperatorsFinalized ? "border-ds-alert-border bg-ds-warn-bg text-ds-alert-ink" : "border-ds-border bg-ds-muted text-ds-ink-muted")}>
        {loading || changingDate ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : loadError ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : missing ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : allOperatorsFinalized ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
        <span><strong className="block text-sm">{loading || changingDate ? "Consultando a situação da data" : loadError ? "Não foi possível consultar esta data" : missing ? "Fechamento ainda não sincronizado" : allOperatorsFinalized ? "Contagem finalizada" : someOperatorsFinalized ? "Contagem em andamento" : "Contagem ainda não finalizada"}</strong><span className="mt-0.5 block text-xs leading-5">{loading || changingDate ? "Aguarde antes de avançar." : loadError ? "Tente novamente para saber se a contagem está finalizada." : missing ? "Sincronize o PDV antes de iniciar a contagem." : allOperatorsFinalized ? "Esta data abre em modo de revisão. Para alterar valores, reabra o operador com uma justificativa." : someOperatorsFinalized ? `${finalizedOperatorCount} de ${groups.length} operadores já foram finalizados. Os demais continuam disponíveis para contagem.` : `${groups.length} operador(es) aguardando contagem nesta data.`}</span></span>
      </div>}{loadError && !loading && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void loadClosure(date)}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button>}{missing && editable && permissions.financial?.cashClosures?.resync && <Button type="button" variant="outline" size="sm" className="mt-3" disabled={working === "sync"} onClick={() => void syncClosure()}>{working === "sync" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sincronizar PDV</Button>}</CardContent></Card>
    </div>;
  }

  function renderOperatorStep() {
    if (!activeGroup) return <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-ds-border text-center"><div><p className="font-bold">Nenhum operador encontrado nesta data.</p><p className="mt-1 text-sm text-ds-ink-muted">Sincronize o fechamento do PDV ou escolha outra data.</p></div></div>;
    return <div className="mx-auto w-full max-w-3xl space-y-5 py-2 sm:py-6">
      <div><p className="text-[11px] font-black uppercase tracking-[.14em] text-ds-accent-ink">Etapa 2 de 6 · Operador</p><h2 className="mt-2 text-2xl font-black tracking-tight text-ds-ink">Selecione o operador</h2><p className="mt-2 text-sm leading-6 text-ds-ink-muted">Todos os turnos desta data aparecem abaixo. A contagem continua individual, mas você pode abrir qualquer operador diretamente.</p></div>
      <Card className="rounded-2xl border-ds-border bg-white shadow-xs">
        <CardHeader className="flex-row items-center justify-between gap-3 px-4 pb-2 pt-4 sm:px-5"><div><p className="text-xs font-black uppercase tracking-[.12em] text-ds-ink-muted">Operadores do malote</p><p className="mt-1 text-xs text-ds-ink-faint">{finalizedOperatorCount} de {groups.length} finalizado(s)</p></div><StatusPill variant={allOperatorsFinalized ? "ok" : someOperatorsFinalized ? "warn" : "neutral"}>{allOperatorsFinalized ? "Finalizada" : someOperatorsFinalized ? "Em andamento" : "Pendente"}</StatusPill></CardHeader>
        <CardContent className="max-h-[360px] space-y-2 overflow-y-auto p-3 sm:p-4">{groups.map((group, index) => {
          const finalized = group.operator?.status === "approved";
          const selected = index === activeOperatorIndex;
          const expected = group.operator?.expectedTotalCents ?? group.lines.reduce((sum, line) => sum + line.expectedCents, 0);
          return <div key={group.operatorId} className={cn("flex flex-wrap items-center gap-2 rounded-xl border p-2 transition-colors sm:flex-nowrap", selected ? "border-ds-accent bg-ds-accent-soft" : finalized ? "border-ds-ok/30 bg-ds-ok-bg" : "border-ds-border bg-white hover:bg-ds-muted")}>
            <button type="button" aria-pressed={selected} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1.5 text-left" onClick={() => moveOperator(index)}><span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-black", finalized ? "bg-ds-ok text-white" : selected ? "bg-ds-accent text-white" : "bg-ds-muted text-ds-ink-muted")}>{finalized ? <Check className="h-4 w-4" /> : group.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{group.name}</strong><span className="mt-0.5 block text-xs text-ds-ink-muted">{group.lines.length} canais · {formatBRL(expected)} esperado</span></span><StatusPill variant={finalized ? "ok" : group.operator?.status === "reopened" ? "warn" : "neutral"}>{finalized ? "Finalizado" : group.operator?.status === "reopened" ? "Reaberto" : "Pendente"}</StatusPill></button>
            {finalized && canReopen && <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!!working} onClick={() => { setActiveOperatorIndex(index); setReopenTarget({ operatorId: group.operatorId, name: group.name }); setReopenReason(""); }}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reabrir</Button>}
          </div>;
        })}</CardContent>
      </Card>
    </div>;
  }

  function renderStepContent() {
    if (activeStep === 1) return renderDateStep();
    if (!date) return renderDateStep();
    if (loading) return <div className="grid min-h-72 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-ds-accent-ink" /></div>;
    if (loadError) return <div className="grid min-h-72 place-items-center rounded-2xl border border-ds-confirm-border bg-ds-danger-bg text-center"><div><AlertTriangle className="mx-auto h-8 w-8 text-ds-danger" /><p className="mt-3 font-bold">Não foi possível carregar esta data</p><p className="mt-1 text-sm text-ds-ink-muted">O rascunho local foi preservado. Tente carregar novamente.</p><Button variant="ds-secondary" size="md" className="mt-4" onClick={() => void loadClosure(date)}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button></div></div>;
    if (missing) return <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-ds-border text-center"><div><p className="font-bold">Fechamento ainda não sincronizado</p><p className="mt-1 text-sm text-ds-ink-muted">Não há dados do PDV para {dateLabel}.</p>{editable && permissions.financial?.cashClosures?.resync && <Button variant="primary-modal" size="md" className="mt-4" onClick={() => void syncClosure()} disabled={working === "sync"}>{working === "sync" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sincronizar PDV</Button>}</div></div>;
    if (!activeGroup) return renderOperatorStep();
    if (activeStep === 2) return renderOperatorStep();
    if (activeStep === 3) return <div className="mx-auto w-full max-w-4xl space-y-5 py-2 sm:py-6"><div><p className="text-[11px] font-black uppercase tracking-[.14em] text-ds-accent-ink">Etapa 3 de 6 · Contagem</p><h2 className="mt-2 text-2xl font-black tracking-tight text-ds-ink">Conte o caixa e classifique os movimentos</h2><p className="mt-2 text-sm leading-6 text-ds-ink-muted">Preencha Caixa e Financeiro nos canais manuais de <strong>{activeGroup.name}</strong>. Os suprimentos e as sangrias logo abaixo pertencem somente a este operador.</p></div>{renderOperatorChannels()}</div>;
    if (activeStep === 4) return <div className="mx-auto w-full max-w-4xl space-y-5 py-2 sm:py-6"><div><p className="text-[11px] font-black uppercase tracking-[.14em] text-ds-accent-ink">Etapa 4 de 6 · Revisão</p><h2 className="mt-2 text-2xl font-black tracking-tight text-ds-ink">Revise as diferenças</h2><p className="mt-2 text-sm leading-6 text-ds-ink-muted">Os valores em vermelho precisam de justificativa antes da finalização. Você ainda pode corrigir os valores nesta etapa.</p></div>{renderOperatorChannels()}{!operatorFinalized && incomplete && <p className="rounded-xl border border-ds-border bg-ds-warn-bg px-4 py-3 text-xs font-semibold text-ds-warn-ink">Preencha todos os canais manuais do Caixa e do Financeiro. R$ 0,00 pode ser finalizado normalmente.</p>}{!operatorFinalized && missingReportedNote && <p className="rounded-xl border border-ds-confirm-border bg-ds-danger-bg px-4 py-3 text-xs font-semibold text-ds-danger">O Caixa precisa justificar cada falta em relação ao PDV.</p>}{!operatorFinalized && missingFinanceNote && <p className="rounded-xl border border-ds-confirm-border bg-ds-danger-bg px-4 py-3 text-xs font-semibold text-ds-danger">Justifique cada falta confirmada pelo Financeiro.</p>}</div>;
    if (activeStep === 5) return <div className="mx-auto w-full max-w-4xl pt-2 sm:pt-6"><p className="text-[11px] font-black uppercase tracking-[.14em] text-ds-accent-ink">Etapa 5 de 6 · Movimentos</p><h2 className="mt-2 text-2xl font-black tracking-tight text-ds-ink">Revise suprimentos e sangrias</h2><p className="mt-2 text-sm leading-6 text-ds-ink-muted">Confirme se cada suprimento foi marcado como Fundo de caixa ou Suprimento e se todas as saídas em espécie de <strong>{activeGroup.name}</strong> foram classificadas ou vinculadas.</p></div>;
    return <div className="mx-auto w-full max-w-3xl space-y-5 py-2 sm:py-6"><div><p className="text-[11px] font-black uppercase tracking-[.14em] text-ds-accent-ink">Etapa 6 de 6 · Finalização</p><h2 className="mt-2 text-2xl font-black tracking-tight text-ds-ink">Finalize {activeGroup.name}</h2><p className="mt-2 text-sm leading-6 text-ds-ink-muted">Faça uma última conferência. A finalização registra o operador e libera o próximo turno.</p></div><Card className={cn("rounded-2xl border-ds-border bg-white shadow-xs", operatorFinalized && "border-ds-ok/30 bg-ds-ok-bg")}><CardContent className="space-y-4 p-5 sm:p-6"><div className="flex items-center gap-3"><span className={cn("grid h-10 w-10 place-items-center rounded-xl", operatorFinalized ? "bg-ds-ok text-white" : "bg-ds-accent text-white")}>{operatorFinalized ? <CheckCircle2 className="h-5 w-5" /> : <span className="text-sm font-black">6</span>}</span><div><p className="font-black">{operatorFinalized ? "Operador já finalizado" : "Contagem pronta para revisão final"}</p><p className="text-sm text-ds-ink-muted">{activeGroup.lines.length} canais analisados · {activeGroup.name}</p></div></div><div className="grid gap-2 sm:grid-cols-3"><div className={cn("rounded-xl px-3 py-2 text-xs font-bold", differenceClass(activeOperator?.reportedDifferenceTotalCents ?? null))}>Caixa × PDV: {differenceLabel(activeOperator?.reportedDifferenceTotalCents ?? null)}</div><div className={cn("rounded-xl px-3 py-2 text-xs font-bold", differenceClass(activeOperator?.differenceTotalCents ?? null))}>Financeiro × malote: {differenceLabel(activeOperator?.differenceTotalCents ?? null)}</div><div className={cn("rounded-xl px-3 py-2 text-xs font-bold", incomplete || missingNote || missingSupplyClassification ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-ok-bg text-ds-ok")}>{incomplete ? "Faltam valores" : missingSupplyClassification ? "Faltam suprimentos" : missingNote ? "Faltam justificativas" : "Pronto para finalizar"}</div></div>{!operatorFinalized && incomplete && <p className="text-xs font-semibold text-ds-warn-ink">Volte à etapa 3 para preencher os canais manuais.</p>}{!operatorFinalized && missingSupplyClassification && <p className="text-xs font-semibold text-ds-danger">Volte à etapa 5 para classificar cada suprimento como Fundo de caixa ou Suprimento.</p>}{!operatorFinalized && missingNote && <p className="text-xs font-semibold text-ds-danger">Volte à etapa 4 para completar as justificativas das faltas.</p>}</CardContent></Card></div>;
  }

  const statusMessage = changingDate
    ? <><Loader2 className="h-4 w-4 animate-spin" />Abrindo a data…</>
    : saveState === "dirty" ? <><AlertTriangle className="h-4 w-4 text-ds-warn" />Alterações pendentes</>
      : saveState === "saving" ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando automaticamente…</>
        : saveState === "saved" ? <><Check className="h-4 w-4 text-ds-ok" />Salvo{savedTime ? ` às ${savedTime}` : ""}</>
          : saveState === "error" ? <><AlertTriangle className="h-4 w-4 text-ds-danger" />Falha ao salvar; o modal permanecerá aberto</> : null;

  return <><Dialog open={open} onOpenChange={(next) => { if (!next) void requestClose(); }}>
    <DialogContent hideClose className="h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-[1080px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-ds-modal bg-ds-muted p-0 font-ds sm:h-[min(900px,calc(100dvh-2rem))] sm:max-w-[min(1080px,calc(100vw-2rem))] sm:p-0">
      <DialogHeader className="min-w-0 space-y-0 rounded-t-2xl bg-white px-5 pb-4 pt-5 text-left sm:px-10 sm:pb-5 sm:pt-7"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[.16em] text-ds-accent-ink">Financeiro · Fechamento de caixa</p><DialogTitle className="mt-1 text-xl font-black tracking-tight">Contar malote</DialogTitle><DialogDescription className="sr-only">Contagem do malote da unidade {unit.name}.</DialogDescription></div><Button type="button" size="icon" variant="ghost" className="shrink-0 rounded-full" aria-label="Fechar contagem" disabled={changingDate} onClick={() => void requestClose()}><X className="h-4 w-4" /></Button></div><div className="mt-5 rounded-2xl border border-ds-border bg-ds-muted p-3 sm:mt-6 sm:p-4"><div className="mb-3 flex items-center justify-between gap-3"><p className="text-[11px] font-black uppercase tracking-[.12em] text-ds-ink-muted">Passo a passo da contagem</p><span className="text-xs font-bold text-ds-ink-muted">Etapa {activeStep} de {COUNTING_GUIDE_STEPS.length}</span></div><ol className="flex min-w-0 gap-2 overflow-x-auto pb-1" aria-label="Etapas para contar e finalizar o malote">{COUNTING_GUIDE_STEPS.map((step, index) => { const stepNumber = (index + 1) as CountingStep; const current = activeStep === stepNumber; const done = stepNumber < activeStep || (stepNumber === 6 && operatorFinalized); const available = stepNumber <= activeStep && (!!date || stepNumber === 1); return <li key={step.title} className="min-w-[132px] flex-1"><button type="button" disabled={!available} onClick={() => setActiveStep(stepNumber)} className={cn("flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors", current ? "border-ds-accent bg-ds-accent-soft" : done ? "border-ds-ok/30 bg-ds-ok-bg" : "border-ds-border bg-white", !available && "cursor-not-allowed opacity-50")}><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black", current ? "bg-ds-accent text-white" : done ? "bg-ds-ok text-white" : "bg-ds-muted text-ds-ink-muted")}>{done ? <Check className="h-4 w-4" /> : stepNumber}</span><span className="min-w-0"><strong className="block truncate text-[11px] font-black">{step.title}</strong><span className="mt-0.5 block truncate text-[10px] text-ds-ink-muted">{step.description}</span></span></button></li>; })}</ol></div></DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-ds-border bg-ds-muted px-5 py-3 text-xs sm:px-10"><span className="font-bold text-ds-ink-muted">{date ? `Malote de ${dateLabel} · ${unit.name}` : "Selecione a data do malote"}</span><span className="flex items-center gap-2 text-ds-ink-muted">{activeGroup && <><span>Operador {activeOperatorIndex + 1}/{groups.length}</span><span className="h-1 w-1 rounded-full bg-ds-ink-faint" /></>}{statusMessage}</span></div><div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-10 sm:py-7">{renderStepContent()}{data && activeGroup && <div className={cn("mx-auto w-full max-w-4xl space-y-5 pb-2 pt-5 sm:pb-6", ![3, 5].includes(activeStep) && "hidden")}><CashSuppliesPanel data={data} editable={editable && !working} operatorId={activeGroup.operatorId} onClassify={classifySupply} /><CashWithdrawalsPanel key={data.closure.id} data={data} editable={editable && !working} operatorId={activeGroup.operatorId} /></div>}</div></div>
      <div className="flex flex-col gap-3 border-t border-ds-border bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-10"><div className="flex min-h-8 items-center gap-2 text-xs text-ds-ink-muted"><span className="hidden sm:inline">{activeGroup ? activeGroup.name : ""}</span>{activeGroup && !operatorFinalized && (incomplete || missingSupplyClassification) && activeStep >= 4 && <span className="rounded-full bg-ds-warn-bg px-2.5 py-1 font-bold text-ds-warn-ink">{missingSupplyClassification ? `${supplySummary.pending} suprimento(s) pendente(s)` : "Preenchimento pendente"}</span>}</div><div className="flex flex-wrap items-center justify-end gap-2"><Button type="button" variant="ghost" size="sm" disabled={activeStep === 1 || !!working} onClick={() => setActiveStep((current) => Math.max(1, current - 1) as CountingStep)}><ArrowLeft className="mr-1.5 h-4 w-4" />Voltar</Button>{activeStep === 1 && <Button type="button" variant="primary-modal" size="md" disabled={!date || loading || loadError || missing || groups.length === 0} onClick={() => setActiveStep(2)}>Escolher operador<ArrowRight className="ml-2 h-4 w-4" /></Button>}{activeStep === 2 && <Button type="button" variant="primary-modal" size="md" disabled={!activeGroup} onClick={() => setActiveStep(3)}>{operatorFinalized ? "Revisar operador" : "Começar contagem"}<ArrowRight className="ml-2 h-4 w-4" /></Button>}{activeStep === 3 && <Button type="button" variant="primary-modal" size="md" disabled={!activeGroup} onClick={() => setActiveStep(4)}>Revisar diferenças<ArrowRight className="ml-2 h-4 w-4" /></Button>}{activeStep === 4 && <Button type="button" variant="primary-modal" size="md" disabled={!activeGroup} onClick={() => setActiveStep(5)}>Classificar movimentos<ArrowRight className="ml-2 h-4 w-4" /></Button>}{activeStep === 5 && <Button type="button" variant="primary-modal" size="md" disabled={!activeGroup || missingSupplyClassification} onClick={() => setActiveStep(6)}>Revisar finalização<ArrowRight className="ml-2 h-4 w-4" /></Button>}{activeStep === 6 && (operatorFinalized ? <Button type="button" variant="primary-modal" size="md" onClick={() => setActiveStep(2)}>Voltar aos operadores<ArrowRight className="ml-2 h-4 w-4" /></Button> : <Button type="button" variant="primary-modal" size="md" disabled={!editable || !!working || !activeOperator || incomplete || missingNote || missingSupplyClassification} onClick={() => activeOperator && void finalizeOperator(activeOperator)}>{working === `finalize:${activeGroup?.operatorId}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Finalizar operador</Button>)}</div></div>
    </DialogContent>
  </Dialog><Dialog open={reopenTarget !== null} onOpenChange={(next) => { if (!next && !working) { setReopenTarget(null); setReopenReason(""); } }}><DialogContent className="rounded-[20px] sm:max-w-[460px]"><DialogHeader><DialogTitle>Reabrir contagem de {reopenTarget?.name}</DialogTitle><DialogDescription>A reabertura libera somente este operador para alterações e exige uma justificativa. Valores já destinados a depósito continuam sujeitos ao tratamento auditado do sistema.</DialogDescription></DialogHeader><Textarea value={reopenReason} maxLength={500} disabled={!!working} onChange={(event) => setReopenReason(event.target.value)} placeholder="Motivo obrigatório" /><div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={!!working} onClick={() => { setReopenTarget(null); setReopenReason(""); }}>Cancelar</Button><Button type="button" disabled={!!working || reopenReason.trim().length < 3} onClick={() => void reopenOperator()}>{working?.startsWith("reopen:") && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar reabertura</Button></div></DialogContent></Dialog></>;
}
