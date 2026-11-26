import type { DPCoveragePolicy, DPJourney } from '@/types';

/**
 * Decisão da Política de jornada de cobertura para uma pessoa e uma versão de jornada, congelada no turno escrito
 * (plano de turno de cobertura). A pessoa entra se o cargo dela ou qualquer uma das funções estiver na política.
 * Sem "Usar o expediente definido no turno" a política não vale: sem turno menor não existe cobertura.
 */
export type DPCoverageDecision = {
  applies: true;
  matchedBy: 'job_role' | 'job_function';
  journeyId: string;
  journeyVersion: number;
};

const ids = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export function isCoveragePolicyActive(journey: Pick<DPJourney, 'useDefinedShiftWhenShorter' | 'coveragePolicy'>) {
  const policy = journey.coveragePolicy;
  return journey.useDefinedShiftWhenShorter !== false
    && Boolean(policy && (policy.jobRoleIds.length > 0 || policy.jobFunctionIds.length > 0));
}

export function dpCoverageDecision(
  journey: Pick<DPJourney, 'id' | 'version' | 'useDefinedShiftWhenShorter' | 'coveragePolicy'>,
  person: { jobRoleId?: unknown; jobFunctionIds?: unknown },
): DPCoverageDecision | null {
  if (!isCoveragePolicyActive(journey)) return null;
  const policy = journey.coveragePolicy as DPCoveragePolicy;
  const base = { applies: true as const, journeyId: journey.id, journeyVersion: journey.version };
  if (typeof person.jobRoleId === 'string' && policy.jobRoleIds.includes(person.jobRoleId)) return { ...base, matchedBy: 'job_role' };
  if (ids(person.jobFunctionIds).some((id) => policy.jobFunctionIds.includes(id))) return { ...base, matchedBy: 'job_function' };
  return null;
}

/** Campo a copiar para `journeyResolution` do turno; ausente quando a política não se aplica (forma antiga preservada). */
export function coverageResolutionField(reference: { coverage?: DPCoverageDecision }) {
  return reference.coverage ? { coverage: reference.coverage } : {};
}
