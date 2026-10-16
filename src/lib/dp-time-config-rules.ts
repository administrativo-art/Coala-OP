import type { DPTimeApplicability } from '@/types';

function normalizeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry)))].sort()
    : [];
}

export function applicabilityScopeCollection(scope: DPTimeApplicability['scope']) {
  if (scope.kind === 'company') return null;
  if (scope.kind === 'unit') return 'dp_units' as const;
  if (scope.kind === 'unit_group') return 'dp_unitGroups' as const;
  return 'dp_unitOrganizations' as const;
}

function sameScope(left: DPTimeApplicability['scope'], right: DPTimeApplicability['scope']) {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'company' && right.kind === 'company') return true;
  return 'id' in left && 'id' in right && left.id === right.id;
}

function dimensionsIntersect(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return true;
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

export function applicabilityOverlaps(left: DPTimeApplicability, right: DPTimeApplicability) {
  return sameScope(left.scope, right.scope)
    && dimensionsIntersect(normalizeIds(left.jobRoleIds), normalizeIds(right.jobRoleIds))
    && dimensionsIntersect(normalizeIds(left.jobFunctionIds), normalizeIds(right.jobFunctionIds))
    && dimensionsIntersect(normalizeIds(left.collaboratorIds), normalizeIds(right.collaboratorIds));
}

const SCOPE_SPECIFICITY: Record<DPTimeApplicability['scope']['kind'], number> = {
  company: 0,
  unit_organization: 1,
  unit_group: 2,
  unit: 3,
};

/**
 * Precedência operacional: colaborador > função > cargo > abrangência.
 * A pontuação é estável e também permite impedir empates ambíguos na publicação.
 */
export function applicabilitySpecificity(applicability: DPTimeApplicability) {
  const collaborator = normalizeIds(applicability.collaboratorIds).length > 0 ? 1 : 0;
  const jobFunction = normalizeIds(applicability.jobFunctionIds).length > 0 ? 1 : 0;
  const jobRole = normalizeIds(applicability.jobRoleIds).length > 0 ? 1 : 0;
  const scope = SCOPE_SPECIFICITY[applicability.scope.kind];
  return {
    collaborator,
    jobFunction,
    jobRole,
    scope,
    score: collaborator * 10_000 + jobFunction * 1_000 + jobRole * 100 + scope,
  };
}

export function validityOverlaps(
  left: { validFrom: string; validTo?: string },
  right: { validFrom: string; validTo?: string },
) {
  return left.validFrom <= (right.validTo ?? '9999-12-31')
    && right.validFrom <= (left.validTo ?? '9999-12-31');
}

export function previousCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const BIZNEO_IDENTITY_FIELDS = ['code', 'name', 'bizneoTemplateId'] as const;

function comparableExternalValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function changedShiftBizneoIdentity(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  return BIZNEO_IDENTITY_FIELDS.filter((field) => (
    field in patch
    && comparableExternalValue(patch[field]) !== comparableExternalValue(current[field])
  ));
}

/**
 * A compatibilidade é a interseção das duas restrições opcionais:
 * a jornada pode limitar seus turnos e o turno pode limitar suas jornadas.
 * Lista vazia, dos dois lados, significa ausência de restrição.
 */
export function isShiftDefinitionCompatibleWithJourney(input: {
  journeyId: string;
  journeyAllowedShiftDefinitionIds?: unknown;
  shiftDefinitionId?: string | null;
  shiftJourneyIds?: unknown;
}) {
  const journeyShiftIds = normalizeIds(input.journeyAllowedShiftDefinitionIds);
  if (journeyShiftIds.length > 0 && (
    !input.shiftDefinitionId || !journeyShiftIds.includes(input.shiftDefinitionId)
  )) return false;

  const shiftJourneyIds = normalizeIds(input.shiftJourneyIds);
  if (input.shiftDefinitionId && shiftJourneyIds.length > 0 && !shiftJourneyIds.includes(input.journeyId)) {
    return false;
  }
  return true;
}
