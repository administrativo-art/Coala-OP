"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { Check, Lock } from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";
import { MyTimeRecordingPage, type TimeRecordingMonthSummary } from "@/features/dp/rep-p/my-time-recording-page";
import { REASON_LABELS, TimeBankCard, type TimeBankStatementResponse } from "@/features/dp/time-bank/time-bank-card";
import type { BankStatementLine } from "@/features/dp/time-bank/core";
import { cn } from "@/lib/utils";

import type { ClosurePerson } from "./closure-core";
import { pendingOfPerson } from "./closure-year-overview";

type StepState = "done" | "current" | "locked";
type Step = { title: string; status: string; state: StepState };

const hm = (minutes: number) => `${Math.floor(Math.abs(minutes) / 60)}h${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
const dateBR = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
const lastDayOf = (competence: string) => new Date(Date.UTC(Number(competence.slice(0, 4)), Number(competence.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Destino de um lançamento do mês, como a política de horas o classificou. */
function destinationOf(line: BankStatementLine["line"]): { label: string; variant: "info" | "ok" | "warn" | "danger" | "neutral" } {
  if (line.reason === "pending_approval") return { label: "Aguardando aprovação", variant: "warn" };
  if (line.nature === "payroll_overtime") return { label: `Folha · ${line.ratePercent ?? 0}%`, variant: "info" };
  if (line.nature === "bank_credit") return { label: "Banco · crédito", variant: "ok" };
  if (line.nature === "bank_debit") return { label: "Banco · débito", variant: "danger" };
  if (line.nature === "payroll_discount") return { label: "Folha · desconto", variant: "danger" };
  return { label: "Em revisão", variant: "warn" };
}

/**
 * Trilha de fechamento de uma pessoa: cada etapa só abre quando a anterior termina, e a tela abre na primeira etapa
 * ainda não concluída. A situação das etapas vem da consulta do ponto e do extrato do banco de horas do mês.
 */
export function ClosurePersonTrail({ firebaseUser, competence, person, closed, canManage, requests, closing }: {
  firebaseUser: FirebaseUser | null;
  competence: string;
  person: ClosurePerson;
  closed: boolean;
  canManage: boolean;
  /** Solicitações do mês (a tratar e finalizadas), exibidas no saneamento. */
  requests: ReactNode;
  /** Ação de fechamento da etapa final. */
  closing: ReactNode;
}) {
  const [summary, setSummary] = useState<TimeRecordingMonthSummary | null>(null);
  const [bank, setBank] = useState<TimeBankStatementResponse | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const onSummary = useCallback((value: TimeRecordingMonthSummary) => setSummary(value), []);
  const onBank = useCallback((value: TimeBankStatementResponse) => setBank(value), []);

  const pending = pendingOfPerson(person);
  const lines = (bank?.statement?.lines ?? []).filter((item) => item.competence === competence);
  const toDecide = lines.filter((item) => item.line.reason === "pending_approval" || item.line.nature === "review").length;
  const issues = (summary?.problemDays ?? 0) + (summary?.toTreat ?? 0) + pending;
  const sanitized = closed || Boolean(summary?.loaded && issues === 0);
  const bankDone = closed || (sanitized && bank !== null && toDecide === 0);

  const steps: Step[] = [
    { title: "Saneamento da folha", state: sanitized ? "done" : "current",
      status: sanitized ? "Sem alerta grave nem pedido aberto" : !summary?.loaded ? "Conferindo…" : `${issues} ${issues === 1 ? "pendência" : "pendências"}` },
    { title: "Banco de horas e extras", state: bankDone ? "done" : sanitized ? "current" : "locked",
      status: !sanitized ? "Depois do saneamento" : bankDone ? (closed ? "Destinos definidos" : "Destinos definidos (prévia)") : bank ? `${toDecide} a decidir` : "Lendo extrato…" },
    { title: "Resumo do colaborador", state: closed ? "done" : bankDone ? "current" : "locked",
      status: closed ? "Folha fechada" : bankDone ? "Conferir e fechar" : "Depois do banco" },
    { title: "Fechamento da folha", state: closed ? "done" : "locked", status: closed ? "Competência fechada (todas as pessoas)" : "Hoje fecha a competência de todos" },
  ];
  const current = Math.max(0, steps.findIndex((step) => step.state === "current"));
  const automatic = closed ? steps.length - 1 : current;
  const active = chosen !== null && steps[chosen].state !== "locked" ? chosen : automatic;

  const sum = (filter: (line: BankStatementLine["line"]) => boolean) => lines.filter((item) => filter(item.line)).reduce((total, item) => total + item.line.minutes, 0);
  const payrollByRate = [...lines.filter((item) => item.line.nature === "payroll_overtime")
    .reduce((map, item) => map.set(item.line.ratePercent ?? 0, (map.get(item.line.ratePercent ?? 0) ?? 0) + item.line.minutes), new Map<number, number>())]
    .sort(([left], [right]) => left - right);

  return (
    <div className="space-y-4">
      <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Trilha de fechamento">
        {steps.map((step, index) => {
          const selected = index === active;
          return (
            <li key={step.title}>
              <button type="button" disabled={step.state === "locked"} onClick={() => setChosen(index)} aria-current={selected ? "step" : undefined}
                className={cn("relative flex w-full items-center gap-3 rounded-[14px] border bg-ds-surface px-3 py-2.5 text-left transition-colors",
                  selected ? "border-ds-ink shadow-[inset_0_0_0_1px_var(--ds-ink)]" : "border-ds-border enabled:hover:border-ds-ink-faint",
                  step.state === "locked" && "cursor-not-allowed bg-ds-surface/60")}>
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full font-ds-mono text-sm font-black",
                  step.state === "done" ? "bg-ds-ok text-white" : step.state === "current" ? "bg-ds-accent-ink text-white" : "border border-dashed border-ds-ink-faint text-ds-ink-faint")}>
                  {step.state === "done" ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : step.state === "locked" ? <Lock className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">Etapa {index + 1}</span>
                  <span className={cn("block truncate text-[13px] font-black", step.state === "locked" ? "text-ds-ink-faint" : "text-ds-ink")}>{step.title}</span>
                  <span className={cn("block truncate text-[11px] font-bold", step.state === "done" ? "text-ds-ok" : step.state === "current" ? "text-ds-accent-ink" : "text-ds-ink-faint")}>{step.status}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* As duas primeiras etapas ficam montadas para alimentar a situação da trilha; só a ativa aparece. */}
      <section className={cn("space-y-4", active !== 0 && "hidden")}>
        <MyTimeRecordingPage embedded employeeUid={person.uid} month={competence} onSummary={onSummary} />
        <div className="space-y-1">
          <h4 className="text-sm font-black text-ds-ink">Solicitações do mês</h4>
          <p className="text-xs text-ds-ink-muted">Pedidos a tratar e já finalizados; revise também os finalizados.</p>
        </div>
        {requests}
      </section>

      <section className={cn("space-y-4", active !== 1 && "hidden")}>
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ds-divider px-4 py-3">
            <div>
              <h4 className="text-sm font-black text-ds-ink">Horas extras e lançamentos do mês</h4>
              <p className="text-xs text-ds-ink-muted">Destino definido pela política de horas{bank?.policy ? ` “${bank.policy.name}”` : ""}. Itens em aprovação ou revisão precisam de decisão do DP.</p>
            </div>
            {toDecide ? <StatusPill variant="warn">{toDecide} a decidir</StatusPill> : bank ? <StatusPill variant="ok">Tudo decidido</StatusPill> : null}
          </header>
          {lines.length ? (
            <ul className="divide-y divide-ds-divider">
              {lines.map((item, index) => {
                const destination = destinationOf(item.line);
                return (
                  <li key={`${item.date}-${index}`} className="grid grid-cols-[56px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="font-ds-mono font-bold text-ds-ink">{dateBR(item.date)}</span>
                    <span className="truncate text-ds-ink-2">{REASON_LABELS[item.line.reason]}</span>
                    <span className="font-ds-mono font-bold tabular-nums text-ds-ink">{hm(item.line.minutes)}</span>
                    <StatusPill variant={destination.variant}>{destination.label}</StatusPill>
                  </li>
                );
              })}
            </ul>
          ) : <p className="px-4 py-6 text-center text-sm text-ds-ink-muted">{bank ? "Nenhum lançamento de banco ou hora extra neste mês." : "Lendo o extrato…"}</p>}
        </div>
        <TimeBankCard firebaseUser={firebaseUser} employeeUid={person.uid} date={lastDayOf(competence)} canManage={canManage} detailed onLoaded={onBank} />
      </section>

      {active === 2 ? (
        <section className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ["Dias sem pendência", String(summary?.okDays ?? 0), "text-ds-ok"],
              ["Faltas (dia sem batida)", String(summary?.missingDays ?? 0), summary?.missingDays ? "text-ds-danger" : "text-ds-ink"],
              ["Dias com ausência", String(summary?.absenceDays ?? 0), "text-ds-ink"],
              ["Solicitações finalizadas", String(summary?.finalized ?? 0), "text-ds-ink"],
            ] as const).map(([label, value, tone]) => (
              <div key={label} className="rounded-ds-btn-lg border border-ds-border bg-ds-surface px-4 py-3">
                <span className={cn("block font-ds-mono text-[22px] font-extrabold tabular-nums", tone)}>{value}</span>
                <span className="text-[12px] font-semibold text-ds-ink-muted">{label}</span>
              </div>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-ds-card border border-ds-border bg-ds-surface px-4 py-3">
              <h4 className="text-sm font-black text-ds-ink">Para a folha (contador)</h4>
              {!closed ? <p className="text-xs text-ds-ink-muted">Prévia pela política vigente; o oficial sai no fechamento.</p> : null}
              <ul className="mt-2 space-y-1.5 text-sm">
                {payrollByRate.length ? payrollByRate.map(([rate, minutes]) => (
                  <li key={rate} className="flex justify-between"><span className="text-ds-ink-2">Hora extra {rate}%</span><strong className="font-ds-mono">{hm(minutes)}</strong></li>
                )) : <li className="text-ds-ink-muted">Nenhuma hora extra paga na folha.</li>}
                {sum((line) => line.nature === "payroll_discount") ? <li className="flex justify-between"><span className="text-ds-ink-2">Descontos</span><strong className="font-ds-mono text-ds-danger">{hm(sum((line) => line.nature === "payroll_discount"))}</strong></li> : null}
              </ul>
            </div>
            <div className="rounded-ds-card border border-ds-border bg-ds-surface px-4 py-3">
              <h4 className="text-sm font-black text-ds-ink">Para o banco de horas</h4>
              {!closed ? <p className="text-xs text-ds-ink-muted">Prévia pela política vigente; o oficial sai no fechamento.</p> : null}
              <ul className="mt-2 space-y-1.5 text-sm">
                <li className="flex justify-between"><span className="text-ds-ink-2">Créditos</span><strong className="font-ds-mono text-ds-ok">{hm(sum((line) => line.nature === "bank_credit"))}</strong></li>
                <li className="flex justify-between"><span className="text-ds-ink-2">Débitos</span><strong className="font-ds-mono text-ds-danger">{hm(sum((line) => line.nature === "bank_debit"))}</strong></li>
                {sum((line) => line.nature === "review") ? <li className="flex justify-between"><span className="text-ds-ink-2">Em revisão</span><strong className="font-ds-mono text-ds-caution">{hm(sum((line) => line.nature === "review"))}</strong></li> : null}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {active === 3 || (active === 2 && !closed) ? <section className="space-y-3">{closing}</section> : null}
    </div>
  );
}
