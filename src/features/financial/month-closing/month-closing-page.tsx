"use client";

import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { HeroChip } from "@/components/patterns/hero-chip";
import { PageHero } from "@/components/patterns/page-hero";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { cn } from "@/lib/utils";

import { MonthNav } from "./month-nav";
import { formatCents, formatDateBr, monthLabel } from "./month";
import { checkCount, checkTone, dependsOnYou, flowStatus, itemLabel, nextDueDate } from "./presentation";
import type { ClosingFlow, ClosingItem, ClosingTone } from "./types";
import { useClosingMonth, useMonthClosing, useMonthClosingAccess } from "./use-month-closing";

const DOT: Record<ClosingTone, string> = {
  ok: "bg-ds-ok", warn: "bg-ds-warn", danger: "bg-ds-danger", info: "bg-ds-info", neutral: "bg-ds-disabled",
};

function FlowCard({ flow, index, month }: { flow: ClosingFlow; index: number; month: string }) {
  const status = flowStatus(flow);
  const connected = flow.state !== "not_connected";
  const countable = flow.checks.filter((check) => check.state !== "unavailable");
  const done = countable.filter((check) => check.state === "ok").length;
  const pct = flow.checks.length === 0 ? 0 : Math.round((done / flow.checks.length) * 100);
  const detailHref = flow.key === "expenses" ? `${FINANCIAL_ROUTES.monthClosingExpenses}?${new URLSearchParams({ month })}` : flow.originHref ?? null;
  const detailLabel = flow.key === "expenses" ? `Ver fluxo de ${flow.name.toLowerCase()}` : `Abrir ${flow.name.toLowerCase()} em ${monthLabel(month)}`;
  return (
    <article className="flex min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface transition-[transform,box-shadow] duration-200 ease-ds-lift hover:-translate-y-0.5 hover:shadow-ds-lift motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <header className="flex flex-col gap-2 p-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Fluxo {index + 1}</span>
          {connected ? <span className="font-ds-mono text-[11.5px] font-bold text-ds-ink-muted">{done} de {flow.checks.length}</span> : null}
        </div>
        <h2 className="text-[19px] font-extrabold uppercase text-ds-ink">{flow.name}</h2>
        <StatusPill variant={status.tone} className="self-start">{status.label}</StatusPill>
        <div className="h-1.5 overflow-hidden rounded-full bg-ds-neutral-bg" role="presentation">
          <div className={cn("h-1.5 rounded-full", DOT[status.tone])} style={{ width: `${pct}%` }} />
        </div>
      </header>

      <div className="flex flex-col px-4 pb-3">
        <span className="pb-0.5 pt-1 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Conferências</span>
        {flow.checks.map((check) => (
          <div key={check.id} className="grid grid-cols-[9px_minmax(0,1fr)_auto] items-center gap-2 border-b border-ds-divider py-1.5 text-[12.5px]" title={check.note}>
            <span className={cn("size-[9px] rounded-full", DOT[checkTone(check.state)])} aria-hidden="true" />
            <span className="min-w-0 font-semibold text-ds-ink">{check.name}</span>
            <span className={cn("font-ds-mono text-[11.5px] font-bold", check.state === "pending" ? "text-ds-warn" : check.state === "ok" ? "text-ds-ok" : "text-ds-ink-faint")}>
              {check.state === "unavailable" ? "não conectada" : checkCount(check)}
            </span>
          </div>
        ))}
      </div>

      {connected ? <FlowHiddenNote flow={flow} /> : (
        <p className="px-4 pb-3 text-[12px] text-ds-ink-muted">Este fluxo ainda não foi conectado ao fechamento. Nenhum valor é mostrado até ele existir.</p>
      )}

      <div className="mt-auto">
        {detailHref ? (
          <Link href={detailHref} className="flex items-center justify-between rounded-b-ds-card border-t border-ds-divider px-4 py-3 text-[12.5px] font-bold text-ds-accent-ink hover:bg-ds-muted hover:text-ds-accent-ink-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
            <span>{detailLabel}</span><span aria-hidden="true">›</span>
          </Link>
        ) : (
          <div className="rounded-b-ds-card border-t border-ds-divider px-4 py-3 text-[12.5px] font-bold text-ds-ink-faint">Em construção</div>
        )}
      </div>
    </article>
  );
}

/** A lista de pendências fica na tabela “Até fechar”; o card só avisa quando os itens não podem ser vistos. */
function FlowHiddenNote({ flow }: { flow: ClosingFlow }) {
  if (!flow.itemsHidden) return null;
  return <p className="px-4 pb-3 text-[12px] text-ds-ink-muted">{flow.key === "expenses" ? "Os itens ficam visíveis para quem também visualiza despesas." : "Os itens ficam visíveis para quem acessa a tela de origem deste fluxo."}</p>;
}

function UntilClosing({ items, today }: { items: ClosingItem[]; today: string }) {
  const yours = items.filter(dependsOnYou);
  const waiting = items.filter((entry) => !dependsOnYou(entry)).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-ds-card border border-ds-border bg-ds-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[19px] font-extrabold uppercase text-ds-ink">Até fechar</h2>
        <span className="text-[12px] text-ds-ink-muted">Somente os fluxos já conectados</span>
      </div>
      {items.length === 0 ? <p className="text-[13px] text-ds-ink-muted">Nenhuma pendência nos fluxos conectados.</p> : (
        <ol className="flex flex-col">
          {[...yours.map((entry) => ({ entry, group: "yours" as const })), ...waiting.map((entry) => ({ entry, group: "waiting" as const }))].map(({ entry, group }) => (
            <li key={entry.id} className="grid grid-cols-[96px_12px_minmax(0,1fr)_auto] items-center gap-3 border-b border-ds-divider py-2.5">
              <span className={cn("font-ds-mono text-[12.5px] font-bold", group === "yours" ? "text-ds-danger" : "text-ds-ink")}>{group === "yours" ? "Depende de você" : formatDateBr(entry.dueDate)}</span>
              <span className={cn("size-2.5 rounded-full", DOT[entry.tone])} aria-hidden="true" />
              <span className="min-w-0 text-[13px] font-semibold text-ds-ink">{entry.title} <span className="font-normal text-ds-ink-muted">· {entry.detail}</span></span>
              <StatusPill variant={entry.tone}>{itemLabel(entry)}</StatusPill>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[12px] text-ds-ink-muted">Hoje é {formatDateBr(today)}. O que aguarda data some da lista quando o pagamento for vinculado ao extrato.</p>
    </section>
  );
}

export function MonthClosingPage() {
  const { month, setMonth } = useClosingMonth();
  const allowed = useMonthClosingAccess();
  const { payload, loading, error, reload } = useMonthClosing(month, allowed);

  if (!allowed) {
    return <PageContainer><p role="alert" className="rounded-ds-card border border-ds-border bg-ds-surface p-5 text-[13px] text-ds-ink-muted">Você não tem acesso ao fechamento do mês. Peça a permissão “Ver fechamento do mês” a quem administra os perfis.</p></PageContainer>;
  }

  const flows = payload?.flows ?? [];
  const confirmed = flows.filter((flow) => flow.state === "ok").length;
  const connectedItems = flows.filter((flow) => flow.state !== "not_connected").flatMap((flow) => flow.items);
  const next = payload ? nextDueDate(connectedItems, payload.today) : null;
  const yours = connectedItems.filter(dependsOnYou).length;
  const label = monthLabel(month);

  return (
    <PageContainer className="flex flex-col gap-5">
      <PageHero
        kicker="Financeiro · Fechamento do mês"
        title={`Fechamento de ${label}`}
        subtitle="Aqui se revisa o mês. O tratamento de cada pendência é feito na tela de origem."
        actions={<MonthNav month={month} onChange={setMonth} />}
        chips={payload ? (
          <>
            <HeroChip value={`${confirmed} de ${flows.length}`} label="fluxos conferidos" />
            <HeroChip value={yours} label="dependem de você" tone={yours > 0 ? "danger" : "neutral"} />
            <HeroChip value={next ? formatDateBr(next).slice(0, 5) : "—"} label="próxima data" tone="warning" />
            <HeroChip value="indisponível" label="previsão de fechamento" />
          </>
        ) : null}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
          <p className="max-w-[640px] text-[12.5px] text-ds-on-dark-muted">Fechar e reabrir o mês entram na próxima etapa. Enquanto houver fluxos ainda não conectados, não há previsão de fechamento: nenhum valor é inventado.</p>
          <Button type="button" variant="primary-page" size="xl" disabled title="O fechamento do mês ainda não está disponível.">Fechar {label}</Button>
        </div>
      </PageHero>

      {loading && !payload ? <p role="status" className="text-[13px] text-ds-ink-muted">Carregando o fechamento de {label}…</p> : null}
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-ds-card border border-ds-confirm-border bg-ds-confirm-bg p-4 text-[13px] text-ds-confirm-ink">
          <span>{error}</span>
          <Button type="button" variant="ds-secondary" size="sm" onClick={reload}>Tentar de novo</Button>
        </div>
      ) : null}

      {payload ? (
        <>
          <section aria-label="Fluxos do fechamento" className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] items-stretch gap-3.5">
            {flows.map((flow, index) => <FlowCard key={flow.key} flow={flow} index={index} month={month} />)}
          </section>

          <div className="flex flex-wrap items-start gap-5">
            <div className="min-w-0 flex-[999_1_640px]"><UntilClosing items={connectedItems} today={payload.today} /></div>
            <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
              <section className="flex flex-col gap-2.5 rounded-ds-card border border-ds-border bg-ds-surface p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-2">Bancos · saldo final</span>
                  <StatusPill variant="neutral">Aguardando contas</StatusPill>
                </div>
                <p className="text-[12.5px] leading-relaxed text-ds-ink-muted">As saídas do extrato são conferidas em Despesas e as entradas em Recebimento. O saldo de cada conta aparece aqui quando as contas forem definidas.</p>
              </section>
              {payload.expenseTotals ? (
                <section className="flex flex-col gap-2 rounded-ds-card border border-ds-border bg-ds-surface p-5">
                  <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-2">Despesas da competência</span>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                    <dt className="text-ds-ink-muted">Títulos</dt><dd className="text-right font-ds-mono font-bold">{formatCents(payload.expenseTotals.titlesCents)}</dd>
                    <dt className="text-ds-ink-muted">Pagos e conferidos</dt><dd className="text-right font-ds-mono font-bold">{formatCents(payload.expenseTotals.settledCents)}</dd>
                    <dt className="text-ds-ink-muted">Pagos sem conferência no extrato</dt><dd className="text-right font-ds-mono font-bold">{formatCents(payload.expenseTotals.unconfirmedCents)}</dd>
                    <dt className="text-ds-ink-muted">A vencer</dt><dd className="text-right font-ds-mono font-bold">{formatCents(payload.expenseTotals.openCents)}</dd>
                    <dt className="text-ds-ink-muted">Vencido</dt><dd className="text-right font-ds-mono font-bold text-ds-danger">{formatCents(payload.expenseTotals.overdueCents)}</dd>
                  </dl>
                  <p className="text-[11.5px] text-ds-ink-faint">Sem as compras no cartão, que seguem pela fatura.</p>
                </section>
              ) : null}
            </aside>
          </div>
        </>
      ) : null}
    </PageContainer>
  );
}
