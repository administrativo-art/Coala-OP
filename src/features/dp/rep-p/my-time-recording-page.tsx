"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Info } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { BackButton } from "@/components/navigation/back-button";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Segmented } from "@/components/patterns/segmented";
import { listAbsenceRequests } from "@/features/dp/absences/requests/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

import { buildMonthView, type DayAbsence, type DayMarking, type DayShift, type DayView, type DayIncident } from "./day-model";
import { AbsencesAndAlerts, DAY_GRID, DayCard, DayPanel, INCIDENTS, type ReceiptActions } from "./day-list";
import { saveFile } from "./marking-ui";
import { hm, RecordStrip } from "./record-strip";
import { useRepPMarking, type RepPReceiptStatus } from "./use-rep-p-marking";

type HistoryItem = DayMarking & { workDate: string; collectorId: string; hash: string; receiptIssue: string | null };
type HistoryPayload = { markings: HistoryItem[]; truncated: boolean };
type MonthPayload = { month: string; shifts: (DayShift & { date: string })[]; truncated: boolean };

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

export function MyTimeRecordingPage() {
  const { firebaseUser, permissions } = useAuth();
  const canView = permissions.dashboard.collaborator ?? permissions.dashboard.view;
  const [reloadKey, setReloadKey] = useState(0);
  const onRecorded = useCallback(() => setReloadKey((current) => current + 1), []);
  const marking = useRepPMarking({ onRecorded });
  const { today, request, fetchReceiptFile, options, setLastMarking } = marking;
  const currentMonth = today.slice(0, 7);

  const [month, setMonth] = useState(currentMonth);
  const [schedule, setSchedule] = useState<MonthPayload | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [absences, setAbsences] = useState<DayAbsence[]>([]);
  const [absencesUnavailable, setAbsencesUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [showFuture, setShowFuture] = useState(false);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [busyReceipt, setBusyReceipt] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<{ id: string; message: string } | null>(null);

  const monthStart = `${month}-01`;
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);

  // Uma leitura por troca de mês ou batida: escala própria, batidas do mês (até hoje) e ausências.
  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    const historyEnd = monthEnd < today ? monthEnd : today;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      request<MonthPayload>(`/api/dp/time-recording/month?month=${month}`, { fallbackError: "Não foi possível carregar sua escala." }),
      monthStart <= today
        ? request<HistoryPayload>(`/api/dp/time-recording/markings?${new URLSearchParams({ startDate: monthStart, endDate: historyEnd })}`,
          { fallbackError: "Não foi possível carregar as batidas." })
        : Promise.resolve({ markings: [], truncated: false }),
      listAbsenceRequests(firebaseUser, "mine", undefined, { startDate: addDays(monthStart, -ABSENCE_LOOKBACK_DAYS), endDate: monthEnd })
        .then((result) => ({ ok: true as const, result }), () => ({ ok: false as const, result: null })),
    ]).then(([monthPayload, historyPayload, absencePayload]) => {
      if (cancelled) return;
      setSchedule(monthPayload);
      setHistory(historyPayload);
      setAbsencesUnavailable(!absencePayload.ok);
      setAbsences((absencePayload.result?.requests ?? [])
        .filter((item) => item.input.startDate <= monthEnd && item.input.endDate >= monthStart && !["draft", "cancelled", "rejected"].includes(item.status))
        .map((item) => ({ id: item.id, typeName: item.typeName, status: item.status, startDate: item.input.startDate, endDate: item.input.endDate })));
    }).catch((error) => {
      if (!cancelled) setLoadError(errorMessageOf(error, "Não foi possível carregar o mês."));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [firebaseUser, month, monthStart, monthEnd, today, request, reloadKey]);

  const days = useMemo(() => buildMonthView({
    month, today, shifts: schedule?.shifts ?? [], markings: history?.markings ?? [], absences,
  }), [month, today, schedule, history, absences]);
  // A faixa de registro mostra sempre o dia de hoje, mesmo navegando por outros meses.
  const [todaySnapshot, setTodaySnapshot] = useState<DayView | null>(null);
  useEffect(() => {
    if (month !== currentMonth || !schedule) return;
    const found = days.find((day) => day.date === today);
    if (found) setTodaySnapshot(found);
  }, [days, month, currentMonth, schedule, today]);
  const todayView = useMemo<DayView>(() => todaySnapshot
    ?? { date: today, shift: null, markings: [], absence: null, incidents: [], workedMinutes: 0, breakMinutes: null, balanceMinutes: null, deviation: null },
  [todaySnapshot, today]);
  const unitNames = useMemo(() => new Map(options?.executionUnits.map((unit) => [unit.id, unit.name]) ?? []), [options]);

  const matches = useCallback((day: DayView) => {
    if (filter === "alert") return day.incidents.length > 0;
    if (filter === "absence") return day.absence !== null;
    if (filter.startsWith("incident:")) return day.incidents.includes(filter.slice(9) as DayIncident);
    if (filter.startsWith("absence:")) return day.absence?.id === filter.slice(8);
    return true;
  }, [filter]);
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
  const registered = days.reduce((sum, day) => sum + day.workedMinutes, 0);
  const balance = days.reduce((sum, day) => sum + (day.balanceMinutes ?? 0), 0);
  const filterLabel = filter.startsWith("incident:") ? INCIDENTS[filter.slice(9) as DayIncident].label
    : filter.startsWith("absence:") ? absences.find((item) => item.id === filter.slice(8))?.typeName ?? null : null;
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

  if (!canView) return <p className="p-6 text-ds-ink-muted">Sem permissão para acessar o Painel do colaborador.</p>;

  return (
    <PageContainer variant="wide" className="space-y-5 pb-8">
      <header className="flex items-center gap-3">
        <BackButton fallbackHref="/dashboard/collaborator" label="Painel do colaborador" variant="ghost" size="sm" className="-ml-2" />
        <h1 className="text-2xl font-extrabold tracking-tight text-ds-ink">Registro de ponto</h1>
      </header>

      <RecordStrip marking={marking} day={todayView} today={today} onOpenDay={() => setOpenDate(today)} onRecorded={onRecorded} />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <AbsencesAndAlerts days={days} absences={absences} filter={filter} onFilter={(next) => { setFilter(next); setShowFuture(false); }} />
          {absencesUnavailable ? <p className="px-1 text-xs text-ds-ink-muted">As ausências não puderam ser carregadas agora.</p> : null}
        </aside>

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
              <Segmented<string> aria-label="Filtrar dias" value={filter} onChange={setFilter}
                options={[{ value: "all", label: "Todos" }, { value: "alert", label: `A conferir · ${alertDays}` }, { value: "absence", label: `Com ausência · ${absenceDays}` }]} />
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ds-ink-muted">
              <span><strong className="text-sm text-ds-ink">{hm(registered)}</strong> registradas</span>
              <span>Saldo (prévia) <strong className="text-sm text-ds-ink">{hm(balance, true)}</strong></span>
            </p>
          </div>

          {filterLabel ? (
            <div className="flex flex-wrap items-center gap-2 rounded-ds-btn-lg border border-ds-accent-ink/20 bg-ds-accent-row px-3 py-2 text-sm">
              <span className="text-ds-ink-muted">Filtrando:</span>
              <strong className="text-ds-ink">{filterLabel}</strong>
              <span className="text-ds-ink-muted">· {filtered} {filtered === 1 ? "dia" : "dias"}</span>
              <button type="button" onClick={() => setFilter("all")} className="ml-auto text-xs font-bold text-ds-accent-ink underline">Limpar filtro</button>
            </div>
          ) : null}

          {loadError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{loadError}</p> : null}
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
                      {visible.map((day) => <DayCard key={day.date} day={day} today={today} selected={openDate === day.date} onOpen={() => setOpenDate(day.date)} />)}
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
        </div>
      </div>
      <DayPanel day={openDate ? days.find((day) => day.date === openDate) ?? (openDate === today ? todayView : null) : null}
        today={today} unitNames={unitNames} receipts={receipts} onClose={() => setOpenDate(null)} />
    </PageContainer>
  );
}
