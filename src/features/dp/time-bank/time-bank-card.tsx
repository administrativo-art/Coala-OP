"use client";

import { useCallback, useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import Link from "next/link";

import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import type { BankLineReason, BankStatement } from "./core";
import { RESIDUAL_LABELS } from "./cycle";

type StatementResponse = { policy: { name: string; enabled: boolean } | null; statement: BankStatement | null;
  closures: Record<string, number>; previewCompetences?: string[]; pilotPreview?: boolean };

export const REASON_LABELS: Record<BankLineReason, string> = {
  worked_less: "Trabalhou menos que a jornada",
  worked_more: "Trabalhou mais que a jornada",
  missing_day: "Dia escalado sem batida (aguarda o DP lançar a ausência)",
  absence_unexcused: "Falta injustificada",
  absence_debit: "Ausência com débito",
  absence_review: "Ausência para revisão",
  rest_day_work: "Trabalho na folga",
  sunday_work: "Trabalho no domingo",
  holiday_work: "Trabalho no feriado",
  unplanned_work: "Trabalho fora da escala",
  daily_limit_exceeded: "Acima do limite diário de extra",
  weekly_limit_exceeded: "Acima do limite semanal de extra",
  no_category: "Sem faixa de hora extra na política",
  needs_review: "Banco desligado na política",
  pending_approval: "Extra que pede aprovação",
  approved_overtime: "Hora extra aprovada",
  manual_compensation: "Compensação lançada pelo DP",
  manual_adjustment: "Ajuste manual do banco",
  payroll_settlement: "Saldo lançado na folha",
  credit_expired: "Crédito vencido",
};
const hm = (minutes: number, signed = false) => {
  const sign = minutes < 0 ? "−" : signed && minutes > 0 ? "+" : "";
  const value = Math.abs(minutes);
  return `${sign}${Math.floor(value / 60)}h${String(value % 60).padStart(2, "0")}`;
};
const dateBR = (value: string) => value.split("-").reverse().join("/");
const VISIBLE_LINES = 8;
const parseHm = (value: string) => {
  const match = value.trim().match(/^(\d{1,3}):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * Banco de horas do ciclo: saldo, créditos e débitos dos meses já fechados, com o motivo de cada lançamento.
 * Ao abrir, apura (uma vez por versão do fechamento) os meses fechados do ciclo que ainda não têm apuração.
 * No painel do DP (`employeeUid`), mostra o banco da pessoa na data informada.
 */
export function TimeBankCard({ firebaseUser, employeeUid, date, canManage = false, detailed = false, detailHref }: {
  firebaseUser: FirebaseUser | null;
  employeeUid?: string;
  date?: string;
  canManage?: boolean;
  detailed?: boolean;
  detailHref?: string;
}) {
  const [data, setData] = useState<StatementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(detailed);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [movementKind, setMovementKind] = useState("compensation");
  const [movementDate, setMovementDate] = useState(date ?? new Date().toISOString().slice(0, 10));
  const [movementMinutes, setMovementMinutes] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const query = new URLSearchParams({ ...(employeeUid ? { employeeUid } : {}), ...(date ? { date } : {}) }).toString();
  const request = useCallback(<T,>(input: string, init: { method?: string; json?: unknown; fallbackError: string }) =>
    authenticatedApiRequest<T>(input, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);
  useEffect(() => { if (detailed) setExpanded(true); }, [detailed]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const url = `/api/dp/time-recording/time-bank${query ? `?${query}` : ""}`;
      let response = await request<StatementResponse>(url, { fallbackError: "Não foi possível ler o banco de horas." });
      const pending = (response.statement?.missing ?? []).filter((competence) => response.closures[competence]);
      if (pending.length && (!employeeUid || canManage)) {
        for (const competence of pending) {
          await request("/api/dp/time-recording/time-bank", { method: "POST", json: { action: "generate", competence, expectedVersion: response.closures[competence], ...(employeeUid ? { employeeUid } : {}) },
            fallbackError: "Não foi possível apurar o banco de horas." });
        }
        response = await request<StatementResponse>(url, { fallbackError: "Não foi possível ler o banco de horas." });
      }
      setData(response);
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível ler o banco de horas."));
    }
  }, [canManage, employeeUid, query, request]);
  useEffect(() => { void load(); }, [load]);

  async function settle() {
    const residual = data?.statement?.residual;
    if (!employeeUid || !residual || !data?.statement?.cycle) return;
    setBusy(true);
    setError(null);
    try {
      await request("/api/dp/time-recording/time-bank", { method: "POST", json: { action: "settle", employeeUid, date: data.statement.cycle.end, expectedMinutes: residual.minutes },
        fallbackError: "Não foi possível registrar o encerramento do ciclo." });
      setConfirming(false);
      await load();
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível registrar o encerramento do ciclo."));
    } finally {
      setBusy(false);
    }
  }

  async function approveOvertime(workDate: string, categoryId: string, minutes: number) {
    if (!employeeUid) return;
    setBusy(true); setError(null);
    try {
      await request("/api/dp/time-recording/time-bank", { method: "POST", json: { action: "approve_overtime", operationId: crypto.randomUUID(), employeeUid,
        date: workDate, categoryId, minutes, reason: "Hora extra conferida e aprovada pelo Departamento Pessoal." }, fallbackError: "Não foi possível aprovar a hora extra." });
      await load();
    } catch (cause) { setError(errorMessageOf(cause, "Não foi possível aprovar a hora extra.")); } finally { setBusy(false); }
  }

  async function createMovement() {
    if (!employeeUid || !data?.statement) return;
    const parsed = parseHm(movementMinutes);
    if (!parsed || movementReason.trim().length < 10) { setError("Informe duração em HH:MM e motivo com ao menos 10 caracteres."); return; }
    const [kind, sign] = movementKind.split(":") as ["compensation" | "adjustment" | "payroll", "credit" | "debit" | undefined];
    const minutes = kind === "compensation" || sign === "debit" ? -parsed : parsed;
    setBusy(true); setError(null);
    try {
      await request("/api/dp/time-recording/time-bank", { method: "POST", json: { action: "movement", operationId: crypto.randomUUID(), employeeUid,
        date: movementDate, kind, minutes: kind === "compensation" ? parsed : minutes, expectedBalance: data.statement.balanceMinutes, reason: movementReason.trim() },
      fallbackError: "Não foi possível lançar o movimento." });
      setMovementMinutes(""); setMovementReason(""); setMovementOpen(false); await load();
    } catch (cause) { setError(errorMessageOf(cause, "Não foi possível lançar o movimento.")); } finally { setBusy(false); }
  }

  async function reverseMovement() {
    const movement = data?.statement?.movements.find((item) => item.id === reversingId);
    if (!employeeUid || !movement || reversalReason.trim().length < 10) { setError("Informe o motivo do estorno com ao menos 10 caracteres."); return; }
    setBusy(true); setError(null);
    try {
      await request("/api/dp/time-recording/time-bank", { method: "POST", json: { action: "reverse", employeeUid, date: movement.date,
        movementId: movement.id, reason: reversalReason.trim() }, fallbackError: "Não foi possível estornar o movimento." });
      setReversingId(null); setReversalReason(""); await load();
    } catch (cause) { setError(errorMessageOf(cause, "Não foi possível estornar o movimento.")); } finally { setBusy(false); }
  }

  if (error && !data) return <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p>;
  if (!data?.policy?.enabled || !data.statement) return null;
  const statement = data.statement;
  const open = statement.missing.filter((competence) => !data.closures[competence]);
  const lines = [...statement.lines].reverse();
  return (
    <div className={detailed ? "min-w-0 space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-5" : "min-w-0 space-y-2 overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface p-3"}>
      {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-extrabold text-ds-ink">Banco de horas</p>
          {detailed ? <p className="text-xs text-ds-ink-muted">Política: {data.policy.name}</p> : null}
        </div>
        {detailed && statement.cycle ? <StatusPill variant="neutral">Ciclo {dateBR(statement.cycle.start)} a {dateBR(statement.cycle.end)}</StatusPill> : null}
      </div>
      <p className={`font-ds-mono text-2xl font-extrabold ${statement.balanceMinutes < 0 ? "text-ds-danger" : "text-ds-ink"}`}>{hm(statement.balanceMinutes, true)}</p>
      {data.previewCompetences?.length ? <StatusPill className="h-auto w-full max-w-full justify-center whitespace-normal py-1 text-center leading-tight" variant="info">Prévia inclui o mês aberto; o saldo ainda pode mudar</StatusPill> : null}
      {data.pilotPreview ? <StatusPill className="h-auto w-full max-w-full justify-center whitespace-normal py-1 text-center leading-tight" variant="warn">Ensaio: estas batidas ajudam no teste, mas não entram no fechamento oficial</StatusPill> : null}
      <div className={detailed ? "grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ds-ink-muted" : "grid min-w-0 grid-cols-1 gap-1 text-xs text-ds-ink-muted"}>
        {statement.openingMinutes ? <span>Saldo anterior <strong className="font-ds-mono text-ds-ink">{hm(statement.openingMinutes, true)}</strong></span> : null}
        <span>Créditos <strong className="font-ds-mono text-ds-ink">{hm(statement.credit)}</strong></span>
        <span>Débitos <strong className="font-ds-mono text-ds-ink">{hm(statement.debit)}</strong></span>
        {detailed && statement.payroll ? <span>Extra para a folha <strong className="font-ds-mono text-ds-ink">{hm(statement.payroll)}</strong></span> : null}
        {detailed && statement.discount ? <span>Desconto na folha <strong className="font-ds-mono text-ds-ink">{hm(statement.discount)}</strong></span> : null}
        {statement.nightMinutes ? <span>Faixa noturna física <strong className="font-ds-mono text-ds-ink">{hm(statement.nightMinutes)}</strong></span> : null}
        {statement.review ? <span>Em revisão do DP <strong className="font-ds-mono text-ds-ink">{hm(statement.review)}</strong></span> : null}
      </div>
      {statement.limits.positiveExceeded ? <StatusPill variant="warn">Acima do limite positivo do banco</StatusPill> : null}
      {statement.limits.negativeExceeded || statement.limits.negativeNotAllowed ? <StatusPill variant="danger">Saldo negativo fora do permitido</StatusPill> : null}
      {detailed ? (statement.settlement ? <p className="text-xs font-semibold text-ds-ink-2">Ciclo encerrado pelo DP em {dateBR(statement.settlement.settledAt.slice(0, 10))}: {hm(statement.settlement.minutes, true)} · {RESIDUAL_LABELS[statement.settlement.destination]}.</p>
        : statement.residual ? <p className="text-xs font-semibold text-ds-ink-2">Ciclo terminado: {hm(statement.residual.minutes, true)} · {RESIDUAL_LABELS[statement.residual.destination]} (aguarda o DP registrar o encerramento).</p> : null) : null}
      {detailed && statement.settlementOutdated ? <StatusPill variant="danger">Encerramento desatualizado: o mês foi refechado depois dele</StatusPill> : null}
      {detailed && employeeUid && canManage && statement.residual && !statement.settlement && !confirming ? <Button variant="ds-secondary" size="sm" onClick={() => setConfirming(true)}>Registrar encerramento do ciclo</Button> : null}
      {detailed && confirming && statement.residual ? <InlineConfirm message={`Registrar o encerramento com ${hm(statement.residual.minutes, true)} · ${RESIDUAL_LABELS[statement.residual.destination]}? O registro fica com data e autor e não é desfeito.`}
        confirmLabel="Registrar encerramento" loadingLabel="Registrando…" loading={busy} onConfirm={() => void settle()} onCancel={() => setConfirming(false)} /> : null}
      {detailed && statement.reviewDays.some((item) => item.issues.includes("MISSING_DAY")) ? <StatusPill variant="warn">{statement.reviewDays.filter((item) => item.issues.includes("MISSING_DAY")).length} dia(s) escalado(s) sem batida a tratar pelo DP</StatusPill> : null}
      {detailed && statement.reviewDays.some((item) => item.issues.includes("NIGHT_SHIFT")) ? <StatusPill variant="warn">Faixa noturna exige cálculo da hora reduzida e do adicional na folha</StatusPill> : null}
      {statement.reviewDays.length ? <p className="break-words text-xs text-ds-ink-muted">{statement.reviewDays.length} {statement.reviewDays.length === 1 ? "dia exige" : "dias exigem"} revisão do DP{detailed ? "; os lançamentos seguros permanecem no extrato." : "."}</p> : null}
      {open.length ? <p className="text-xs text-ds-ink-muted">O mês em andamento entra no banco depois do fechamento pelo DP.</p> : null}
      {detailed && lines.length ? (
        <ul className="divide-y divide-ds-divider text-xs">
          {(expanded ? lines : lines.slice(0, VISIBLE_LINES)).map((item, index) => (
            <li key={`${item.date}-${index}`} className={detailed ? "grid gap-1 py-2 sm:grid-cols-[90px_1fr_auto] sm:items-center sm:gap-3" : "flex items-center justify-between gap-2 py-1.5"}>
              <span className={detailed ? "font-semibold text-ds-ink" : "min-w-0 truncate"}><span className="font-semibold text-ds-ink">{dateBR(item.date).slice(0, 5)}</span>{detailed ? null : " · "}{detailed ? null : REASON_LABELS[item.line.reason]}</span>
              {detailed ? <span className="text-ds-ink-muted">{REASON_LABELS[item.line.reason]}</span> : null}
              <span className={`shrink-0 font-ds-mono font-semibold ${item.line.nature === "bank_debit" ? "text-ds-danger" : "text-ds-ink"}`}>
                {item.line.nature === "bank_credit" ? hm(item.line.minutes, true) : item.line.nature === "bank_debit" ? hm(-item.line.minutes) : `${hm(item.line.minutes)} ${item.line.nature === "payroll_overtime" ? `folha ${item.line.ratePercent ?? 0}%` : item.line.nature === "payroll_discount" ? "desconto na folha" : "revisão"}`}
              </span>
              {employeeUid && canManage && item.line.reason === "pending_approval" && item.line.categoryId ? <Button size="sm" variant="ds-secondary" disabled={busy}
                onClick={() => void approveOvertime(item.date, item.line.categoryId!, item.line.minutes)}>Aprovar extra</Button> : null}
            </li>
          ))}
        </ul>
      ) : detailed ? <p className="text-xs text-ds-ink-muted">Nenhum lançamento no ciclo ainda.</p> : null}
      {detailed && lines.length > VISIBLE_LINES ? <Button variant="ds-ghost" size="sm" onClick={() => setExpanded((value) => !value)}>{expanded ? "Mostrar menos" : `Ver os ${lines.length} lançamentos`}</Button> : null}
      {!detailed && detailHref ? <Button asChild variant="ds-secondary" size="sm" className="w-full"><Link href={detailHref}>Ver banco de horas detalhado</Link></Button> : null}
      {detailed && employeeUid && canManage ? <div className="space-y-2 border-t border-ds-divider pt-2">
        {!movementOpen ? <Button variant="ds-secondary" size="sm" onClick={() => setMovementOpen(true)}>Lançar movimento</Button> : <div className="grid gap-2 md:grid-cols-2">
          <Select value={movementKind} onValueChange={setMovementKind}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="compensation">Compensação (débito)</SelectItem><SelectItem value="adjustment:credit">Ajuste de crédito</SelectItem>
            <SelectItem value="adjustment:debit">Ajuste de débito</SelectItem><SelectItem value="payroll:credit">Pagar saldo na folha</SelectItem>
            <SelectItem value="payroll:debit">Descontar saldo na folha</SelectItem>
          </SelectContent></Select>
          <Input type="date" value={movementDate} onChange={(event) => setMovementDate(event.target.value)} />
          <Input className="font-ds-mono" placeholder="Duração HH:MM" value={movementMinutes} onChange={(event) => setMovementMinutes(event.target.value)} />
          <Textarea className="md:col-span-2" placeholder="Motivo obrigatório" value={movementReason} onChange={(event) => setMovementReason(event.target.value)} />
          <div className="flex gap-2 md:col-span-2"><Button size="sm" disabled={busy} onClick={() => void createMovement()}>Registrar</Button>
            <Button size="sm" variant="ds-ghost" onClick={() => setMovementOpen(false)}>Cancelar</Button></div>
        </div>}
        {statement.movements.filter((item) => item.status === "active" && item.kind !== "overtime_approval").map((movement) => <div key={movement.id} className="rounded-ds-btn border border-ds-border px-2 py-1.5 text-xs">
          <div className="flex items-center justify-between gap-2"><span>{dateBR(movement.date)} · {movement.reason}</span>
            {reversingId !== movement.id ? <Button size="sm" variant="ds-ghost" onClick={() => setReversingId(movement.id)}>Estornar</Button> : null}</div>
          {reversingId === movement.id ? <div className="mt-2 space-y-2"><Textarea placeholder="Motivo do estorno" value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} />
            <InlineConfirm message="O movimento será preservado no histórico e retirado do saldo." confirmLabel="Confirmar estorno" loadingLabel="Estornando…" loading={busy}
              onConfirm={() => void reverseMovement()} onCancel={() => { setReversingId(null); setReversalReason(""); }} /></div> : null}
        </div>)}
      </div> : null}
    </div>
  );
}
