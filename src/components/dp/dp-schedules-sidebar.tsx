"use client";

import { CalendarDays, ChevronLeft, Lock, Search, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export type DPSchedulesSidebarUnit = {
  key: string;
  name: string;
  locked?: boolean;
  selected?: boolean;
  disabled?: boolean;
  filledDays: number;
  expectedDays?: number | null;
  onClick?: () => void;
  onDelete?: () => void;
};

export type DPSchedulesSidebarGroup = {
  state: string;
  stateCode: string;
  unitCount: number;
  cities: Array<{
    city: string;
    units: DPSchedulesSidebarUnit[];
  }>;
};

function progressForUnit(unit: DPSchedulesSidebarUnit) {
  if (unit.expectedDays == null || unit.expectedDays <= 0) {
    return unit.filledDays > 0 ? 100 : 0;
  }
  return Math.min(100, Math.round((unit.filledDays / unit.expectedDays) * 100));
}

function unitMeta(unit: DPSchedulesSidebarUnit) {
  if (unit.expectedDays == null || unit.expectedDays <= 0) {
    return String(unit.filledDays);
  }
  return `${unit.filledDays}/${unit.expectedDays}`;
}

function unitDetail(unit: DPSchedulesSidebarUnit) {
  if (unit.expectedDays == null || unit.expectedDays <= 0) {
    return `${unit.filledDays} ${unit.filledDays === 1 ? 'dia preenchido' : 'dias preenchidos'}`;
  }
  return `${unit.filledDays} preenchidos · ${unit.expectedDays} esperados`;
}

export function DPSchedulesSidebar({
  groups,
  query,
  onQueryChange,
  onBack,
  startedCount,
  totalCount,
  emptyLabel = 'Nenhuma unidade disponível.',
}: {
  groups: DPSchedulesSidebarGroup[];
  query: string;
  onQueryChange: (value: string) => void;
  onBack: () => void;
  startedCount: number;
  totalCount: number;
  emptyLabel?: string;
}) {
  const startedPct = totalCount > 0 ? Math.round((startedCount / totalCount) * 100) : 0;

  return (
    <aside className="flex max-h-[42vh] w-full shrink-0 flex-col overflow-hidden rounded-[12px] bg-ds-dark px-[11px] pb-[11px] pt-[15px] text-ds-on-dark lg:max-h-none lg:w-[230px]">
      <div className="flex items-center gap-2 px-[5px]">
        <CalendarDays className="h-[15px] w-[15px] shrink-0 text-ds-accent-ink" strokeWidth={2.4} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-black leading-4 tracking-[-0.01em] text-white">Escalas · DP</p>
          <p className="text-[10.5px] font-bold leading-[14px] text-ds-ink-muted">Unidades por estado</p>
        </div>
      </div>

      <label className="mt-[14px] flex h-8 items-center gap-2 rounded-[10px] bg-ds-info px-[10px]">
        <Search className="h-[13px] w-[13px] shrink-0 text-ds-ink-muted" strokeWidth={2.4} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar unidade"
          aria-label="Buscar unidade"
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-semibold text-ds-on-dark-2 outline-none placeholder:text-ds-ink-muted focus:ring-0"
        />
      </label>

      <button
        type="button"
        onClick={onBack}
        className="mt-3 flex items-center gap-[7px] px-[5px] text-[11.5px] font-extrabold text-ds-ink-faint transition-colors hover:text-ds-on-dark-2"
      >
        <ChevronLeft className="h-3 w-3" strokeWidth={2.8} />
        Todos os meses
      </button>

      <div className="no-scrollbar mt-[10px] min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-ds-ink-muted">{emptyLabel}</p>
        ) : groups.map((group) => (
          <section key={group.state} className="mb-2">
            <div className="sticky top-0 z-[2] mb-0.5 flex items-center gap-[7px] rounded-[9px] bg-ds-info p-2">
              <span className="grid h-[18px] min-w-6 shrink-0 place-items-center rounded-[5px] bg-ds-accent px-1.5 text-[9.5px] font-black uppercase tracking-[0.06em] text-white">
                {group.stateCode}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-black text-ds-info">{group.state}</span>
              <span className="shrink-0 text-[10px] font-bold text-ds-ink-muted">
                {group.unitCount} {group.unitCount === 1 ? 'unidade' : 'unidades'}
              </span>
            </div>

            {group.cities.map((city) => (
              <div key={city.city} className="mb-0.5 ml-[9px] border-l border-ds-info pl-[7px]">
                <div className="flex items-baseline gap-[5px] px-2 pb-1 pt-1.5">
                  <span className="truncate text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-ds-ink-muted">{city.city}</span>
                  <span className="shrink-0 text-[9.5px] font-bold text-ds-info">· {city.units.length}</span>
                </div>

                {city.units.map((unit) => {
                  const progress = progressForUnit(unit);
                  const interactive = !unit.disabled && !!unit.onClick;
                  return (
                    <div
                      key={unit.key}
                      className={cn(
                        'group relative mb-0.5 rounded-[11px] transition-colors',
                        unit.selected ? 'bg-ds-info' : interactive ? 'hover:bg-ds-info' : 'opacity-60',
                      )}
                    >
                      <button
                        type="button"
                        disabled={!interactive}
                        aria-current={unit.selected ? 'page' : undefined}
                        onClick={unit.onClick}
                        className={cn(
                          'w-full rounded-[11px] px-[10px] py-[9px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ds-accent',
                          unit.onDelete && 'pr-8',
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            'min-w-0 flex-1 truncate text-[12.5px] leading-4',
                            unit.selected ? 'font-extrabold text-white' : unit.filledDays > 0 ? 'font-semibold text-ds-info' : 'font-semibold text-ds-ink-faint',
                          )}>
                            {unit.name}
                          </span>
                          {unit.locked && <Lock className="h-2.5 w-2.5 shrink-0 text-ds-ink-muted" strokeWidth={2.6} />}
                          <span className={cn(
                            'shrink-0 text-[10px] font-extrabold tabular-nums',
                            unit.filledDays > 0 ? 'text-ds-info' : 'text-ds-accent-ink',
                          )}>
                            {unitMeta(unit)}
                          </span>
                        </div>
                        <div className="mt-[5px] h-[3px] overflow-hidden rounded-sm bg-ds-info">
                          <div
                            className={cn('h-[3px] rounded-sm', unit.selected ? 'bg-ds-accent' : unit.filledDays > 0 ? 'bg-ds-ink-faint' : 'bg-ds-info')}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <p className="mt-1 truncate text-[9.5px] font-semibold leading-3 text-ds-ink-muted">{unitDetail(unit)}</p>
                      </button>

                      {unit.onDelete && (
                        <button
                          type="button"
                          aria-label={`Excluir escala de ${unit.name}`}
                          onClick={unit.onDelete}
                          className="pointer-events-none absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md text-ds-ink-muted opacity-0 outline-none transition hover:bg-ds-info hover:text-ds-danger focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ds-accent group-hover:pointer-events-auto group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className="mt-[10px] rounded-[12px] bg-ds-info px-3 py-[11px]">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-extrabold text-ds-info">{startedCount} de {totalCount} iniciadas</span>
          <span className="text-[10.5px] font-extrabold text-ds-ink-faint">{startedPct}%</span>
        </div>
        <div className="mt-[7px] h-[5px] overflow-hidden rounded-[3px] bg-ds-info">
          <div className="h-[5px] rounded-[3px] bg-ds-accent" style={{ width: `${startedPct}%` }} />
        </div>
      </div>
    </aside>
  );
}
