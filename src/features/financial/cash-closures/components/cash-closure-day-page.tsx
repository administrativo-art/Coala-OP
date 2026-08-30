"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Info,
  Loader2,
  LockKeyhole,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/layout/page-container";
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
import {
  formatClosureMonthLabel,
  formatClosureTime,
  shiftClosureDate,
  todayInClosureTimezone,
} from "../date";
import type { CashClosure, CashClosureLine, CashClosureWithLines } from "../types";
import { isPdvAutoCountedChannel } from "../channel-normalization";
import { cashDepositBatchReferenceFromId } from "../../cash-deposits/references";
import { isCurrentDraftRevision, persistLatestDraft } from "../latest-draft-save";
import { CentsInput } from "./cents-input";
import { CashControlNavigation } from "./cash-control-navigation";

type Props = { kioskId: string; date: string; sessionId?: string };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type CashClosureApiPayload = CashClosureWithLines & {
  created?: boolean;
  operatorAvatars?: Record<string, string>;
  activeCountingSessionId?: string | null;
  settings?: { seniorDivergenceCents?: number };
  allocationError?: string;
};

const STATUS_LABEL: Record<CashClosure["status"], string> = {
  not_synced: "Não sincronizado",
  draft: "Rascunho",
  pending_review: "Finalização parcial",
  approved: "Finalizado",
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

export function CashClosureDayPage({ kioskId, date, sessionId }: Props) {
  const router = useRouter();
  const { firebaseUser, permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [data, setData] = useState<CashClosureWithLines | null>(null);
  const [operatorAvatars, setOperatorAvatars] = useState<Record<string, string>>({});
  const [activeCountingSessionId, setActiveCountingSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [seniorDivergenceCents, setSeniorDivergenceCents] = useState(1_000);
  const [reasonAction, setReasonAction] = useState<{ operatorId?: string; operatorName: string } | null>(null);
  const [reason, setReason] = useState("");
  const [expectedLineId, setExpectedLineId] = useState<string | null>(null);
  const [expectedCorrectionCents, setExpectedCorrectionCents] = useState<number | null>(null);
  const [expectedReason, setExpectedReason] = useState("");
  const latestData = useRef<CashClosureWithLines | null>(null);
  const draftRevision = useRef(0);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const intervalBackfillAttempted = useRef(false);
  const closureId = `${kioskId}_${date}`;
  const [dateYear, dateMonth] = date.split("-").map(Number);
  const monthLabel = formatClosureMonthLabel(dateYear, dateMonth);
  const countingSessionId = sessionId ?? activeCountingSessionId;
  const sessionQuery = countingSessionId ? `?sessionId=${encodeURIComponent(countingSessionId)}` : "";
  const monthHref = `/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${dateYear}/${String(dateMonth).padStart(2, "0")}${sessionQuery}`;
  const nextDate = shiftClosureDate(date, 1);
  const [nextYear, nextMonth, nextDay] = nextDate.split("-");
  const nextDayHref = `/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${nextYear}/${nextMonth}/${nextDay}${sessionQuery}`;
  const nextDayIsFuture = nextDate > todayInClosureTimezone();

  useEffect(() => {
    latestData.current = data;
  }, [data]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    const requestRevision = draftRevision.current;
    setLoading(true);
    try {
      const payload = await api<CashClosureApiPayload>(`/api/financial/cash-closures/${encodeURIComponent(closureId)}`);
      if (!isCurrentDraftRevision(requestRevision, draftRevision.current)) {
        setSaveState("dirty");
        return;
      }
      const nextData = { closure: payload.closure, lines: payload.lines, operators: payload.operators };
      latestData.current = nextData;
      setData(nextData);
      setOperatorAvatars(payload.operatorAvatars ?? {});
      setActiveCountingSessionId(payload.activeCountingSessionId ?? null);
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

  const cashierEditable = !!data
    && ["draft", "reopened", "pending_review"].includes(data.closure.status)
    && permissions.financial?.cashClosures?.edit;
  const financeEditable = !!data
    && !!countingSessionId
    && ["draft", "reopened", "pending_review"].includes(data.closure.status)
    && permissions.financial?.cashClosures?.approve;
  const expectedEditable = !!data
    && ["draft", "reopened", "pending_review"].includes(data.closure.status)
    && permissions.financial?.cashClosures?.adjustExpected;
  const editable = cashierEditable || financeEditable;
  const requiresSeniorApproval = !!data && data.lines.some(
    (line) => Math.max(
      Math.abs(line.reportedDifferenceCents ?? 0),
      Math.abs(line.differenceCents ?? 0),
      Math.abs(line.conferenceDifferenceCents ?? 0),
    ) > seniorDivergenceCents,
  );

  const save = useCallback(async () => {
    if (saveInFlight.current) return saveInFlight.current;

    const current = latestData.current;
    if (!current || !["draft", "reopened", "pending_review"].includes(current.closure.status)) return;

    const request = (async () => {
      setSaveState("saving");
      try {
        const didCommit = await persistLatestDraft({
          read: () => {
            const draft = latestData.current;
            if (!draft || !["draft", "reopened", "pending_review"].includes(draft.closure.status)) return null;
            return { revision: draftRevision.current, value: draft };
          },
          persist: (draft) => api<CashClosureApiPayload>(`/api/financial/cash-closures/${encodeURIComponent(closureId)}`, {
            method: "PATCH",
            json: {
              ...(countingSessionId ? { countingSessionId } : {}),
              lines: draft.lines.map((line) => ({
                id: line.id,
                reportedCents: line.reportedCents,
                reportedNote: line.reportedNote,
                countedCents: line.countedCents,
                note: line.note,
              })),
            },
          }),
          commit: (payload) => {
            const nextData = { closure: payload.closure, lines: payload.lines, operators: payload.operators };
            latestData.current = nextData;
            setData(nextData);
            setSaveState("saved");
          },
        });
        if (!didCommit) setSaveState("idle");
      } catch (error) {
        setSaveState("error");
        toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha no autosave." });
        throw error;
      }
    })();

    saveInFlight.current = request;
    try {
      await request;
    } finally {
      if (saveInFlight.current === request) saveInFlight.current = null;
    }
  }, [api, closureId, countingSessionId, toast]);

  useEffect(() => {
    if (saveState !== "dirty" || !editable) return;
    const timer = window.setTimeout(() => { void save().catch(() => undefined); }, 1000);
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
    const current = latestData.current;
    if (!current) return;
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
    const nextData = { ...current, lines };
    draftRevision.current += 1;
    latestData.current = nextData;
    setData(nextData);
    setSaveState("dirty");
  }

  async function goToNextDay() {
    if (nextDayIsFuture || working) return;
    setWorking("next-day");
    try {
      if (["dirty", "saving", "error"].includes(saveState)) await save();
      router.push(nextDayHref);
    } catch {
      // O save já apresenta a falha e mantém o usuário no fechamento atual.
      setWorking(null);
    }
  }

  const sync = useCallback(async () => {
    setWorking("sync");
    try {
      if (["dirty", "saving", "error"].includes(saveState)) await save();
      const requestRevision = draftRevision.current;
      const payload = await api<CashClosureApiPayload>("/api/financial/cash-closures/sync", {
        method: "POST",
        json: { kioskId, date },
      });
      if (!isCurrentDraftRevision(requestRevision, draftRevision.current)) {
        setSaveState("dirty");
        toast({ title: "PDV ressincronizado; alterações locais mantidas para salvar." });
        return;
      }
      const nextData = { closure: payload.closure, lines: payload.lines, operators: payload.operators };
      latestData.current = nextData;
      setData(nextData);
      setSaveState("idle");
      toast({ title: payload.created ? "Fechamento criado a partir do PDV." : "Fechamento ressincronizado." });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na sincronização." });
    } finally {
      setWorking(null);
    }
  }, [api, date, kioskId, save, saveState, toast]);

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

  async function finalizeCount(operatorId: string, operatorName: string) {
    setWorking(`finalize:${operatorId}`);
    try {
      if (["dirty", "saving", "error"].includes(saveState)) await save();
      const payload = await api<CashClosureApiPayload>(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/finalize`, {
        method: "POST",
        json: { operatorId, countingSessionId },
      });
      toast({ title: `Contagem de ${operatorName} finalizada na sessão.` });
      if (payload.allocationError) {
        toast({ variant: "destructive", title: "Contagem finalizada, mas a alocação ficou pendente.", description: payload.allocationError });
      }
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao finalizar." });
    } finally {
      setWorking(null);
    }
  }

  function handleFinalizeOperator(event: ReactMouseEvent<HTMLButtonElement>) {
    const operatorId = event.currentTarget.dataset.operatorId;
    const operatorName = event.currentTarget.dataset.operatorName;
    if (!operatorId || !operatorName) return;
    void finalizeCount(operatorId, operatorName);
  }

  function openExpectedAdjustment(line: CashClosureLine) {
    setExpectedLineId(line.id);
    setExpectedCorrectionCents(line.expectedCents);
    setExpectedReason("");
  }

  async function saveExpectedAdjustment() {
    if (!expectedLineId || expectedCorrectionCents === null) return;
    setWorking("expected-adjustment");
    try {
      if (["dirty", "saving", "error"].includes(saveState)) await save();
      await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/expected-adjustment`, {
        method: "POST",
        json: {
          lineId: expectedLineId,
          correctedExpectedCents: expectedCorrectionCents,
          reason: expectedReason,
        },
      });
      setExpectedLineId(null);
      setExpectedReason("");
      toast({ title: "Esperado corrigido com auditoria preservada." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao corrigir o esperado." });
    } finally {
      setWorking(null);
    }
  }

  async function restoreExpectedCalculation() {
    if (!expectedLineId) return;
    setWorking("expected-restore");
    try {
      if (["dirty", "saving", "error"].includes(saveState)) await save();
      await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/expected-adjustment`, {
        method: "DELETE",
        json: { lineId: expectedLineId, reason: expectedReason },
      });
      setExpectedLineId(null);
      setExpectedReason("");
      toast({ title: "Cálculo importado do PDV restaurado." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao restaurar o cálculo." });
    } finally {
      setWorking(null);
    }
  }

  async function runReasonAction() {
    if (!reasonAction) return;
    setWorking("reopen");
    try {
      await api<CashClosureApiPayload>(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/reopen`, {
        method: "POST",
        json: { reason, operatorId: reasonAction.operatorId },
      });
      toast({ title: `Contagem de ${reasonAction.operatorName} reaberta.` });
      setReasonAction(null);
      setReason("");
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na ação." });
    } finally {
      setWorking(null);
    }
  }

  async function splitOversizedDeposit(operatorId: string, eligibleCents: number) {
    const partsCents: number[] = [];
    let remaining = eligibleCents;
    while (remaining > 0) {
      const part = Math.min(500_000, remaining);
      partsCents.push(part);
      remaining -= part;
    }
    setWorking("split-deposit");
    try {
      await api(`/api/financial/cash-closures/${encodeURIComponent(closureId)}/split-deposit`, {
        method: "POST",
        json: { operatorId, partsCents },
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
    const operatorById = new Map((data?.operators ?? []).map((operator) => [operator.operatorId, operator]));
    return [...grouped.entries()].map(([key, lines]) => ({
      key,
      name: lines[0].operatorName,
      lines,
      operator: operatorById.get(lines[0].operatorId) ?? null,
    }));
  }, [data?.lines, data?.operators]);

  const legacySharedBatchItemIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const operator of data?.operators ?? []) {
      const itemId = operator.cashDeposit.batchItemId;
      if (itemId) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([itemId]) => itemId));
  }, [data?.operators]);

  const expectedLine = useMemo(
    () => data?.lines.find((line) => line.id === expectedLineId) ?? null,
    [data?.lines, expectedLineId],
  );

  const liveSummary = useMemo(() => {
    const lines = data?.lines ?? [];
    return {
      expected: lines.reduce((total, line) => total + line.expectedCents, 0),
      reported: lines.reduce((total, line) => total + (line.reportedCents ?? 0), 0),
      reportedDifference: lines.reduce((total, line) => total + (line.reportedDifferenceCents ?? 0), 0),
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
  const countingSessionIds = useMemo(() => Array.from(new Set(
    (data?.operators ?? []).map((operator) => operator.countingSessionId).filter((id): id is string => !!id),
  )), [data?.operators]);
  if (!permissions.financial?.cashClosures?.view) {
    return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui acesso a fechamentos de caixa.</div>;
  }
  if (loading) return <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!data) {
    return <PageContainer variant="compact" className="space-y-4 pb-10">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-10 rounded-xl border-stone-200 font-bold"><Link href={monthHref}><ArrowLeft className="mr-2 h-4 w-4" />Voltar ao mês</Link></Button>
        <Button variant="outline" className="h-10 rounded-xl border-stone-200 font-bold" onClick={() => void goToNextDay()} disabled={nextDayIsFuture || !!working} title={nextDayIsFuture ? "O próximo dia ainda não está disponível." : undefined}>{working === "next-day" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Próximo dia{working !== "next-day" && <ArrowRight className="ml-2 h-4 w-4" />}</Button>
      </div>
      <Card><CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 p-10 text-center">
        <CircleDollarSign className="h-10 w-10 text-muted-foreground" />
        <div><h1 className="text-xl font-bold">Fechamento ainda não sincronizado</h1><p className="text-sm text-muted-foreground">{kioskId} · {date}</p></div>
        {permissions.financial.cashClosures.resync && <Button onClick={() => void sync()} disabled={working === "sync"}>{working === "sync" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sincronizar PDV</Button>}
      </CardContent></Card>
    </PageContainer>;
  }

  return <PageContainer variant="compact" className="space-y-4 pb-10">
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
        <Button variant="outline" className="h-10 rounded-xl border-stone-200 font-bold" onClick={() => void goToNextDay()} disabled={nextDayIsFuture || !!working} title={nextDayIsFuture ? "O próximo dia ainda não está disponível." : undefined}>{working === "next-day" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Próximo dia{working !== "next-day" && <ArrowRight className="ml-2 h-4 w-4" />}</Button>
        {permissions.financial.cashClosures.resync && <Button variant="outline" className="h-10 rounded-xl border-stone-200 font-bold" onClick={() => void sync()} disabled={!!working}><RefreshCw className="mr-2 h-4 w-4" />Ressincronizar</Button>}
        {editable && <Button variant="outline" className="h-10 rounded-xl border-stone-200 font-bold" onClick={() => void save().catch(() => undefined)} disabled={saveState === "saving" || !!working}><Save className="mr-2 h-4 w-4" />Salvar</Button>}
        {data.closure.status === "approved" && legacySharedBatchItemIds.size > 0 && permissions.financial.cashClosures.reopen && <Button variant="outline" className="h-10 rounded-xl border-stone-200 font-bold" onClick={() => setReasonAction({ operatorName: "todo o dia" })}><RotateCcw className="mr-2 h-4 w-4" />Reabrir dia legado</Button>}
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
      <span><strong className="text-zinc-900">Pix e cartões são conferidos automaticamente pelo PDV</strong> e ficam travados. No <strong className="text-zinc-900">dinheiro</strong>, Caixa e Financeiro informam contagens independentes.</span>
    </div>
    {!countingSessionId && data.closure.status !== "approved" && <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900"><span>O acesso direto permite informar os valores do Caixa, mas a conferência do Financeiro e a finalização só ficam disponíveis dentro de uma sessão de contagem.</span><Button asChild size="sm" variant="outline" className="shrink-0 border-amber-300 bg-white"><Link href="/dashboard/financial/cash-closures/sessions/new">Abrir sessão</Link></Button></div>}

    {data.closure.source.unknownPaymentNames.length > 0 && <div className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"><strong>Formas não mapeadas:</strong> {data.closure.source.unknownPaymentNames.join(", ")}</div>}
    {data.closure.finalizedOperatorCount > 0 && <Card className="rounded-2xl border-stone-200 shadow-[0_2px_10px_rgba(15,23,42,.04)]">
      <CardHeader className="pb-3"><CardTitle className="text-base">{countingSessionIds.length > 0 ? "Sessão da contagem" : "Referência do depósito"}</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{DEPOSIT_STATUS_LABEL[data.closure.cashDeposit.status]}</p>
          <p className="text-xs text-muted-foreground">Dinheiro elegível: {formatBRL(data.closure.cashDeposit.eligibleCents)}</p>
        </div>
        {countingSessionIds.length > 0
          ? <div className="flex flex-wrap gap-2">{countingSessionIds.map((id) => <Button key={id} asChild size="sm" variant="outline"><Link href={`/dashboard/financial/cash-closures/sessions/${id}`}>Sessão {id.slice(0, 8)}</Link></Button>)}</div>
          : depositBatchIds.length > 0
          ? <div className="flex flex-wrap gap-2">{depositBatchIds.map((batchId) => <Button key={batchId} asChild size="sm" variant="outline"><Link href={`/dashboard/financial/cash-deposits#deposit-${batchId}`}>{cashDepositBatchReferenceFromId(kioskId, batchId)}</Link></Button>)}</div>
          : <span className="text-xs text-muted-foreground">A referência aparecerá após a alocação do dinheiro.</span>}
      </CardContent>
    </Card>}

    {groups.length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Dia sem movimento. O fechamento zerado pode ser finalizado diretamente.</CardContent></Card> : groups.map((group) => {
      const operatorId = group.lines[0].operatorId;
      const expected = group.lines.reduce((total, line) => total + line.expectedCents, 0);
      const financePending = group.lines.some((line) => line.countedCents === null);
      const difference = group.lines.reduce((total, line) => total + (line.differenceCents ?? 0), 0);
      const initials = group.name.split(" ").slice(0, 2).map((part) => part[0]).join("");
      const interval = operatorInterval(group.lines);
      const groupResult = financePending ? null : resultText(difference);
      const operatorFinalized = group.operator?.status === "approved";
      const groupCashierEditable = cashierEditable && !operatorFinalized;
      const groupFinanceEditable = financeEditable && !operatorFinalized;
      return <Card key={group.key} className="overflow-hidden rounded-[18px] border-stone-200 shadow-[0_2px_10px_rgba(15,23,42,.05)]">
        <CardHeader className="border-b border-stone-100 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3"><Avatar className="h-[38px] w-[38px]"><AvatarImage src={operatorAvatars[group.lines[0].operatorId]} alt={group.name} className="object-cover" /><AvatarFallback className="bg-pink-100 text-xs font-black text-pink-600">{initials}</AvatarFallback></Avatar><div><CardTitle className="text-[15px] font-bold">{group.name}</CardTitle>{interval && <p className="mt-0.5 text-[11.5px] font-semibold text-zinc-400">{interval}</p>}</div></div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="inline-flex h-7 items-center rounded-full bg-stone-100 px-3 font-mono text-[11.5px] font-bold text-zinc-600"><span className="mr-1.5 font-sans font-semibold text-zinc-400">PDV</span>{formatBRL(expected)}</span>
              <span className={cn("inline-flex h-7 items-center rounded-full px-3 text-[11.5px] font-extrabold", operatorFinalized ? "bg-emerald-50 text-emerald-700" : groupResult?.className ?? "text-zinc-500", !operatorFinalized && (!groupResult ? "bg-stone-100" : difference === 0 ? "bg-emerald-50" : difference > 0 ? "bg-blue-50" : "bg-rose-50"))}>{operatorFinalized ? <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Contagem finalizada</> : !groupResult ? "Aguardando Financeiro" : difference === 0 ? <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Tudo confere</> : groupResult.label}</span>
              {groupFinanceEditable && countingSessionId && <Button size="sm" className="h-8 rounded-lg bg-emerald-700 font-bold hover:bg-emerald-800" data-operator-id={operatorId} data-operator-name={group.name} onClick={handleFinalizeOperator} disabled={!!working}>{working === `finalize:${operatorId}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Finalizar operador</Button>}
              {operatorFinalized && !legacySharedBatchItemIds.has(group.operator?.cashDeposit.batchItemId ?? "") && permissions.financial.cashClosures.reopen && <Button size="sm" variant="outline" className="h-8 rounded-lg font-bold" onClick={() => setReasonAction({ operatorId, operatorName: group.name })} disabled={!!working}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reabrir operador</Button>}
              {group.operator?.cashDeposit.manualSplitRequired && permissions.financial?.cashDeposits?.adjust && <Button size="sm" variant="outline" className="h-8 rounded-lg border-amber-300 bg-amber-50 font-bold text-amber-900" onClick={() => void splitOversizedDeposit(group.operator!.operatorId, group.operator!.cashDeposit.eligibleCents)} disabled={!!working}>{working === "split-deposit" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Dividir depósito</Button>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-0 !p-0">
          <div className="hidden grid-cols-[14px_minmax(170px,1.5fr)_150px_150px_150px_minmax(150px,190px)] gap-3 border-b border-stone-100 bg-stone-50/80 px-5 py-2.5 text-[9.5px] font-extrabold uppercase tracking-[.06em] text-zinc-400 lg:grid"><span /><span className="pl-[29px]">Canal</span><span className="text-right">PDV · esperado</span><span className="text-center">Caixa · contado</span><span className="text-center">Financeiro · conferido</span><span>Resultado</span></div>
          {group.lines.map((line) => {
            const result = resultText(line.differenceCents);
            const hasReportedDifference = (line.reportedDifferenceCents ?? 0) < 0;
            const hasFinanceDifference = line.countedCents !== null && (line.differenceCents ?? 0) < 0;
            const automatic = isPdvAutoCountedChannel(line.channel);
            const complete = line.reportedCents !== null && line.countedCents !== null;
            return <div key={line.id} className={cn("grid gap-3 border-b border-stone-100 px-5 py-3.5 last:border-b-0 lg:grid-cols-[14px_minmax(170px,1.5fr)_150px_150px_150px_minmax(150px,190px)] lg:items-center", (hasReportedDifference || hasFinanceDifference || line.expectedAdjustmentNeedsReview) && "bg-rose-50/35")}>
              <span className={cn("hidden h-[34px] w-[5px] rounded-full lg:block", complete && line.differenceCents === 0 ? "bg-emerald-500" : complete ? "bg-rose-500" : "bg-amber-400")} />
              <div className="flex items-center gap-2.5 font-semibold"><ChannelIcon line={line} /><span>{channelName(line)}{line.channel === "cash" && <span className="mt-0.5 block text-[10.5px] font-medium text-zinc-400">{formatBRL(line.metadata.grossCashCents ?? line.calculatedExpectedCents)} recebido − {formatBRL(line.metadata.changeCents ?? 0)} troco + {formatBRL(line.metadata.supplyCents ?? 0)} suprimentos − {formatBRL(line.metadata.withdrawalCents ?? 0)} sangrias</span>}</span>{line.channel === "cash" && <Popover><PopoverTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7"><Info className="h-4 w-4" /><span className="sr-only">Ver composição do dinheiro</span></Button></PopoverTrigger><PopoverContent align="start" className="w-80 space-y-2 text-sm"><p className="font-semibold">Composição do dinheiro</p><div className="flex justify-between"><span>Recebido</span><strong>{formatBRL(line.metadata.grossCashCents ?? line.calculatedExpectedCents)}</strong></div><div className="flex justify-between"><span>Troco</span><strong>- {formatBRL(line.metadata.changeCents ?? 0)}</strong></div><div className="flex justify-between"><span>Suprimentos</span><strong>+ {formatBRL(line.metadata.supplyCents ?? 0)}</strong></div><div className="flex justify-between"><span>Sangrias</span><strong>- {formatBRL(line.metadata.withdrawalCents ?? 0)}</strong></div><div className="flex justify-between border-t pt-2"><span>Calculado pelo sistema</span><strong>{formatBRL(line.calculatedExpectedCents)}</strong></div>{line.expectedAdjustedAt && <><div className="flex justify-between"><span>Ajuste manual</span><strong>{formatBRL(line.expectedAdjustmentCents)}</strong></div><p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">{line.expectedAdjustmentReason}</p></>}<div className="flex justify-between border-t pt-2"><span>Esperado efetivo</span><strong>{formatBRL(line.expectedCents)}</strong></div></PopoverContent></Popover>}</div>
              <div className="flex items-center justify-end gap-1.5"><div className="text-right font-mono text-sm">{formatBRL(line.expectedCents)}</div>{line.expectedAdjustedAt && <Badge variant="outline" className={cn("h-5 rounded-full px-1.5 text-[9px]", line.expectedAdjustmentNeedsReview ? "border-rose-300 bg-rose-50 text-rose-700" : "border-amber-300 bg-amber-50 text-amber-800")}>{line.expectedAdjustmentNeedsReview ? "Revisar" : "Ajustado"}</Badge>}{expectedEditable && !operatorFinalized && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openExpectedAdjustment(line)}><Pencil className="h-3.5 w-3.5" /><span className="sr-only">Corrigir esperado de {channelName(line)}</span></Button>}</div>
              <div className="space-y-1"><div className="relative"><CentsInput value={line.reportedCents} onChange={(value) => updateLine(line.id, { reportedCents: value })} disabled={!groupCashierEditable || automatic} ariaLabel={`Valor informado pelo Caixa em ${channelName(line)} para ${group.name}`} className={cn("h-9 rounded-[10px] border-stone-300 bg-stone-50 font-mono text-[13px]", automatic && "border-dashed bg-stone-100 pr-8 text-zinc-500", groupCashierEditable && !automatic && "border-pink-500 bg-white ring-2 ring-pink-100")} />{automatic && <LockKeyhole className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />}</div>{groupCashierEditable && !automatic && line.reportedCents === null && <Button type="button" variant="ghost" className="h-5 w-full px-1 text-[10px] font-bold text-zinc-500" onClick={() => updateLine(line.id, { reportedCents: line.expectedCents })}>Usar esperado</Button>}</div>
              <div className="relative"><CentsInput value={line.countedCents} onChange={(value) => updateLine(line.id, { countedCents: value })} disabled={!groupFinanceEditable || automatic} ariaLabel={`Valor conferido pelo Financeiro em ${channelName(line)} para ${group.name}`} className={cn("h-9 rounded-[10px] border-stone-300 bg-stone-50 font-mono text-[13px]", automatic && "border-dashed bg-stone-100 pr-8 text-zinc-500", groupFinanceEditable && !automatic && "border-pink-500 bg-white ring-2 ring-pink-100")} />{automatic && <LockKeyhole className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />}</div>
              <div><strong className={cn("inline-flex min-h-7 items-center rounded-full px-3 text-[11.5px] font-extrabold", line.reportedCents === null || line.countedCents === null ? "bg-stone-100 text-zinc-500" : line.differenceCents === 0 ? "bg-emerald-50 text-emerald-700" : (line.differenceCents ?? 0) > 0 ? "bg-blue-50 text-blue-700" : "bg-rose-50 text-rose-700")}>{line.reportedCents === null ? "Caixa não informou" : line.countedCents === null ? "Aguardando Financeiro" : automatic ? <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Conferido</> : result.label}</strong>{hasReportedDifference && <p className="mt-1 text-[10.5px] text-zinc-500">Caixa × PDV: {differenceLabel(line.reportedDifferenceCents)}</p>}{line.conferenceDifferenceCents !== null && line.conferenceDifferenceCents !== 0 && <p className="text-[10.5px] text-zinc-500">Financeiro × Caixa: {differenceLabel(line.conferenceDifferenceCents)}</p>}</div>
              {hasReportedDifference && <div className="lg:col-span-6 lg:pl-[29px]"><Textarea value={line.reportedNote ?? ""} onChange={(event) => updateLine(line.id, { reportedNote: event.target.value })} disabled={!groupCashierEditable} placeholder="Justificativa obrigatória do Caixa para a falta em relação ao PDV" className="min-h-[52px] border-rose-200 bg-rose-50/40 text-[12.5px]" /></div>}
              {hasFinanceDifference && <div className="lg:col-span-6 lg:pl-[29px]"><Textarea value={line.note ?? ""} onChange={(event) => updateLine(line.id, { note: event.target.value })} disabled={!groupFinanceEditable} placeholder="Parecer obrigatório do Financeiro sobre a falta apurada" className="min-h-[52px] border-rose-200 bg-rose-50/40 text-[12.5px]" /></div>}
            </div>;
          })}
        </CardContent>
      </Card>;
    })}

    {requiresSeniorApproval && <div className="flex items-start gap-3 rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] leading-5 text-rose-900"><AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" /><span><strong>Finalização sênior necessária.</strong> Uma diferença entre PDV, Caixa e Financeiro ultrapassa {formatBRL(seniorDivergenceCents)}; a finalização exige também permissão de reabertura.</span></div>}

    <Card className="overflow-hidden border-0 bg-zinc-900 text-white shadow-[0_14px_34px_-12px_rgba(0,0,0,.5)]"><CardContent className="grid items-stretch !p-0 sm:grid-cols-3 lg:grid-cols-[1.3fr_1fr_1fr_1fr_.9fr_.9fr]">
      <SummaryMetric label="Total PDV" value={formatBRL(liveSummary.expected)} prominent />
      <SummaryMetric label="Informado Caixa" value={liveSummary.unreported > 0 ? "—" : formatBRL(liveSummary.reported)} />
      <SummaryMetric label="Conferido Financeiro" value={liveSummary.pending > 0 ? "—" : formatBRL(liveSummary.counted)} />
      <SummaryMetric label="Diferença final" value={liveSummary.pending ? "—" : differenceLabel(liveSummary.difference)} valueClass={liveSummary.pending ? "text-zinc-500" : resultText(liveSummary.difference).className} />
      <SummaryMetric label="A informar Caixa" value={String(liveSummary.unreported)} valueClass={liveSummary.unreported ? "text-amber-300" : "text-emerald-300"} />
      <SummaryMetric label="A conferir Financeiro" value={String(liveSummary.pending)} valueClass={liveSummary.pending ? "text-amber-300" : "text-emerald-300"} />
    </CardContent></Card>

    <Dialog open={expectedLine !== null} onOpenChange={(open) => { if (!open) { setExpectedLineId(null); setExpectedReason(""); } }}>
      <DialogContent className="rounded-[20px] sm:max-w-[500px]">
        <DialogHeader><DialogTitle>Corrigir esperado do PDV</DialogTitle><DialogDescription>O valor corrigido passa a ser usado nas comparações. A composição importada permanece preservada para auditoria.</DialogDescription></DialogHeader>
        {expectedLine && <div className="space-y-4">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
            <div className="flex justify-between"><span>Calculado pelo sistema</span><strong>{formatBRL(expectedLine.calculatedExpectedCents)}</strong></div>
            {expectedLine.expectedAdjustedAt && <div className="mt-1 flex justify-between"><span>Ajuste atual</span><strong>{formatBRL(expectedLine.expectedAdjustmentCents)}</strong></div>}
          </div>
          <div><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-500">Novo esperado</p><CentsInput value={expectedCorrectionCents} onChange={setExpectedCorrectionCents} ariaLabel={`Novo esperado para ${channelName(expectedLine)}`} /></div>
          <div><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-500">Justificativa</p><Textarea value={expectedReason} onChange={(event) => setExpectedReason(event.target.value)} placeholder="Explique a divergência identificada na base do PDV" /></div>
          {expectedLine.expectedAdjustmentNeedsReview && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">A composição do PDV mudou após o ajuste. Confirme novamente o valor corrigido ou restaure o cálculo atualizado.</div>}
        </div>}
        <DialogFooter className="gap-2 sm:justify-between">
          <div>{expectedLine?.expectedAdjustedAt && <Button variant="outline" onClick={() => void restoreExpectedCalculation()} disabled={expectedReason.trim().length < 3 || !!working}>Restaurar cálculo do PDV</Button>}</div>
          <div className="flex gap-2"><Button variant="outline" onClick={() => setExpectedLineId(null)}>Cancelar</Button><Button onClick={() => void saveExpectedAdjustment()} disabled={expectedReason.trim().length < 3 || expectedCorrectionCents === null || expectedCorrectionCents === expectedLine?.expectedCents || !!working}>{working === "expected-adjustment" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar correção</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={reasonAction !== null} onOpenChange={(open) => { if (!open) { setReasonAction(null); setReason(""); } }}>
      <DialogContent className="rounded-[20px] sm:max-w-[460px]">
        <DialogHeader><DialogTitle>Reabrir contagem de {reasonAction?.operatorName}</DialogTitle><DialogDescription>A reabertura libera apenas este operador para alterações e exige justificativa. Se o valor já estiver em um boleto, a diferença será tratada como ajuste.</DialogDescription></DialogHeader>
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo obrigatório" />
        <DialogFooter><Button variant="outline" onClick={() => setReasonAction(null)}>Cancelar</Button><Button onClick={() => void runReasonAction()} disabled={reason.trim().length < 3 || !!working}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </PageContainer>;
}

function SummaryMetric({ label, value, valueClass, prominent = false }: { label: string; value: string; valueClass?: string; prominent?: boolean }) {
  return <div className="flex min-w-0 flex-col justify-center border-zinc-700/70 px-5 py-4 text-left sm:border-l sm:first:border-l-0"><p className="text-[9.5px] font-extrabold uppercase tracking-[.06em] text-zinc-500">{label}</p><p className={cn("mt-1 whitespace-nowrap font-mono text-[16px] font-extrabold", prominent && "text-xl", valueClass)}>{value}</p></div>;
}
