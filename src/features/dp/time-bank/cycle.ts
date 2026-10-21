import type { DPTimeBankCycle } from '@/types';

/**
 * Ciclo do banco de horas (plano mestre 3.10): períodos seguidos a partir do marco. Seis meses de calendário não
 * equivalem a 180 dias; por isso a unidade (mês ou dia) é guardada junto com o tamanho. Puro, usado pelo editor e
 * pelo extrato.
 */
export type CyclePreset = 'none' | 'monthly' | 'fortnight' | 'semester' | 'days180' | 'custom';

export const CYCLE_PRESETS: Record<Exclude<CyclePreset, 'none' | 'custom'>, Pick<DPTimeBankCycle, 'unit' | 'length'>> = {
  monthly: { unit: 'month', length: 1 },
  fortnight: { unit: 'day', length: 15 },
  semester: { unit: 'month', length: 6 },
  days180: { unit: 'day', length: 180 },
};

export const CYCLE_PRESET_LABELS: Record<CyclePreset, string> = {
  none: 'Sem ciclo',
  monthly: 'Mensal',
  fortnight: '15 dias',
  semester: 'Semestral (6 meses)',
  days180: '180 dias corridos',
  custom: 'Outro intervalo',
};

export const RESIDUAL_LABELS: Record<DPTimeBankCycle['residualDestination'], string> = {
  carry: 'Transportar ao próximo ciclo',
  payroll: 'Folha (pagar ou descontar)',
  review: 'Revisão do DP',
  forfeit: 'Zerar saldo negativo (positivo vai para revisão)',
};

export function presetOf(cycle: Pick<DPTimeBankCycle, 'unit' | 'length'> | null | undefined): CyclePreset {
  if (!cycle) return 'none';
  const found = (Object.entries(CYCLE_PRESETS) as Array<[CyclePreset, Pick<DPTimeBankCycle, 'unit' | 'length'>]>)
    .find(([, value]) => value.unit === cycle.unit && value.length === cycle.length);
  return found?.[0] ?? 'custom';
}

export function cycleLabel(cycle: DPTimeBankCycle | null | undefined) {
  if (!cycle) return CYCLE_PRESET_LABELS.none;
  const preset = presetOf(cycle);
  const size = preset === 'custom' ? `${cycle.length} ${cycle.unit === 'month' ? (cycle.length === 1 ? 'mês' : 'meses') : (cycle.length === 1 ? 'dia' : 'dias')}` : CYCLE_PRESET_LABELS[preset];
  return `${size} a partir de ${cycle.anchorDate.split('-').reverse().join('/')}`;
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const fromDayNumber = (value: number) => new Date(value * 86_400_000).toISOString().slice(0, 10);
function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number);
  const total = year * 12 + (month - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Período do ciclo que contém a data: início e fim inclusivos e o número do ciclo (0 = o que começa no marco). */
export function cycleOf(cycle: Pick<DPTimeBankCycle, 'unit' | 'length' | 'anchorDate'>, date: string) {
  if (cycle.unit === 'day') {
    const index = Math.floor((dayNumber(date) - dayNumber(cycle.anchorDate)) / cycle.length);
    const start = dayNumber(cycle.anchorDate) + index * cycle.length;
    return { index, start: fromDayNumber(start), end: fromDayNumber(start + cycle.length - 1) };
  }
  const [anchorYear, anchorMonth, anchorDay] = cycle.anchorDate.split('-').map(Number);
  const [year, month, day] = date.split('-').map(Number);
  const elapsed = (year - anchorYear) * 12 + (month - anchorMonth) - (day < anchorDay ? 1 : 0);
  const index = Math.floor(elapsed / cycle.length);
  const start = addMonths(cycle.anchorDate, index * cycle.length);
  return { index, start, end: fromDayNumber(dayNumber(addMonths(cycle.anchorDate, (index + 1) * cycle.length)) - 1) };
}
