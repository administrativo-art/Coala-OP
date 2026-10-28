import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

import type { DPVacationRecord } from '@/types';
import type { VacationCycle } from '@/lib/utils/vacation-logic';
import { cn } from '@/lib/utils';

export type BandTone = 'neutral' | 'info' | 'warn' | 'danger';

const BAND_TONE: Record<BandTone, string> = {
  neutral: 'border-ds-border bg-ds-muted text-ds-ink-2',
  info: 'border-ds-info/25 bg-ds-info-bg text-ds-info',
  warn: 'border-ds-alert-border bg-ds-alert-bg text-ds-alert-ink',
  danger: 'border-ds-confirm-border bg-ds-confirm-bg text-ds-confirm-ink',
};

/** Faixa de uma frase só, para "Hoje" e "O que fazer agora". */
export function PersonBand({ label, text, tone }: { label: string; text: string; tone: BandTone }) {
  return (
    <div className={cn('flex flex-col gap-0.5 rounded-ds-btn-lg border px-4 py-3', BAND_TONE[tone])}>
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] opacity-80">{label}</span>
      <span className="text-[14px] font-extrabold">{text}</span>
    </div>
  );
}

function enjoymentRange(record: DPVacationRecord) {
  if (!record.startDate || !record.endDate) return null;
  return { start: parseISO(record.startDate), end: parseISO(record.endDate) };
}

/**
 * A regra num desenho: 12 meses trabalhados ganham o direito; os 12 seguintes são o prazo para conceder. As parcelas
 * da pessoa aparecem sobre o prazo, e a linha escura marca hoje.
 */
export function VacationRuleTimeline({ cycle, today }: { cycle: VacationCycle; today: Date }) {
  const start = cycle.acquisitivePeriod.start;
  const end = cycle.concessivePeriod.end;
  const span = Math.max(1, differenceInCalendarDays(end, start));
  const pos = (date: Date) => Math.max(0, Math.min(100, (differenceInCalendarDays(date, start) / span) * 100));
  const urgent = cycle.balance > 0 && differenceInCalendarDays(end, today) <= 120;
  const parcels = cycle.records
    .filter(record => record.recordType === 'gozo' && record.status !== 'REJECTED')
    .flatMap(record => {
      const range = enjoymentRange(record);
      if (!range) return [];
      const left = pos(range.start);
      return [{ id: record.id, left, width: Math.max(1.2, pos(addDays(range.end, 1)) - left), done: range.end < today, label: `${format(range.start, 'dd/MM/yyyy')} a ${format(range.end, 'dd/MM/yyyy')}` }];
    });

  return (
    <section aria-label="Como o prazo funciona" className="rounded-ds-card-lg border border-ds-border bg-ds-surface px-[18px] pb-3 pt-3.5">
      <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Como o prazo funciona para esta pessoa</p>
      <div className="relative mt-8 h-[30px]">
        <span className="absolute -top-[22px] left-0 w-1/2 text-center text-[11.5px] font-extrabold text-ds-info">Ganhou o direito · 12 meses trabalhados</span>
        <span className="absolute -top-[22px] left-1/2 w-1/2 text-center text-[11.5px] font-extrabold text-ds-alert-ink">Prazo para conceder · 12 meses</span>
        <span aria-hidden="true" className="absolute left-0 top-2.5 h-2.5 w-1/2 rounded-l-full bg-ds-info-bg" />
        <span aria-hidden="true" className="absolute left-1/2 right-0 top-2.5 h-2.5 rounded-r-full bg-ds-alert-bg" />
        {parcels.map(parcel => (
          <span
            key={parcel.id}
            title={parcel.label}
            className={cn('absolute top-[5px] h-5 rounded-[5px] ring-2 ring-ds-surface', parcel.done ? 'bg-ds-ok' : 'bg-ds-info')}
            style={{ left: `${parcel.left}%`, width: `${parcel.width}%` }}
          />
        ))}
        {today >= start && today <= end ? (
          <span aria-label="Hoje" className="absolute top-0 h-[30px] w-0.5 bg-ds-dark" style={{ left: `${pos(today)}%` }} />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between font-ds-mono text-[11.5px] font-bold text-ds-ink-2">
        <span>{format(start, 'dd/MM/yyyy')}</span>
        <span>{format(cycle.concessivePeriod.start, 'dd/MM/yyyy')}</span>
        <span className={urgent ? 'text-ds-danger' : undefined}>{format(end, 'dd/MM/yyyy')}</span>
      </div>
      <p className="mt-1.5 text-[12px] text-ds-ink-muted">
        Blocos são as parcelas desta pessoa (verde já gozada, azul agendada ou em andamento). A linha escura é hoje. Tudo precisa caber até {format(end, 'dd/MM/yyyy')}.
      </p>
    </section>
  );
}
