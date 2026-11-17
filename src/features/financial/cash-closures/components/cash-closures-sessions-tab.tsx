"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { CashCountingSession } from "@/features/financial/cash-counting-sessions/types";
import { filterCashCountingSessions } from "@/features/financial/cash-counting-sessions/session-filter";
import { cn } from "@/lib/utils";
import { formatBRL } from "../money";
import { formatClosureMonthLabel } from "../date";
import type { CashClosureMonthlySummary } from "../types";
import { activeSessionScopeKeys, sessionKioskCards, trailingMonths, waitingUnits } from "../analysis";

const SESSION_STEP: Record<CashCountingSession["status"], string> = {
  open: "etapa 1 de 4 · Contagem",
  counted: "etapa 2 de 4 · Composição física",
  deposit_ready: "etapa 3 de 4 · Malotes preparados",
  completed: "Concluída",
  cancelled: "Cancelada",
};

function dateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Belem" }).format(date);
}

function periodsLabel(periods: Array<{ year: number; month: number }>) {
  return periods.map((period) => formatClosureMonthLabel(period.year, period.month).toLocaleLowerCase("pt-BR")).join(" e ");
}

function shortMonth(year: number, month: number) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))).replace(". de ", "/").replace(" de ", "/");
}

export function CashClosuresSessionsTab({
  sessions,
  units,
  summariesByUnit,
  summariesLoading,
  today,
  scopeKioskIds = null,
}: {
  sessions: CashCountingSession[];
  units: Array<{ id: string; name: string }>;
  summariesByUnit: Array<{ kioskId: string; summaries: CashClosureMonthlySummary[] }>;
  summariesLoading: boolean;
  today: string;
  /** Quiosques do recorte (regional/quiosque escolhidos); `null` mostra todos. Uma sessão com quiosques fora do recorte mostra só os do recorte. */
  scopeKioskIds?: Set<string> | null;
}) {
  const active = filterCashCountingSessions(sessions, "active");
  const history = [...filterCashCountingSessions(sessions, "completed"), ...filterCashCountingSessions(sessions, "cancelled")]
    .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""));
  const [year, month] = today.split("-").map(Number);
  const waiting = waitingUnits(summariesByUnit, trailingMonths(year, month, 6), today, activeSessionScopeKeys(active));
  const unitName = (id: string) => units.find((unit) => unit.id === id)?.name ?? id;
  const waitingDays = waiting.reduce((total, unit) => total + unit.pendingDays, 0);

  return (
    <div className="flex flex-col gap-5">
      {active.map((session) => {
        const allCards = sessionKioskCards(session);
        const cards = scopeKioskIds ? allCards.filter((card) => scopeKioskIds.has(card.kioskId)) : allCards;
        return (
          <section key={session.id} className="flex flex-col gap-3 rounded-ds-card-lg border border-ds-accent-soft bg-ds-accent-soft/60 p-4" aria-label="Sessão de contagem em andamento">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="rounded-full bg-ds-accent px-2.5 py-1 text-[12px] font-bold text-white">Sessão em andamento</span>
                <span className="text-[13.5px] text-ds-ink-2">
                  aberta em {dateTime(session.openedAt)} · Responsável: {session.openedByName} · {cards.length} {cards.length === 1 ? "quiosque" : "quiosques"}{cards.length < allCards.length ? ` de ${allCards.length} da sessão` : ""} · <strong>{SESSION_STEP[session.status]}</strong>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-ds-mono text-[13px] text-ds-ink-2">{session.finalizedOperatorCount} operador(es) finalizado(s) · {formatBRL(session.countedCashCents)} contados</span>
                <Link href={`/dashboard/financial/cash-closures/sessions/${session.id}`} className="text-[13px] font-bold text-ds-accent-ink underline-offset-2 hover:underline">Ver sessão completa</Link>
              </div>
            </div>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {cards.map((card) => (
                <article key={card.kioskId} className="flex flex-col gap-3 rounded-ds-card border border-ds-border bg-ds-surface p-4">
                  <div>
                    <p className="text-[16px] font-extrabold">{card.kioskName}</p>
                    <p className="text-[12.5px] text-ds-ink-muted">{periodsLabel(card.periods)}</p>
                  </div>
                  <div className="flex items-baseline justify-between text-[12.5px] text-ds-ink-2">
                    <span>Operadores finalizados</span>
                    <strong className="font-ds-mono text-ds-ink">{card.finalizedOperators}</strong>
                  </div>
                  <Link href={`/dashboard/financial/cash-closures/sessions/${session.id}`} className="inline-flex min-h-10 items-center justify-center rounded-ds-btn bg-ds-accent px-4 text-[13px] font-bold text-white hover:bg-ds-accent-hover">
                    Contar {card.kioskName}
                  </Link>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[999_1_560px] rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="waiting-title">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="waiting-title" className="text-[18px] font-extrabold">Dias aguardando contagem</h2>
              <p className="text-[13px] text-ds-ink-muted">Fora de qualquer sessão · últimos seis meses · um quiosque por linha</p>
            </div>
            {waitingDays > 0 ? <span className="rounded-full bg-ds-warn-bg px-2.5 py-1 text-[12px] font-bold text-ds-alert-ink">{waitingDays} dias · {waiting.length} {waiting.length === 1 ? "quiosque" : "quiosques"}</span> : null}
          </div>
          {summariesLoading ? (
            <p className="py-6 text-center text-[13px] text-ds-ink-muted">Carregando…</p>
          ) : waiting.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ds-ink-muted">Nenhum dia aguardando contagem fora das sessões.</p>
          ) : (
            <ul className="divide-y divide-ds-divider">
              {waiting.map((unit) => (
                <li key={unit.kioskId}>
                  <Link href={`/dashboard/financial/cash-closures/${encodeURIComponent(unit.kioskId)}`} className="grid grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 py-3 hover:bg-ds-warm">
                    <span className="min-w-0">
                      <strong className="block truncate text-[14px]">{unitName(unit.kioskId)}</strong>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {unit.months.map((item) => (
                          <span key={`${item.year}-${item.month}`} className="rounded-full bg-ds-muted px-2 py-0.5 text-[11.5px] font-semibold text-ds-ink-2">{shortMonth(item.year, item.month)} · {item.pendingDays} {item.pendingDays === 1 ? "dia" : "dias"}</span>
                        ))}
                      </span>
                    </span>
                    <span className="font-ds-mono text-[13px] font-bold text-ds-alert-ink">{unit.pendingDays} {unit.pendingDays === 1 ? "dia" : "dias"}</span>
                    <ArrowRight className="h-4 w-4 text-ds-ink-faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[12.5px] text-ds-ink-muted">A contagem é feita numa sessão: use “Nova sessão de contagem” no topo e escolha os quiosques e meses.</p>
        </section>

        <aside className="flex-[1_1_320px] rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="history-title">
          <h2 id="history-title" className="text-[16px] font-extrabold">Histórico de sessões</h2>
          <p className="mb-2 text-[12.5px] text-ds-ink-muted">{filterCashCountingSessions(sessions, "completed").length} concluídas · {filterCashCountingSessions(sessions, "cancelled").length} canceladas</p>
          {history.length === 0 ? <p className="py-4 text-[13px] text-ds-ink-muted">Nenhuma sessão encerrada.</p> : (
            <ul className="divide-y divide-ds-divider">
              {history.slice(0, 8).map((session) => (
                <li key={session.id}>
                  <Link href={`/dashboard/financial/cash-closures/sessions/${session.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2.5 text-[13px] hover:bg-ds-warm">
                    <span className="truncate font-semibold">{session.kioskNames.join(" · ")}</span>
                    <span className={cn("text-right font-ds-mono", session.status === "cancelled" && "text-ds-ink-faint line-through")}>{formatBRL(session.countedCashCents)}</span>
                    <span className="text-[12px] text-ds-ink-muted">{dateTime(session.openedAt)} · {session.status === "cancelled" ? "Cancelada" : "Concluída"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
