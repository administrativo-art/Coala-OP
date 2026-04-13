import {
  addYears, subDays, addDays, isBefore, isAfter,
  differenceInMonths, differenceInDays, startOfDay, parseISO,
} from 'date-fns';
import type { DPVacationRecord } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CycleStatus = 'PENDENTE' | 'AGENDADO' | 'GOZADO' | 'VENCIDO' | 'PARCIAL' | 'AQUISITIVO';
export type VacationRisk = 'VENCIDA' | 'CRITICA' | 'ATENCAO' | 'EM_DIA';

export interface VacationCycle {
  id: string;
  acquisitivePeriod: { start: Date; end: Date };
  concessivePeriod:  { start: Date; end: Date };
  status: CycleStatus;
  takenDays: number;
  balance: number;
  records: DPVacationRecord[];
  hasTakenLongPeriod: boolean;
}

export type VacationHealthStatus =
  | { status: 'CONCESSIVO'; cycleStatus: CycleStatus; details: { acquisitivePeriod: { start: Date; end: Date }; deadline: Date; progress: number; risk: VacationRisk } }
  | { status: 'AQUISITIVO'; details: { start: Date; end: Date; progress: number } }
  | { status: 'INVALIDO'; details: Record<string, never> };

// ─── Core logic (ported from Coala-DP) ───────────────────────────────────────

export function getVacationCycleHistory(
  admissionDate: Date,
  allVacationRecords: DPVacationRecord[],
): VacationCycle[] {
  const today = startOfDay(new Date());
  const cycles: VacationCycle[] = [];

  if (!admissionDate || isNaN(admissionDate.getTime())) return [];

  let cycleStartDate = startOfDay(admissionDate);

  while (isBefore(cycleStartDate, addYears(today, 1))) {
    const acquisitiveStart = cycleStartDate;
    const acquisitiveEnd   = subDays(addYears(acquisitiveStart, 1), 1);
    if (isAfter(acquisitiveStart, today)) break;

    const concessiveStart = addDays(acquisitiveEnd, 1);
    const concessiveEnd   = subDays(addYears(concessiveStart, 1), 1);
    const cycleId = `${acquisitiveStart.getFullYear()}-${concessiveStart.getFullYear()}`;

    const recordsInCycle = allVacationRecords.filter(v => v.cycleId === cycleId);
    const takenDays = recordsInCycle.reduce((t, v) => t + v.days, 0);
    const allEnjoymentRecords = recordsInCycle.filter(r => r.recordType === 'gozo' && r.endDate);
    const allEnjoyed = allEnjoymentRecords.length > 0
      && allEnjoymentRecords.every(r => isBefore(parseISO(r.endDate!), today));

    let status: CycleStatus;
    if (isAfter(today, acquisitiveEnd)) {
      if (takenDays >= 30)       status = allEnjoyed ? 'GOZADO' : 'AGENDADO';
      else if (isAfter(today, concessiveEnd)) status = 'VENCIDO';
      else if (takenDays > 0)    status = 'PARCIAL';
      else                       status = 'PENDENTE';
    } else {
      status = 'AQUISITIVO';
    }

    const hasTakenLongPeriod = recordsInCycle.some(r => r.recordType === 'gozo' && r.days >= 14);

    cycles.push({
      id: cycleId,
      acquisitivePeriod: { start: acquisitiveStart, end: acquisitiveEnd },
      concessivePeriod:  { start: concessiveStart,  end: concessiveEnd  },
      status,
      takenDays,
      balance: 30 - takenDays,
      records: recordsInCycle,
      hasTakenLongPeriod,
    });

    cycleStartDate = addYears(cycleStartDate, 1);
  }

  return cycles.reverse();
}

export function calculateVacationHealth(
  admissionDate: Date | undefined,
  allVacations: DPVacationRecord[],
): VacationHealthStatus {
  const today = startOfDay(new Date());

  if (!admissionDate || isNaN(admissionDate.getTime()) || isAfter(admissionDate, today)) {
    return { status: 'INVALIDO', details: {} };
  }

  const history = getVacationCycleHistory(admissionDate, allVacations);
  const openConcessiveCycle = history.find(c => c.status !== 'GOZADO' && c.status !== 'AQUISITIVO');

  if (openConcessiveCycle) {
    const { concessivePeriod, acquisitivePeriod, status } = openConcessiveCycle;
    const deadline = concessivePeriod.end;
    const totalDuration = differenceInDays(deadline, concessivePeriod.start);
    const elapsed = differenceInDays(today, concessivePeriod.start);
    const progress = Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));

    let risk: VacationRisk = 'EM_DIA';
    const monthsLeft = differenceInMonths(deadline, today);
    if (status === 'VENCIDO' || isAfter(today, deadline)) risk = 'VENCIDA';
    else if (monthsLeft <= 2) risk = 'CRITICA';
    else if (monthsLeft <= 5) risk = 'ATENCAO';

    return {
      status: 'CONCESSIVO',
      cycleStatus: openConcessiveCycle.status,
      details: { acquisitivePeriod: { start: acquisitivePeriod.start, end: acquisitivePeriod.end }, deadline, progress, risk },
    };
  }

  const currentAquisitiveCycle = history.find(c => c.status === 'AQUISITIVO');
  if (currentAquisitiveCycle) {
    const { start, end } = currentAquisitiveCycle.acquisitivePeriod;
    const totalDuration = differenceInDays(end, start);
    const elapsed = differenceInDays(today, start);
    const progress = Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));
    return { status: 'AQUISITIVO', details: { start, end, progress } };
  }

  return { status: 'INVALIDO', details: {} };
}

// ─── Risk helpers ─────────────────────────────────────────────────────────────

export const RISK_PROGRESS_CLASS: Record<VacationRisk, string> = {
  VENCIDA:  '[&>*]:bg-red-500',
  CRITICA:  '[&>*]:bg-orange-500',
  ATENCAO:  '[&>*]:bg-yellow-500',
  EM_DIA:   '[&>*]:bg-primary',
};

export const CYCLE_STATUS_CONFIG: Record<CycleStatus, { label: string; bg: string; text: string }> = {
  PENDENTE:   { label: 'Pendente agendamento', bg: 'bg-blue-100 dark:bg-blue-900/30',   text: 'text-blue-700 dark:text-blue-300'   },
  AGENDADO:   { label: 'Agendado',             bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
  GOZADO:     { label: 'Concluído',            bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-700 dark:text-green-300'  },
  VENCIDO:    { label: 'Vencido',              bg: 'bg-red-100 dark:bg-red-900/30',      text: 'text-red-700 dark:text-red-300'      },
  PARCIAL:    { label: 'Parcial',              bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
  AQUISITIVO: { label: 'Em Aquisição',         bg: 'bg-gray-100 dark:bg-gray-800',       text: 'text-gray-600 dark:text-gray-400'    },
};

export const CONCESSIVO_SORT_PRIORITY: Record<CycleStatus, number> = {
  VENCIDO: 0, PENDENTE: 1, PARCIAL: 2, AGENDADO: 3, GOZADO: 6, AQUISITIVO: 9,
};
