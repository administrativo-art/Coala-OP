"use client";

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type DPScheduleRestSummaryRow = {
  userId: string;
  name: string;
  journeyName: string;
  /** false quando a jornada não tem regra de distribuição resolvida para o mês. */
  resolved: boolean;
  granted: number;
  required: number | null;
  /** Datas já formatadas (dd/MM). */
  dates: string[];
  /** Linhas de apoio: próximo prazo e semanas abaixo da meta. */
  notes: Array<{ text: string; tone: 'info' | 'warn' | 'muted' }>;
  published?: { version: number | undefined; text: string; dates: string[] } | null;
};

function isShort(row: DPScheduleRestSummaryRow) {
  return row.resolved && row.required !== null && row.granted < row.required;
}

function firstName(name: string) {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export function DPScheduleRestSummary({
  competenceLabel,
  rows,
  unresolvedMessage,
}: {
  competenceLabel: string;
  rows: DPScheduleRestSummaryRow[];
  unresolvedMessage: string;
}) {
  const hasUnresolved = rows.some((row) => !row.resolved);

  return (
    <section className="mb-3 rounded-[14px] border border-ds-border bg-ds-surface px-4 py-3.5" aria-label="Conferência de repousos da escala">
      <h2 className="text-[13px] font-extrabold text-ds-ink">Repousos · {competenceLabel}</h2>
      <ul className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
        {rows.map((row) => (
          <li key={row.userId}>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Ver repousos de ${row.name}`}
                  className="text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2"
                >
                  <span className={cn('block text-[26px] font-black leading-none tabular-nums', isShort(row) ? 'text-ds-warn' : 'text-ds-ink')}>
                    {row.granted}
                    {row.required !== null ? <span className="text-[13px] font-bold text-ds-ink-faint">/{row.required}</span> : null}
                  </span>
                  <span className="mt-1 block text-[11.5px] font-semibold text-ds-ink-muted">{firstName(row.name)}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-3 text-xs" align="start" sideOffset={8}>
                <p className="font-bold text-ds-ink">{row.name}</p>
                <p className="mt-0.5 text-ds-ink-muted">{row.journeyName}</p>
                <p className="mt-2 text-ds-ink-2">
                  {row.dates.length ? row.dates.join(', ') : 'Nenhuma folga lançada neste mês'}
                </p>
                {row.notes.map((note) => (
                  <p
                    key={note.text}
                    className={cn('mt-1', note.tone === 'warn' ? 'font-bold text-ds-warn' : note.tone === 'info' ? 'font-semibold text-ds-info' : 'text-ds-ink-muted')}
                  >
                    {note.text}
                  </p>
                ))}
                {!row.resolved ? <p className="mt-1 text-ds-warn">Sem regra de distribuição resolvida: meta e prazo não conferidos.</p> : null}
                {row.published ? (
                  <p className="mt-2 rounded-ds-md bg-ds-info-bg px-2 py-1 text-ds-info">
                    <span className="font-bold">Publicação v{row.published.version}: </span>{row.published.text}
                    {row.published.dates.length ? ` · ${row.published.dates.join(', ')}` : ''}
                  </p>
                ) : null}
              </PopoverContent>
            </Popover>
          </li>
        ))}
      </ul>
      {hasUnresolved ? <p className="mt-3 text-[11.5px] font-semibold text-ds-warn">{unresolvedMessage}</p> : null}
    </section>
  );
}
