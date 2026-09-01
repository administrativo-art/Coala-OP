import {
  addYears, subDays, addDays, isBefore, isAfter,
  differenceInMonths, differenceInDays, startOfDay, parseISO,
} from 'date-fns';
import type { DPVacationRecord, DPVacationStatus } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CycleStatus = 'PENDENTE' | 'AGUARDANDO_APROVACAO' | 'AGENDADO' | 'GOZADO' | 'VENCIDO' | 'PARCIAL' | 'AQUISITIVO';
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
  referenceDate: Date = new Date(),
): VacationCycle[] {
  const today = startOfDay(referenceDate);
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

    const recordsInCycle = allVacationRecords.filter(v => v.cycleId === cycleId && v.status !== 'REJECTED');
    const takenDays = recordsInCycle.reduce((t, v) => t + v.days, 0);
    const allEnjoymentRecords = recordsInCycle.filter(r => r.recordType === 'gozo' && r.endDate);
    const hasPendingApproval = recordsInCycle.some(r => r.status !== 'APPROVED');
    const hasPeriodOutsideDeadline = allEnjoymentRecords.some(r => isAfter(parseISO(r.endDate!), concessiveEnd));
    const allEnjoyed = recordsInCycle.length > 0
      && !hasPendingApproval
      && allEnjoymentRecords.length > 0
      && allEnjoymentRecords.every(r => isBefore(parseISO(r.endDate!), today));

    let status: CycleStatus;
    if (isAfter(today, acquisitiveEnd)) {
      if (takenDays >= 30 && allEnjoyed && !hasPeriodOutsideDeadline) status = 'GOZADO';
      else if (isAfter(today, concessiveEnd) || hasPeriodOutsideDeadline) status = 'VENCIDO';
      else if (takenDays >= 30 && hasPendingApproval) status = 'AGUARDANDO_APROVACAO';
      else if (takenDays >= 30) status = 'AGENDADO';
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
  referenceDate: Date = new Date(),
): VacationHealthStatus {
  const today = startOfDay(referenceDate);

  if (!admissionDate || isNaN(admissionDate.getTime()) || isAfter(admissionDate, today)) {
    return { status: 'INVALIDO', details: {} };
  }

  const history = getVacationCycleHistory(admissionDate, allVacations, today);
  const openConcessiveCycle = history.find(c => c.status !== 'GOZADO' && c.status !== 'AQUISITIVO');

  if (openConcessiveCycle) {
    const { concessivePeriod, acquisitivePeriod, status } = openConcessiveCycle;
    const deadline = concessivePeriod.end;
    const totalDuration = differenceInDays(deadline, concessivePeriod.start);
    const elapsed = differenceInDays(today, concessivePeriod.start);
    const progress = Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));

    let risk: VacationRisk = 'EM_DIA';
    const monthsLeft = differenceInMonths(deadline, today);
    if (status === 'AGENDADO') risk = 'EM_DIA';
    else if (status === 'VENCIDO' || isAfter(today, deadline)) risk = 'VENCIDA';
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
  PENDENTE:   { label: 'Pendente de gozo',     bg: 'bg-blue-100 dark:bg-blue-900/30',     text: 'text-blue-700 dark:text-blue-300'   },
  AGUARDANDO_APROVACAO: { label: 'Aguardando aprovação', bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300' },
  AGENDADO:   { label: 'Gozo agendado',        bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
  GOZADO:     { label: 'Concluído',            bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-700 dark:text-green-300'  },
  VENCIDO:    { label: 'Vencido',              bg: 'bg-red-100 dark:bg-red-900/30',      text: 'text-red-700 dark:text-red-300'      },
  PARCIAL:    { label: 'Parcial',              bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
  AQUISITIVO: { label: 'Em aquisição',         bg: 'bg-gray-100 dark:bg-gray-800',       text: 'text-gray-600 dark:text-gray-400'    },
};

export const CONCESSIVO_SORT_PRIORITY: Record<CycleStatus, number> = {
  VENCIDO: 0, PENDENTE: 1, PARCIAL: 2, AGUARDANDO_APROVACAO: 3, AGENDADO: 4, GOZADO: 6, AQUISITIVO: 9,
};

// ─── Raw color tokens (for conic rings / timeline bars that need real values) ──
// Semantic Tailwind classes cover badges/borders; these are only for the few
// spots (progress rings, absolutely-positioned timeline bars) that need a hex.

export const RISK_HEX: Record<VacationRisk, { fg: string; bg: string; label: string }> = {
  VENCIDA: { fg: '#DC2626', bg: 'rgba(239,68,68,0.13)',  label: 'Vencida' },
  CRITICA: { fg: '#C2410C', bg: 'rgba(249,115,22,0.15)', label: 'Crítica' },
  ATENCAO: { fg: '#A16207', bg: 'rgba(234,179,8,0.16)',  label: 'Atenção' },
  EM_DIA:  { fg: '#15803D', bg: 'rgba(34,197,94,0.14)',  label: 'Em dia' },
};

export const VACATION_STATUS_HEX: Record<DPVacationStatus, { fg: string; bg: string; label: string }> = {
  APPROVED: { fg: '#15803D', bg: 'rgba(34,197,94,0.14)',  label: 'Aprovada' },
  PLANNED:  { fg: '#1D4ED8', bg: 'rgba(59,130,246,0.12)', label: 'Planejada' },
  PENDING:  { fg: '#A16207', bg: 'rgba(234,179,8,0.16)',  label: 'Pendente' },
  REJECTED: { fg: '#DC2626', bg: 'rgba(239,68,68,0.13)',  label: 'Rejeitada' },
};

/** Risk classification for a single cycle (not just the worst open one). */
export function getCycleRisk(cycle: VacationCycle, today: Date = startOfDay(new Date())): VacationRisk {
  if (cycle.status === 'AGENDADO' || cycle.status === 'GOZADO') return 'EM_DIA';
  if (cycle.status === 'VENCIDO' || isAfter(today, cycle.concessivePeriod.end)) return 'VENCIDA';
  const monthsLeft = differenceInMonths(cycle.concessivePeriod.end, today);
  if (monthsLeft <= 2) return 'CRITICA';
  if (monthsLeft <= 5) return 'ATENCAO';
  return 'EM_DIA';
}

/** How far along the concessive window a cycle is (0–100). */
export function getCycleProgress(cycle: VacationCycle, today: Date = startOfDay(new Date())): number {
  const total = differenceInDays(cycle.concessivePeriod.end, cycle.concessivePeriod.start);
  if (total <= 0) return 100;
  const elapsed = differenceInDays(today, cycle.concessivePeriod.start);
  return Math.max(0, Math.min(100, (elapsed / total) * 100));
}
