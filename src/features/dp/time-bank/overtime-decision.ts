/**
 * Escolha da hora extra de cada dia pelo DP (decisão do programador de 27/11/2026, opção B): só entram as faixas da
 * política compatíveis com o tipo do dia, mais o banco quando a política permite; sem faixa compatível, o dia continua
 * em conferência. Puro: usado pela prévia, pela apuração oficial, pela rota e pela tela.
 */
import type { DPOvertimeCategory } from '@/types';

import { categoryFor, type BankDay, type BankLine, type BankLineReason, type BankPolicy } from './core';

export type OvertimeDestination = 'payroll' | 'time_bank';
export type OvertimeOption = { destination: OvertimeDestination; categoryId: string; name: string; ratePercent: number; factor?: number };
export type OvertimePart = { destination: OvertimeDestination; categoryId: string; minutes: number };
export type OvertimeDecision = {
  date: string; sourceMinutes: number; policy: { id: string; version: number }; parts: OvertimePart[];
  reason: string; decidedBy: string; decidedAt: string;
};
export type OvertimeDecisions = Record<string, OvertimeDecision>;

export type OvertimeDayView = {
  date: string; sourceMinutes: number; options: OvertimeOption[]; suggestion: OvertimeOption | null;
  decision: OvertimeDecision | null;
  /** A escolha gravada deixou de valer para o dia calculado agora. */
  outdated: string | null;
  blockedReason: string | null;
};
export type OvertimeMonthView = { enabled: boolean; competence: string; closed: boolean; closureVersion: number; revision: number; canDecide: boolean; days: OvertimeDayView[] };

// O excedente de limite diário ou semanal continua em conferência: a escolha não passa por cima do teto.
const DECIDABLE = new Set<BankLineReason>(['worked_more', 'rest_day_work', 'sunday_work', 'holiday_work', 'unplanned_work', 'pending_approval', 'needs_review']);
const isDecidable = (line: BankLine) => DECIDABLE.has(line.reason)
  && (line.nature === 'payroll_overtime' || line.nature === 'bank_credit' || line.nature === 'review');
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * Minutos trabalhados a mais, antes do fator do banco, separados do que passa do limite diário. A linha que aguarda
 * aprovação sai do cálculo sem o corte do teto, por isso ele é aplicado aqui; as demais já chegam cortadas.
 */
function splitOvertime(day: BankDay, policy: BankPolicy | null) {
  if (day.deltaMinutes === null || day.deltaMinutes <= 0) return { decidable: 0, overLimit: 0 };
  // Com o banco desligado, a linha vira conferência mas continua multiplicada: o fator é desfeito sempre que existir.
  const total = day.lines.filter(isDecidable).reduce((sum, line) => sum + (line.factor ? Math.round(line.minutes / line.factor) : line.minutes), 0);
  const limit = policy?.dailyOvertimeLimitMinutes;
  const uncapped = day.kind === 'workday' && day.lines.some((line) => line.reason === 'pending_approval');
  const decidable = uncapped && limit ? Math.min(total, limit) : total;
  return { decidable, overLimit: total - decidable };
}

/** Quanto o dia deixa o DP escolher. */
export const decidableOvertimeMinutes = (day: BankDay, policy: BankPolicy | null) => splitOvertime(day, policy).decidable;

function dayReason(day: BankDay): BankLineReason {
  if (day.kind === 'workday') return 'worked_more';
  return day.holiday ? 'holiday_work' : day.sunday ? 'sunday_work' : day.kind === 'rest_day' ? 'rest_day_work' : 'unplanned_work';
}

/** A faixa que a política aplicaria sozinha: a mesma resolução do cálculo do dia. */
function suggestedCategory(day: BankDay, policy: BankPolicy) {
  return categoryFor(policy.categories, { kind: day.kind, holiday: day.kind === 'workday' ? false : day.holiday, sunday: day.sunday, weekday: weekdayOf(day.date) });
}

function compatibleCategories(day: BankDay, policy: BankPolicy): DPOvertimeCategory[] {
  const weekday = weekdayOf(day.date);
  const matches = (category: DPOvertimeCategory) => {
    if (day.holiday || day.sunday) return (day.holiday && category.trigger === 'holiday') || (day.sunday && category.trigger === 'sunday');
    if (day.kind === 'rest_day') return category.trigger === 'rest_day';
    if (day.kind === 'no_schedule') return category.trigger === 'unplanned_work' || category.trigger === 'rest_day';
    return category.trigger === 'workday' || (category.trigger === 'specific_weekdays' && Boolean(category.weekdays?.includes(weekday)));
  };
  const suggestion = suggestedCategory(day, policy);
  const list = policy.categories.filter(matches);
  return suggestion && !list.some((item) => item.id === suggestion.id) ? [suggestion, ...list] : list;
}

export function overtimeOptions(day: BankDay, policy: BankPolicy | null): { options: OvertimeOption[]; suggestion: OvertimeOption | null } {
  if (!policy) return { options: [], suggestion: null };
  const compatible = compatibleCategories(day, policy);
  const bankEnabled = policy.timeBank.enabled;
  const options: OvertimeOption[] = compatible.flatMap((category): OvertimeOption[] => {
    if (category.destination === 'review') return [];
    if (category.destination === 'time_bank' && !bankEnabled) return [];
    return [{ destination: category.destination, categoryId: category.id, name: category.name, ratePercent: category.ratePercent,
      ...(category.destination === 'time_bank' ? { factor: category.bankCreditFactor ?? 1 } : {}) }];
  });
  const base = suggestedCategory(day, policy);
  // Banco a partir de faixa de folha só em dia útil comum. Domingo, feriado, folga e fora da escala só vão ao banco
  // quando a política declara a faixa (e o fator) com destino banco: 1 por 1 ali perderia o adicional.
  if (bankEnabled && base && base.destination === 'payroll' && day.kind === 'workday' && !day.holiday && !day.sunday
    && !options.some((option) => option.destination === 'time_bank')) {
    options.push({ destination: 'time_bank', categoryId: base.id, name: base.name, ratePercent: base.ratePercent, factor: base.bankCreditFactor ?? 1 });
  }
  const suggestion = options.find((option) => option.categoryId === base?.id && option.destination === base.destination) ?? null;
  return { options, suggestion };
}

/** Devolve o motivo de a escolha não valer para o dia calculado agora, ou nulo quando vale. */
export function decisionProblem(day: BankDay, policy: BankPolicy | null, decision: Pick<OvertimeDecision, 'sourceMinutes' | 'policy' | 'parts'>): string | null {
  if (!policy || decision.policy.id !== policy.id || decision.policy.version !== policy.version) return 'A política do dia mudou.';
  if (decision.sourceMinutes !== decidableOvertimeMinutes(day, policy)) return 'O tempo extra do dia mudou.';
  const { options } = overtimeOptions(day, policy);
  if (!decision.parts.length || decision.parts.some((part) => !Number.isInteger(part.minutes) || part.minutes <= 0
    || !options.some((option) => option.categoryId === part.categoryId && option.destination === part.destination))) return 'Há faixa ou destino que não serve para este dia.';
  if (decision.parts.reduce((total, part) => total + part.minutes, 0) !== decision.sourceMinutes) return 'A soma das partes difere do tempo extra do dia.';
  return null;
}

/**
 * Troca as linhas de hora extra do dia pelas partes escolhidas. As linhas mantêm o motivo do dia, para continuarem
 * contando nos limites semanais. Escolha que deixou de valer não paga nada sozinha: o tempo vai para conferência.
 */
export function applyOvertimeDecision(day: BankDay, policy: BankPolicy | null, decision: OvertimeDecision | undefined): BankDay {
  if (!decision) return day;
  const { decidable: current, overLimit } = splitOvertime(day, policy);
  if (!current) return day;
  const kept: BankLine[] = [...day.lines.filter((line) => !isDecidable(line)),
    ...(overLimit ? [{ nature: 'review' as const, minutes: overLimit, reason: 'daily_limit_exceeded' as const }] : [])];
  if (decisionProblem(day, policy, decision)) return { ...day, lines: [...kept, { nature: 'review', minutes: current, reason: 'decision_outdated' }] };
  const { options } = overtimeOptions(day, policy);
  const reason = dayReason(day);
  const lines = decision.parts.map((part): BankLine => {
    const option = options.find((item) => item.categoryId === part.categoryId && item.destination === part.destination)!;
    const base = { reason, categoryId: option.categoryId, ratePercent: option.ratePercent, decided: true as const };
    return part.destination === 'time_bank'
      ? { ...base, nature: 'bank_credit', minutes: Math.round(part.minutes * (option.factor ?? 1)), factor: option.factor ?? 1 }
      : { ...base, nature: 'payroll_overtime', minutes: part.minutes };
  });
  return { ...day, lines: [...kept, ...lines] };
}
