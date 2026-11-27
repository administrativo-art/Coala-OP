import 'server-only';

import type { DPOvertimePolicy } from '@/types';
import { AppError } from '@/lib/observability/app-error';

/** Activation requires a separate, reviewed rollout; drafts do not enable it. */
export function policyRulesEnabled() {
  return process.env.DP_TIME_POLICY_RULES_ENABLED?.trim() === 'true';
}

export function timeReviewEnabled() {
  return process.env.DP_TIME_REVIEW_ENABLED?.trim() === 'true';
}

/** Turno que passa da meia-noite: telas, ajustes, banco, espelho, AEJ e falta automática mudam juntos. */
export function nightShiftEnabled() {
  return process.env.DP_TIME_NIGHT_SHIFT_ENABLED?.trim() === 'true';
}

/** Turno que termina às 22h: saída dentro da tolerância não gera minuto noturno. Muda número usado na folha. */
export function nightToleranceEnabled() {
  return process.env.DP_TIME_NIGHT_TOLERANCE_ENABLED?.trim() === 'true';
}

export function activeOvertimePolicy(policy: DPOvertimePolicy): DPOvertimePolicy {
  if (policyRulesEnabled()) return policy;
  const legacy = { ...policy };
  delete legacy.tolerances;
  delete legacy.intrajornada;
  return legacy;
}

export function assertPolicyRulesPublication(policy: Record<string, unknown>) {
  if (!policyRulesEnabled() && (policy.tolerances != null || Boolean(policy.intrajornada))) {
    throw new AppError({ code: 'DP_TIME_POLICY_RULES_PENDING', kind: 'CONFLICT', reportable: false,
      safeMessage: 'As regras de tolerância e intervalo ainda aguardam liberação. Mantenha esta versão como rascunho.' });
  }
}

export function assertTimeReviewEnabled() {
  if (!timeReviewEnabled()) throw new AppError({ code: 'TIME_REVIEW_PENDING', kind: 'CONFLICT', reportable: false,
    safeMessage: 'A revisão antecipada do ponto ainda aguarda liberação.' });
}
