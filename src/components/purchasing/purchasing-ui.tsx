"use client";

import Link from 'next/link';
import { Columns3, LayoutGrid, Search, ShoppingCart, Table2 } from 'lucide-react';
import { type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type PurchasingTone = 'blue' | 'amber' | 'purple' | 'cyan' | 'green' | 'rose' | 'zinc';

const toneClasses: Record<PurchasingTone, { text: string; bg: string; border: string; bar: string; soft: string }> = {
  blue: { text: 'text-blue-600', bg: 'bg-blue-500', border: 'border-blue-500', bar: 'bg-blue-500', soft: 'bg-blue-50 text-blue-700 border-blue-200' },
  amber: { text: 'text-amber-600', bg: 'bg-amber-500', border: 'border-amber-500', bar: 'bg-amber-500', soft: 'bg-amber-50 text-amber-700 border-amber-200' },
  purple: { text: 'text-violet-600', bg: 'bg-violet-500', border: 'border-violet-500', bar: 'bg-violet-500', soft: 'bg-violet-50 text-violet-700 border-violet-200' },
  cyan: { text: 'text-cyan-600', bg: 'bg-cyan-500', border: 'border-cyan-500', bar: 'bg-cyan-500', soft: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  green: { text: 'text-emerald-600', bg: 'bg-emerald-500', border: 'border-emerald-500', bar: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rose: { text: 'text-rose-600', bg: 'bg-rose-500', border: 'border-rose-500', bar: 'bg-rose-500', soft: 'bg-rose-50 text-rose-700 border-rose-200' },
  zinc: { text: 'text-zinc-600', bg: 'bg-zinc-500', border: 'border-zinc-400', bar: 'bg-zinc-400', soft: 'bg-zinc-50 text-zinc-700 border-zinc-200' },
};

export function purchasingMoney(value?: number | null) {
  return Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function purchasingCompactMoney(value?: number | null) {
  return `R$ ${Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function purchasingAgeLabel(date?: string | null) {
  if (!date) return '';
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return '';
  const diffDays = Math.max(Math.floor((Date.now() - time) / 86400000), 0);
  if (diffDays === 0) return 'hoje';
  if (diffDays === 1) return 'ontem';
  return `há ${diffDays}d`;
}

export function PurchasingPageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-1px)] bg-[#f5f5f6]">
      <div className="mx-auto w-full max-w-[1500px] px-6 py-7 lg:px-8">
        {children}
      </div>
    </div>
  );
}

export function PurchasingHeader({
  crumb,
  title,
  description,
  actions,
}: {
  crumb: string[];
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-zinc-500">
          <ShoppingCart className="h-4 w-4" />
          {crumb.map((item, idx) => (
            <span key={`${item}-${idx}`} className="inline-flex items-center gap-2">
              {idx > 0 && <span className="text-zinc-300">/</span>}
              <span className={idx === crumb.length - 1 ? 'font-medium text-zinc-700' : ''}>{item}</span>
            </span>
          ))}
        </div>
        <h1 className="text-[2rem] font-black leading-none tracking-[-0.055em] text-zinc-950">{title}</h1>
        <p className="mt-2 text-base text-zinc-500">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 lg:pt-5">{actions}</div> : null}
    </div>
  );
}

export function PurchasingMetricCard({
  label,
  value,
  detail,
  foot,
  tone = 'blue',
  icon,
  active,
}: {
  label: string;
  value: string | number;
  detail?: string;
  foot?: ReactNode;
  tone?: PurchasingTone;
  icon?: ReactNode;
  active?: boolean;
}) {
  const toneClass = toneClasses[tone];
  return (
    <div className={cn('relative overflow-hidden rounded-[14px] border bg-white p-5 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.35)]', active ? 'border-zinc-950' : 'border-zinc-200')}>
      <span className={cn('absolute left-5 top-5 h-10 w-1 rounded-full', toneClass.bg)} />
      <div className="flex items-start justify-between gap-4 pl-5">
        <div>
          <p className="text-[12px] font-black uppercase tracking-[0.12em] text-zinc-500">{label}</p>
          <p className="mt-2 text-3xl font-black leading-none tracking-[-0.04em] text-zinc-950">{value}</p>
          {detail ? <p className="mt-2 text-sm text-zinc-500">{detail}</p> : null}
        </div>
        {icon ? <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-white', toneClass.bg)}>{icon}</div> : null}
      </div>
      {foot ? <div className="mt-5 border-t border-zinc-100 pt-4 pl-5 text-sm text-zinc-500">{foot}</div> : null}
    </div>
  );
}

export function PurchasingToolbar({
  search,
  onSearchChange,
  placeholder = 'Buscar por código, título, fornecedor, PO...',
  children,
  resultLabel,
  view,
  onViewChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
  resultLabel?: string;
  view?: 'cards' | 'table' | 'kanban';
  onViewChange?: (view: 'cards' | 'table' | 'kanban') => void;
}) {
  const views = [
    { value: 'cards' as const, label: 'Cards', icon: LayoutGrid },
    { value: 'table' as const, label: 'Tabela', icon: Table2 },
    { value: 'kanban' as const, label: 'Kanban', icon: Columns3 },
  ];

  return (
    <div className="mb-6 rounded-[14px] border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={placeholder}
            className="h-12 rounded-[10px] border-zinc-200 bg-white pl-11 text-base shadow-none"
          />
        </div>
        <div className="flex items-center gap-1 rounded-[10px] bg-zinc-100 p-1">
          {views.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => onViewChange?.(value)}
              className={cn(
                'inline-flex h-9 items-center rounded-[8px] px-3 text-sm font-medium transition-colors',
                (view ?? 'cards') === value ? 'border border-zinc-200 bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800',
              )}
            >
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">{children}</div>
        {resultLabel ? <p className="text-sm text-zinc-500">{resultLabel}</p> : null}
      </div>
    </div>
  );
}

export function PurchasingFilterChip({
  active,
  label,
  count,
  tone = 'zinc',
  onClick,
}: {
  active?: boolean;
  label: string;
  count?: number;
  tone?: PurchasingTone;
  onClick: () => void;
}) {
  const toneClass = toneClasses[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
        active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300',
      )}
    >
      {!active && tone !== 'zinc' ? <span className={cn('h-1.5 w-1.5 rounded-full', toneClass.bg)} /> : null}
      <span>{label}</span>
      {typeof count === 'number' ? (
        <span className={cn('rounded-full px-1.5 py-0.5 text-xs font-bold', active ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-500')}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function PurchasingStatusBadge({ label, tone = 'blue' }: { label: string; tone?: PurchasingTone }) {
  return (
    <span className={cn('inline-flex items-center rounded-[6px] border px-2 py-1 text-[11px] font-black uppercase leading-none tracking-[0.04em]', toneClasses[tone].soft)}>
      {label}
    </span>
  );
}

export function PurchasingProgressSegments({
  value,
  total = 8,
  tone = 'blue',
}: {
  value: number;
  total?: number;
  tone?: PurchasingTone;
}) {
  const bounded = Math.max(0, Math.min(value, total));
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, index) => (
        <span
          key={index}
          className={cn('h-1.5 w-4 rounded-full', index < bounded ? toneClasses[tone].bar : 'bg-zinc-200')}
        />
      ))}
      <span className={cn('ml-2 text-xs font-bold tabular-nums', toneClasses[tone].text)}>
        {bounded}/{total}
      </span>
    </div>
  );
}

export function PurchasingPipelineCard({
  href,
  tone = 'blue',
  code,
  title,
  badges,
  progress,
  lines,
  footerLeft,
  amount,
  age,
}: {
  href: string;
  tone?: PurchasingTone;
  code: string;
  title: string;
  badges?: ReactNode;
  progress: number;
  lines?: Array<{ label: string; value?: string }>;
  footerLeft?: ReactNode;
  amount?: string;
  age?: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex min-h-[250px] flex-col overflow-hidden rounded-[16px] border border-zinc-200 bg-white p-5 shadow-[0_12px_26px_-24px_rgba(15,23,42,0.4)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-26px_rgba(15,23,42,0.45)]"
    >
      <span className={cn('absolute left-0 right-0 top-0 h-1', toneClasses[tone].bg)} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-black uppercase tracking-[-0.03em] text-zinc-500">{code}</span>
          {badges}
        </div>
      </div>
      <h2 className="mt-3 line-clamp-2 min-h-[44px] text-lg font-black leading-tight tracking-[-0.03em] text-zinc-950">
        {title}
      </h2>
      <div className="mt-6">
        <PurchasingProgressSegments value={progress} tone={tone} />
      </div>
      <div className="mt-5 flex-1 border-t border-zinc-100 pt-4">
        <div className="space-y-2 text-sm">
          {(lines ?? []).slice(0, 3).map((line, index) => (
            <div key={`${line.label}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 text-zinc-600">
              <span className="truncate">{line.label}</span>
              {line.value ? <span className="font-mono text-xs text-zinc-500">{line.value}</span> : null}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3 border-t border-zinc-100 pt-4">
        <div className="min-w-0 text-sm text-zinc-500">{footerLeft}</div>
        <div className="shrink-0 text-right">
          {amount ? <p className="font-mono text-lg font-black tracking-[-0.04em] text-zinc-950">{amount}</p> : null}
          {age ? <p className="text-xs text-zinc-400">{age}</p> : null}
        </div>
      </div>
    </Link>
  );
}

export function PurchasingEmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-zinc-300 bg-white py-16 text-center text-sm font-medium text-zinc-500">
      {label}
    </div>
  );
}
