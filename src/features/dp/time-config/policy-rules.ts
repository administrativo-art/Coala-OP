/**
 * Regras de tolerância e intervalo da política de hora extra. Puro: usado pelo esquema, pelo Registro de ponto e
 * pela apuração do banco. Plano: docs/planos/plano-fechamento-ponto-politica-hora-extra.md.
 */
import type { DPPolicyIntrajornada, DPPolicyTolerances } from '@/types';

/** Teto aceito em cada campo: a política não pode ser mais permissiva que isto. */
export const TOLERANCE_CEILING = { markingMinutes: 5, dailyMinutes: 10, upTo15: 1, upTo30: 2, upTo60: 5 } as const;
export const INTRAJORNADA_MIN_RATE_PERCENT = 50;

/** Modelo com que uma política nova nasce; o operador ajusta conforme CCT ou acordo individual. */
export const LEGAL_TOLERANCE_DEFAULTS: DPPolicyTolerances = {
  markingMinutes: 5, dailyMinutes: 10, breakMinutes: { upTo15: 1, upTo30: 2, upTo60: 5 },
  source: { origin: 'law', reference: 'CLT art. 58 §1º; TST Tema 14 (60 min). 15 e 30 min: regra interna proporcional.' },
};
export const LEGAL_INTRAJORNADA_DEFAULT: DPPolicyIntrajornada = {
  code: 'HEI - 50%', ratePercent: 50, source: { origin: 'law', reference: 'CLT art. 71 §4º' },
};

/**
 * Tolerância total do intervalo previsto. 15, 30 e 60 min usam a tabela da política; outro tamanho usa a
 * proporção do valor de 60 min, arredondada para baixo e limitada a ele.
 */
export function breakToleranceFor(expectedMinutes: number, tolerances: Pick<DPPolicyTolerances, 'breakMinutes'>) {
  const { upTo15, upTo30, upTo60 } = tolerances.breakMinutes;
  if (expectedMinutes <= 0) return 0;
  if (expectedMinutes === 15) return upTo15;
  if (expectedMinutes === 30) return upTo30;
  return Math.min(upTo60, Math.floor((expectedMinutes * upTo60) / 60));
}

/** Minutos a indenizar: nada dentro da tolerância; acima dela, TODO o tempo suprimido. */
export function suppressedBreakMinutes(expectedMinutes: number, takenMinutes: number, toleranceMinutes: number) {
  const missing = Math.max(0, expectedMinutes - takenMinutes);
  return missing > toleranceMinutes ? missing : 0;
}

/** Mínimo legal que nunca se desconta: 5 min por marcação, 10 no dia (CLT art. 58 §1º). */
export const LEGAL_EDGE_TOLERANCE = { markingMinutes: 5, dailyMinutes: 10 } as const;

/**
 * Entrada e saída absorvidas pela tolerância. `edges` são os minutos a mais (positivo) ou a menos (negativo) em cada
 * ponta. Fora da janela legal, tudo conta. Dentro dela, o que falta nunca é descontado, mesmo que a política seja mais
 * estreita; o que sobra só deixa de contar dentro dos limites da própria política.
 */
export function absorbedEdgeMinutes(edges: number[], policy: Pick<DPPolicyTolerances, 'markingMinutes' | 'dailyMinutes'>) {
  const total = edges.reduce((sum, value) => sum + Math.abs(value), 0);
  const largest = Math.max(0, ...edges.map(Math.abs));
  if (largest > LEGAL_EDGE_TOLERANCE.markingMinutes || total > LEGAL_EDGE_TOLERANCE.dailyMinutes) return { minutes: 0, applied: false };
  const creditsInside = total <= policy.dailyMinutes && edges.every((value) => value <= policy.markingMinutes);
  const absorbed = edges.filter((value) => value < 0 || (value > 0 && creditsInside));
  return { minutes: absorbed.reduce((sum, value) => sum + value, 0), applied: absorbed.length > 0 };
}

export type BreakReviewReason = 'no_pause' | 'fractioned' | 'long_day_on_short_shift' | 'reduced_break' | 'unsupported_shift';
export type BreakAssessment =
  | { status: 'ok' }
  | { status: 'pay'; expectedMinutes: number; minutes: number }
  | { status: 'review'; reason: BreakReviewReason };

/**
 * Intervalo do dia pela duração trabalhada (CLT art. 71): até 4h não há intervalo; até 6h, 15 min; acima, 1h. Só vira
 * pagamento automático o caso sem dúvida; o resto vai para o DP. "Até 6h" aceita os 10 min da tolerância do dia.
 */
export function assessBreak(input: {
  workedMinutes: number; pauses: number[]; plannedWorkMinutes: number | null; scheduledBreakMinutes: number;
  coverage: boolean; split: 'single' | 'multiple' | null | undefined; minPauseMinutes: number | null | undefined;
  /** Dia manual ou turno que atravessa a meia-noite: não há pagamento automático. */
  unsupported: boolean;
  tolerances: Pick<DPPolicyTolerances, 'breakMinutes'>;
}): BreakAssessment {
  const { workedMinutes: worked, pauses } = input;
  if (worked <= 240) return { status: 'ok' };
  const coverageLong = input.coverage && worked > 360;
  const overSixHours = coverageLong || worked > 360 + LEGAL_EDGE_TOLERANCE.dailyMinutes;
  const required = overSixHours ? 60 : 15;
  const tolerance = breakToleranceFor(required, input.tolerances);
  const total = pauses.reduce((sum, value) => sum + value, 0);
  const longest = Math.max(0, ...pauses);
  const multiple = input.split === 'multiple';
  const met = (taken: number) => !suppressedBreakMinutes(required, taken, tolerance);
  const shortPause = multiple && Boolean(input.minPauseMinutes) && pauses.some((value) => value < input.minPauseMinutes!);
  const whole = multiple ? total : longest;
  if (met(whole) && !shortPause) return { status: 'ok' };
  if (input.unsupported) return { status: 'review', reason: 'unsupported_shift' };
  if (!pauses.length) return { status: 'review', reason: 'no_pause' };
  if (shortPause || (!multiple && pauses.length > 1)) return { status: 'review', reason: 'fractioned' };
  if (overSixHours && !coverageLong) {
    // Turno de até 6h que se estendeu: a hora cheia depende de habitualidade. Intervalo de 30 a 59 min: pode ser redução por CCT.
    if (input.plannedWorkMinutes !== null && input.plannedWorkMinutes <= 360) return { status: 'review', reason: 'long_day_on_short_shift' };
    if (input.scheduledBreakMinutes >= 30 && input.scheduledBreakMinutes < 60) return { status: 'review', reason: 'reduced_break' };
  }
  return { status: 'pay', expectedMinutes: required, minutes: required - whole };
}
