"use client";

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { LayoutGrid, List, Search, X } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  selectionSummary,
  type CadastrosChip,
  type CadastrosStatus,
  type CadastrosView,
} from './cadastros-utils';

/** O que o espaço de trabalho passa a cada aba: o seletor de abas (parte do cabeçalho escuro) e a visualização. */
export type CadastrosTabProps = {
  tabs: React.ReactNode;
  view: CadastrosView;
  onViewChange: (view: CadastrosView) => void;
};

/* ───────────────────────── Cabeçalho escuro ───────────────────────── */

export type CadastrosTabItem = { id: string; label: string; count: number };

export function CadastrosTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: CadastrosTabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="grid grid-cols-1 gap-1 border-b border-white/10 sm:grid-cols-3">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex flex-col gap-1.5 border-b-4 px-1 pb-4 pt-1.5 text-left transition-colors',
              isActive ? 'border-[#e0457f] text-white' : 'border-transparent text-[#77768a] hover:text-[#c8c7d0]'
            )}
          >
            <span
              className={cn(
                'font-mono text-[44px] font-bold leading-none tracking-[-0.05em]',
                isActive ? 'text-[#f08bb1]' : 'text-[#4b4a58]'
              )}
            >
              {tab.count}
            </span>
            <span className="text-base font-extrabold tracking-[-0.01em]">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CadastrosHero({
  kicker,
  tabs,
  search,
  status,
  manage,
  primary,
  chips,
  activeChip,
  onChip,
}: {
  kicker: string;
  tabs: React.ReactNode;
  search: { value: string; placeholder: string; onChange: (value: string) => void };
  status: {
    value: CadastrosStatus;
    onChange: (value: CadastrosStatus) => void;
    activeCount: number;
    inactiveCount: number;
    inactiveLabel: string;
  };
  manage?: { label: string; onClick: () => void };
  primary: { label: string; onClick: () => void };
  chips: CadastrosChip[];
  activeChip: string;
  onChip: (id: string) => void;
}) {
  return (
    <section className="flex flex-col gap-[18px] rounded-[28px] bg-[#15151c] px-[26px] pb-5 pt-[22px] text-[#f3f2ee] shadow-[0_24px_60px_rgba(21,21,28,0.18)]">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-[#f08bb1]">{kicker}</span>
      {tabs}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-12 min-w-[260px] flex-1 items-center gap-3 rounded-[14px] border border-white/10 bg-white/[0.07] px-[18px]">
          <Search className="h-[18px] w-[18px] shrink-0 text-[#8e8d99]" aria-hidden />
          <input
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            className="min-w-0 flex-1 border-none bg-transparent text-[14.5px] text-white outline-none placeholder:text-[#8e8d99]"
          />
          {search.value ? (
            <button
              type="button"
              onClick={() => search.onChange('')}
              aria-label="Limpar busca"
              className="text-[#8e8d99] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <div className="flex gap-0.5 rounded-[13px] bg-white/[0.07] p-1" role="group" aria-label="Situação">
          {(
            [
              ['active', 'Ativos', status.activeCount],
              ['inactive', status.inactiveLabel, status.inactiveCount],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={status.value === value}
              onClick={() => status.onChange(value)}
              className={cn(
                'h-[42px] whitespace-nowrap rounded-[10px] px-4 text-[13px] font-bold transition-colors',
                status.value === value ? 'bg-[#f3f2ee] text-[#15151c]' : 'text-[#a3a2ad] hover:text-white'
              )}
            >
              {label} <span className="font-semibold opacity-55">{count}</span>
            </button>
          ))}
        </div>
        {manage ? (
          <button
            type="button"
            onClick={manage.onClick}
            className="h-12 whitespace-nowrap rounded-[14px] border border-white/15 px-[18px] text-[13.5px] font-bold text-[#f3f2ee] transition-colors hover:bg-white/10"
          >
            {manage.label}
          </button>
        ) : null}
        <button
          type="button"
          onClick={primary.onClick}
          className="h-12 whitespace-nowrap rounded-[14px] bg-[#e0457f] px-[22px] text-sm font-extrabold text-white shadow-[0_8px_24px_rgba(224,69,127,0.35)] transition-colors hover:bg-[#c93a6f]"
        >
          + {primary.label}
        </button>
      </div>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
        {chips.map((chip) => {
          const isActive = chip.id === activeChip;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChip(chip.id)}
              title={chip.label}
              className={cn(
                'inline-flex h-[34px] max-w-[260px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-[12.5px] font-bold transition-colors',
                isActive
                  ? 'border-[#f3f2ee] bg-[#f3f2ee] text-[#15151c]'
                  : 'border-white/[0.12] text-[#c8c7d0] hover:bg-white/10'
              )}
            >
              <span className="truncate">{chip.label}</span>
              <span className={cn('text-[11px] font-bold', isActive ? 'text-[#70757d]' : 'text-[#77768a]')}>
                {chip.count}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ───────────────────────── Barra de resultados ───────────────────────── */

export function ResultsBar({
  shown,
  total,
  noun,
  selectAll,
  view,
  onView,
}: {
  shown: number;
  total: number;
  noun: string;
  selectAll?: { label: string; onClick: () => void };
  view: CadastrosView;
  onView: (view: CadastrosView) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{shown}</span>
        <span className="text-[13px] text-[#70757d]">
          de {total} {noun}
        </span>
        {selectAll ? (
          <button
            type="button"
            onClick={selectAll.onClick}
            className="ml-2.5 text-[12.5px] font-bold text-[#a6325b] hover:text-[#8e294d]"
          >
            {selectAll.label}
          </button>
        ) : null}
      </div>
      <div className="flex gap-0.5 rounded-[11px] bg-[#e6e3dc] p-[3px]" role="group" aria-label="Visualização">
        {(
          [
            ['list', 'Lista', List],
            ['grid', 'Grade', LayoutGrid],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => onView(value)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-[9px] px-[13px] text-[12.5px] font-bold transition-colors',
              view === value ? 'bg-white text-[#1a1b1f] shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-[#70757d]'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Lista ───────────────────────── */

export function SelectBox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] p-0 text-[11px] font-extrabold text-white',
        checked ? 'bg-[#a6325b]' : 'border-[1.5px] border-[#cfcbc2] bg-white'
      )}
    >
      {checked ? '✓' : ''}
    </button>
  );
}

export function ListShell({ children, minWidth = 860 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <section className="overflow-hidden rounded-[20px] border border-[#e3dfd6] bg-[#fffdf9]">
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>{children}</div>
      </div>
    </section>
  );
}

export function ListHead({ template, children }: { template: string; children: React.ReactNode }) {
  return (
    <div
      className="grid items-center gap-3.5 border-b border-[#ece8e0] px-5 py-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-[#8a8f99]"
      style={{ gridTemplateColumns: template }}
    >
      {children}
    </div>
  );
}

export function ListRow({
  template,
  isFirst,
  isOpen,
  isSelected,
  isMuted,
  onOpen,
  label,
  children,
}: {
  template: string;
  isFirst: boolean;
  isOpen: boolean;
  isSelected: boolean;
  isMuted: boolean;
  onOpen: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'relative grid cursor-pointer items-center gap-3.5 px-5 py-[11px] outline-none transition-[transform,box-shadow,background-color] duration-150',
        'hover:z-[2] hover:-translate-y-0.5 hover:scale-[1.004] hover:rounded-[14px] hover:bg-white hover:shadow-[0_10px_28px_rgba(21,21,28,0.12),0_2px_6px_rgba(21,21,28,0.06)]',
        'focus-visible:ring-2 focus-visible:ring-[#a6325b]/50',
        !isFirst && 'border-t border-[#f1eee8]',
        isOpen ? 'bg-[#fbeef3] shadow-[inset_3px_0_0_#a6325b]' : isSelected ? 'bg-[#fdf6f8]' : 'bg-transparent',
        isMuted && 'opacity-60'
      )}
      style={{ gridTemplateColumns: template }}
    >
      {children}
    </div>
  );
}

export function Chevron() {
  return <span className="text-[13px] text-[#b5b2aa]">›</span>;
}

export function StatusDot({ isActive, activeLabel = 'Ativo', inactiveLabel = 'Inativo' }: { isActive: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return (
    <span className="inline-flex items-center gap-[7px] text-[12.5px] text-[#4a4f57]">
      <span className={cn('h-2 w-2 rounded-full', isActive ? 'bg-emerald-500' : 'bg-[#b5b2aa]')} />
      {isActive ? activeLabel : inactiveLabel}
    </span>
  );
}

export function SoftPill({ children, isEmpty }: { children: React.ReactNode; isEmpty?: boolean }) {
  return (
    <span
      className={cn(
        'max-w-full self-start justify-self-start truncate whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold',
        isEmpty ? 'border border-dashed border-[#d6d2c8] text-[#9a9ba1]' : 'bg-[#f4f2ed] text-[#4a4f57]'
      )}
    >
      {children}
    </span>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono', className)}>{children}</span>;
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-5" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

/* ───────────────────────── Grade ───────────────────────── */

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3.5">{children}</div>;
}

export function GridCard({
  isOpen,
  isSelected,
  isMuted,
  onOpen,
  label,
  minHeight = 240,
  children,
}: {
  isOpen: boolean;
  isSelected: boolean;
  isMuted: boolean;
  onOpen: () => void;
  label: string;
  minHeight?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'flex cursor-pointer flex-col gap-3 rounded-[20px] bg-white p-[18px] outline-none transition-[transform,box-shadow] duration-150',
        'hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(21,21,28,0.12)] focus-visible:ring-2 focus-visible:ring-[#a6325b]/50',
        isOpen ? 'border-2 border-[#a6325b]' : isSelected ? 'border-2 border-[#f0a5c1]' : 'border border-[#e3dfd6]',
        isMuted && 'opacity-60'
      )}
      style={{ minHeight }}
    >
      {children}
    </div>
  );
}

export function CardFooterLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#9a9ba1]">{children}</span>;
}

export function EmptyResults({ title, onClear }: { title: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-5 py-14 text-center">
      <span className="text-sm font-bold">{title}</span>
      <button
        type="button"
        onClick={onClear}
        className="h-9 rounded-[10px] border border-[#e3dfd6] bg-white px-3.5 text-[12.5px] font-bold hover:bg-[#f6f4ef]"
      >
        Limpar filtros
      </button>
    </div>
  );
}

/* ───────────────────────── Painel lateral ───────────────────────── */

export type Tone = 'neutral' | 'pink' | 'off' | 'ok' | 'warn' | 'violet';
export type DrawerChip = { label: string; tone?: Tone };
export type DrawerNotice = { kind: 'block' | 'confirm'; text: string; onConfirm?: () => void };
export type DrawerAction = { label: string; onClick: () => void; isDanger?: boolean };

const CHIP_TONES: Record<Tone, string> = {
  neutral: 'bg-[#f4f2ed] text-[#4a4f57]',
  pink: 'bg-[#fbe7ef] text-[#a6325b]',
  off: 'bg-[#efede7] text-[#70757d]',
  ok: 'bg-[#d1fae5] text-[#065f46]',
  warn: 'bg-[#fef3c7] text-[#92400e]',
  violet: 'bg-[#ede9fe] text-[#5b21b6]',
};

/** Etiqueta pequena para dentro de linhas e cartões. */
export function TagChip({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn('rounded-md px-1.5 py-px text-[10.5px] font-bold', CHIP_TONES[tone === 'neutral' ? 'off' : tone])}>
      {children}
    </span>
  );
}

export function DetailDrawer({
  open,
  onClose,
  kicker,
  title,
  chips,
  hero,
  fields,
  list,
  notice,
  onCancelNotice,
  actions,
  onEdit,
  onFicha,
  isBusy,
}: {
  open: boolean;
  onClose: () => void;
  kicker: string;
  title: string;
  chips: DrawerChip[];
  hero?: { sig: string; label: string; value: string };
  fields: Array<[string, string]>;
  list?: { title: string; more?: string; rows: Array<[string, string]> };
  notice: DrawerNotice | null;
  onCancelNotice: () => void;
  actions: DrawerAction[];
  onEdit?: () => void;
  onFicha?: () => void;
  isBusy?: boolean;
}) {
  const isConfirming = notice?.kind === 'confirm';
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(24,20,14,0.18)] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed bottom-3 right-3 top-3 z-50 flex w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-[20px] border border-[#e3dfd6] bg-[#fffdf9] shadow-[-20px_0_60px_rgba(0,0,0,0.16)] outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
        >
          <div className="flex flex-col gap-2.5 bg-[#15151c] px-[22px] pb-[18px] pt-[22px] text-[#f3f2ee]">
            <div className="flex items-center justify-between gap-2.5">
              <span className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-[#8e8d99]">{kicker}</span>
              <DialogPrimitive.Close
                aria-label="Fechar painel"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/10 text-[#f3f2ee] hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
            <DialogPrimitive.Title className="m-0 break-words text-[30px] font-extrabold leading-[1.05] tracking-[-0.035em]">
              {title}
            </DialogPrimitive.Title>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip.label}
                  className={cn('whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11.5px] font-semibold', CHIP_TONES[chip.tone ?? 'neutral'])}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[22px] py-4">
            {hero ? (
              <div className="flex items-center gap-3.5 rounded-2xl bg-[#15151c] p-3.5 text-[#f3f2ee]">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[14px] border border-[#b9b9ff]/30 bg-[#b9b9ff]/10 text-[28px] font-extrabold tracking-[-0.04em] text-[#b9b9ff]">
                  {hero.sig}
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-[#8e8d99]">{hero.label}</span>
                  <span className="font-mono text-[22px] font-bold tracking-[-0.02em]">{hero.value}</span>
                </div>
              </div>
            ) : null}

            <dl className="flex flex-col rounded-[14px] border border-[#ece8e0] bg-white">
              {fields.map(([key, value], index) => (
                <div
                  key={key}
                  className={cn('flex items-baseline justify-between gap-3.5 px-3.5 py-2.5', index > 0 && 'border-t border-[#f1eee8]')}
                >
                  <dt className="shrink-0 text-xs text-[#70757d]">{key}</dt>
                  <dd className="m-0 break-words text-right text-[13px] font-semibold">{value}</dd>
                </div>
              ))}
            </dl>

            {list ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12.5px] font-extrabold">{list.title}</span>
                  {list.more ? <span className="text-[11.5px] text-[#8a8f99]">{list.more}</span> : null}
                </div>
                <div className="flex flex-col rounded-[14px] border border-[#ece8e0] bg-white">
                  {list.rows.map(([a, b], index) => (
                    <div
                      key={`${a}-${index}`}
                      className={cn('flex items-baseline justify-between gap-3.5 px-3.5 py-2.5', index > 0 && 'border-t border-[#f1eee8]')}
                    >
                      <span className="min-w-0 truncate text-[12.5px] font-semibold">{a}</span>
                      <span className="whitespace-nowrap text-xs text-[#70757d]">{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {notice ? (
              <div
                role="alert"
                className={cn(
                  'rounded-xl border px-3.5 py-[11px] text-[12.5px] leading-normal',
                  notice.kind === 'confirm'
                    ? 'border-[#f3c7d5] bg-[#fff1f4] text-[#9f1239]'
                    : 'border-[#f5d9a3] bg-[#fff7e6] text-[#8a5a00]'
                )}
              >
                {notice.text}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 border-t border-[#ece8e0] px-[22px] pb-[18px] pt-3.5">
            <div className="flex gap-2">
              {onFicha ? (
                <button
                  type="button"
                  onClick={onFicha}
                  className="flex h-[42px] flex-1 items-center justify-center rounded-xl border border-[#e3dfd6] bg-white text-[13px] font-bold text-[#1a1b1f] hover:bg-[#f6f4ef]"
                >
                  Ficha cadastral
                </button>
              ) : null}
              {onEdit ? (
                <button
                  type="button"
                  onClick={onEdit}
                  className="flex h-[42px] flex-1 items-center justify-center rounded-xl bg-[#1a1b1f] text-[13px] font-bold text-white hover:bg-black"
                >
                  Editar
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {isConfirming ? (
                <>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={notice?.onConfirm}
                    className="h-[34px] rounded-[10px] border border-[#be123c] bg-[#be123c] px-3 text-[12.5px] font-bold text-white disabled:opacity-60"
                  >
                    {isBusy ? 'Processando…' : 'Confirmar'}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={onCancelNotice}
                    className="h-[34px] rounded-[10px] border border-[#e3dfd6] bg-white px-3 text-[12.5px] font-bold text-[#4a4f57] disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.onClick}
                    className={cn(
                      'h-[34px] rounded-[10px] border bg-white px-3 text-[12.5px] font-bold hover:bg-[#f6f4ef]',
                      action.isDanger ? 'border-[#f3c7d5] text-[#be123c]' : 'border-[#e3dfd6] text-[#4a4f57]'
                    )}
                  >
                    {action.label}
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ───────────────────────── Barra de ações em massa ───────────────────────── */

export function BulkBar({
  count,
  actions,
  onClear,
}: {
  count: number;
  actions: DrawerAction[];
  onClear: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div
      role="region"
      aria-label="Ações em massa"
      className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-2xl bg-[#15151c] py-2 pl-[18px] pr-2 text-white shadow-[0_18px_50px_rgba(0,0,0,0.28)]"
    >
      <span className="mr-2 whitespace-nowrap text-[13px] font-bold">{selectionSummary(count)}</span>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          className={cn(
            'h-9 whitespace-nowrap rounded-[10px] px-3.5 text-[12.5px] font-bold text-white',
            action.isDanger ? 'bg-[#be123c] hover:bg-[#9f1239]' : 'bg-white/10 hover:bg-white/20'
          )}
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="h-9 rounded-[10px] px-2.5 text-[12.5px] font-semibold text-[#a3a2ad] hover:text-white"
      >
        Limpar
      </button>
    </div>
  );
}
