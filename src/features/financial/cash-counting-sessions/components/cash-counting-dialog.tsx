"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Loader2, LockKeyhole, RefreshCw, RotateCcw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isCurrentDraftLoad, isCurrentDraftRevision, persistLatestDraft } from "@/features/financial/cash-closures/latest-draft-save";
import { formatBRL } from "@/features/financial/cash-closures/money";
import { todayInClosureTimezone } from "@/features/financial/cash-closures/date";
import { CentsInput } from "@/features/financial/cash-closures/components/cents-input";
import { CashSuppliesPanel } from "@/features/financial/cash-closures/components/cash-supplies-panel";
import { CashWithdrawalsPanel } from "@/features/financial/cash-closures/components/cash-withdrawals-panel";
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
type CountingStep = 1 | 2 | 3 | 4;
type ClosurePayload = CashClosureWithLines & {
  activeCountingSessionId?: string | null;
};

const COUNTING_GUIDE_STEPS = [
  { title: "Informe a data", description: "Use a data impressa no malote." },
  { title: "Escolha turno/operador", description: "Abra o cartão de quem entregou o malote." },
  { title: "Confira o malote", description: "Conte, revise diferenças e classifique suprimentos e sangrias." },
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

function calendarDateFromKey(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function calendarDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftCalendarDateKey(value: string, days: number) {
  const date = calendarDateFromKey(value);
  if (!date) return value;
  date.setDate(date.getDate() + days);
  return calendarDateKey(date);
}

function formatTypedDate(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function dateKeyFromTypedDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  if (date.getFullYear() !== Number(match[3]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[1])) return null;
  return calendarDateKey(date);
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
  const [typedDate, setTypedDate] = useState("");
  const [typedDateError, setTypedDateError] = useState("");
  const [automaticChannelsExpanded, setAutomaticChannelsExpanded] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => calendarDateFromKey(todayInClosureTimezone()) ?? new Date());
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
    setTypedDate(resumeDate ? resumeDate.split("-").reverse().join("/") : "");
    setTypedDateError("");
    setVisibleMonth(calendarDateFromKey(resumeDate || todayInClosureTimezone()) ?? new Date());
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
    setWorking(`finalize:${operator.operatorId}`);
    try {
      if (dirtyLineIds.current.size > 0 || saveInFlight.current) await save();
      await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/finalize`, {
        method: "POST",
        json: { operatorId: operator.operatorId, countingSessionId: session.id },
      });
      toast({ title: `Contagem de ${operator.operatorName} finalizada.` });
      await Promise.all([loadClosure(targetDate), onSessionChanged()]);
      setActiveStep(2);
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
  const missingFinanceNote = activeGroup?.lines.some((line) => (line.differenceCents ?? 0) < 0 && !line.note?.trim()) ?? false;
  const missingNote = missingFinanceNote;
  const supplySummary = activeGroup
    ? cashSupplyClassificationSummary(activeGroup.lines, { operatorStatus: activeOperator?.status })
    : { required: false, total: 0, pending: 0, cashFundCents: 0, supplyCents: 0 };
  const missingSupplyClassification = supplySummary.required && supplySummary.pending > 0;
  const canEditReported = editable && !!permissions.financial?.cashClosures?.edit && !operatorFinalized;
  const canEditCounted = editable && !!permissions.financial?.cashClosures?.approve && !operatorFinalized;
  const canReopen = editable && (isDefaultAdmin || !!permissions.financial?.cashClosures?.reopen);
  const hasWithdrawals = activeGroup?.lines.some((line) => (line.metadata.withdrawalCents ?? 0) > 0) ?? false;
  const operatorTotals = activeGroup?.lines.reduce((totals, line) => ({
    expected: totals.expected + financeExpectedCentsForLine(line),
    reported: totals.reported + (line.reportedCents ?? 0),
    counted: totals.counted + (line.countedCents ?? 0),
    withdrawals: totals.withdrawals + (line.metadata.withdrawalCents ?? 0),
  }), { expected: 0, reported: 0, counted: 0, withdrawals: 0 }) ?? { expected: 0, reported: 0, counted: 0, withdrawals: 0 };
  const dateLabel = date ? date.split("-").reverse().join("/") : "—";

  function renderOperatorChannels() {
    if (!activeGroup) return null;
    const manualLines = activeGroup.lines.filter((line) => !isPdvAutoCountedChannel(line.channel));
    const automaticLines = activeGroup.lines.filter((line) => isPdvAutoCountedChannel(line.channel));
    return <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-ds-border bg-white shadow-xs">
        <div className="hidden grid-cols-[minmax(140px,1.1fr)_repeat(3,minmax(0,1fr))] gap-3 border-b border-ds-border bg-ds-muted px-4 py-3 text-[11px] font-extrabold uppercase tracking-wide text-ds-ink-muted sm:grid">
          <span>Canal manual</span><span>PDV · esperado</span><span>Caixa · informado</span><span>Financeiro · contado</span>
        </div>
        {manualLines.length === 0 && <p className="px-4 py-5 text-sm text-ds-ink-muted">Nenhum canal manual para preencher neste turno.</p>}
        {manualLines.map((line) => {
      const reportedShortage = (line.reportedDifferenceCents ?? 0) < 0;
      const financeShortage = (line.differenceCents ?? 0) < 0;
      const cashFundCents = cashFundCentsForLine(line);
      const financeExpectedCents = financeExpectedCentsForLine(line);
      return <div key={line.id} className={cn("space-y-3 border-b border-ds-border p-4 last:border-b-0", (reportedShortage || financeShortage) && "bg-ds-danger-bg")}>
        <div className="grid min-w-0 grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(140px,1.1fr)_repeat(3,minmax(0,1fr))]">
          <strong className="text-sm">{line.channelLabel}</strong>
          <div className="min-w-0"><span className="block text-[11px] font-semibold text-ds-ink-muted sm:hidden">PDV · esperado</span><strong className="mt-1 block font-ds-mono text-base tabular-nums">{formatBRL(line.expectedCents)}</strong></div>
          <div className="min-w-0"><span className="block text-[11px] font-semibold text-ds-ink-muted sm:hidden">Caixa · informado</span><CentsInput value={line.reportedCents} onChange={(value) => updateClosureLine(line.id, { reportedCents: value })} disabled={!canEditReported} ariaLabel={`Valor informado pelo Caixa em ${line.channelLabel} para ${activeGroup.name}`} className={cn("h-10 bg-white font-ds-mono", !canEditReported && "border-transparent bg-transparent px-0 shadow-none")} /></div>
          <div className="min-w-0 rounded-lg bg-ds-accent-soft p-1"><span className="block px-2 pt-1 text-[11px] font-semibold text-ds-accent-ink sm:hidden">Financeiro · contado agora</span><CentsInput value={line.countedCents} onChange={(value) => updateClosureLine(line.id, { countedCents: value })} disabled={!canEditCounted} ariaLabel={`Valor contado agora em ${line.channelLabel} para ${activeGroup.name}`} className={cn("h-10 bg-white font-ds-mono", !canEditCounted && "border-transparent bg-transparent px-0 shadow-none")} /></div>
        </div>
        {(line.reportedCents !== null || line.countedCents !== null) && <div className="grid items-stretch gap-2 text-xs lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.1fr)]">
          <div className="rounded-xl border border-ds-border bg-ds-muted px-3 py-2.5"><span className="block text-[10px] font-extrabold uppercase tracking-wide text-ds-ink-muted">PDV esperado no caixa</span><strong className="mt-1 block font-ds-mono text-sm tabular-nums">{formatBRL(line.expectedCents)}</strong>{cashFundCents > 0 && <span className="mt-1 block text-[10px] font-bold text-ds-ok">Malote: {formatBRL(financeExpectedCents)} · fundo: {formatBRL(cashFundCents)}</span>}</div>
          <ArrowRight className="mx-auto h-4 w-4 self-center rotate-90 text-ds-ink-faint lg:rotate-0" aria-hidden="true" />
          <div className={cn("rounded-xl px-3 py-2.5", differenceClass(line.reportedDifferenceCents))}><span className="block text-[10px] font-extrabold uppercase tracking-wide opacity-75">Caixa informado</span><strong className="mt-1 block font-ds-mono text-sm tabular-nums">{line.reportedCents === null ? "—" : formatBRL(line.reportedCents)}</strong><span className="mt-1 block font-semibold">{differenceLabel(line.reportedDifferenceCents)} vs. PDV</span></div>
          <ArrowRight className="mx-auto h-4 w-4 self-center rotate-90 text-ds-ink-faint lg:rotate-0" aria-hidden="true" />
          <div className={cn("rounded-xl px-3 py-2.5", differenceClass(line.conferenceDifferenceCents))}><span className="block text-[10px] font-extrabold uppercase tracking-wide opacity-75">Financeiro contado</span><strong className="mt-1 block font-ds-mono text-sm tabular-nums">{line.countedCents === null ? "—" : formatBRL(line.countedCents)}</strong><span className="mt-1 block font-semibold">{differenceLabel(line.conferenceDifferenceCents)} vs. Caixa</span></div>
          <ArrowRight className="mx-auto h-4 w-4 self-center rotate-90 text-ds-ink-faint lg:rotate-0" aria-hidden="true" />
          <div className={cn("rounded-xl px-3 py-2.5", differenceClass(line.differenceCents))}><span className="block text-[10px] font-extrabold uppercase tracking-wide opacity-75">Resultado final</span><strong className="mt-1 block text-sm">{differenceLabel(line.differenceCents)}</strong><span className="mt-1 block font-semibold">Financeiro × malote esperado</span></div>
        </div>}
        {(financeShortage || line.note) && <label className="block"><span className="mb-1.5 block text-xs font-bold text-ds-ink-muted">Justificativa do Financeiro</span><Textarea value={line.note ?? ""} onChange={(event) => updateClosureLine(line.id, { note: event.target.value })} disabled={!canEditCounted} placeholder="Obrigatória quando a conferência encontrou falta em relação ao PDV" className="min-h-16 resize-y bg-white" /></label>}
      </div>;
        })}
      </div>
      {automaticLines.length > 0 && <div className="overflow-hidden rounded-2xl border border-ds-border bg-white shadow-xs">
        <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setAutomaticChannelsExpanded((current) => !current)} aria-expanded={automaticChannelsExpanded}>
          <span><strong className="block text-sm">Conferidos automaticamente pelo PDV</strong><span className="mt-0.5 block text-xs text-ds-ink-muted">{automaticLines.length} canal(is) · {formatBRL(automaticLines.reduce((sum, line) => sum + line.expectedCents, 0))}</span></span>
          <span className="flex items-center gap-2 text-xs font-bold text-ds-ink-muted"><LockKeyhole className="h-4 w-4" />{automaticChannelsExpanded ? "Recolher" : "Ver canais"}<ChevronDown className={cn("h-4 w-4 transition-transform", automaticChannelsExpanded && "rotate-180")} /></span>
        </button>
        {automaticChannelsExpanded && <div className="border-t border-ds-border">{automaticLines.map((line) => <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-ds-border px-4 py-3 last:border-b-0"><span><strong className="block text-sm">{line.channelLabel}</strong><span className="mt-0.5 block text-[11px] font-semibold text-ds-ok">Conferido pelo PDV</span></span><strong className="font-ds-mono text-sm tabular-nums">{formatBRL(line.expectedCents)}</strong></div>)}</div>}
      </div>}
    </div>;
  }

  function moveOperator(index: number) {
    if (index < 0 || index >= groups.length) return;
    setActiveOperatorIndex(index);
    setActiveStep(2);
  }

  function renderDateStep() {
    const todayKey = todayInClosureTimezone();
    const today = calendarDateFromKey(todayKey) ?? new Date();
    const selectedDate = calendarDateFromKey(date);
    const dateUnavailable = !editable || changingDate || !!working;
    const lastBagDate = session.lastDraftKioskId === unit.id ? session.lastDraftDate : null;
    const lastBagCalendarDate = lastBagDate ? calendarDateFromKey(lastBagDate) : undefined;
    const shortcuts = [
      { label: "Hoje", value: todayKey },
      { label: "Ontem", value: shiftCalendarDateKey(todayKey, -1) },
      { label: "Há 7 dias", value: shiftCalendarDateKey(todayKey, -7) },
      { label: "Último malote", value: lastBagDate, disabled: !lastBagDate },
    ];
    const chooseDate = (nextDate: string) => {
      const nextCalendarDate = calendarDateFromKey(nextDate);
      if (!nextCalendarDate) return;
      setVisibleMonth(nextCalendarDate);
      setTypedDate(nextDate.split("-").reverse().join("/"));
      setTypedDateError("");
      void changeDate(nextDate);
    };
    const typeDate = (value: string) => {
      const formatted = formatTypedDate(value);
      setTypedDate(formatted);
      setTypedDateError("");
      if (formatted.length !== 10) return;
      const nextDate = dateKeyFromTypedDate(formatted);
      if (!nextDate) {
        setTypedDateError("Data inválida. Confira dia, mês e ano.");
        return;
      }
      if (nextDate > todayKey) {
        setTypedDateError("A data do malote não pode ser no futuro.");
        return;
      }
      chooseDate(nextDate);
    };
    return <div className="mx-auto grid w-full max-w-5xl gap-5 py-1 sm:py-2">
      <div><h2 className="text-2xl font-extrabold tracking-tight text-ds-ink">Comece pela data do malote</h2><p className="mt-2 max-w-xl text-sm leading-6 text-ds-ink-muted">Use a data impressa no malote. O sistema carregará os operadores e os valores sincronizados do PDV para esta unidade.</p></div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(230px,1fr)]">
        <Card className="overflow-hidden rounded-[20px] border-ds-border bg-white shadow-none"><CardContent className="p-4 sm:p-[18px]"><Calendar mode="single" locale={ptBR} month={visibleMonth} onMonthChange={setVisibleMonth} selected={selectedDate} onSelect={(nextDate) => { if (nextDate) chooseDate(calendarDateKey(nextDate)); }} disabled={dateUnavailable ? true : { after: today }} fromYear={today.getFullYear() - 5} toYear={today.getFullYear()} toMonth={today} showOutsideDays={false} modifiers={lastBagCalendarDate ? { lastBag: lastBagCalendarDate } : undefined} modifiersClassNames={{ lastBag: "after:absolute after:bottom-1 after:left-1/2 after:h-1.5 after:w-1.5 after:-translate-x-1/2 after:rounded-full after:bg-ds-accent aria-selected:after:bg-white" }} className="w-full p-0" classNames={{ months: "block w-full", month: "w-full space-y-3", caption: "relative flex h-10 items-center justify-center", caption_label: "text-base font-extrabold capitalize text-ds-ink", nav: "flex items-center", nav_button: "grid h-9 w-9 place-items-center rounded-xl border border-ds-border bg-white p-0 text-ds-ink transition-colors hover:bg-ds-muted disabled:cursor-not-allowed disabled:opacity-35", nav_button_previous: "absolute left-0", nav_button_next: "absolute right-0", table: "w-full border-collapse", head_row: "grid grid-cols-7 gap-1", head_cell: "py-1.5 text-center text-[10px] font-extrabold uppercase tracking-wide text-ds-ink-muted", row: "mt-1 grid grid-cols-7 gap-1", cell: "relative h-11 p-0 text-center", day: "relative h-11 w-full rounded-xl p-0 text-sm font-bold text-ds-ink transition-colors hover:bg-ds-accent-soft hover:text-ds-accent-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent", day_selected: "bg-ds-accent text-white hover:bg-ds-accent-hover hover:text-white focus:bg-ds-accent focus:text-white", day_today: "border-[1.5px] border-ds-ink bg-white text-ds-ink", day_outside: "text-ds-ink-faint opacity-40", day_disabled: "cursor-not-allowed text-ds-ink-faint opacity-35 hover:bg-transparent hover:text-ds-ink-faint", day_hidden: "invisible" }} /><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-ds-divider pt-3 text-xs text-ds-ink-muted"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ds-accent" />Último malote</span><span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-ds-ink" />Hoje</span><span>Datas futuras bloqueadas</span></div></CardContent></Card>
        <div className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[.12em] text-ds-ink-muted">Digitar data</span><Input value={typedDate} onChange={(event) => typeDate(event.target.value)} inputMode="numeric" maxLength={10} placeholder="dd/mm/aaaa" disabled={dateUnavailable} className="h-[52px] rounded-[14px] bg-ds-input font-ds-mono text-lg font-bold" />{typedDateError && <span className="mt-1.5 block text-xs font-semibold text-ds-danger">{typedDateError}</span>}</label>
          <div><span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[.12em] text-ds-ink-muted">Atalhos</span><div className="space-y-1.5">{shortcuts.map((shortcut) => <button key={shortcut.label} type="button" className={cn("flex h-11 w-full items-center justify-between gap-3 rounded-xl border bg-white px-3.5 text-left text-sm font-bold transition-colors", shortcut.value === date ? "border-ds-accent bg-ds-accent-soft text-ds-accent-ink" : "border-ds-border hover:bg-ds-muted")} disabled={dateUnavailable || shortcut.disabled || !shortcut.value} onClick={() => shortcut.value && chooseDate(shortcut.value)}><span>{shortcut.label}</span><span className="font-ds-mono text-xs text-ds-ink-muted">{shortcut.value ? shortcut.value.slice(5).split("-").reverse().join("/") : "—"}</span></button>)}</div></div>
          {(loading || changingDate || date) && <div className={cn("flex items-start gap-2 rounded-xl px-3.5 py-3 text-xs font-semibold", loading || changingDate ? "bg-ds-muted text-ds-ink-muted" : missing ? "bg-ds-warn-bg text-ds-warn-ink" : loadError ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-ok-bg text-ds-ok")}>{loading || changingDate ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : missing || loadError ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{loading || changingDate ? "Carregando o fechamento…" : missing ? <>Não há dados do PDV para {dateLabel}.{editable && permissions.financial?.cashClosures?.resync && <Button variant="primary-modal" size="sm" className="mt-2 flex" onClick={() => void syncClosure()} disabled={working === "sync"}>{working === "sync" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sincronizar PDV</Button>}</> : loadError ? <>Não foi possível carregar esta data.<Button variant="ds-secondary" size="sm" className="mt-2 flex" onClick={() => void loadClosure(date)}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button></> : `Malote de ${dateLabel} selecionado. ${groups.length} operador(es) encontrado(s).`}</span></div>}
        </div>
      </div>
    </div>;
  }

  function renderOperatorStep() {
    if (!activeGroup) return <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-ds-border text-center"><div><p className="font-bold">Nenhum operador encontrado nesta data.</p><p className="mt-1 text-sm text-ds-ink-muted">Sincronize o fechamento do PDV ou escolha outra data.</p></div></div>;
    return <div className="mx-auto w-full max-w-5xl space-y-5 py-2 sm:py-6">
      <div><h2 className="text-2xl font-extrabold tracking-tight text-ds-ink">Escolha o turno para conferir</h2><p className="mt-2 text-sm leading-6 text-ds-ink-muted">Veja todos os turnos e selecione quem entregou o malote. O detalhe permanece ao lado para conferência.</p></div>
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <div className="space-y-2" role="list" aria-label="Operadores do malote">
          {groups.map((group, index) => {
            const finalized = group.operator?.status === "approved";
            const selected = index === activeOperatorIndex;
            const expected = group.operator?.expectedTotalCents ?? group.lines.reduce((sum, line) => sum + line.expectedCents, 0);
            return <button key={group.operatorId} type="button" role="listitem" onClick={() => moveOperator(index)} className={cn("flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left transition-colors", selected ? "border-ds-accent bg-ds-accent-soft" : finalized ? "border-ds-ok/30 bg-ds-ok-bg" : "border-ds-border hover:bg-ds-muted")}>
              <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-extrabold", finalized ? "bg-ds-ok text-white" : selected ? "bg-ds-accent text-white" : "bg-ds-muted text-ds-ink-muted")}>{finalized ? <Check className="h-4 w-4" /> : group.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span>
              <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{group.name}</strong><span className="mt-0.5 block font-ds-mono text-xs text-ds-ink-muted">{formatBRL(expected)}</span></span>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", finalized ? "bg-ds-ok" : selected ? "bg-ds-accent" : "bg-ds-ink-faint")} />
            </button>;
          })}
        </div>
        <Card className={cn("overflow-hidden rounded-2xl border-ds-border bg-white shadow-xs", operatorFinalized && "border-ds-ok/30 bg-ds-ok-bg")}>
          <CardHeader className="border-b border-ds-border px-5 py-4 sm:px-6"><div className="flex items-center justify-between gap-3"><span className="text-xs font-extrabold uppercase tracking-[.12em] text-ds-ink-muted">Operador {activeOperatorIndex + 1} de {groups.length}</span><span className="flex items-center gap-2">{operatorFinalized ? <Badge className="bg-ds-ok-bg text-ds-ok hover:bg-ds-ok-bg"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Finalizado</Badge> : <Badge variant="outline" className="border-ds-border bg-ds-muted text-ds-ink-muted">Aguardando conferência</Badge>}{operatorFinalized && canReopen && <Button type="button" variant="outline" size="sm" disabled={!!working} onClick={() => { setReopenTarget({ operatorId: activeGroup.operatorId, name: activeGroup.name }); setReopenReason(""); }}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reabrir</Button>}</span></div></CardHeader>
          <CardContent className="space-y-6 p-5 sm:p-7"><div className="flex items-center gap-4"><span className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-sm font-extrabold", operatorFinalized ? "bg-ds-ok-bg text-ds-ok" : "bg-ds-accent-soft text-ds-accent-ink")}>{activeGroup.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span><div className="min-w-0"><h3 className="truncate text-xl font-extrabold">{activeGroup.name}</h3><p className="mt-1 text-sm text-ds-ink-muted">{activeGroup.lines.length} canais neste fechamento · malote de {dateLabel}</p></div></div><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-ds-muted p-4"><span className="block text-xs font-semibold text-ds-ink-muted">Esperado no PDV</span><strong className="mt-1 block font-ds-mono text-lg">{formatBRL(activeOperator?.expectedTotalCents ?? activeGroup.lines.reduce((sum, line) => sum + line.expectedCents, 0))}</strong></div><div className="rounded-xl bg-ds-muted p-4"><span className="block text-xs font-semibold text-ds-ink-muted">Canais manuais</span><strong className="mt-1 block text-lg">{activeGroup.lines.filter((line) => !isPdvAutoCountedChannel(line.channel)).length}</strong></div><div className="rounded-xl bg-ds-muted p-4"><span className="block text-xs font-semibold text-ds-ink-muted">Situação</span><strong className={cn("mt-1 block text-lg", operatorFinalized ? "text-ds-ok" : "text-ds-accent-ink")}>{operatorFinalized ? "Conferido" : "Pendente"}</strong></div></div></CardContent>
        </Card>
      </div>
    </div>;
  }

  function renderStepContent() {
    if (activeStep === 1) return renderDateStep();
    if (!date) return renderDateStep();
    if (loading) return <div className="grid min-h-72 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-ds-accent-ink" /></div>;
    if (loadError) return <div className="grid min-h-72 place-items-center rounded-2xl border border-ds-confirm-border bg-ds-danger-bg text-center"><div><AlertTriangle className="mx-auto h-8 w-8 text-ds-danger" /><p className="mt-3 font-bold">Não foi possível carregar esta data</p><p className="mt-1 text-sm text-ds-ink-muted">O rascunho local foi preservado. Tente carregar novamente.</p><Button variant="ds-secondary" size="md" className="mt-4" onClick={() => void loadClosure(date)}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button></div></div>;
    if (missing) return <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-ds-border text-center"><div><p className="font-bold">Fechamento ainda não sincronizado</p><p className="mt-1 text-sm text-ds-ink-muted">Não há dados do PDV para {dateLabel}.</p>{editable && permissions.financial?.cashClosures?.resync && <Button variant="primary-modal" size="md" className="mt-4" onClick={() => void syncClosure()} disabled={working === "sync"}>{working === "sync" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sincronizar PDV</Button>}</div></div>;
    if (!data) return null;
    if (!activeGroup) return renderOperatorStep();
    if (activeStep === 2) return renderOperatorStep();
    if (activeStep === 3) return <div className="mx-auto w-full max-w-4xl space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-ds-ink">Confira o malote</h2>
        <p className="mt-2 text-sm leading-6 text-ds-ink-muted">Conte os valores de <strong>{activeGroup.name}</strong>, revise as diferenças e classifique os suprimentos e as sangrias nesta mesma etapa.</p>
      </div>
      {renderOperatorChannels()}
      {!operatorFinalized && incomplete && <p className="rounded-xl border border-ds-alert-border bg-ds-alert-bg px-4 py-3 text-xs font-semibold text-ds-alert-ink">Preencha todos os canais manuais do Caixa e do Financeiro. R$ 0,00 pode ser finalizado normalmente.</p>}
      {!operatorFinalized && missingFinanceNote && <p className="rounded-xl border border-ds-confirm-border bg-ds-danger-bg px-4 py-3 text-xs font-semibold text-ds-danger">O Financeiro deve justificar cada falta encontrada em relação ao malote esperado.</p>}
      <CashSuppliesPanel data={data} editable={editable && !working} operatorId={activeGroup.operatorId} onClassify={classifySupply} />
      <CashWithdrawalsPanel key={`${data.closure.id}:${activeGroup.operatorId}`} data={data} editable={editable && !working} operatorId={activeGroup.operatorId} />
    </div>;

    return <div className="mx-auto w-full max-w-4xl space-y-5 py-1">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-ds-ink">Revise e finalize {activeGroup.name}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ds-ink-muted">Confira os valores, suprimentos e sangrias antes de finalizar. Depois disso, os dados ficam bloqueados até uma reabertura.</p>
        </div>
        <Badge className={cn("px-3 py-1.5", operatorFinalized ? "bg-ds-ok-bg text-ds-ok hover:bg-ds-ok-bg" : incomplete || missingNote || missingSupplyClassification ? "bg-ds-warn-bg text-ds-warn hover:bg-ds-warn-bg" : "bg-ds-ok-bg text-ds-ok hover:bg-ds-ok-bg")}>
          {operatorFinalized ? "Finalizado" : incomplete ? "Faltam valores" : missingSupplyClassification ? "Faltam suprimentos" : missingNote ? "Falta justificativa" : "Pronto para finalizar"}
        </Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-ds-border bg-ds-muted px-3.5 py-3"><span className="block text-xs font-bold text-ds-ink-muted">Malote esperado</span><strong className="mt-1 block font-ds-mono text-base tabular-nums">{formatBRL(operatorTotals.expected)}</strong><span className="mt-1 block text-xs text-ds-ink-muted">Após fundo de caixa</span></div>
        <div className={cn("rounded-xl px-3.5 py-3", differenceClass(activeOperator?.reportedDifferenceTotalCents ?? null))}><span className="block text-xs font-bold opacity-80">Caixa informado</span><strong className="mt-1 block font-ds-mono text-base tabular-nums">{formatBRL(operatorTotals.reported)}</strong><span className="mt-1 block text-xs font-semibold">{differenceLabel(activeOperator?.reportedDifferenceTotalCents ?? null)} vs. PDV</span></div>
        <div className={cn("rounded-xl px-3.5 py-3", differenceClass(activeOperator?.differenceTotalCents ?? null))}><span className="block text-xs font-bold opacity-80">Financeiro contado</span><strong className="mt-1 block font-ds-mono text-base tabular-nums">{formatBRL(operatorTotals.counted)}</strong><span className="mt-1 block text-xs font-semibold">{differenceLabel(activeOperator?.differenceTotalCents ?? null)} vs. malote</span></div>
        <div className="rounded-xl border border-ds-border bg-white px-3.5 py-3"><span className="block text-xs font-bold text-ds-ink-muted">Fundo de caixa</span><strong className="mt-1 block font-ds-mono text-base tabular-nums">{formatBRL(supplySummary.cashFundCents)}</strong><span className="mt-1 block text-xs text-ds-ink-muted">{missingSupplyClassification ? `${supplySummary.pending} pendente(s)` : `${supplySummary.total} movimento(s)`}</span></div>
        <div className="rounded-xl border border-ds-border bg-white px-3.5 py-3"><span className="block text-xs font-bold text-ds-ink-muted">Sangrias do turno</span><strong className="mt-1 block font-ds-mono text-base tabular-nums">{formatBRL(operatorTotals.withdrawals)}</strong><span className="mt-1 block text-xs text-ds-ink-muted">{hasWithdrawals ? "Despesa criada por sangria" : "Nenhuma sangria"}</span></div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-ds-border bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-ds-border bg-ds-muted px-4 py-3"><strong className="text-sm">Valores por canal</strong><button type="button" className="text-xs font-bold text-ds-accent-ink hover:text-ds-accent-ink-hover" onClick={() => setActiveStep(3)}>Editar conferência</button></div>
        <div className="hidden grid-cols-[minmax(110px,1.2fr)_repeat(3,minmax(0,1fr))_minmax(110px,1.1fr)] gap-2 border-b border-ds-divider px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-wide text-ds-ink-muted md:grid"><span>Canal</span><span>PDV</span><span>Caixa</span><span>Financeiro</span><span>Resultado</span></div>
        {activeGroup.lines.map((line) => <div key={line.id} className="grid gap-2 border-b border-ds-divider px-4 py-3 text-sm last:border-b-0 md:grid-cols-[minmax(110px,1.2fr)_repeat(3,minmax(0,1fr))_minmax(110px,1.1fr)] md:items-center">
          <strong>{line.channelLabel}</strong><span className="font-ds-mono tabular-nums">{formatBRL(line.expectedCents)}</span><span className="font-ds-mono tabular-nums">{line.reportedCents === null ? "—" : formatBRL(line.reportedCents)}</span><span className="font-ds-mono tabular-nums">{line.countedCents === null ? "—" : formatBRL(line.countedCents)}</span><span className={cn("font-bold", (line.differenceCents ?? 0) < 0 ? "text-ds-danger" : (line.differenceCents ?? 0) > 0 ? "text-ds-info" : "text-ds-ok")}>{differenceLabel(line.differenceCents)}</span>
          {line.note && <span className="rounded-lg bg-ds-input px-3 py-2 text-xs text-ds-ink-muted md:col-span-5"><strong className="text-ds-ink">Justificativa:</strong> {line.note}</span>}
        </div>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ds-border bg-white px-4 py-3">
        <span><strong className="block text-sm">Sangrias · {formatBRL(operatorTotals.withdrawals)}</strong><span className="mt-0.5 block text-xs text-ds-ink-muted">{hasWithdrawals ? "Cada retirada deve gerar sua própria despesa paga em espécie." : "Nenhuma sangria em espécie neste turno."}</span></span>
        {(hasWithdrawals || supplySummary.total > 0) && <button type="button" className="text-xs font-bold text-ds-accent-ink hover:text-ds-accent-ink-hover" onClick={() => setActiveStep(3)}>Editar movimentos</button>}
      </div>
      {operatorFinalized && <p className="rounded-xl border border-ds-ok/30 bg-ds-ok-bg px-4 py-3 text-sm font-bold text-ds-ok"><CheckCircle2 className="mr-2 inline h-4 w-4" />{activeGroup.name} já foi finalizado. Para corrigir, reabra a contagem no fechamento.</p>}
      {!operatorFinalized && incomplete && <p className="text-xs font-semibold text-ds-warn-ink">Volte à etapa 3 para preencher os canais manuais.</p>}
      {!operatorFinalized && missingSupplyClassification && <p className="text-xs font-semibold text-ds-danger">Volte à etapa 3 para classificar cada suprimento como Fundo de caixa ou Suprimento.</p>}
      {!operatorFinalized && missingNote && <p className="text-xs font-semibold text-ds-danger">Volte à etapa 3 para completar as justificativas do Financeiro.</p>}
    </div>;
  }

  const statusMessage = changingDate
    ? <><Loader2 className="h-4 w-4 animate-spin" />Abrindo a data…</>
    : saveState === "dirty" ? <><AlertTriangle className="h-4 w-4 text-ds-warn" />Alterações pendentes</>
      : saveState === "saving" ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando automaticamente…</>
        : saveState === "saved" ? <><Check className="h-4 w-4 text-ds-ok" />Salvo{savedTime ? ` às ${savedTime}` : ""}</>
          : saveState === "error" ? <><AlertTriangle className="h-4 w-4 text-ds-danger" />Falha ao salvar; o modal permanecerá aberto</> : null;

  const selectedCalendarDate = calendarDateFromKey(date);
  const selectedWeekday = selectedCalendarDate
    ? selectedCalendarDate.toLocaleDateString("pt-BR", { weekday: "long" })
    : "Selecione no calendário";
  const stepEyebrows = ["", "ETAPA 1 DE 4 · IDENTIFICAÇÃO", "ETAPA 2 DE 4 · OPERADOR", "ETAPA 3 DE 4 · CONFERÊNCIA", "ETAPA 4 DE 4 · FINALIZAÇÃO"];

  return <><Dialog open={open} onOpenChange={(next) => { if (!next) void requestClose(); }}>
    <DialogContent hideClose overlayClassName="bg-ds-dark/45" className="h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-[1180px] grid-cols-1 grid-rows-1 gap-0 overflow-hidden rounded-ds-modal border-0 bg-ds-input p-0 font-ds shadow-ds-modal sm:h-[min(860px,calc(100dvh-3rem))] sm:max-w-[min(1180px,calc(100vw-2rem))] sm:p-0 md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
      <DialogTitle className="sr-only">Contar malote</DialogTitle><DialogDescription className="sr-only">Contagem do malote da unidade {unit.name}.</DialogDescription>
      <aside className="hidden min-h-0 flex-col gap-[22px] overflow-y-auto bg-ds-dark px-[22px] py-[26px] text-ds-on-dark md:flex">
        <div className="space-y-1.5"><p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-ds-accent-kicker">Fechamento de caixa</p><p className="text-2xl font-extrabold tracking-tight">Contar malote</p><p className="text-[13px] text-ds-on-dark-sub">{unit.name}</p></div>
        <div className="rounded-2xl border border-white/[.08] bg-white/[.05] p-4"><span className="block text-xs font-bold text-ds-on-dark-sub">Data impressa no malote</span><strong className="mt-1 block font-ds-mono text-[28px] leading-tight">{date ? dateLabel : "—/—/—"}</strong><span className="mt-1 block text-[13px] capitalize text-ds-on-dark-sub">{selectedWeekday}</span>{activeGroup && activeStep >= 2 && <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3 text-[13px]"><span className="text-ds-on-dark-sub">Operador</span><strong className="truncate">{activeGroup.name.split(" ")[0]} · {activeOperatorIndex + 1}/{groups.length}</strong></div>}</div>
        <nav aria-label="Etapas para contar e finalizar o malote"><ol className="space-y-1">{COUNTING_GUIDE_STEPS.map((step, index) => { const stepNumber = (index + 1) as CountingStep; const current = activeStep === stepNumber; const done = stepNumber < activeStep || (stepNumber === 4 && operatorFinalized); const available = stepNumber <= activeStep && (!!date || stepNumber === 1); return <li key={step.title}><button type="button" disabled={!available} aria-current={current ? "step" : undefined} onClick={() => setActiveStep(stepNumber)} className={cn("flex w-full items-start gap-3 rounded-[14px] border px-3 py-3 text-left transition-colors", current ? "border-ds-accent-ink bg-white/[.06]" : "border-transparent hover:bg-white/[.04]", !available && "cursor-not-allowed opacity-45")}><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold", current ? "bg-ds-accent text-white" : done ? "bg-ds-ok text-white" : "bg-white/10 text-ds-on-dark-2")}>{done && !current ? <Check className="h-4 w-4" /> : stepNumber}</span><span className="min-w-0"><strong className="block text-sm text-ds-on-dark">{step.title}</strong><span className="mt-0.5 block text-xs leading-[1.35] text-ds-on-dark-sub">{step.description}</span></span></button></li>; })}</ol></nav>
        <div className="mt-auto space-y-2 text-xs text-ds-on-dark-sub">{statusMessage && <span className="flex items-center gap-2">{statusMessage}</span>}<p>Responsável pela sessão: <strong className="text-ds-on-dark">{session.openedByName}</strong></p></div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col bg-white">
        <header className="border-b border-ds-divider px-5 py-[18px] sm:px-7"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="text-xs font-extrabold uppercase tracking-[.14em] text-ds-accent-ink">{stepEyebrows[activeStep]}</p><p className="mt-1 truncate text-sm font-bold text-ds-ink md:hidden">Contar malote · {unit.name}</p></div><Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full" aria-label="Fechar contagem" disabled={changingDate} onClick={() => void requestClose()}><X className="h-5 w-5" /></Button></div><ol className="mt-3 flex gap-1.5 overflow-x-auto pb-1 md:hidden" aria-label="Etapas da contagem">{COUNTING_GUIDE_STEPS.map((step, index) => { const stepNumber = (index + 1) as CountingStep; return <li key={step.title} className="min-w-[108px] flex-1"><button type="button" disabled={stepNumber > activeStep} onClick={() => setActiveStep(stepNumber)} className={cn("w-full rounded-lg border px-2 py-1.5 text-left text-[10px] font-bold", stepNumber === activeStep ? "border-ds-accent bg-ds-accent-soft text-ds-accent-ink" : "border-ds-border bg-white text-ds-ink-muted")}>{stepNumber}. {step.title}</button></li>; })}</ol></header>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ds-divider bg-ds-input px-5 py-3 text-xs sm:px-7"><span className="font-bold text-ds-ink-muted">{date ? `Malote de ${dateLabel} · ${unit.name}` : "Selecione a data do malote"}</span>{activeGroup && <span className="text-ds-ink-muted">Operador {activeOperatorIndex + 1}/{groups.length}</span>}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">{renderStepContent()}</div>
        <footer className="flex flex-col gap-3 border-t border-ds-border-footer bg-ds-input px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div className="flex min-h-8 flex-wrap items-center gap-2 text-xs text-ds-ink-muted">
            <span>{activeGroup && activeStep >= 2 ? activeGroup.name : date ? `Malote de ${dateLabel} · ${unit.name}` : "Selecione a data do malote"}</span>
            {activeGroup && !operatorFinalized && (incomplete || missingSupplyClassification) && activeStep >= 3 && <span className="rounded-full bg-ds-warn-bg px-2.5 py-1 font-bold text-ds-warn-ink">{missingSupplyClassification ? `${supplySummary.pending} suprimento(s) pendente(s)` : "Preenchimento pendente"}</span>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ds-secondary" size="lg" disabled={activeStep === 1 || !!working} onClick={() => setActiveStep((current) => Math.max(1, current - 1) as CountingStep)}><ArrowLeft className="mr-1.5 h-4 w-4" />Voltar</Button>
            {activeStep === 1 && <Button type="button" variant="primary-modal" size="lg" disabled={!date || loading || loadError || missing || groups.length === 0} onClick={() => setActiveStep(2)}>Escolher operador<ArrowRight className="ml-2 h-4 w-4" /></Button>}
            {activeStep === 2 && <Button type="button" variant="primary-modal" size="lg" disabled={!activeGroup} onClick={() => setActiveStep(3)}>{operatorFinalized ? "Revisar operador" : "Começar contagem"}<ArrowRight className="ml-2 h-4 w-4" /></Button>}
            {activeStep === 3 && <Button type="button" variant="primary-modal" size="lg" disabled={!activeGroup || incomplete || missingNote || missingSupplyClassification} onClick={() => setActiveStep(4)}>Revisar finalização<ArrowRight className="ml-2 h-4 w-4" /></Button>}
            {activeStep === 4 && (operatorFinalized
              ? <Button type="button" variant="primary-modal" size="lg" onClick={() => setActiveStep(2)}>Voltar aos operadores<ArrowRight className="ml-2 h-4 w-4" /></Button>
              : <Button type="button" variant="primary-modal" size="lg" disabled={!editable || !!working || !activeOperator || incomplete || missingNote || missingSupplyClassification} onClick={() => activeOperator && void finalizeOperator(activeOperator)}>{working === `finalize:${activeGroup?.operatorId}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Finalizar operador</Button>)}
          </div>
        </footer>
      </main>
    </DialogContent>
  </Dialog><Dialog open={reopenTarget !== null} onOpenChange={(next) => { if (!next && !working) { setReopenTarget(null); setReopenReason(""); } }}>
    <DialogContent className="rounded-[20px] sm:max-w-[460px]">
      <DialogHeader><DialogTitle>Reabrir contagem de {reopenTarget?.name}</DialogTitle><DialogDescription>A reabertura libera somente este operador para alterações e exige uma justificativa.</DialogDescription></DialogHeader>
      <Textarea value={reopenReason} maxLength={500} disabled={!!working} onChange={(event) => setReopenReason(event.target.value)} placeholder="Motivo obrigatório" />
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={!!working} onClick={() => { setReopenTarget(null); setReopenReason(""); }}>Cancelar</Button><Button type="button" disabled={!!working || reopenReason.trim().length < 3} onClick={() => void reopenOperator()}>{working?.startsWith("reopen:") && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar reabertura</Button></div>
    </DialogContent>
  </Dialog></>;
}
