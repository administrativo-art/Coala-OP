"use client";

import * as React from 'react';
import { Info } from 'lucide-react';

import { cn } from '@/lib/utils';

export function fmtBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtPct(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

export const kickerClass = 'text-[10.5px] font-extrabold uppercase tracking-[0.16em]';

export function attainmentTone(pct: number) {
  if (pct >= 100) return 'text-ds-ok';
  if (pct >= 80) return 'text-ds-warn';
  return 'text-ds-danger';
}

/** Número em destaque dentro do painel escuro. */
export function PanelStat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string }) {
  return (
    <div className="px-1 py-2">
      <div className={cn('text-[30px] font-extrabold leading-none tracking-[-0.04em]', tone ?? 'text-ds-on-dark')}>{value}</div>
      <div className="mt-1 text-[13px] font-bold text-ds-on-dark-2">{label}</div>
      {hint && <div className="mt-0.5 text-[11.5px] font-semibold text-ds-on-dark-muted">{hint}</div>}
    </div>
  );
}

/** Campo de filtro para o painel escuro (select nativo ou input). */
export function DarkField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className={cn(kickerClass, 'text-ds-on-dark-muted')}>{label}</span>
      {children}
    </label>
  );
}

export const darkControlClass =
  'h-10 w-full rounded-ds-btn border border-white/[.12] bg-white/[.06] px-3 text-[13px] font-semibold text-ds-on-dark outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker [color-scheme:dark]';

/** Barra de atingimento: 100% preenche a trilha; acima disso mantém cheia e muda de cor. */
export function AttainmentBar({ pct, className }: { pct: number; className?: string }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-ds-muted', className)} role="img" aria-label={`Atingimento ${fmtPct(pct)}`}>
      <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-ds-ok' : pct >= 80 ? 'bg-ds-warn' : 'bg-ds-danger')} style={{ width: `${width}%` }} />
    </div>
  );
}

export function SectionCard({ title, subtitle, action, children, className }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-ds-card border border-ds-border bg-ds-surface', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ds-divider px-5 py-4">
        <div>
          <h2 className="text-[16px] font-extrabold text-ds-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12.5px] font-medium text-ds-ink-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function EmptyBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-ds-card border border-dashed border-ds-border-input px-4 py-12 text-center text-[13.5px] font-bold text-ds-ink-2">{children}</div>;
}

/** Ícone de ajuda: ao pousar o mouse (ou focar com o teclado) mostra a explicação. */
export function HoverHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/hint relative inline-flex align-middle">
      <button type="button" aria-label={label} className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-ds-ink-faint hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
        <Info aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 hidden w-max max-w-[260px] -translate-x-1/2 rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2 text-left text-[12px] font-semibold normal-case leading-snug tracking-normal text-ds-ink-2 shadow-ds-menu group-hover/hint:block group-focus-within/hint:block">
        {children}
      </span>
    </span>
  );
}
