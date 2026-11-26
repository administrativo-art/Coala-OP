"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { FilterChips } from "@/components/patterns/filter-chips";
import { HeroBackButton } from "@/components/patterns/hero-back-button";
import { HeroChip } from "@/components/patterns/hero-chip";
import { LiftRow } from "@/components/patterns/lift-row";
import { PageHero } from "@/components/patterns/page-hero";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { cn } from "@/lib/utils";

import { MonthNav } from "./month-nav";
import { formatCents, formatDateBr, monthLabel } from "./month";
import { checkCount, checkTone, flowStatus, itemLabel } from "./presentation";
import type { ClosingTone } from "./types";
import { useClosingMonth, useMonthClosing, useMonthClosingAccess } from "./use-month-closing";

const BAR: Record<ClosingTone, string> = {
  ok: "bg-ds-ok", warn: "bg-ds-warn", danger: "bg-ds-danger", info: "bg-ds-info", neutral: "bg-ds-disabled",
};

export function ExpensesFlowPage() {
  const { month, setMonth } = useClosingMonth();
  const allowed = useMonthClosingAccess();
  const { payload, loading, error, reload } = useMonthClosing(month, allowed);
  const [checkFilter, setCheckFilter] = useState<string | null>(null);

  const flow = payload?.flows.find((entry) => entry.key === "expenses") ?? null;
  const items = useMemo(
    () => (flow ? flow.items.filter((entry) => !checkFilter || entry.checkId === checkFilter) : []),
    [flow, checkFilter],
  );
  const label = monthLabel(month);
  const homeHref = `${FINANCIAL_ROUTES.monthClosing}?${new URLSearchParams({ month })}`;
  const listHref = `${FINANCIAL_ROUTES.expenses}?${new URLSearchParams({ competence: month })}`;

  if (!allowed) {
    return <PageContainer><p role="alert" className="rounded-ds-card border border-ds-border bg-ds-surface p-5 text-[13px] text-ds-ink-muted">Você não tem acesso ao fechamento do mês.</p></PageContainer>;
  }

  const status = flow ? flowStatus(flow) : null;
  const totals = payload?.expenseTotals ?? null;
  const pendingChecks = flow ? flow.checks.filter((check) => check.state === "pending") : [];

  return (
    <PageContainer className="flex flex-col gap-5">
      <PageHero
        kicker={`Fechamento de ${label} · Fluxo 1 de 5`}
        title="Despesas"
        subtitle="Confira as despesas e parcelas cobradas na competência. Os ajustes são feitos em Despesas."
        actions={<MonthNav month={month} onChange={setMonth} />}
        chips={flow ? (
          <>
            {status ? <StatusPill variant={status.tone}>{status.label}</StatusPill> : null}
            {totals ? (
              <>
                <HeroChip value={formatCents(totals.titlesCents)} label={`em ${totals.titleCount} itens`} />
                <HeroChip value={formatCents(totals.settledCents)} label="pagos e conferidos" />
                <HeroChip value={formatCents(totals.openCents)} label="a vencer" tone="warning" />
                <HeroChip value={formatCents(totals.overdueCents)} label="vencido" tone="danger" />
              </>
            ) : null}
          </>
        ) : null}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <HeroBackButton fallbackHref={homeHref} parentLabel={`Fechamento de ${label}`} />
          <Button asChild variant="on-dark-secondary" size="sm"><Link href={listHref}>Abrir Despesas de {label} ↗</Link></Button>
        </div>
        {flow && flow.items.length > 0 && !flow.itemsHidden ? (
          <FilterChips
            value={checkFilter}
            onChange={setCheckFilter}
            allLabel="Todas"
            allCount={flow.items.length}
            chips={pendingChecks.map((check) => ({ value: check.id, label: check.name, count: flow.items.filter((entry) => entry.checkId === check.id).length }))}
          />
        ) : null}
      </PageHero>

      {loading && !payload ? <p role="status" className="text-[13px] text-ds-ink-muted">Carregando as despesas de {label}…</p> : null}
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-ds-card border border-ds-confirm-border bg-ds-confirm-bg p-4 text-[13px] text-ds-confirm-ink">
          <span>{error}</span>
          <Button type="button" variant="ds-secondary" size="sm" onClick={reload}>Tentar de novo</Button>
        </div>
      ) : null}

      {flow ? (
        <>
          <section aria-label="Conferências de despesas" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
            {flow.checks.map((check, index) => {
              const tone = checkTone(check.state);
              const pct = check.done != null && check.total ? Math.round((check.done / check.total) * 100) : check.state === "ok" ? 100 : 0;
              return (
                <div key={check.id} className="flex flex-col gap-2.5 rounded-ds-card border border-ds-border bg-ds-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-ds-mono text-[12px] font-bold text-ds-ink-faint">1.{index + 1}</span>
                    <StatusPill variant={tone}>{check.state === "ok" ? "Conferido" : check.state === "pending" ? "Pendente" : "Fonte não conectada"}</StatusPill>
                  </div>
                  <span className="text-[15.5px] font-extrabold text-ds-ink">{check.name}</span>
                  {check.note ? <span className="text-[12.5px] leading-snug text-ds-ink-muted">{check.note}</span> : null}
                  <div className="h-1.5 overflow-hidden rounded-full bg-ds-neutral-bg" role="presentation"><div className={cn("h-1.5 rounded-full", BAR[tone])} style={{ width: `${pct}%` }} /></div>
                  <span className="font-ds-mono text-[12px] font-bold text-ds-ink">{check.state === "unavailable" ? "—" : checkCount(check)}</span>
                </div>
              );
            })}
          </section>

          <section className="rounded-ds-card border border-ds-border bg-ds-surface p-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2 pt-3">
              <h2 className="text-[19px] font-extrabold uppercase text-ds-ink">Pendências</h2>
              <span className="text-[12px] text-ds-ink-muted">{flow.items.length === 0 ? "Nenhuma pendência" : `${items.length} de ${flow.items.length}`} · cada linha abre a despesa em Despesas</span>
            </div>
            {flow.itemsHidden ? (
              <p className="px-4 py-3 text-[13px] text-ds-ink-muted">Há pendências neste fluxo, mas os itens ficam visíveis para quem também visualiza despesas.</p>
            ) : items.length === 0 ? (
              <p className="m-4 rounded-ds-card border border-dashed border-ds-border-input p-4 text-[13px] text-ds-ink-muted">{flow.items.length === 0 ? "Nada pendente nas conferências conectadas." : "Nenhuma pendência neste filtro."}</p>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,2fr)_150px_110px_130px_150px] gap-3.5 px-[18px] py-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint md:grid">
                  <span>Item</span><span>Situação</span><span>Vencimento</span><span className="text-right">Valor</span><span />
                </div>
                {items.map((entry) => (
                  <LiftRow key={entry.id} table interactive={false} className="grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(0,2fr)_150px_110px_130px_150px] md:gap-3.5">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[13.5px] font-extrabold text-ds-ink">{entry.title}</span>
                      <span className="text-[12px] text-ds-ink-muted">{entry.detail}</span>
                    </span>
                    <span><StatusPill variant={entry.tone}>{itemLabel(entry)}</StatusPill></span>
                    <span className="font-ds-mono text-[12.5px] text-ds-ink">{formatDateBr(entry.dueDate)}</span>
                    <span className="font-ds-mono text-[13px] font-bold text-ds-ink md:text-right">{formatCents(entry.amountCents)}</span>
                    <span className="md:text-right"><Button asChild variant="ds-secondary" size="xs"><Link href={entry.href}>Abrir em Despesas ↗</Link></Button></span>
                  </LiftRow>
                ))}
              </>
            )}
          </section>

          <p className="text-[12px] text-ds-ink-faint">
            Lidos {payload?.limits.expensesRead} de até {payload?.limits.expensesLimit} títulos da competência. Pagamento sem boleto: vincule e pague, ou pague direto e vincule pelo extrato.
          </p>
        </>
      ) : null}
    </PageContainer>
  );
}
