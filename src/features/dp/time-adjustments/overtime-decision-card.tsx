"use client";

import { useEffect, useRef, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { durationLabel } from "@/features/dp/rep-p/day-list";
import type { OvertimeDayView, OvertimeMonthView, OvertimeOption, OvertimePart } from "@/features/dp/time-bank/overtime-decision";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

export type OvertimeMonthState = { view: OvertimeMonthView | null; error: string | null };

const REASONS = ["Extensão combinada com a liderança", "Cobertura de colega", "Fechamento do caixa"];
const OTHER = "other";
const dateBR = (value: string) => value.slice(0, 10).split("-").reverse().join("/");
const keyOf = (item: { destination: string; categoryId: string }) => `${item.destination}:${item.categoryId}`;
const optionLabel = (option: OvertimeOption) => option.destination === "payroll"
  ? `${option.name} · ${option.ratePercent}% · pagar na folha`
  : `Banco de horas · crédito${option.factor && option.factor !== 1 ? ` (vale ${String(option.factor).replace(".", ",")}x)` : ""} · ${option.name}`;
const partLabel = (part: OvertimePart, options: OvertimeOption[]) => {
  const option = options.find((item) => keyOf(item) === keyOf(part));
  return `${durationLabel(part.minutes)} · ${option ? optionLabel(option) : part.destination === "payroll" ? "folha" : "banco de horas"}`;
};

/** Hora extra por dia do mês aberto. Uma leitura ao abrir a pessoa e a cada decisão, sem polling. */
export function useOvertimeMonth(firebaseUser: FirebaseUser | null, competence: string, employeeUid: string, reloadKey: number): OvertimeMonthState {
  const [state, setState] = useState<OvertimeMonthState & { key: string }>({ view: null, error: null, key: "" });
  const key = `${employeeUid}:${competence}`;
  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    authenticatedApiRequest<OvertimeMonthView>(`/api/dp/time-recording/closures?${new URLSearchParams({ competence, overtimeOf: employeeUid })}`,
      { getIdToken: () => firebaseUser.getIdToken(), fallbackError: "Não foi possível ler a hora extra por dia." })
      .then((view) => { if (!cancelled) setState({ view: Array.isArray(view?.days) ? view : null, error: null, key }); })
      .catch((cause) => { if (!cancelled) setState({ view: null, error: errorMessageOf(cause, "Não foi possível ler a hora extra por dia."), key }); });
    return () => { cancelled = true; };
  }, [firebaseUser, competence, employeeUid, reloadKey, key]);
  return state.key === key ? { view: state.view, error: state.error } : { view: null, error: null };
}

const dayStatus = (item: OvertimeDayView) => !item.sourceMinutes ? { label: "Sem efeito", variant: "neutral" as const }
  : item.outdated ? { label: "Conferir de novo", variant: "danger" as const }
  : item.decision ? { label: "Definida", variant: "ok" as const }
    : item.blockedReason ? { label: "Ainda não dá para definir", variant: "neutral" as const } : { label: "A definir", variant: "warn" as const };

export function OvertimeDaysList({ overtime, onOpen }: { overtime: OvertimeMonthState; onOpen: (date: string) => void }) {
  if (overtime.error) return <p role="alert" className="text-sm font-semibold text-ds-danger">{overtime.error}</p>;
  const view = overtime.view;
  if (!view?.enabled || view.closed || !view.days.length) return null;
  return (
    <section aria-label="Hora extra por dia" className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
      <header className="border-b border-ds-divider px-4 py-3">
        <h3 className="text-sm font-black text-ds-ink">Hora extra por dia</h3>
        <p className="text-xs text-ds-ink-muted">Dia sem escolha segue a regra da política. Isso não trava o fechamento.</p>
      </header>
      <ul className="divide-y divide-ds-divider">
        {view.days.map((item) => {
          const status = dayStatus(item);
          return <li key={item.date} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
            <span className="font-ds-mono font-extrabold text-ds-ink">{dateBR(item.date).slice(0, 5)}</span>
            <span className="font-ds-mono text-ds-ink-2">{item.sourceMinutes ? durationLabel(item.sourceMinutes) : "—"}</span>
            <StatusPill variant={status.variant}>{status.label}</StatusPill>
            <Button type="button" variant="ds-secondary" size="sm" className="ml-auto" onClick={() => onOpen(item.date)} aria-label={`Ver hora extra de ${dateBR(item.date)}`}>Abrir dia</Button>
          </li>;
        })}
      </ul>
    </section>
  );
}

type DraftPart = { option: string; minutes: string };

type CardProps = { overtime: OvertimeMonthState; date: string; employeeUid: string; firebaseUser: FirebaseUser | null; onSaved: () => void };

export function OvertimeDayCard(props: CardProps) {
  const view = props.overtime.view;
  const item = view?.days.find((day) => day.date === props.date) ?? null;
  if (!view?.enabled || view.closed || !item) return null;
  // Outro dia ou outra leitura do servidor recomeçam o formulário.
  return <OvertimeForm key={`${item.date}:${view.revision}:${item.sourceMinutes}`} {...props} view={view} item={item} />;
}

function OvertimeForm({ date, employeeUid, firebaseUser, onSaved, view, item }: CardProps & { view: OvertimeMonthView; item: OvertimeDayView }) {
  const [editing, setEditing] = useState(false);
  const [parts, setParts] = useState<DraftPart[]>([{ option: item.suggestion ? keyOf(item.suggestion) : "", minutes: "" }]);
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // O mesmo envio repetido usa o mesmo identificador; mudar qualquer campo gera outro.
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const split = parts.length > 1;
  const minutesOf = (part: DraftPart) => split ? Number(part.minutes) : item.sourceMinutes;
  const total = parts.reduce((sum, part) => sum + (Number.isInteger(minutesOf(part)) ? minutesOf(part) : 0), 0);
  const finalReason = reason === OTHER ? otherReason.trim() : reason;
  const valid = parts.every((part) => part.option && Number.isInteger(minutesOf(part)) && minutesOf(part) > 0) && total === item.sourceMinutes;
  const showForm = item.sourceMinutes > 0 && !item.blockedReason && view.canDecide && (!item.decision || editing || Boolean(item.outdated));

  async function send(action: "decideOvertime" | "revokeOvertime") {
    if (!firebaseUser) return;
    if (action === "decideOvertime") {
      if (!valid) { setError(`Escolha o destino e feche a soma em ${durationLabel(item.sourceMinutes)}.`); return; }
      if (finalReason.length < 10) { setError("Informe o motivo com ao menos 10 caracteres."); return; }
    }
    const payload = { action, employeeUid, date, expectedRevision: view.revision,
      ...(action === "decideOvertime" ? { sourceMinutes: item.sourceMinutes, reason: finalReason,
        parts: parts.map((part) => { const [destination, ...rest] = part.option.split(":"); return { destination, categoryId: rest.join(":"), minutes: minutesOf(part) }; }) } : {}) };
    const body = JSON.stringify(payload);
    if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() };
    setBusy(true); setError(null);
    try {
      await authenticatedApiRequest("/api/dp/time-recording/closures", { method: "POST", json: { ...payload, operationId: attempt.current.id },
        getIdToken: () => firebaseUser.getIdToken(), fallbackError: "Não foi possível registrar a hora extra." });
      attempt.current = null;
      onSaved();
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível registrar a hora extra."));
    } finally {
      setBusy(false); setConfirmingRevoke(false);
    }
  }
  const change = (index: number, patch: Partial<DraftPart>) => { setError(null); setParts((current) => current.map((part, position) => position === index ? { ...part, ...patch } : part)); };
  const status = dayStatus(item);

  return (
    <section aria-label="Hora extra do dia" className="overflow-hidden rounded-ds-btn-lg border border-ds-border bg-ds-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ds-divider px-4 py-2.5">
        <h4 className="text-sm font-black text-ds-ink">Hora extra do dia{item.sourceMinutes ? ` · ${durationLabel(item.sourceMinutes)}` : ""}</h4>
        <StatusPill variant={status.variant}>{status.label}</StatusPill>
      </header>
      <div className="space-y-2.5 px-4 py-3">
        {item.outdated ? <p role="alert" className="text-xs font-semibold text-ds-danger">{item.outdated} A escolha anterior não vale mais e o tempo fica em conferência até você definir de novo.</p> : null}
        {!item.sourceMinutes ? <p className="text-sm text-ds-ink-muted">O dia não tem mais hora extra, então a escolha gravada não gera lançamento.</p> : null}
        {item.decision && !item.outdated && item.sourceMinutes ? <div className="space-y-1 text-sm">
          <ul>{item.decision.parts.map((part) => <li key={keyOf(part)} className="font-bold text-ds-ink">{partLabel(part, item.options)}</li>)}</ul>
          <p className="text-xs text-ds-ink-muted">Definida em {dateBR(item.decision.decidedAt)} · {item.decision.reason}</p>
        </div> : null}
        {item.blockedReason ? <p className="text-sm text-ds-ink-muted">{item.blockedReason}</p> : null}
        {!item.blockedReason && !view.canDecide ? <p className="text-sm text-ds-ink-muted">Definir a hora extra exige permissão de fechamento e de análise de ajustes, e não vale para o próprio ponto.</p> : null}
        {showForm ? <>
          {parts.map((part, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <div className="min-w-[220px] flex-1">
                <Select value={part.option} onValueChange={(value) => change(index, { option: value })}>
                  <SelectTrigger aria-label={split ? `Faixa ou destino da parte ${index + 1}` : "Faixa ou destino"}><SelectValue placeholder="Faixa ou destino" /></SelectTrigger>
                  <SelectContent>{item.options.map((option) => <SelectItem key={keyOf(option)} value={keyOf(option)}>{optionLabel(option)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {split ? <Input className="w-24 font-ds-mono" inputMode="numeric" aria-label={`Minutos da parte ${index + 1}`} placeholder="min" value={part.minutes}
                onChange={(event) => change(index, { minutes: event.target.value.replace(/\D/g, "").slice(0, 4) })} />
                : <span className="font-ds-mono text-sm font-extrabold text-ds-ink">{durationLabel(item.sourceMinutes)}</span>}
              {split ? <Button type="button" variant="ds-ghost" size="sm" onClick={() => setParts((current) => current.filter((_, position) => position !== index))}>Remover</Button> : null}
            </div>
          ))}
          {split ? <p className="text-xs text-ds-ink-muted">Soma: <span className="font-ds-mono">{total}</span> de <span className="font-ds-mono">{item.sourceMinutes}</span> minutos.</p> : null}
          {item.options.length > 1 && parts.length < Math.min(item.options.length, 8) && item.sourceMinutes > 1 ? <Button type="button" variant="ds-ghost" size="sm" onClick={() => setParts((current) => [...current, { option: "", minutes: "" }])}>Dividir em partes</Button> : null}
          <Select value={reason} onValueChange={(value) => { setReason(value); setError(null); }}>
            <SelectTrigger aria-label="Motivo da conferência"><SelectValue placeholder="Motivo da conferência" /></SelectTrigger>
            <SelectContent>{REASONS.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}<SelectItem value={OTHER}>Outro (descrever)</SelectItem></SelectContent>
          </Select>
          {reason === OTHER ? <Textarea aria-label="Descreva o motivo" value={otherReason} maxLength={1000} className="min-h-16" placeholder="Motivo com ao menos 10 caracteres"
            onChange={(event) => { setOtherReason(event.target.value); setError(null); }} /> : null}
        </> : null}
        {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {showForm ? <Button variant="primary-page" size="sm" loading={busy} loadingLabel="Registrando…" onClick={() => void send("decideOvertime")}>Conferir dia e definir a extra</Button> : null}
          {item.decision && item.sourceMinutes && !item.outdated && !editing && view.canDecide && !item.blockedReason ? <Button variant="ds-secondary" size="sm" onClick={() => setEditing(true)}>Mudar escolha</Button> : null}
          {item.decision && view.canDecide && !confirmingRevoke ? <Button variant="ds-ghost" size="sm" disabled={busy} onClick={() => setConfirmingRevoke(true)}>Voltar à regra da política</Button> : null}
        </div>
        {confirmingRevoke ? <InlineConfirm message="A escolha sai e o dia volta a seguir a política. O histórico fica guardado." confirmLabel="Remover escolha" loadingLabel="Removendo…" loading={busy}
          onConfirm={() => void send("revokeOvertime")} onCancel={() => setConfirmingRevoke(false)} /> : null}
        <p className="text-xs text-ds-ink-muted">Ao definir, você aprova esta hora extra. O lançamento oficial sai no fechamento do mês.</p>
      </div>
    </section>
  );
}
