"use client";

import { useCallback, useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import type { BankLineReason, BankStatement } from "./core";
import { RESIDUAL_LABELS } from "./cycle";

type StatementResponse = { policy: { name: string; enabled: boolean } | null; statement: BankStatement | null; closures: Record<string, number> };

const REASON_LABELS: Record<BankLineReason, string> = {
  worked_less: "Trabalhou menos que a jornada",
  worked_more: "Trabalhou mais que a jornada",
  missing_day: "Dia escalado sem batida",
  absence_debit: "Ausência com débito",
  absence_review: "Ausência para revisão",
  rest_day_work: "Trabalho na folga",
  sunday_work: "Trabalho no domingo",
  holiday_work: "Trabalho no feriado",
  unplanned_work: "Trabalho fora da escala",
  daily_limit_exceeded: "Acima do limite diário de extra",
  no_category: "Sem faixa de hora extra na política",
  needs_review: "Banco desligado na política",
  pending_approval: "Extra que pede aprovação",
};
const hm = (minutes: number, signed = false) => {
  const sign = minutes < 0 ? "−" : signed && minutes > 0 ? "+" : "";
  const value = Math.abs(minutes);
  return `${sign}${Math.floor(value / 60)}h${String(value % 60).padStart(2, "0")}`;
};
const dateBR = (value: string) => value.split("-").reverse().join("/");
const VISIBLE_LINES = 8;

/**
 * Banco de horas do ciclo: saldo, créditos e débitos dos meses já fechados, com o motivo de cada lançamento.
 * Ao abrir, apura (uma vez por versão do fechamento) os meses fechados do ciclo que ainda não têm apuração.
 * No painel do DP (`employeeUid`), mostra o banco da pessoa na data informada.
 */
export function TimeBankCard({ firebaseUser, employeeUid, date }: { firebaseUser: FirebaseUser | null; employeeUid?: string; date?: string }) {
  const [data, setData] = useState<StatementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams({ ...(employeeUid ? { employeeUid } : {}), ...(date ? { date } : {}) }).toString();
  const request = useCallback(<T,>(input: string, init: { method?: string; json?: unknown; fallbackError: string }) =>
    authenticatedApiRequest<T>(input, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const url = `/api/dp/time-recording/time-bank${query ? `?${query}` : ""}`;
      let response = await request<StatementResponse>(url, { fallbackError: "Não foi possível ler o banco de horas." });
      const pending = (response.statement?.missing ?? []).filter((competence) => response.closures[competence]);
      if (pending.length) {
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
  }, [employeeUid, query, request]);
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

  if (error) return <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p>;
  if (!data?.policy?.enabled || !data.statement) return null;
  const statement = data.statement;
  const open = statement.missing.filter((competence) => !data.closures[competence]);
  const lines = [...statement.lines].reverse();
  return (
    <div className="space-y-2 rounded-ds-card border border-ds-border bg-ds-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-ds-ink">Banco de horas</p>
        {statement.cycle ? <StatusPill variant="neutral">Ciclo {dateBR(statement.cycle.start)} a {dateBR(statement.cycle.end)}</StatusPill> : null}
      </div>
      <p className={`font-ds-mono text-2xl font-extrabold ${statement.balanceMinutes < 0 ? "text-ds-danger" : "text-ds-ink"}`}>{hm(statement.balanceMinutes, true)}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ds-ink-muted">
        {statement.openingMinutes ? <span>Saldo anterior <strong className="font-ds-mono text-ds-ink">{hm(statement.openingMinutes, true)}</strong></span> : null}
        <span>Créditos <strong className="font-ds-mono text-ds-ink">{hm(statement.credit)}</strong></span>
        <span>Débitos <strong className="font-ds-mono text-ds-ink">{hm(statement.debit)}</strong></span>
        {statement.payroll ? <span>Extra para a folha <strong className="font-ds-mono text-ds-ink">{hm(statement.payroll)}</strong></span> : null}
        {statement.review ? <span>Em revisão do DP <strong className="font-ds-mono text-ds-ink">{hm(statement.review)}</strong></span> : null}
      </div>
      {statement.limits.positiveExceeded ? <StatusPill variant="warn">Acima do limite positivo do banco</StatusPill> : null}
      {statement.limits.negativeExceeded || statement.limits.negativeNotAllowed ? <StatusPill variant="danger">Saldo negativo fora do permitido</StatusPill> : null}
      {statement.settlement ? <p className="text-xs font-semibold text-ds-ink-2">Ciclo encerrado pelo DP em {dateBR(statement.settlement.settledAt.slice(0, 10))}: {hm(statement.settlement.minutes, true)} · {RESIDUAL_LABELS[statement.settlement.destination]}.</p>
        : statement.residual ? <p className="text-xs font-semibold text-ds-ink-2">Ciclo terminado: {hm(statement.residual.minutes, true)} · {RESIDUAL_LABELS[statement.residual.destination]} (aguarda o DP registrar o encerramento).</p> : null}
      {statement.settlementOutdated ? <StatusPill variant="danger">Encerramento desatualizado: o mês foi refechado depois dele</StatusPill> : null}
      {employeeUid && statement.residual && !statement.settlement && !confirming ? <Button variant="ds-secondary" size="sm" onClick={() => setConfirming(true)}>Registrar encerramento do ciclo</Button> : null}
      {confirming && statement.residual ? <InlineConfirm message={`Registrar o encerramento com ${hm(statement.residual.minutes, true)} · ${RESIDUAL_LABELS[statement.residual.destination]}? O registro fica com data e autor e não é desfeito.`}
        confirmLabel="Registrar encerramento" loadingLabel="Registrando…" loading={busy} onConfirm={() => void settle()} onCancel={() => setConfirming(false)} /> : null}
      {statement.reviewDays.length ? <p className="text-xs text-ds-ink-muted">{statement.reviewDays.length} {statement.reviewDays.length === 1 ? "dia ficou" : "dias ficaram"} para revisão do DP e não {statement.reviewDays.length === 1 ? "entrou" : "entraram"} no saldo.</p> : null}
      {open.length ? <p className="text-xs text-ds-ink-muted">O mês em andamento entra no banco depois do fechamento pelo DP.</p> : null}
      {lines.length ? (
        <ul className="divide-y divide-ds-divider text-xs">
          {(expanded ? lines : lines.slice(0, VISIBLE_LINES)).map((item, index) => (
            <li key={`${item.date}-${index}`} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate"><span className="font-semibold text-ds-ink">{dateBR(item.date).slice(0, 5)}</span> · {REASON_LABELS[item.line.reason]}</span>
              <span className={`shrink-0 font-ds-mono font-semibold ${item.line.nature === "bank_debit" ? "text-ds-danger" : "text-ds-ink"}`}>
                {item.line.nature === "bank_credit" ? hm(item.line.minutes, true) : item.line.nature === "bank_debit" ? hm(-item.line.minutes) : `${hm(item.line.minutes)} ${item.line.nature === "payroll_overtime" ? `folha ${item.line.ratePercent ?? 0}%` : "revisão"}`}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-ds-ink-muted">Nenhum lançamento no ciclo ainda.</p>}
      {lines.length > VISIBLE_LINES ? <Button variant="ds-ghost" size="sm" onClick={() => setExpanded((value) => !value)}>{expanded ? "Mostrar menos" : `Ver os ${lines.length} lançamentos`}</Button> : null}
    </div>
  );
}
