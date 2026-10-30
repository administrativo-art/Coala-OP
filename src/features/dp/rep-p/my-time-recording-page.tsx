"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, Eye, Info } from "lucide-react";
import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { ScheduledDarkTheme } from "@/components/theme/scheduled-dark-theme";
import { BackButton } from "@/components/navigation/back-button";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { listAbsenceRequests } from "@/features/dp/absences/requests/client";
import { AbsencePreviewPanel } from "@/features/dp/absences/requests/preview-panel";
import { AdjustmentReport, AdjustmentRequestPanel } from "@/features/dp/time-adjustments/adjustment-panel";
import { TimeBankCard } from "@/features/dp/time-bank/time-bank-card";
import type { AdjustmentView, TreatmentView } from "@/features/dp/time-adjustments/types";
import { SidePanel } from "@/components/patterns/side-panel";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

import { buildMonthView, type DayAbsence, type DayMarking, type DayShift, type DayView } from "./day-model";
import { DAY_GRID, DayCard, type ClassificationActions, type ReceiptActions } from "./day-list";
import { DayDetailPanel } from "./day-detail";
import type { BankStatementLine } from "@/features/dp/time-bank/core";
import { saveFile } from "./marking-ui";
import { hm, PURPOSE_DOT, RecordStrip, type MarkingPurpose } from "./record-strip";
import { AdjustmentsHistory, MirrorsGrid } from "./time-recording-views";
import { useRepPMarking, type RepPReceiptStatus } from "./use-rep-p-marking";

type HistoryItem = DayMarking & { workDate: string; collectorId: string; hash: string; receiptIssue: string | null };
type HistoryPayload = { markings: HistoryItem[]; truncated: boolean };
type MonthPayload = { month: string; shifts: (DayShift & { date: string })[]; truncated: boolean };
type EmployeeMonthPayload = {
  employee: { uid: string; name: string };
  schedule: MonthPayload;
  history: HistoryPayload;
  absences: DayAbsence[];
  adjustments: AdjustmentView[];
  treatments: TreatmentView[];
  unitNames: Record<string, string>;
};

export type TimeRecordingView = "records" | "adjustments" | "time-bank" | "mirrors";
export function parseTimeRecordingView(value: string | undefined): TimeRecordingView {
  return value === "adjustments" || value === "time-bank" || value === "mirrors" ? value : "records";
}
type BankPayload = { policy: { id: string; version: number; name: string; enabled: boolean } | null;
  statement: { balanceMinutes: number; cycle: { start: string; end: string } | null; lines: BankStatementLine[];
    reviewDays: Array<{ date: string; issues: string[] }> } | null;
  previewCompetences?: string[] };

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
// Ausências da conta "minhas" filtram pela data de início; 40 dias antes do mês pegam as que começaram no mês anterior.
const ABSENCE_LOOKBACK_DAYS = 40;

function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(month: string) {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;
}
function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function MyTimeRecordingPage({ employeeUid, initialView = "records" }: {
  employeeUid?: string;
  initialView?: TimeRecordingView;
} = {}) {
  const { firebaseUser, permissions, isDefaultAdmin } = useAuth();
  const readOnly = Boolean(employeeUid);
  const canReadOthers = isDefaultAdmin || permissions.dp?.timeRecording?.view === true
    || permissions.dp?.timeClosure?.close === true || permissions.dp?.timeClosure?.reopen === true;
  const canView = readOnly ? canReadOthers : (permissions.dashboard.collaborator ?? permissions.dashboard.view);
  const canReadClosure = isDefaultAdmin || permissions.dp?.timeClosure?.close === true || permissions.dp?.timeClosure?.reopen === true;
  const [reloadKey, setReloadKey] = useState(0);
  const onRecorded = useCallback(() => setReloadKey((current) => current + 1), []);
  const marking = useRepPMarking({ onRecorded, enabled: !readOnly });
  const { today, request, fetchReceiptFile, options, setLastMarking } = marking;
  const currentMonth = today.slice(0, 7);

  const [month, setMonth] = useState(currentMonth);
  const [schedule, setSchedule] = useState<MonthPayload | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [absences, setAbsences] = useState<DayAbsence[]>([]);
  const [absencesUnavailable, setAbsencesUnavailable] = useState(false);
  const [adjustments, setAdjustments] = useState<AdjustmentView[]>([]);
  const [treatments, setTreatments] = useState<TreatmentView[]>([]);
  const [adjustDate, setAdjustDate] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [showFuture, setShowFuture] = useState(false);
  const [openDate, setOpenDate] = useState<string | null>(null);
  // Pedido de ausência aberto na própria tela: undefined = fechado; "" = sem data; AAAA-MM-DD = vindo do dia.
  const [absenceDate, setAbsenceDate] = useState<string | undefined>(undefined);
  const [busyReceipt, setBusyReceipt] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<{ id: string; message: string } | null>(null);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [employeeUnitNames, setEmployeeUnitNames] = useState<Record<string, string>>({});

  const [recordOpen, setRecordOpen] = useState(false);
  const [bank, setBank] = useState<BankPayload | null>(null);
  const [bankUnavailable, setBankUnavailable] = useState(false);
  const monthStart = `${month}-01`;
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);

  // Uma leitura por troca de mês ou batida: escala própria, batidas do mês (até hoje) e ausências.
  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    const historyEnd = monthEnd < today ? monthEnd : today;
    setLoading(true);
    setLoadError(null);
    if (employeeUid) {
      request<EmployeeMonthPayload>(`/api/dp/time-recording/employees/${encodeURIComponent(employeeUid)}`,
        { method: "POST", json: { month }, fallbackError: "Não foi possível carregar o ponto do colaborador." })
        .then((payload) => {
          if (cancelled) return;
          setEmployeeName(payload.employee.name);
          setEmployeeUnitNames(payload.unitNames);
          setSchedule(payload.schedule);
          setHistory(payload.history);
          setAbsences(payload.absences);
          setAbsencesUnavailable(false);
          setAdjustments(payload.adjustments);
          setTreatments(payload.treatments);
        })
        .catch((error) => { if (!cancelled) setLoadError(errorMessageOf(error, "Não foi possível carregar o mês.")); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    Promise.all([
      request<MonthPayload>(`/api/dp/time-recording/month?month=${month}`, { fallbackError: "Não foi possível carregar sua escala." }),
      monthStart <= today
        ? request<HistoryPayload>(`/api/dp/time-recording/markings?${new URLSearchParams({ startDate: monthStart, endDate: historyEnd })}`,
          { fallbackError: "Não foi possível carregar as batidas." })
        : Promise.resolve({ markings: [], truncated: false }),
      listAbsenceRequests(firebaseUser, "mine", undefined, { startDate: addDays(monthStart, -ABSENCE_LOOKBACK_DAYS), endDate: monthEnd })
        .then((result) => ({ ok: true as const, result }), () => ({ ok: false as const, result: null })),
      request<{ adjustments: AdjustmentView[]; treatments: TreatmentView[] }>(`/api/dp/time-recording/adjustments?month=${month}`,
        { fallbackError: "Não foi possível carregar os ajustes." }).catch(() => ({ adjustments: [], treatments: [] })),
    ]).then(([monthPayload, historyPayload, absencePayload, adjustmentPayload]) => {
      setAdjustments(adjustmentPayload.adjustments);
      setTreatments(adjustmentPayload.treatments);
      if (cancelled) return;
      setSchedule(monthPayload);
      setHistory(historyPayload);
      setAbsencesUnavailable(!absencePayload.ok);
      setAbsences((absencePayload.result?.requests ?? [])
        .filter((item) => item.input.startDate <= monthEnd && item.input.endDate >= monthStart && !["draft", "cancelled", "rejected"].includes(item.status))
        .map((item) => ({ id: item.id, typeName: item.typeName, status: item.status, startDate: item.input.startDate, endDate: item.input.endDate,
          approvedByInaction: item.approvedByInaction })));
    }).catch((error) => {
      if (!cancelled) setLoadError(errorMessageOf(error, "Não foi possível carregar o mês."));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [employeeUid, firebaseUser, month, monthStart, monthEnd, today, request, reloadKey]);

  // Extrato do banco no ciclo do mês aberto: alimenta o cartão "Banco de horas" e a política aplicada em cada dia.
  // Uma leitura por troca de mês ou batida, a mesma que o cartão do banco já fazia.
  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    const date = monthEnd < today ? monthEnd : today;
    setBankUnavailable(false);
    request<BankPayload>(`/api/dp/time-recording/time-bank?${new URLSearchParams({ date, ...(employeeUid ? { employeeUid } : {}) })}`,
      { fallbackError: "Não foi possível ler o banco de horas." })
      .then((payload) => { if (!cancelled) setBank(payload); })
      .catch(() => { if (!cancelled) { setBank(null); setBankUnavailable(true); } });
    return () => { cancelled = true; };
  }, [employeeUid, firebaseUser, monthEnd, today, request, reloadKey]);

  const days = useMemo(() => buildMonthView({
    month, today, shifts: schedule?.shifts ?? [], markings: history?.markings ?? [], absences, treatments,
  }), [month, today, schedule, history, absences, treatments]);
  // A faixa de registro mostra sempre o dia de hoje, mesmo navegando por outros meses.
  const [todaySnapshot, setTodaySnapshot] = useState<DayView | null>(null);
  useEffect(() => {
    if (month !== currentMonth || !schedule) return;
    const found = days.find((day) => day.date === today);
    if (found) setTodaySnapshot(found);
  }, [days, month, currentMonth, schedule, today]);
  const todayView = useMemo<DayView>(() => todaySnapshot
    ?? { date: today, shift: null, markings: [], allMarkings: [], absence: null, incidents: [], workedMinutes: 0, breakMinutes: null,
      plannedWorkMinutes: null, nightMinutes: 0, balanceMinutes: null, deviation: null },
  [todaySnapshot, today]);
  const unitNames = useMemo(() => new Map(readOnly
    ? Object.entries(employeeUnitNames)
    : options?.executionUnits.map((unit) => [unit.id, unit.name]) ?? []), [employeeUnitNames, options, readOnly]);

  const adjustmentDates = useMemo(() => new Set(adjustments.filter((item) => item.status === "in_review").map((item) => item.workDate)), [adjustments]);
  const matches = useCallback((day: DayView) => {
    if (filter === "marks") return day.markings.length > 0;
    if (filter === "alert") return day.incidents.length > 0;
    if (filter === "review") return adjustmentDates.has(day.date);
    if (filter === "absence") return day.absence !== null;
    return true;
  }, [filter, adjustmentDates]);
  const past = days.filter((day) => day.date <= today);
  const future = days.filter((day) => day.date > today);
  // Hoje primeiro e os dias anteriores em seguida, agrupados por semana (domingo a sábado).
  const weeks = useMemo(() => {
    const grouped: DayView[][] = [];
    [...past].reverse().forEach((day) => {
      if (!grouped.length || new Date(`${day.date}T12:00:00Z`).getUTCDay() === 6) grouped.push([]);
      grouped[grouped.length - 1].push(day);
    });
    return grouped;
  }, [past]);
  const alertDays = days.filter((day) => day.incidents.length).length;
  const absenceDays = days.filter((day) => day.absence).length;
  const markedDays = days.filter((day) => day.markings.length).length;
  const reviewDays = days.filter((day) => adjustmentDates.has(day.date)).length;
  const inReview = adjustments.filter((item) => item.status === "in_review").length;
  const registered = days.reduce((sum, day) => sum + day.workedMinutes, 0);
  const balance = days.reduce((sum, day) => sum + (day.balanceMinutes ?? 0), 0);
  const filterLabel = ({ marks: "Dias com batida", alert: "A conferir", review: "Ajuste em análise", absence: "Com ausência" } as Record<string, string>)[filter] ?? null;
  const filtered = days.filter((day) => day.date <= today && matches(day)).length;

  const changeMonth = (delta: number) => { setMonth((current) => shiftMonth(current, delta)); setFilter("all"); setOpenDate(null); };

  async function retryReceipt(receiptId: string) {
    setBusyReceipt(receiptId);
    setReceiptError(null);
    try {
      const result = await request<{ receiptStatus: RepPReceiptStatus; receiptIssue: string | null }>(
        `/api/dp/time-recording/receipts/${receiptId}`, { method: "POST", fallbackError: "Não foi possível emitir o comprovante." });
      if (result.receiptStatus !== "available") {
        setReceiptError({ id: receiptId, message: "O comprovante continua pendente. O ponto está registrado; tente mais tarde." });
      }
      setLastMarking((current) => current?.receiptId === receiptId ? { ...current, ...result } : current);
      setReloadKey((current) => current + 1);
    } catch (error) {
      setReceiptError({ id: receiptId, message: errorMessageOf(error, "Não foi possível emitir o comprovante.") });
    } finally {
      setBusyReceipt(null);
    }
  }
  async function openReceipt(item: DayMarking) {
    setBusyReceipt(item.receiptId);
    setReceiptError(null);
    try {
      saveFile(await fetchReceiptFile(item.receiptId, item.nsr, item.markedAt));
    } catch (error) {
      setReceiptError({ id: item.receiptId, message: errorMessageOf(error, "Não foi possível abrir o comprovante.") });
    } finally {
      setBusyReceipt(null);
    }
  }
  const canShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";
  async function shareReceipt(item: DayMarking) {
    setBusyReceipt(item.receiptId);
    setReceiptError(null);
    try {
      const file = await fetchReceiptFile(item.receiptId, item.nsr, item.markedAt);
      if (!navigator.canShare?.({ files: [file] })) {
        setReceiptError({ id: item.receiptId, message: "Este navegador não compartilha arquivos. Use Baixar." });
        return;
      }
      // Quem escolhe destino e confirma o envio é a pessoa, na folha nativa do sistema.
      await navigator.share({ files: [file], title: "Comprovante de registro de ponto" });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setReceiptError({ id: item.receiptId, message: errorMessageOf(error, "Não foi possível compartilhar o comprovante.") });
      }
    } finally {
      setBusyReceipt(null);
    }
  }
  const receipts: ReceiptActions = { busyReceipt, canShare, error: receiptError, open: (item) => void openReceipt(item),
    share: (item) => void shareReceipt(item), retry: (id) => void retryReceipt(id) };
  const classifications: ClassificationActions = {
    async change(receiptId: string, purpose: MarkingPurpose) {
      const result = await request<{ changeStatus: "applied" | "in_review" }>(
        `/api/dp/time-recording/markings/${encodeURIComponent(receiptId)}/classification`,
        { method: "PATCH", json: { purpose }, fallbackError: "Não foi possível alterar a classificação." });
      setReloadKey((current) => current + 1);
      return result;
    },
  };
  const baseHref = employeeUid
    ? `/dashboard/dp/collaborators/${encodeURIComponent(employeeUid)}/time-recording`
    : "/dashboard/collaborator/time-recording";

  if (!canView) return <p className="p-6 text-ds-ink-muted">Sem permissão para consultar este registro de ponto.</p>;

  const viewHref = (view: TimeRecordingView) => view === "records" ? baseHref : `${baseHref}?view=${view}`;
  const bankBalance = bank?.statement?.balanceMinutes ?? null;
  const bankPreview = Boolean(bank?.previewCompetences?.length);
  const VIEW_CARDS: Array<{ view: TimeRecordingView; title: string; value: string; hint: string; tone?: string; chip?: { label: string; variant: "warn" | "info" | "neutral" } }> = [
    { view: "records", title: "Registros", value: hm(registered), hint: `registradas em ${MONTHS[Number(month.slice(5, 7)) - 1]}`,
      chip: alertDays ? { label: `${alertDays} a conferir`, variant: "warn" } : undefined },
    { view: "adjustments", title: "Histórico de ajustes", value: String(adjustments.length), hint: `${inReview} em análise · pedidos do mês`,
      chip: inReview ? { label: `${inReview} em análise`, variant: "info" } : undefined },
    { view: "time-bank", title: "Banco de horas", value: bankBalance === null ? "—" : hm(bankBalance, true),
      hint: bank?.policy ? (bank.policy.enabled ? bank.statement?.cycle ? `ciclo ${bank.statement.cycle.start.split("-").reverse().join("/")} a ${bank.statement.cycle.end.split("-").reverse().join("/")}` : "saldo do ciclo" : "banco desligado na política")
        : bankUnavailable ? "indisponível agora" : "sem política de horas",
      tone: bankBalance === null ? undefined : bankBalance < 0 ? "text-ds-danger" : bankBalance > 0 ? "text-ds-ok" : undefined,
      chip: bankBalance !== null ? { label: bankPreview ? "Prévia" : "Fechado", variant: "neutral" } : undefined },
    { view: "mirrors", title: "Espelhos mensais", value: monthLabel(currentMonth).split(" ")[0], hint: `${monthLabel(currentMonth).split(" ")[0]} fecha após ${`${addDays(`${shiftMonth(currentMonth, 1)}-01`, -1).slice(8, 10)}/${currentMonth.slice(5, 7)}`}` },
  ];

  return (
    <PageContainer variant="wide" className="space-y-5 pb-8">
      <ScheduledDarkTheme />
      <header className="flex items-center gap-3">
        <BackButton fallbackHref={employeeUid ? `/dashboard/dp/collaborators/${encodeURIComponent(employeeUid)}` : "/dashboard/collaborator"}
          label={employeeUid ? "Perfil do colaborador" : "Painel do colaborador"} variant="ghost" size="sm" className="-ml-2" />
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ds-ink">{initialView === "time-bank" ? "Banco de horas" : "Registro de ponto"}</h1>
          {readOnly ? <p className="text-sm font-semibold text-ds-ink-muted">{employeeName ?? "Colaborador"}</p> : null}
        </div>
      </header>

      {readOnly ? (
        <div className="flex items-start gap-3 rounded-ds-card border border-ds-info-bg bg-ds-info-bg/45 px-4 py-3 text-sm text-ds-ink-2">
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-ds-info" aria-hidden />
          {initialView === "time-bank"
            ? <p><strong className="text-ds-ink">Modo de conferência.</strong> O DP pode consultar e analisar o extrato, mas não registra batidas em nome do colaborador.</p>
            : <p><strong className="text-ds-ink">Modo de conferência.</strong> Esta tela permite analisar escala, batidas, ausências, ajustes, alertas e saldo. Ela não registra ponto em nome do colaborador.</p>}
        </div>
      ) : <>
        {options?.mode === "pilot" ? (
          <div className="rounded-ds-card border border-ds-warn/20 bg-ds-warn-bg px-4 py-3 text-sm text-ds-warn">
            <strong>Ensaio controlado.</strong> As batidas aparecem aqui e na prévia do banco de horas, mas ficam fora do fechamento, do AFD e do AEJ.
          </div>
        ) : null}
        <RecordStrip marking={marking} day={todayView} today={today} onOpenDay={() => setOpenDate(today)} onRecorded={onRecorded}
          dialogOpen={recordOpen} onDialogOpenChange={setRecordOpen} />
      </>}

      {/* Consultas por cartões, como no Coala Go; cada uma tem endereço próprio (?view=). */}
      <nav aria-label="Consultas do ponto" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {VIEW_CARDS.map((card) => (
          <Link key={card.view} href={viewHref(card.view)} aria-current={initialView === card.view ? "page" : undefined}
            className={cn("flex min-w-0 flex-col gap-1 rounded-ds-card border bg-ds-surface px-4 py-3 transition-colors hover:border-ds-ink-faint",
              initialView === card.view ? "border-ds-ink shadow-[inset_0_0_0_1px_var(--ds-ink)]" : "border-ds-border")}>
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-extrabold text-ds-ink">{card.title}</span>
              {card.chip ? <StatusPill variant={card.chip.variant}>{card.chip.label}</StatusPill> : null}
            </span>
            <span className={cn("font-ds-mono text-xl font-extrabold capitalize tabular-nums text-ds-ink", card.tone)}>{card.value}</span>
            <span className="truncate text-xs text-ds-ink-muted">{card.hint}</span>
          </Link>
        ))}
      </nav>

      {initialView === "time-bank" ? (
        <section id="banco-de-horas" className="scroll-mt-28 space-y-3">
          <div>
            <h2 className="text-lg font-extrabold text-ds-ink">Resumo e extrato detalhado</h2>
            <p className="text-sm text-ds-ink-muted">Saldo, créditos, débitos, dias em revisão, ciclo vigente e cada lançamento que compõe o banco.</p>
          </div>
          <TimeBankCard firebaseUser={firebaseUser} employeeUid={employeeUid} detailed />
        </section>
      ) : initialView === "mirrors" ? (
        !readOnly || canReadClosure
          ? <MirrorsGrid firebaseUser={firebaseUser} today={today} employeeUid={employeeUid} />
          : <p className="text-sm text-ds-ink-muted">Os espelhos deste colaborador exigem a permissão de fechamento do ponto.</p>
      ) : (
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-9 items-center rounded-ds-md border border-ds-border bg-ds-surface">
                <button type="button" aria-label="Mês anterior" onClick={() => changeMonth(-1)} className="px-2 text-ds-ink-muted hover:text-ds-ink"><ChevronLeft className="h-4 w-4" /></button>
                <span className="px-1 text-[13px] font-bold text-ds-ink">{monthLabel(month)}</span>
                <button type="button" aria-label="Próximo mês" onClick={() => changeMonth(1)} disabled={month >= shiftMonth(currentMonth, 1)}
                  className="px-2 text-ds-ink-muted hover:text-ds-ink disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
              {month !== currentMonth ? <button type="button" onClick={() => setMonth(currentMonth)} className="text-xs font-bold text-ds-ink-2 underline">Voltar para hoje</button> : null}
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ds-ink-muted">
              <span><strong className="text-sm text-ds-ink">{hm(registered)}</strong> registradas</span>
              <span>Saldo (prévia) <strong className="text-sm text-ds-ink">{hm(balance, true)}</strong></span>
            </p>
          </div>

          {loadError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{loadError}</p> : null}

          {initialView === "adjustments" ? (
            <AdjustmentsHistory adjustments={adjustments} onOpen={setReportId} onOpenDay={(date) => setOpenDate(date)} />
          ) : (
            <>
              {/* Contagens que filtram a lista; clicar de novo limpa. */}
              <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Filtrar dias">
                {([["marks", markedDays, "dias com batida", "text-ds-ink"], ["alert", alertDays, "a conferir", "text-ds-caution"],
                  ["review", reviewDays, "com ajuste em análise", "text-ds-info"]] as const).map(([value, count, label, tone]) => (
                  <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(filter === value ? "all" : value); setShowFuture(false); }}
                    className={cn("flex items-center gap-3 rounded-ds-btn-lg border bg-ds-surface px-4 py-2.5 text-left transition-colors hover:border-ds-ink-faint",
                      filter === value ? "border-ds-ink shadow-[inset_0_0_0_1px_var(--ds-ink)]" : "border-ds-border")}>
                    <span className={cn("font-ds-mono text-[22px] font-extrabold tabular-nums", tone)}>{count}</span>
                    <span className="text-[12.5px] font-semibold text-ds-ink-muted">{label}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ds-ink-muted">
                  {([["journey_start", "Início da jornada"], ["break_start", "Intervalo"], ["journey_end", "Fim da jornada"]] as const).map(([purpose, label]) => (
                    <span key={purpose} className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("h-2 w-2 rounded-full", PURPOSE_DOT[purpose as MarkingPurpose])} />{label}</span>
                  ))}
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-full border border-dashed border-ds-ink-faint" />Sem classificação</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {absenceDays ? (
                    <button type="button" aria-pressed={filter === "absence"} onClick={() => setFilter(filter === "absence" ? "all" : "absence")}
                      className={cn("rounded-ds-pill border px-3 py-1 text-xs font-bold", filter === "absence" ? "border-ds-ink bg-ds-ink text-white" : "border-ds-border bg-ds-surface text-ds-ink-2")}>
                      Com ausência · {absenceDays}
                    </button>
                  ) : null}
                  {!readOnly ? <Button type="button" variant="ds-secondary" size="sm" onClick={() => setAbsenceDate("")}><CalendarPlus className="h-4 w-4" aria-hidden /> Solicitar ausência</Button> : null}
                </div>
              </div>
              {absencesUnavailable ? <p className="text-xs text-ds-ink-muted">As ausências não puderam ser carregadas agora.</p> : null}

              {filterLabel ? (
                <div className="flex flex-wrap items-center gap-2 rounded-ds-btn-lg border border-ds-accent-ink/20 bg-ds-accent-row px-3 py-2 text-sm">
                  <span className="text-ds-ink-muted">Filtrando:</span>
                  <strong className="text-ds-ink">{filterLabel}</strong>
                  <span className="text-ds-ink-muted">· {filtered} {filtered === 1 ? "dia" : "dias"}</span>
                  <button type="button" onClick={() => setFilter("all")} className="ml-auto text-xs font-bold text-ds-accent-ink underline">Limpar filtro</button>
                </div>
              ) : null}

              {history?.truncated || schedule?.truncated ? (
                <p className="text-xs text-ds-caution">O mês tem mais registros do que esta tela mostra de uma vez; confira os dias no fechamento.</p>
              ) : null}

              <div className="space-y-2">
                <div className={cn(DAY_GRID, "hidden px-[18px] pb-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint md:grid")}>
                  <span>Dia</span><span>Escala</span><span>Batidas</span><span>Total</span><span>Saldo (prévia)</span><span>A conferir</span>
                </div>
                {loading && !schedule ? (
                  Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="flex items-center gap-4 rounded-ds-btn-lg border border-ds-border bg-ds-surface px-[18px] py-4" aria-hidden>
                      <span className="h-10 w-14 animate-pulse rounded-ds-md bg-ds-warm" />
                      <span className="h-4 w-24 animate-pulse rounded bg-ds-warm" />
                      <span className="h-3 flex-1 animate-pulse rounded-full bg-ds-warm" />
                    </div>
                  ))
                ) : past.length === 0 && future.length === 0 ? null : (
                  <>
                    {future.length && filter === "all" ? (
                      <button type="button" onClick={() => setShowFuture((current) => !current)}
                        className="flex w-full items-center gap-2 rounded-ds-btn-lg border border-ds-border bg-ds-surface/60 px-4 py-2.5 text-left text-xs font-bold text-ds-ink-muted hover:bg-ds-surface">
                        <ChevronDown className={cn("h-4 w-4 transition-transform", !showFuture && "-rotate-90")} aria-hidden />
                        Próximos dias ({future.length})
                      </button>
                    ) : null}
                    {showFuture && filter === "all" ? [...future].reverse().map((day) => (
                      <div key={day.date} className="flex items-center gap-3 rounded-ds-btn-lg border border-dashed border-ds-border px-4 py-2 text-xs text-ds-ink-muted">
                        <span className="w-24 font-bold">{day.date.slice(8, 10)}/{day.date.slice(5, 7)}</span>
                        {day.absence ? <span>{day.absence.typeName}</span>
                          : day.shift?.type === "work" ? <span>{day.shift.shiftName ?? "Turno"} · {day.shift.startTime}–{day.shift.endTime}</span>
                            : <span>{day.shift ? "Folga" : "Sem escala"}</span>}
                      </div>
                    )) : null}
                    {weeks.map((week) => {
                      const visible = week.filter(matches);
                      if (!visible.length) return null;
                      const worked = week.reduce((sum, day) => sum + day.workedMinutes, 0);
                      const weekAlerts = week.filter((day) => day.incidents.length).length;
                      const first = week[week.length - 1].date;
                      const last = week[0].date;
                      return (
                        <Fragment key={first}>
                          <div className="flex flex-wrap items-center gap-3 px-1 pb-0.5 pt-4 text-xs first:pt-1">
                            <strong className="text-ds-ink">{first.slice(8, 10)}/{first.slice(5, 7)} a {last.slice(8, 10)}/{last.slice(5, 7)}</strong>
                            <span className="tabular-nums text-ds-ink-2"><strong className="text-ds-ink">{hm(worked)}</strong> registradas</span>
                            {weekAlerts ? <span className="font-bold text-ds-danger">{weekAlerts} {weekAlerts === 1 ? "dia a conferir" : "dias a conferir"}</span> : <span className="text-ds-ink-muted">nada a conferir</span>}
                          </div>
                          {visible.map((day) => <DayCard key={day.date} day={day} today={today} selected={openDate === day.date}
                            reviewing={adjustmentDates.has(day.date)} onOpen={() => setOpenDate(day.date)} />)}
                        </Fragment>
                      );
                    })}
                    {past.length === 0 ? <p className="rounded-[18px] border border-dashed border-ds-border bg-ds-surface p-6 text-center text-sm text-ds-ink-muted">Este mês ainda não começou.</p> : null}
                  </>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-xs text-ds-ink-muted">
                <Info className="h-3.5 w-3.5" aria-hidden /> Saldo e itens a conferir são uma prévia; a apuração oficial é feita no fechamento do ponto.
              </p>
            </>
          )}
        </div>
      )}

      <DayDetailPanel day={openDate ? days.find((day) => day.date === openDate) ?? (openDate === today ? todayView : null) : null}
        days={days} today={today} unitNames={unitNames} receipts={readOnly ? null : receipts} classifications={readOnly ? null : classifications}
        onClose={() => setOpenDate(null)} onNavigate={setOpenDate}
        onRequestAbsence={(date) => { setOpenDate(null); setAbsenceDate(date); }}
        adjustments={adjustments.filter((item) => item.workDate === openDate)}
        onRequestAdjustment={(date) => { setOpenDate(null); setAdjustDate(date); }}
        onOpenAdjustment={(id) => { setOpenDate(null); setReportId(id); }} readOnly={readOnly} markingMode={options?.mode ?? null}
        bank={bank ? { policy: bank.policy, lines: bank.statement?.lines.filter((item) => item.date === openDate) ?? [],
          reviewIssues: bank.statement?.reviewDays.find((item) => item.date === openDate)?.issues ?? [],
          preview: Boolean(openDate && bank.previewCompetences?.includes(openDate.slice(0, 7))) } : bankUnavailable ? "unavailable" : null}
        onRecord={!readOnly && openDate === today && marking.canRecord ? () => { setOpenDate(null); setRecordOpen(true); } : undefined} />
      {adjustDate && !readOnly && (options?.mode === "official" || options?.mode === "pilot") ? (
        <AdjustmentRequestPanel key={adjustDate} open workDate={adjustDate} request={request}
          originals={days.find((day) => day.date === adjustDate)?.allMarkings ?? []}
          scope={days.find((day) => day.date === adjustDate)?.allMarkings.some((item) => item.pilot)
            || (options.mode === "pilot" && adjustDate === today) ? "pilot" : "official"}
          onClose={() => setAdjustDate(null)} onSubmitted={() => setReloadKey((current) => current + 1)} />
      ) : null}
      {reportId && adjustments.find((item) => item.id === reportId) ? (() => {
        const adjustment = adjustments.find((item) => item.id === reportId)!;
        return (
          <SidePanel open onOpenChange={(next) => { if (!next) setReportId(null); }} kicker={`Pedido de ajuste · ${adjustment.workDate.split("-").reverse().join("/")}`}
            title="Relatório do pedido" subtitle="Antigo × novo, justificativa e quem pediu e decidiu.">
            <AdjustmentReport adjustment={adjustment} originals={days.find((day) => day.date === adjustment.workDate)?.allMarkings ?? []} />
          </SidePanel>
        );
      })() : null}
      {!readOnly ? <AbsencePreviewPanel open={absenceDate !== undefined} onOpenChange={(open) => { if (!open) setAbsenceDate(undefined); }}
        firebaseUser={firebaseUser} initialDate={absenceDate || undefined} onDraftCreated={() => setReloadKey((current) => current + 1)} /> : null}
    </PageContainer>
  );
}
