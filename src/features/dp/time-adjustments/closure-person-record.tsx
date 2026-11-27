"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { ChevronDown } from "lucide-react";

import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { absenceStatus, durationLabel, INCIDENTS } from "@/features/dp/rep-p/day-list";
import { buildMonthView, fiscalClock, type DayAbsence, type DayMarking, type DayShift, type DayView } from "@/features/dp/rep-p/day-model";
import type { MonthDays } from "@/features/dp/rep-p/month-days";
import type { TimeRecordingMonthSummary } from "@/features/dp/rep-p/my-time-recording-page";
import { PURPOSE_DOT, type MarkingPurpose } from "@/features/dp/rep-p/record-strip";
import type { TimeBankStatementResponse } from "@/features/dp/time-bank/time-bank-card";
import type { TimeReviewView } from "@/features/dp/time-review/core";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { cn } from "@/lib/utils";

import type { ClosurePerson } from "./closure-core";
import { ClosureFocusMode } from "./closure-focus-mode";
import {
  applyAutomaticAbsences, automaticAbsenceDates, closureDayRow, closureRecordHours, closureRecordIndicators, closureTrailProblemDays,
  type ClosureDayKind, type ClosureDayRow, type ClosureDayTone, type PersonServerAlerts,
} from "./closure-person-record-model";
import { DayCorrectionBatch } from "./day-corrections-panel";
import type { AdjustmentView, TreatmentView } from "./types";

type EmployeeMonth = {
  employee: { uid: string; name: string };
  schedule: { month: string; shifts: (DayShift & { date: string })[]; truncated: boolean };
  history: { markings: Array<DayMarking & { workDate: string }>; truncated: boolean };
  absences: DayAbsence[];
  adjustments: AdjustmentView[];
  treatments: TreatmentView[];
  unitNames: Record<string, string>;
  monthDays?: MonthDays;
  reviewRequests?: TimeReviewView[];
};

type DayFilter = "all" | "to_treat" | "clear" | "marks" | "absence" | "adjustment" | "to_review" | "warnings";
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const OPEN_ABSENCE = ["submitted", "in_review", "adjustments_requested"];
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const ROW_ACTION: Partial<Record<ClosureDayKind, string>> = { request: "Decidir pedido", alert: "Abrir dia", warning: "Abrir dia", overnight: "Abrir dia", automatic_absence: "Ver falta" };

const TONE_CELL: Record<ClosureDayTone, string> = {
  ok: "bg-ds-ok-bg text-ds-ok", warn: "bg-ds-warn-bg text-ds-warn", danger: "bg-ds-danger-bg text-ds-danger",
  info: "bg-ds-info-bg text-ds-info", neutral: "bg-ds-neutral-bg text-ds-neutral",
};

/** Texto e cor da situação de um dia. */
function situationOf(row: ClosureDayRow): { label: string; short: string; tone: ClosureDayTone } {
  const { day, kind } = row;
  const incidents = day.incidents.map((incident) => INCIDENTS[incident].label).join(" · ");
  switch (kind) {
    case "future": return { label: "", short: "", tone: "neutral" };
    case "today": return { label: "Em curso", short: "hoje", tone: "info" };
    case "request": return { label: day.absence && OPEN_ABSENCE.includes(day.absence.status) ? `${day.absence.typeName} sem decisão` : "Ajuste em análise", short: "pedido", tone: "warn" };
    case "automatic_absence": return { label: "Falta automática", short: "falta", tone: "neutral" };
    case "alert": return { label: `${incidents || "Alerta do fechamento"}${row.released ? " · liberado pelo RH" : row.blocks ? " · trava o fechamento" : ""}`, short: "alerta", tone: row.released ? "neutral" : "danger" };
    case "warning": return { label: incidents, short: "aviso", tone: "warn" };
    case "absence": return { label: `${day.absence!.typeName} · ${absenceStatus(day.absence!.status, day.absence!.approvedByInaction).label}`, short: "ausência", tone: "info" };
    case "overnight": return { label: "Turno da noite · conferir", short: "noite", tone: "warn" };
    case "day_off": return { label: "Folga", short: "folga", tone: "neutral" };
    case "unscheduled": return { label: "Sem escala", short: "", tone: "neutral" };
    default: return { label: "Sem ocorrência", short: "ok", tone: "ok" };
  }
}

function Collapsible({ title, summary, children }: { title: string; summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group rounded-ds-card border border-ds-border bg-ds-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-muted">{title}</span>
        <span className="flex flex-wrap items-center gap-2">{summary}<ChevronDown className="h-4 w-4 text-ds-ink-muted transition-transform group-open:rotate-180" aria-hidden /></span>
      </summary>
      <div className="border-t border-ds-divider px-4 py-3">{children}</div>
    </details>
  );
}

/**
 * Registro do mês de uma pessoa no saneamento (tela aprovada em 25/11/2026). O ponto é de uso exclusivo do
 * colaborador: aqui o DP só consulta, pede que a pessoa regularize e decide os pedidos feitos por ela.
 */
export function ClosurePersonRecord({ firebaseUser, competence, person, alerts, onSummary, onDecided }: {
  firebaseUser: FirebaseUser | null;
  competence: string;
  person: ClosurePerson;
  /** Alertas que o servidor apontou para a pessoa; `null` quando ele não informou. */
  alerts: PersonServerAlerts;
  onSummary: (summary: TimeRecordingMonthSummary) => void;
  /** Algo foi decidido ou devolvido num dia: quem embute atualiza pendências e alertas. */
  onDecided: () => void;
}) {
  const [payload, setPayload] = useState<EmployeeMonth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [bank, setBank] = useState<TimeBankStatementResponse | null>(null);
  const [bankUnavailable, setBankUnavailable] = useState(false);
  const [filter, setFilter] = useState<DayFilter>("all");
  const [focus, setFocus] = useState<{ open: boolean; date: string | null }>({ open: false, date: null });

  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    setLoadError(null);
    authenticatedApiRequest<EmployeeMonth>(`/api/dp/time-recording/employees/${encodeURIComponent(person.uid)}`, {
      method: "POST", json: { month: competence }, getIdToken: () => firebaseUser.getIdToken(), fallbackError: "Não foi possível carregar o ponto do colaborador.",
    }).then((value) => { if (!cancelled) setPayload(value); })
      .catch((cause) => { if (!cancelled) setLoadError(errorMessageOf(cause, "Não foi possível carregar o ponto do colaborador.")); });
    return () => { cancelled = true; };
  }, [firebaseUser, person.uid, competence, reloadKey]);

  // Extrato do ciclo que contém o fim do mês: política aplicada em cada dia e saldo. Uma leitura por pessoa e a cada decisão.
  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    setBankUnavailable(false);
    const monthEnd = new Date(Date.UTC(Number(competence.slice(0, 4)), Number(competence.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const now = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    authenticatedApiRequest<TimeBankStatementResponse>(`/api/dp/time-recording/time-bank?${new URLSearchParams({ date: monthEnd < now ? monthEnd : now, employeeUid: person.uid })}`,
      { getIdToken: () => firebaseUser.getIdToken(), fallbackError: "Não foi possível ler o banco de horas." })
      .then((value) => { if (!cancelled) setBank(value); })
      .catch(() => { if (!cancelled) { setBank(null); setBankUnavailable(true); } });
    return () => { cancelled = true; };
  }, [firebaseUser, person.uid, competence, reloadKey]);

  // Os alertas do servidor releem a equipe toda: são atualizados uma vez, ao sair do modal, e não a cada decisão.
  const decided = useRef(false);
  const changedInDay = useCallback(() => { decided.current = true; setReloadKey((value) => value + 1); }, []);
  const returned = useCallback(() => { setReloadKey((value) => value + 1); onDecided(); }, [onDecided]);
  const focusChanged = (next: boolean) => {
    setFocus((current) => ({ ...current, open: next }));
    if (!next && decided.current) { decided.current = false; onDecided(); }
  };

  // "Hoje" vem do servidor; o cálculo local é só reserva para resposta de servidor anterior ao contrato central.
  const today = payload?.monthDays?.today ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const calculatedDays = useMemo<DayView[]>(() => !payload ? [] : (payload.monthDays?.month === competence ? payload.monthDays.days : null)
    ?? buildMonthView({ month: competence, today, shifts: payload.schedule.shifts, markings: payload.history.markings, absences: payload.absences, treatments: payload.treatments }),
  [payload, competence, today]);
  const adjustments = useMemo(() => payload?.adjustments ?? [], [payload]);
  const automaticDates = useMemo(() => automaticAbsenceDates(person), [person]);
  const days = useMemo(() => applyAutomaticAbsences(calculatedDays, automaticDates), [calculatedDays, automaticDates]);
  const rows = useMemo(() => days.map((day) => closureDayRow(day, { today, adjustments, automaticDates, alerts })), [days, today, adjustments, automaticDates, alerts]);
  const indicators = closureRecordIndicators(rows, person);
  const hours = closureRecordHours(rows, bank?.statement?.lines ?? null, competence);
  const unitNames = useMemo(() => new Map(Object.entries(payload?.unitNames ?? {})), [payload]);

  // Mesmos números que a trilha usa para liberar a etapa seguinte.
  useEffect(() => {
    const past = days.filter((day) => day.date <= today);
    onSummary({
      loaded: Boolean(payload),
      problemDays: closureTrailProblemDays(rows),
      alertDays: days.filter((day) => day.incidents.length).length,
      missingDays: past.filter((day) => day.incidents.includes("missing")).length + rows.filter((row) => row.kind === "automatic_absence").length,
      absenceDays: days.filter((day) => day.absence).length,
      okDays: rows.filter((row) => row.kind === "clear" && row.day.shift?.type === "work").length,
      toTreat: adjustments.filter((item) => item.status === "in_review").length + (payload?.absences ?? []).filter((item) => OPEN_ABSENCE.includes(item.status)).length,
      finalized: adjustments.filter((item) => item.status !== "in_review").length + (payload?.absences ?? []).filter((item) => !OPEN_ABSENCE.includes(item.status)).length,
    });
  }, [onSummary, payload, days, rows, adjustments, today]);

  if (loadError && !payload) {
    return <div className="space-y-2">
      <p role="alert" className="text-sm font-semibold text-ds-danger">{loadError}</p>
      <Button variant="ds-secondary" size="sm" onClick={() => setReloadKey((value) => value + 1)}>Tentar de novo</Button>
    </div>;
  }
  if (!payload) return <p role="status" className="text-sm text-ds-ink-muted">Carregando o ponto do mês…</p>;

  const name = payload.employee.name;
  const first = name.split(" ")[0];
  const open = (date: string) => setFocus({ open: true, date });
  const returnable = rows.filter((row) => row.needsTreatment && row.kind === "alert" && !row.released).map((row) => row.day.date);
  // Revisão antecipada: pedidos abertos do mês (a rotina fica desligada até a ativação).
  const reviewDates = new Set((payload.reviewRequests ?? []).filter((item) => item.status === "open").map((item) => item.date));
  const adjustmentDates = new Set(adjustments.filter((item) => item.status === "in_review").map((item) => item.workDate));
  const matches: Record<DayFilter, (row: ClosureDayRow) => boolean> = {
    all: () => true, to_treat: (row) => row.needsTreatment, clear: (row) => row.kind === "clear", marks: (row) => row.day.markings.length > 0,
    absence: (row) => row.day.absence !== null || row.kind === "automatic_absence", adjustment: (row) => adjustmentDates.has(row.day.date),
    to_review: (row) => reviewDates.has(row.day.date), warnings: (row) => row.kind === "warning" || row.kind === "overnight",
  };
  const visible = rows.filter(matches[filter]);
  const queue = rows.filter((row) => row.needsTreatment && row.kind !== "future" && row.kind !== "today").map((row) => row.day.date);
  const extraFilters = ([["warnings", "Com aviso"], ["marks", "Com batida"], ["absence", "Com ausência ou falta"], ["adjustment", "Ajuste em análise"]] as const)
    .map(([value, label]) => ({ value, label, count: rows.filter(matches[value]).length })).filter((item) => item.count);
  const weekStart = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - weekdayOf(date) * 86_400_000).toISOString().slice(0, 10);
  const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  const weekSummary = (date: string) => {
    const week = rows.filter((row) => weekStart(row.day.date) === weekStart(date));
    const toCheck = week.filter((row) => row.kind === "alert" || row.kind === "warning" || row.kind === "overnight").length;
    return `${shortDate(week[0].day.date)} a ${shortDate(week[week.length - 1].day.date)} · ${durationLabel(week.reduce((total, row) => total + row.day.workedMinutes, 0))} registradas · ${toCheck ? `${toCheck} ${toCheck === 1 ? "dia a conferir" : "dias a conferir"}` : "nada a conferir"}`;
  };
  const until = competence < today.slice(0, 7) ? "no mês" : "até ontem";
  const cards: Array<{ value: number; label: string; hint: string; tone: string; filter: DayFilter | null }> = [
    { value: indicators.clearDays, label: "Dias sem ocorrência", hint: `de ${indicators.scheduledDays} escalados ${until}`, tone: "text-ds-ok", filter: "clear" },
    { value: indicators.alertDays, label: "Dias com alerta grave", hint: alerts === null ? "a conferir" : `${indicators.blockingDays} ${indicators.blockingDays === 1 ? "trava" : "travam"} o fechamento`, tone: "text-ds-danger", filter: "to_treat" },
    { value: indicators.automaticAbsences, label: "Faltas automáticas", hint: "lançadas pelo sistema", tone: "text-ds-ink", filter: null },
    { value: indicators.openRequests, label: "Pedidos sem decisão", hint: "travam o fechamento", tone: "text-ds-warn", filter: "to_treat" },
    { value: indicators.warningDays, label: "Dias com aviso", hint: "para conferir", tone: "text-ds-caution", filter: "warnings" },
    { value: indicators.approvedAbsences, label: "Ausências aprovadas", hint: "no mês", tone: "text-ds-info", filter: null },
  ];
  const signed = (minutes: number | null) => minutes === null ? "—" : durationLabel(minutes, true);

  return (
    <div className="space-y-3">
      {loadError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{loadError}</p> : null}
      {alerts === null ? <p className="text-xs text-ds-ink-muted">Os alertas abaixo são uma conferência prévia. O que trava o fechamento é confirmado pelo servidor depois que o mês termina, para quem tem acesso a todos os dias.</p> : null}
      {payload.history.truncated || payload.schedule.truncated ? <p className="text-xs font-semibold text-ds-caution">O mês tem mais registros do que esta tela mostra de uma vez; confira os dias no fechamento.</p> : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => {
          const content = <>
            <span className={cn("block font-ds-mono text-[22px] font-extrabold tabular-nums", card.value ? card.tone : "text-ds-ink-faint")}>{card.value}</span>
            <span className="block text-[12.5px] font-extrabold text-ds-ink">{card.label}</span>
            <span className="block text-[11px] font-semibold text-ds-ink-muted">{card.hint}</span>
          </>;
          const style = "rounded-ds-btn-lg border border-ds-border bg-ds-surface px-3 py-2.5 text-left";
          return card.filter
            ? <button key={card.label} type="button" onClick={() => setFilter(card.filter!)} className={cn(style, "transition-colors hover:border-ds-ink-faint")}>{content}</button>
            : <div key={card.label} className={style}>{content}</div>;
        })}
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Collapsible title="Mês em um olhar" summary={<>
          <StatusPill variant="ok">{indicators.clearDays} ok</StatusPill>
          {indicators.alertDays ? <StatusPill variant="danger">{indicators.alertDays} {indicators.alertDays === 1 ? "alerta" : "alertas"}</StatusPill> : null}
          {indicators.automaticAbsences ? <StatusPill variant="neutral">{indicators.automaticAbsences} {indicators.automaticAbsences === 1 ? "falta" : "faltas"}</StatusPill> : null}
        </>}>
          <p className="mb-2 text-xs text-ds-ink-muted">Clique num dia para abrir.</p>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((weekday) => <span key={weekday} className="text-center text-[10px] font-extrabold uppercase text-ds-ink-faint">{weekday}</span>)}
            {rows.map((row, index) => {
              const situation = situationOf(row);
              return <button key={row.day.date} type="button" disabled={row.kind === "future" || row.kind === "today"} onClick={() => open(row.day.date)}
                style={index === 0 ? { gridColumnStart: weekdayOf(row.day.date) + 1 } : undefined}
                aria-label={`${row.day.date.split("-").reverse().join("/")}: ${situation.label || "ainda não aconteceu"}`}
                className={cn("flex h-11 flex-col items-center justify-center rounded-ds-sm border text-[12px] font-extrabold",
                  row.kind === "future" || row.kind === "day_off" || row.kind === "unscheduled" ? "border-ds-border bg-transparent text-ds-ink-muted" : cn("border-transparent", TONE_CELL[situation.tone]),
                  row.kind === "today" && "border-ds-accent-ink")}>
                {Number(row.day.date.slice(8, 10))}<span className="text-[9px] font-bold">{situation.short}</span>
              </button>;
            })}
          </div>
        </Collapsible>
        <Collapsible title="Horas do mês (prévia)" summary={<>
          <StatusPill variant="neutral">{durationLabel(hours.workedMinutes)} trabalhadas</StatusPill>
          <StatusPill variant={(hours.bankBalanceMinutes ?? 0) < 0 ? "danger" : "neutral"}>banco {signed(hours.bankBalanceMinutes)}</StatusPill>
        </>}>
          <dl className="space-y-1.5 text-sm">
            {([
              [`Previstas ${until} (turno)`, durationLabel(hours.plannedMinutes)],
              [`Trabalhadas ${until}`, durationLabel(hours.workedMinutes)],
              ["Noturnas (dentro das trabalhadas)", durationLabel(hours.nightMinutes)],
              ["Horas previstas em dias com falta automática", durationLabel(hours.automaticAbsenceMinutes)],
              ["Hora extra para a folha de pagamento", hours.payrollOvertimeMinutes === null ? "—" : durationLabel(hours.payrollOvertimeMinutes)],
              ["Banco de horas · saldo do mês", signed(hours.bankBalanceMinutes)],
            ] as const).map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-3"><dt className="text-ds-ink-2">{label}</dt><dd className="font-ds-mono font-extrabold text-ds-ink">{value}</dd></div>)}
          </dl>
          <p className="mt-2 text-xs text-ds-ink-muted">{bank?.policy?.name ? `Destino pela política “${bank.policy.name}”. ` : bankUnavailable ? "Extrato do banco indisponível agora. " : bank ? "" : "Lendo o extrato do banco. "}O oficial sai no fechamento.</p>
        </Collapsible>
      </div>

      {reviewDates.size ? <div className="flex flex-wrap items-center gap-3 rounded-ds-btn-lg border border-ds-info/20 bg-ds-info-bg px-4 py-2.5">
        <p className="min-w-0 flex-1 text-sm text-ds-ink-2"><strong className="text-ds-ink">{reviewDates.size} {reviewDates.size === 1 ? "dia com revisão pedida" : "dias com revisão pedida"}</strong> à pessoa neste mês.</p>
        <Button type="button" variant="ds-secondary" size="sm" onClick={() => setFilter(filter === "to_review" ? "all" : "to_review")}>{filter === "to_review" ? "Mostrar todos" : "Ver dias"}</Button>
      </div> : null}

      <section className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ds-divider px-4 py-3">
          <div role="group" aria-label="Filtrar dias" className="flex flex-wrap gap-1.5">
            {([["all", `Todos os dias · ${rows.length}`], ["to_treat", `A tratar · ${indicators.toTreat}`], ["clear", `Sem ocorrência · ${indicators.withoutOccurrence}`]] as const).map(([value, label]) =>
              <Button key={value} type="button" size="sm" variant={filter === value ? "primary-page" : "ds-secondary"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}
            {extraFilters.map((item) => <Button key={item.value} type="button" size="sm" variant={filter === item.value ? "primary-page" : "ds-secondary"} aria-pressed={filter === item.value}
              onClick={() => setFilter(filter === item.value ? "all" : item.value)}>{item.label} · {item.count}</Button>)}
          </div>
          <p className="flex flex-wrap gap-x-3 text-xs text-ds-ink-muted">
            {([["journey_start", "Início"], ["break_start", "Intervalo"], ["journey_end", "Fim"]] as const).map(([purpose, label]) =>
              <span key={purpose} className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("h-2 w-2 rounded-full", PURPOSE_DOT[purpose as MarkingPurpose])} />{label}</span>)}
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-full border border-dashed border-ds-ink-faint" />Sem classificação</span>
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-ds-divider text-left text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">
              {["Dia", "Turno", "Batidas", "Trabalhado", "Saldo", "Situação", "Ação do DP"].map((title) => <th key={title} scope="col" className="px-3 py-2">{title}</th>)}
            </tr></thead>
            <tbody>
              {visible.map((row, index) => {
                const { day } = row;
                const situation = situationOf(row);
                const work = day.shift?.type === "work" ? day.shift : null;
                const action = row.kind === "future" || row.kind === "today" ? null : ROW_ACTION[row.kind] ?? null;
                const odd = day.markings.length % 2 === 1;
                const newWeek = index === 0 || weekStart(visible[index - 1].day.date) !== weekStart(day.date);
                return <Fragment key={day.date}>
                {newWeek ? <tr className="border-b border-ds-divider bg-ds-warm"><th scope="colgroup" colSpan={7} className="px-3 py-1.5 text-left text-[11.5px] font-bold text-ds-ink-2">{weekSummary(day.date)}</th></tr> : null}
                <tr className={cn("border-b border-ds-divider last:border-0", (row.kind === "future" || row.kind === "day_off") && "text-ds-ink-muted")}>
                  <td className="whitespace-nowrap px-3 py-2"><strong className="font-ds-mono">{day.date.slice(8, 10)}</strong> <span className="text-xs text-ds-ink-muted">{WEEKDAYS[weekdayOf(day.date)]}</span></td>
                  <td className="whitespace-nowrap px-3 py-2 font-ds-mono text-[13px]">{work ? `${work.startTime}–${work.endTime}` : "—"}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-x-2.5 gap-y-1">
                      {day.markings.map((marking) => <span key={marking.receiptId} className="inline-flex items-center gap-1 font-ds-mono text-[13px] font-bold">
                        <span aria-hidden className={cn("h-2 w-2 rounded-full", marking.classification?.purpose ? PURPOSE_DOT[marking.classification.purpose] : "border border-dashed border-ds-ink-faint")} />{fiscalClock(marking.markedAt)}
                      </span>)}
                      {!day.markings.length ? <span className="text-xs text-ds-ink-muted">{row.kind === "future" ? (work ? "previsto" : "") : work ? "sem batidas" : ""}</span> : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-ds-mono">{day.markings.length ? durationLabel(day.workedMinutes) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-ds-mono">{odd || day.balanceMinutes === null || row.kind === "future" || row.kind === "today" ? "—" : durationLabel(day.balanceMinutes, true)}</td>
                  <td className="px-3 py-2">{situation.label ? <StatusPill variant={situation.tone} className="h-auto min-h-[21px] whitespace-normal py-0.5">{situation.label}</StatusPill> : null}</td>
                  <td className="whitespace-nowrap px-3 py-2">{action ? <Button type="button" variant="ds-secondary" size="sm" onClick={() => open(day.date)} aria-label={`${action} ${day.date.split("-").reverse().join("/")}`}>{action}</Button> : null}</td>
                </tr>
                </Fragment>;
              })}
              {!visible.length ? <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-ds-ink-muted">Nenhum dia neste filtro.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2 rounded-ds-card border border-ds-border bg-ds-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-ds-ink">Conferência de {name}</h3>
            <p className="text-xs text-ds-ink-muted">{indicators.toTreat ? `${indicators.toTreat} ${indicators.toTreat === 1 ? "dia a tratar" : "dias a tratar"} neste mês.` : "Nenhum dia a tratar neste mês."} O ponto é de uso exclusivo de {first}.</p>
          </div>
          <Button variant="primary-page" size="sm" disabled={!indicators.toTreat} onClick={() => setFocus({ open: true, date: queue[0] ?? null })}>
            {indicators.toTreat === 1 ? "Tratar 1 dia" : `Tratar ${indicators.toTreat} dias em sequência`}
          </Button>
        </div>
        <DayCorrectionBatch key={person.uid + competence} firebaseUser={firebaseUser} employeeUid={person.uid} dates={returnable} onChanged={returned} />
      </section>

      <ClosureFocusMode open={focus.open} onOpenChange={focusChanged} startDate={focus.date} queueDates={queue}
        days={days} today={today} adjustments={adjustments} unitNames={unitNames} employeeName={name} employeeUid={person.uid} firebaseUser={firebaseUser}
        bank={bank ? { policyName: bank.policy?.name ?? null, lines: bank.statement?.lines ?? [] } : null}
        onChanged={changedInDay} />
    </div>
  );
}
