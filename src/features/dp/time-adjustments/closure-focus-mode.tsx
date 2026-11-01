"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { ChevronLeft, ChevronRight, FileText, Info, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { actOnAbsenceRequest, getAbsenceRequest, openAbsenceAttachment } from "@/features/dp/absences/requests/client";
import type { AbsenceActionInput, AbsenceRequestDto } from "@/features/dp/absences/requests/workflow-types";
import { absenceStatus, durationLabel, incidentFact, INCIDENTS } from "@/features/dp/rep-p/day-list";
import { fiscalClock, INCIDENT_SEVERITY, type DayView } from "@/features/dp/rep-p/day-model";
import { purposeLabel } from "@/features/dp/rep-p/record-strip";
import type { BankStatementLine } from "@/features/dp/time-bank/core";
import { REASON_LABELS } from "@/features/dp/time-bank/time-bank-card";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { cn } from "@/lib/utils";

import { ADJUSTMENT_KIND_LABELS, ADJUSTMENT_STATUS_LABELS, type AdjustmentView } from "./types";

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const OPEN_ABSENCE = ["submitted", "in_review", "adjustments_requested"];
const dateBR = (value: string) => value.slice(0, 10).split("-").reverse().join("/");
const whenBR = (value: string | null | undefined) => value ? `${dateBR(value)} às ${new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "—";
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

/** Dia que pede ação do DP no saneamento: alerta, ajuste em análise ou ausência ainda sem decisão. */
export function dayNeedsTreatment(day: DayView, adjustments: AdjustmentView[], today: string) {
  if (day.date >= today) return false;
  return day.incidents.length > 0
    || adjustments.some((item) => item.workDate === day.date && item.status === "in_review")
    || Boolean(day.absence && OPEN_ABSENCE.includes(day.absence.status));
}

type BankLines = { policyName: string | null; lines: BankStatementLine[] } | null;

/**
 * Cobertura do dia pela ausência: só um pedido de dia inteiro, já carregado e ainda válido, cobre "dia sem batidas" e
 * "batidas ímpares". Pedido por horas, ainda carregando ou ilegível não cobre (o alerta continua). Só a ausência aprovada
 * permite dizer que nenhuma batida era esperada; em análise, a cobertura depende da decisão.
 */
export function absenceCoverage(dayAbsence: DayView["absence"], request: { unit: "day" | "hour"; status: string } | null) {
  const alive = Boolean(dayAbsence && request && !["rejected", "cancelled"].includes(request.status));
  const fullDay = alive && request!.unit === "day";
  return {
    fullDay,
    approved: fullDay && request!.status === "approved",
    covers: (incident: string) => fullDay && (incident === "missing" || incident === "odd"),
  };
}

/**
 * Modo foco do saneamento: um dia por vez em tela ampla, com o que precisa de decisão em cima e as evidências embaixo.
 * O ponto é de uso exclusivo do colaborador: aqui o DP só decide pedidos feitos por ele (ajuste e ausência) e consulta
 * batidas e política; nada grava batida ou pedido em nome da pessoa. Clicar fora não fecha (Esc e "Fechar" fecham).
 */
export function ClosureFocusMode({ open, onOpenChange, startDate, days, today, adjustments, bank, unitNames, employeeName, firebaseUser, onChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: string | null;
  days: DayView[];
  today: string;
  adjustments: AdjustmentView[];
  bank: BankLines;
  unitNames: Map<string, string>;
  employeeName: string;
  firebaseUser: FirebaseUser | null;
  onChanged: () => void;
}) {
  const queue = useMemo(() => days.filter((day) => dayNeedsTreatment(day, adjustments, today)).map((day) => day.date), [days, adjustments, today]);
  const [date, setDate] = useState<string | null>(startDate);
  useEffect(() => { if (open) setDate(startDate ?? queue[0] ?? null); }, [open, startDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const day = days.find((item) => item.date === date) ?? null;
  const position = date ? queue.indexOf(date) : -1;
  const next = position >= 0 ? queue[position + 1] : queue.find((item) => item > (date ?? ""));
  const previous = position > 0 ? queue[position - 1] : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-(--ds-scrim)" />
        <DialogPrimitive.Content onInteractOutside={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}
          className="fixed inset-4 z-50 mx-auto flex max-w-[1180px] flex-col overflow-hidden rounded-[20px] bg-ds-warm font-ds shadow-ds-side outline-hidden md:inset-8">
          {day ? <>
            <header className="flex flex-wrap items-center gap-3 border-b border-ds-border bg-ds-surface px-5 py-3.5">
              <DialogPrimitive.Title className="text-lg font-black text-ds-ink">{WEEKDAYS[new Date(`${day.date}T12:00:00Z`).getUTCDay()]}, {dateBR(day.date)}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Tratamento do dia de {employeeName} no saneamento da folha.</DialogPrimitive.Description>
              {day.incidents.map((incident) => <StatusPill key={incident} variant={INCIDENT_SEVERITY[incident] === "danger" ? "danger" : "warn"}>{INCIDENTS[incident].label}</StatusPill>)}
              {day.absence ? <StatusPill variant={absenceStatus(day.absence.status, day.absence.approvedByInaction).variant}>{day.absence.typeName} · {absenceStatus(day.absence.status, day.absence.approvedByInaction).label}</StatusPill> : null}
              <span className="ml-auto text-xs font-bold text-ds-ink-muted">{position >= 0 ? `Dia ${position + 1} de ${queue.length} a tratar` : `${queue.length} dias a tratar`}</span>
              <DialogPrimitive.Close asChild><Button variant="ds-secondary" size="sm"><X className="h-4 w-4" aria-hidden /> Fechar</Button></DialogPrimitive.Close>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <FocusDay key={day.date} day={day} adjustments={adjustments.filter((item) => item.workDate === day.date)} bank={bank} unitNames={unitNames}
                employeeName={employeeName} firebaseUser={firebaseUser} onChanged={onChanged} />
            </div>
            <footer className="flex flex-wrap items-center gap-2 border-t border-ds-border bg-ds-surface px-5 py-3">
              <Button variant="ds-secondary" size="sm" disabled={!previous} onClick={() => previous && setDate(previous)}><ChevronLeft className="h-4 w-4" aria-hidden /> Anterior</Button>
              <p className="min-w-0 flex-1 text-xs text-ds-ink-muted">O ponto é de uso exclusivo do colaborador: o DP não ajusta batida nem lança pedido por ele. Aqui você decide os pedidos feitos por {employeeName.split(" ")[0]}.</p>
              {next ? <Button variant="primary-page" size="sm" onClick={() => setDate(next)}>Próximo a tratar <ChevronRight className="h-4 w-4" aria-hidden /></Button>
                : <DialogPrimitive.Close asChild><Button variant="primary-page" size="sm">Concluir</Button></DialogPrimitive.Close>}
            </footer>
          </> : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div className="space-y-3">
                <DialogPrimitive.Title className="text-lg font-black text-ds-ink">Nenhum dia a tratar</DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm text-ds-ink-muted">Todos os dias deste mês estão sem pendência.</DialogPrimitive.Description>
                <DialogPrimitive.Close asChild><Button variant="ds-secondary" size="sm">Fechar</Button></DialogPrimitive.Close>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Zone({ index, title, aside, children }: { index: number; title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[10.5px] font-black uppercase tracking-[0.16em] text-ds-ink-muted">{index} · {title}</h3>
        {aside ? <span className="text-[11.5px] font-bold text-ds-ink-faint">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Card({ title, aside, children, className }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-ds-btn-lg border border-ds-border bg-ds-surface", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-ds-divider px-4 py-2.5">
        <h4 className="text-sm font-black text-ds-ink">{title}</h4>{aside}
      </header>
      {children}
    </section>
  );
}

function FocusDay({ day, adjustments, bank, unitNames, employeeName, firebaseUser, onChanged }: {
  day: DayView; adjustments: AdjustmentView[]; bank: BankLines; unitNames: Map<string, string>; employeeName: string;
  firebaseUser: FirebaseUser | null; onChanged: () => void;
}) {
  const work = day.shift?.type === "work" ? day.shift : null;
  const [absence, setAbsence] = useState<AbsenceRequestDto | null>(null);
  const [absenceError, setAbsenceError] = useState<string | null>(null);
  const absenceId = day.absence?.id ?? null;
  const loadAbsence = useCallback(async () => {
    if (!absenceId || !firebaseUser) return;
    setAbsenceError(null);
    try { setAbsence((await getAbsenceRequest(firebaseUser, absenceId)).request); }
    catch (cause) { setAbsenceError(errorMessageOf(cause, "Não foi possível abrir o pedido de ausência.")); }
  }, [absenceId, firebaseUser]);
  useEffect(() => { void loadAbsence(); }, [loadAbsence]);

  // Ausência do dia inteiro carregada e válida cobre o dia sem batida: a pendência passa a ser decidir o pedido.
  const coverage = absenceCoverage(day.absence, absence ? { unit: absence.unit, status: absence.status } : null);
  const fullDay = coverage.fullDay;
  const covered = coverage.covers;
  const alerts = day.incidents.filter((incident) => !covered(incident));
  const coveredAlerts = day.incidents.filter(covered);
  const pendingAdjustments = adjustments.filter((item) => item.status === "in_review");
  const decisions = alerts.length + pendingAdjustments.length + (day.absence && OPEN_ABSENCE.includes(day.absence.status) ? 1 : 0);
  const odd = day.markings.length % 2 === 1 || (work && day.markings.length > 0 && day.markings.length < 4);
  const lines = (bank?.lines ?? []).filter((item) => item.date === day.date);
  const first = employeeName.split(" ")[0];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-ds-btn-lg border border-ds-border bg-ds-surface px-4 py-3 sm:grid-cols-4">
        {[["Escala", work ? `${work.shiftName ?? "Turno"} · ${work.startTime}–${work.endTime}` : day.shift ? "Folga" : "Sem escala", work?.unitName ?? null],
          ["Trabalhado", day.markings.length ? durationLabel(day.workedMinutes) : "—", odd ? "só períodos fechados" : day.plannedWorkMinutes ? `de ${durationLabel(day.plannedWorkMinutes)} previstos` : null],
          ["Intervalo", !odd && day.breakMinutes !== null ? durationLabel(day.breakMinutes) : "—", odd ? "indisponível: falta batida" : null],
          ["Resultado", odd || day.balanceMinutes === null ? "—" : durationLabel(day.balanceMinutes, true), odd ? "falta batida" : "prévia"]].map(([label, value, hint]) => (
          <div key={label as string} className="min-w-0">
            <span className="block text-[10.5px] font-bold text-ds-ink-muted">{label}</span>
            <span className="block truncate font-ds-mono text-[16px] font-extrabold text-ds-ink">{value}</span>
            {hint ? <span className="block truncate text-[10.5px] font-semibold text-ds-ink-muted">{hint}</span> : null}
          </div>
        ))}
      </div>

      <Zone index={1} title="O que precisa de decisão" aside={decisions ? `${decisions} ${decisions === 1 ? "item" : "itens"}` : "nenhum"}>
        <div className="space-y-3">
          {coveredAlerts.map((incident) => (
            <p key={incident} className="flex gap-2 rounded-ds-md border border-dashed border-ds-border bg-ds-surface/60 px-3 py-2 text-xs text-ds-ink-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span><strong className="text-ds-ink">{INCIDENTS[incident].label}</strong> · {incidentFact(day, incident, unitNames)} Coberto pelo pedido de ausência do dia inteiro: decida o pedido. Se ele for recusado, a pendência volta.</span>
            </p>
          ))}
          {alerts.map((incident) => {
            const { label, detail, icon: Icon } = INCIDENTS[incident];
            const danger = INCIDENT_SEVERITY[incident] === "danger";
            return (
              <div key={incident} className={cn("flex gap-2.5 rounded-ds-md border px-3 py-2.5", danger ? "border-ds-trouble-border bg-ds-trouble-bg" : "border-ds-caution-border bg-ds-caution-bg")}>
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", danger ? "text-ds-danger" : "text-ds-caution")} aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-bold text-ds-ink">{label}</p>
                  {incidentFact(day, incident, unitNames) ? <p className="text-xs font-semibold text-ds-ink-2">{incidentFact(day, incident, unitNames)}</p> : null}
                  <p className="text-xs text-ds-ink-muted">{detail}</p>
                  <Button variant="ds-secondary" size="sm" disabled title="Em construção: o envio do pedido ao colaborador ainda não existe no sistema.">
                    Pedir a {first}: {incident === "missing" ? "justificar ou corrigir" : "corrigir as batidas"} · em breve
                  </Button>
                </div>
              </div>
            );
          })}
          {adjustments.map((adjustment) => <AdjustmentCard key={adjustment.id} adjustment={adjustment} day={day} firebaseUser={firebaseUser} onChanged={onChanged} />)}
          {day.absence ? (
            absence ? <AbsenceCard request={absence} firebaseUser={firebaseUser} employeeName={employeeName} onChanged={() => { void loadAbsence(); onChanged(); }} />
              : <Card title={`Ausência · ${day.absence.typeName}`}><p className="px-4 py-3 text-sm text-ds-ink-muted">{absenceError ?? "Abrindo o pedido…"}</p></Card>
          ) : null}
          {!decisions && !coveredAlerts.length ? <p className="text-sm text-ds-ink-muted">Nada a decidir neste dia.</p> : null}
        </div>
      </Zone>

      <Zone index={2} title="Evidências do dia" aside="batidas e política aplicada">
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Batidas" aside={<span className="text-xs text-ds-ink-faint">{day.markings.length}{work ? ` de ${Math.max(4, day.markings.length)}` : ""}</span>}>
            <div className="space-y-2.5 px-4 py-3">
              {fullDay && !day.allMarkings.length ? <p className="text-sm text-ds-ink-muted">{coverage.approved ? "Nenhuma batida esperada: o dia inteiro está coberto pela ausência aprovada." : "Sem batidas. O dia inteiro está no pedido de ausência ainda sem decisão: se ele for recusado, as batidas da escala voltam a ser cobradas."}</p>
                : day.allMarkings.length ? day.allMarkings.map((marking, index) => (
                  <div key={marking.receiptId} className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-3">
                    <span className={cn("text-right font-ds-mono text-[15px] font-extrabold", marking.treatment === "discarded" ? "text-ds-ink-faint line-through" : "text-ds-ink")}>{fiscalClock(marking.markedAt)}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ds-ink">{marking.treatment === "included" ? "Incluída por ajuste aprovado" : marking.treatment === "discarded" ? "Desconsiderada por ajuste"
                        : marking.classification?.purpose ? purposeLabel(marking.classification.purpose) : `${index + 1}ª batida · classificação pendente`}</p>
                      <p className="text-xs text-ds-ink-muted">{index + 1}ª · NSR {marking.nsr} · {unitNames.get(marking.executionUnitId) ?? "unidade do registro"}</p>
                    </div>
                  </div>
                )) : <p className="text-sm text-ds-danger">Nenhuma batida neste dia.</p>}
              <p className="flex gap-1.5 text-xs text-ds-ink-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />A batida original nunca é apagada; ajuste aprovado aparece como inclusão ou desconsideração.</p>
            </div>
          </Card>
          <Card title="Política de horas" aside={bank?.policyName ? <span className="text-xs text-ds-ink-faint">{bank.policyName}</span> : undefined}>
            <div className="space-y-2 px-4 py-3">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">Para onde vai</p>
              {lines.length ? lines.map((item, index) => (
                <div key={index} className="flex items-center justify-between gap-3 rounded-ds-md border border-ds-border px-3 py-2 text-sm">
                  <span className="min-w-0"><span className="block font-bold text-ds-ink">{REASON_LABELS[item.line.reason]}</span>
                    <span className="block text-xs text-ds-ink-muted">{item.line.nature === "payroll_overtime" ? `Folha · ${item.line.ratePercent ?? 0}%` : item.line.nature === "bank_credit" ? "Banco · crédito"
                      : item.line.nature === "bank_debit" ? "Banco · débito" : item.line.nature === "payroll_discount" ? "Folha · desconto" : "Em conferência pelo DP"}</span></span>
                  <span className="font-ds-mono font-extrabold">{durationLabel(item.line.minutes)}</span>
                </div>
              )) : <p className="text-sm text-ds-ink-muted">{bank ? "Nada lançado para este dia (igual ao previsto, na tolerância ou em conferência)." : "Apuração indisponível agora."}</p>}
              <p className="text-xs text-ds-ink-muted">Prévia pela política vigente; o lançamento oficial sai no fechamento do mês.</p>
            </div>
          </Card>
        </div>
      </Zone>
    </div>
  );
}

/** Pedido de ajuste do colaborador: antigo × novo alinhado pelas batidas, justificativa, contexto e decisão. */
function AdjustmentCard({ adjustment, day, firebaseUser, onChanged }: { adjustment: AdjustmentView; day: DayView; firebaseUser: FirebaseUser | null; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operations = adjustment.operations?.length ? adjustment.operations : [{ kind: adjustment.kind, target: adjustment.target, inclusion: adjustment.inclusion }];
  const discarded = new Set(operations.flatMap((item) => item.target && item.kind !== "include" ? [item.target.receiptId] : []));
  const before = day.allMarkings.filter((item) => item.treatment !== "included");
  const added = operations.flatMap((item) => item.inclusion && item.kind !== "discard" ? [fiscalClock(item.inclusion.markedAt)] : []);
  const after = [...before.filter((item) => !discarded.has(item.receiptId) && item.treatment !== "discarded").map((item) => ({ time: fiscalClock(item.markedAt), state: "kept" as const })),
    ...added.map((time) => ({ time, state: "added" as const }))].sort((left, right) => left.time.localeCompare(right.time));
  const requestedAt = adjustment.acts.find((act) => act.action === "requested")?.at ?? adjustment.createdAt;
  const late = daysBetween(adjustment.workDate, requestedAt);
  const inReview = adjustment.status === "in_review";

  async function decide(action: "approve" | "reject") {
    if (reason.trim().length < 10) { setError("Escreva a justificativa da decisão (mínimo de 10 caracteres)."); return; }
    setBusy(true);
    setError(null);
    try {
      await authenticatedApiRequest(`/api/dp/time-recording/adjustments/${adjustment.id}`, { method: "PATCH", json: { action, expectedVersion: adjustment.version, reason: reason.trim() },
        getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null), fallbackError: "Não foi possível registrar a decisão." });
      onChanged();
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível registrar a decisão."));
    } finally {
      setBusy(false);
    }
  }

  const chip = (time: string, state: "kept" | "added" | "removed") => (
    <span key={`${state}-${time}`} className={cn("rounded-full border px-2 py-0.5 font-ds-mono text-[13px] font-bold",
      state === "added" ? "border-ds-ok/30 bg-ds-ok-bg text-ds-ok" : state === "removed" ? "border-ds-danger/30 bg-ds-danger-bg text-ds-danger line-through" : "border-ds-border bg-ds-surface text-ds-ink")}>
      {state === "added" ? `+ ${time}` : time}
    </span>
  );
  return (
    <Card title={`Pedido de ajuste · ${ADJUSTMENT_KIND_LABELS[adjustment.kind].title}`}
      aside={<StatusPill variant={inReview ? "info" : adjustment.status === "approved" ? "ok" : "neutral"}>{ADJUSTMENT_STATUS_LABELS[adjustment.status]}</StatusPill>}>
      <div className="grid gap-0 md:grid-cols-2">
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5 text-xs">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">Antigo × novo</p>
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-y-1.5">
              <span className="font-bold text-ds-ink-muted">Registrado</span>
              <div className="flex flex-wrap gap-1.5">{before.length ? before.map((item) => chip(fiscalClock(item.markedAt), discarded.has(item.receiptId) ? "removed" : "kept")) : <span className="text-ds-ink-muted">sem batida</span>}</div>
              <span className="font-bold text-ds-ink-muted">Com o ajuste</span>
              <div className="flex flex-wrap gap-1.5">{after.map((item) => chip(item.time, item.state))}</div>
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">Justificativa do colaborador</p>
            <p className="whitespace-pre-wrap rounded-ds-sm border-l-[3px] border-ds-border bg-ds-warm px-3 py-1.5 text-sm text-ds-ink-2">“{adjustment.reason}”</p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11.5px] font-bold text-ds-ink-2">
            <span className="rounded-full bg-ds-neutral-bg px-2.5 py-0.5">Pedido em {whenBR(requestedAt)}</span>
            <span className="rounded-full bg-ds-neutral-bg px-2.5 py-0.5">{late <= 0 ? "No mesmo dia" : `${late} ${late === 1 ? "dia" : "dias"} depois`}</span>
          </div>
        </div>
        <div className="space-y-2.5 border-t border-ds-divider bg-ds-warm/40 px-4 py-3 md:border-l md:border-t-0">
          {inReview ? <>
            <Textarea value={reason} onChange={(event) => { setReason(event.target.value); setError(null); }} maxLength={1000} placeholder="Justificativa da decisão (mínimo de 10 caracteres)" className="min-h-20" />
            {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary-page" size="sm" loading={busy} loadingLabel="Registrando…" onClick={() => void decide("approve")}>Aprovar ajuste</Button>
              <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void decide("reject")}>Recusar</Button>
            </div>
          </> : <p className="text-sm text-ds-ink-muted">Decidido em {whenBR(adjustment.decidedAt)}.</p>}
          <details>
            <summary className="cursor-pointer text-xs font-bold text-ds-ink">Trilha de autoria e verificação</summary>
            <ol className="mt-2 space-y-2 text-xs">
              {adjustment.acts.map((act) => (
                <li key={act.hash}><p className="font-bold text-ds-ink">{act.action === "requested" ? "Solicitado" : act.action === "approved" ? "Aprovado" : act.action === "rejected" ? "Recusado" : "Cancelado"} · {whenBR(act.at)}</p>
                  <p className="text-ds-ink-muted">{act.clockSource === "hora_legal" ? "hora oficial" : "relógio do servidor"} · verificação <span className="font-ds-mono">{act.hash.slice(0, 4)}…{act.hash.slice(-4)}</span></p></li>
              ))}
            </ol>
          </details>
          <p className="text-xs text-ds-ink-muted">A batida original continua guardada no registro oficial; o ajuste aparece no espelho e no documento de fechamento do mês.</p>
        </div>
      </div>
    </Card>
  );
}

/** Pedido de ausência do colaborador: fatos, comprovante, aprovação e decisão (aprovar, pedir correção ou recusar). */
function AbsenceCard({ request, firebaseUser, employeeName, onChanged }: { request: AbsenceRequestDto; firebaseUser: FirebaseUser | null; employeeName: string; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const attempt = useRef<AbsenceActionInput | null>(null);
  const status = absenceStatus(request.status, request.approvedByInaction);
  const input = request.input as { startDate?: string; endDate?: string; startTime?: string; endTime?: string };
  const period = input.startDate === input.endDate || !input.endDate ? dateBR(input.startDate ?? "") : `${dateBR(input.startDate ?? "")} a ${dateBR(input.endDate)}`;
  const hours = input.startTime && input.endTime ? ` · ${input.startTime} às ${input.endTime}` : "";
  const sentAt = request.submittedAt ?? request.createdAt;
  const late = input.startDate ? daysBetween(input.startDate, sentAt) : 0;
  const first = employeeName.split(" ")[0];

  async function run(action: "approve" | "reject" | "request_adjustments") {
    if (!firebaseUser) return;
    if (action === "request_adjustments" && reason.trim().length < 10) { setError("Explique o que corrigir (mínimo de 10 caracteres)."); return; }
    const payload = attempt.current?.action === action && attempt.current.expectedVersion === request.version ? attempt.current
      : ({ action, expectedVersion: request.version, operationId: crypto.randomUUID(), ...(action === "approve" ? {} : reason.trim() ? { reason: reason.trim() } : {}) } as AbsenceActionInput);
    attempt.current = payload;
    setBusy(true);
    setError(null);
    try {
      await actOnAbsenceRequest(firebaseUser, request.id, payload);
      attempt.current = null;
      setReason("");
      onChanged();
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível registrar a decisão."));
    } finally {
      setBusy(false);
    }
  }
  async function openFile(fileId: string) {
    if (!firebaseUser) return;
    setOpening(fileId);
    setError(null);
    try { await openAbsenceAttachment(firebaseUser, request.id, fileId); }
    catch (cause) { setError(errorMessageOf(cause, "Não foi possível abrir o comprovante.")); }
    finally { setOpening(null); }
  }

  return (
    <Card title={`Ausência · ${request.typeName}`} aside={<StatusPill variant={status.variant}>{status.label}</StatusPill>}>
      <div className="grid gap-0 md:grid-cols-2">
        <div className="space-y-3 px-4 py-3">
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="font-semibold text-ds-ink-muted">Para o período</dt><dd className="font-semibold text-ds-ink">{period}{hours} · {request.quantity} {request.unit === "hour" ? "h" : request.quantity === 1 ? "dia" : "dias"}</dd>
            <dt className="font-semibold text-ds-ink-muted">Pedido em</dt><dd className="font-semibold text-ds-ink">{whenBR(sentAt)} · {late <= 0 ? "antes ou no próprio dia" : `${late} ${late === 1 ? "dia" : "dias"} depois`}</dd>
            <dt className="font-semibold text-ds-ink-muted">Comprovante</dt>
            <dd className="space-y-1.5">
              {request.attachments.length ? request.attachments.map((file, index) => (
                <Button key={file.id} variant="primary-page" size="sm" disabled={!file.canRead} loading={opening === file.id} loadingLabel="Abrindo…" onClick={() => void openFile(file.id)}
                  title={file.canRead ? undefined : "Sem acesso a este anexo nesta etapa."}>
                  <FileText className="h-4 w-4" aria-hidden /> Abrir comprovante{request.attachments.length > 1 ? ` ${index + 1}` : ""}
                </Button>
              )) : <span className="text-sm text-ds-ink-muted">Sem comprovante</span>}
              {request.attachments.length ? <p className="text-[11.5px] text-ds-ink-muted">A abertura fica registrada na auditoria da ausência.</p> : null}
            </dd>
          </dl>
          <div>
            <p className="mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">Justificativa do colaborador</p>
            {request.reason ? <p className="whitespace-pre-wrap rounded-ds-sm border-l-[3px] border-ds-border bg-ds-warm px-3 py-1.5 text-sm text-ds-ink-2">“{request.reason}”</p>
              : <p className="text-sm text-ds-ink-muted">Não informada (campo opcional).</p>}
          </div>
          <div>
            <p className="mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">Histórico</p>
            <ol className="space-y-1 text-xs text-ds-ink-2">
              {request.history.slice(-4).map((item) => <li key={`${item.action}-${item.at}`}>{whenBR(item.at)} · {item.action === "submit" ? "enviado" : item.action === "approve" ? "aprovado" : item.action === "reject" ? "recusado" : item.action === "request_adjustments" ? "correção pedida" : item.action}{item.reason ? `: ${item.reason}` : ""}</li>)}
            </ol>
          </div>
        </div>
        <div className="space-y-2.5 border-t border-ds-divider bg-ds-warm/40 px-4 py-3 md:border-l md:border-t-0">
          <p className="text-xs text-ds-ink-2">Prazo, comprovante e limite do tipo foram conferidos pelo sistema no envio{request.tacitApprovalDays ? `; sem análise em ${request.tacitApprovalDays} dias, a etapa é aprovada automaticamente` : ""}.</p>
          {request.canReview ? <>
            <Textarea value={reason} onChange={(event) => { setReason(event.target.value); setError(null); attempt.current = null; }} maxLength={1000} className="min-h-20"
              placeholder="Motivo (obrigatório para pedir correção; na recusa, conforme a regra do tipo)" />
            {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary-page" size="sm" loading={busy} loadingLabel="Registrando…" onClick={() => void run("approve")}>Aprovar ausência</Button>
              <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void run("request_adjustments")}>Pedir correção do pedido a {first}</Button>
              <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void run("reject")}>Recusar</Button>
            </div>
            <p className="text-xs text-ds-ink-muted"><strong>Pedir correção</strong> devolve o pedido a {first} para trocar o comprovante ou o período; <strong>Recusar</strong> encerra o pedido.</p>
          </> : <p className="text-sm text-ds-ink-muted">{request.status === "in_review" ? "A decisão desta etapa cabe a outro responsável." : "Pedido sem decisão pendente."}</p>}
          {error && !request.canReview ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
          <p className="text-xs text-ds-ink-muted">Tipo, justificativa e comprovante são vistos só por quem decide; o banco de horas recebe apenas o efeito (LGPD art. 11).</p>
        </div>
      </div>
    </Card>
  );
}
