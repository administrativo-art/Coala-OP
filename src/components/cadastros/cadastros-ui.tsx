"use client";

/**
 * Composição de Cadastros sobre o guia de design (docs/design, decisão 0005).
 * Não há padrão visual próprio aqui: cada peça delega a `src/components/patterns/`,
 * aos tokens `--ds-*`, ao `Button` e ao `StatusPill`. A API pública é a que as telas já usam.
 */

import * as React from 'react';
import { LayoutGrid, List } from 'lucide-react';

import { BulkBar as BulkBarPattern } from '@/components/patterns/bulk-bar';
import { ControlPanel, ControlSearch } from '@/components/patterns/control-panel';
import { FilterChips } from '@/components/patterns/filter-chips';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { LiftRow } from '@/components/patterns/lift-row';
import { PanelField, SidePanel } from '@/components/patterns/side-panel';
import { Segmented } from '@/components/patterns/segmented';
import { SelectBox } from '@/components/patterns/select-box';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import {
  selectionSummary,
  type CadastrosChip,
  type CadastrosStatus,
  type CadastrosView,
} from './cadastros-utils';

export { SelectBox };

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
              'flex flex-col gap-1.5 border-b-4 px-1 pb-4 pt-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker',
              isActive ? 'border-ds-accent text-white' : 'border-transparent text-ds-indicator-zero hover:text-ds-on-dark-2'
            )}
          >
            <span
              className={cn(
                'font-ds-mono text-[44px] font-bold leading-none tracking-[-0.05em]',
                isActive ? 'text-ds-accent-kicker' : 'text-ds-indicator-zero opacity-60'
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
  /** Omitido nas telas sem situação ativo/inativo. */
  status?: {
    value: CadastrosStatus;
    onChange: (value: CadastrosStatus) => void;
    activeCount: number;
    inactiveCount: number;
    inactiveLabel: string;
  };
  manage?: { label: string; onClick: () => void };
  /** Omitido quando a pessoa só pode consultar. */
  primary?: { label: string; onClick: () => void };
  chips: CadastrosChip[];
  activeChip: string;
  onChip: (id: string) => void;
}) {
  const allChip = chips.find((chip) => chip.id === 'all');
  const filterChips = chips.filter((chip) => chip.id !== 'all').map((chip) => ({ value: chip.id, label: chip.label, count: chip.count }));
  return (
    <ControlPanel className="flex flex-col gap-[18px] px-[26px] pb-5 pt-[22px]">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">{kicker}</span>
      {tabs}
      <div className="flex flex-wrap items-center gap-2.5">
        <ControlSearch value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
        {status ? (
        <div className="flex gap-0.5 rounded-ds-btn bg-white/[0.07] p-1" role="group" aria-label="Situação">
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
                'h-[42px] whitespace-nowrap rounded-ds-md px-4 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker',
                status.value === value ? 'bg-ds-on-dark text-ds-dark' : 'text-ds-on-dark-sub hover:text-white'
              )}
            >
              {label} <span className="font-semibold opacity-55">{count}</span>
            </button>
          ))}
        </div>
        ) : null}
        {manage ? (
          <Button type="button" variant="on-dark-secondary" size="xl" onClick={manage.onClick} className="whitespace-nowrap">
            {manage.label}
          </Button>
        ) : null}
        {primary ? (
          <Button type="button" variant="primary-page" size="xl" onClick={primary.onClick} className="whitespace-nowrap">
            + {primary.label}
          </Button>
        ) : null}
      </div>
      {filterChips.length > 0 ? (
        <FilterChips
          chips={filterChips}
          value={activeChip === 'all' ? null : activeChip}
          onChange={(value) => onChip(value ?? 'all')}
          allLabel={allChip?.label}
          allCount={allChip?.count}
        />
      ) : null}
    </ControlPanel>
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
        <span className="text-[13px] text-ds-ink-faint">
          de {total} {noun}
        </span>
        {selectAll ? (
          <button
            type="button"
            onClick={selectAll.onClick}
            className="ml-2.5 text-[12.5px] font-bold text-ds-accent-ink hover:text-ds-accent-ink-hover"
          >
            {selectAll.label}
          </button>
        ) : null}
      </div>
      <Segmented<CadastrosView>
        aria-label="Visualização"
        value={view}
        onChange={onView}
        options={[
          {
            value: 'list',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <List className="h-3.5 w-3.5" aria-hidden />
                Lista
              </span>
            ),
          },
          {
            value: 'grid',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                Grade
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

/* ───────────────────────── Lista ───────────────────────── */

export function ListShell({ children, minWidth = 860 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <section className="overflow-hidden rounded-ds-card-lg border border-ds-border bg-ds-warm">
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>{children}</div>
      </div>
    </section>
  );
}

export function ListHead({ template, children }: { template: string; children: React.ReactNode }) {
  return (
    <div
      className="grid items-center gap-3.5 border-b border-ds-divider px-5 py-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-ds-ink-faint"
      style={{ gridTemplateColumns: template }}
    >
      {children}
    </div>
  );
}

export function ListRow({
  template,
  isOpen,
  isSelected,
  isMuted,
  onOpen,
  label,
  children,
}: {
  template: string;
  /** Mantido por compatibilidade: a divisória agora é de `LiftRow`. */
  isFirst?: boolean;
  isOpen: boolean;
  isSelected: boolean;
  isMuted: boolean;
  onOpen: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <LiftRow
      selected={isOpen}
      aria-label={label}
      aria-pressed={undefined}
      onClick={onOpen}
      table
      className={cn(
        'grid items-center gap-3.5 px-5 py-[11px] last:border-b-0',
        isSelected && !isOpen && 'bg-ds-accent-soft/40',
        isMuted && 'opacity-60'
      )}
      style={{ gridTemplateColumns: template }}
    >
      {children}
    </LiftRow>
  );
}

export function Chevron() {
  return <span className="text-[13px] text-ds-ink-faint">›</span>;
}

/** Situação somente leitura (docs/design/status.md): a troca acontece no painel ou no modal. */
export function StatusDot({ isActive, activeLabel = 'Ativo', inactiveLabel = 'Inativo' }: { isActive: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return <StatusPill variant={isActive ? 'ok' : 'neutral'}>{isActive ? activeLabel : inactiveLabel}</StatusPill>;
}

export function SoftPill({ children, isEmpty }: { children: React.ReactNode; isEmpty?: boolean }) {
  return (
    <span
      className={cn(
        'max-w-full self-start justify-self-start truncate whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold',
        isEmpty ? 'border border-dashed border-ds-border-input text-ds-ink-faint' : 'bg-ds-muted text-ds-ink-2'
      )}
    >
      {children}
    </span>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-ds-mono', className)}>{children}</span>;
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
        'flex cursor-pointer flex-col gap-3 rounded-ds-card-lg bg-ds-surface p-[18px] outline-none transition-[transform,box-shadow] duration-150 ease-ds-lift',
        'hover:-translate-y-0.5 hover:shadow-ds-lift focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2 motion-reduce:hover:translate-y-0',
        isOpen ? 'border-2 border-ds-accent-ink' : isSelected ? 'border-2 border-ds-accent/40' : 'border border-ds-border',
        isMuted && 'opacity-60'
      )}
      style={{ minHeight }}
    >
      {children}
    </div>
  );
}

export function CardFooterLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">{children}</span>;
}

export function EmptyResults({ title, onClear }: { title: string; onClear: () => void }) {
  return (
    <div className="m-4 flex flex-col items-center gap-2.5 rounded-ds-card border border-dashed border-ds-border-input px-5 py-12 text-center">
      <span className="text-sm font-bold">{title}</span>
      <Button type="button" variant="ds-secondary" size="xs" onClick={onClear}>
        Limpar filtros
      </Button>
    </div>
  );
}

/* ───────────────────────── Painel lateral ───────────────────────── */

export type Tone = 'neutral' | 'pink' | 'off' | 'ok' | 'warn' | 'violet';
export type DrawerChip = { label: string; tone?: Tone };
export type DrawerNotice = { kind: 'block' | 'confirm'; text: string; onConfirm?: () => void };
export type DrawerAction = { label: string; onClick: () => void; isDanger?: boolean };

/** `pink` e `violet` não têm variante em `StatusPill`; usam os tokens de marca e de modal. */
const CHIP_TONES: Record<Tone, string> = {
  neutral: 'bg-ds-muted text-ds-ink-2',
  off: 'bg-ds-neutral-bg text-ds-neutral',
  pink: 'bg-ds-accent-soft text-ds-accent-ink',
  ok: 'bg-ds-ok-bg text-ds-ok',
  warn: 'bg-ds-warn-bg text-ds-warn',
  violet: 'bg-ds-modal-soft text-ds-modal-ink',
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
  const regularActions = actions.filter((action) => !action.isDanger);
  const dangerActions = actions.filter((action) => action.isDanger);
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      kicker={kicker}
      title={title}
      subtitle={
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className={cn('inline-flex h-[21px] items-center whitespace-nowrap rounded-full px-[9px] text-[11.5px] font-bold', CHIP_TONES[chip.tone ?? 'neutral'])}
            >
              {chip.label}
            </span>
          ))}
        </span>
      }
    >
      {hero ? (
        <div className="flex items-center gap-3.5 rounded-ds-card bg-ds-dark p-3.5 text-ds-on-dark">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-ds-btn-lg border border-white/20 bg-white/10 text-[28px] font-extrabold tracking-[-0.04em] text-ds-accent-kicker">
            {hero.sig}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">{hero.label}</span>
            <span className="font-ds-mono text-[22px] font-bold tracking-[-0.02em]">{hero.value}</span>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        {fields.map(([key, value]) => (
          <PanelField key={key} label={key}>
            <span className="break-words">{value}</span>
          </PanelField>
        ))}
      </div>

      {list ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-extrabold">{list.title}</span>
            {list.more ? <span className="text-[11.5px] text-ds-ink-faint">{list.more}</span> : null}
          </div>
          <div className="flex flex-col rounded-ds-btn-lg border border-ds-border bg-ds-surface">
            {list.rows.map(([a, b], index) => (
              <div
                key={`${a}-${index}`}
                className={cn('flex items-baseline justify-between gap-3.5 px-3.5 py-2.5', index > 0 && 'border-t border-ds-divider')}
              >
                <span className="min-w-0 truncate text-[12.5px] font-semibold">{a}</span>
                <span className="whitespace-nowrap text-xs text-ds-ink-faint">{b}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {notice?.kind === 'block' ? (
        <div role="alert" className="rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-3.5 py-[11px] text-[12.5px] leading-normal text-ds-alert-ink">
          {notice.text}
        </div>
      ) : null}

      {isConfirming ? (
        <InlineConfirm
          message={notice.text}
          confirmLabel="Confirmar"
          loadingLabel="Processando…"
          loading={isBusy}
          onConfirm={() => notice.onConfirm?.()}
          onCancel={onCancelNotice}
        />
      ) : null}

      <div className="mt-auto flex flex-col gap-3 border-t border-ds-divider pt-4">
        {onFicha || onEdit ? (
          <div className="grid grid-cols-2 gap-2">
            {onFicha ? (
              <Button type="button" variant="ds-secondary" size="md" onClick={onFicha}>
                Ficha cadastral
              </Button>
            ) : null}
            {onEdit ? (
              <Button type="button" variant="primary-modal" size="md" onClick={onEdit} className={onFicha ? undefined : 'col-span-2'}>
                Editar
              </Button>
            ) : null}
          </div>
        ) : null}
        {!isConfirming && regularActions.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {regularActions.map((action) => (
              <Button key={action.label} type="button" variant="ds-secondary" size="md" onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
        {!isConfirming && dangerActions.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {dangerActions.map((action) => (
              <Button key={action.label} type="button" variant="danger-link" size="xs" onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </SidePanel>
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
  return <BulkBarPattern count={count} summary={selectionSummary(count)} actions={actions} onClear={onClear} />;
}
