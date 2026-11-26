/** Conversão entre os campos de texto do editor da política e as regras de tolerância e intrajornada. */
import type { DPOvertimePolicy, DPPolicyRuleSource } from '@/types';

import { INTRAJORNADA_MIN_RATE_PERCENT, LEGAL_INTRAJORNADA_DEFAULT, LEGAL_TOLERANCE_DEFAULTS, TOLERANCE_CEILING } from './policy-rules';

export const RULE_ORIGIN_LABELS: Record<DPPolicyRuleSource['origin'], string> = {
  law: 'Lei', cct: 'Convenção coletiva (CCT)', individual_agreement: 'Acordo individual', internal: 'Regra interna',
};

type SourceForm = { origin: DPPolicyRuleSource['origin']; reference: string };
export type PolicyRulesForm = {
  tolerancesEnabled: boolean;
  markingMinutes: string; dailyMinutes: string; upTo15: string; upTo30: string; upTo60: string;
  toleranceSource: SourceForm;
  intrajornadaEnabled: boolean;
  intrajornadaCode: string; intrajornadaRate: string;
  intrajornadaSource: SourceForm;
};

const sourceForm = (source: DPPolicyRuleSource): SourceForm => ({ origin: source.origin, reference: source.reference ?? '' });
const sourceOf = (form: SourceForm): DPPolicyRuleSource => ({ origin: form.origin, ...(form.reference.trim() ? { reference: form.reference.trim() } : {}) });

/** Os campos vêm preenchidos com o padrão, mas desligados: a regra só passa a valer quando o operador a liga. */
export function policyRulesFormFor(item?: Pick<DPOvertimePolicy, 'tolerances' | 'intrajornada'>): PolicyRulesForm {
  const tolerances = item?.tolerances ?? LEGAL_TOLERANCE_DEFAULTS;
  const intrajornada = item?.intrajornada ?? LEGAL_INTRAJORNADA_DEFAULT;
  return {
    tolerancesEnabled: Boolean(item?.tolerances),
    markingMinutes: String(tolerances.markingMinutes), dailyMinutes: String(tolerances.dailyMinutes),
    upTo15: String(tolerances.breakMinutes.upTo15), upTo30: String(tolerances.breakMinutes.upTo30), upTo60: String(tolerances.breakMinutes.upTo60),
    toleranceSource: sourceForm(tolerances.source),
    intrajornadaEnabled: Boolean(item?.intrajornada),
    intrajornadaCode: intrajornada.code, intrajornadaRate: String(intrajornada.ratePercent),
    intrajornadaSource: sourceForm(intrajornada.source),
  };
}

function wholeMinutes(value: string, max: number, label: string) {
  const minutes = Number(value);
  if (!value.trim() || !Number.isInteger(minutes) || minutes < 0 || minutes > max) throw new Error(`${label}: informe de 0 a ${max} minutos.`);
  return minutes;
}

/** `null` quando a seção está desligada: na edição de um rascunho, isso apaga a regra. */
export function policyRulesFromForm(form: PolicyRulesForm): { tolerances: NonNullable<DPOvertimePolicy['tolerances']> | null; intrajornada: NonNullable<DPOvertimePolicy['intrajornada']> | null } {
  if (!form.tolerancesEnabled) return { tolerances: null, intrajornada: null };
  const tolerances = {
    markingMinutes: wholeMinutes(form.markingMinutes, TOLERANCE_CEILING.markingMinutes, 'Tolerância por marcação'),
    dailyMinutes: wholeMinutes(form.dailyMinutes, TOLERANCE_CEILING.dailyMinutes, 'Limite de tolerância no dia'),
    breakMinutes: {
      upTo15: wholeMinutes(form.upTo15, TOLERANCE_CEILING.upTo15, 'Intervalo de 15 min'),
      upTo30: wholeMinutes(form.upTo30, TOLERANCE_CEILING.upTo30, 'Intervalo de 30 min'),
      upTo60: wholeMinutes(form.upTo60, TOLERANCE_CEILING.upTo60, 'Intervalo de 60 min'),
    },
    source: sourceOf(form.toleranceSource),
  };
  if (tolerances.dailyMinutes < tolerances.markingMinutes) throw new Error('O limite do dia não pode ser menor que a tolerância por marcação.');
  if (!form.intrajornadaEnabled) return { tolerances, intrajornada: null };
  const ratePercent = Number(form.intrajornadaRate);
  if (form.intrajornadaCode.trim().length < 2) throw new Error('Informe o código da hora extra intrajornada.');
  if (!Number.isFinite(ratePercent) || ratePercent < INTRAJORNADA_MIN_RATE_PERCENT) throw new Error(`O adicional da intrajornada é de pelo menos ${INTRAJORNADA_MIN_RATE_PERCENT}%.`);
  return { tolerances, intrajornada: { code: form.intrajornadaCode.trim(), ratePercent, source: sourceOf(form.intrajornadaSource) } };
}
