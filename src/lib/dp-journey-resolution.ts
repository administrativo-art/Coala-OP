import type { DPJourney, DPTimeApplicability } from '@/types';

import { applicabilitySpecificity } from './dp-time-config-rules';

export type DPJourneyResolutionTarget = {
  collaboratorId: string;
  jobRoleId?: string;
  jobFunctionIds?: string[];
  unitId?: string;
  unitIds?: string[];
  unitGroupId?: string;
  unitGroupIds?: string[];
  unitOrganizationId?: string;
  unitOrganizationIds?: string[];
};

export type DPJourneyResolvedBy =
  | 'collaborator'
  | 'function'
  | 'job_role'
  | 'unit'
  | 'unit_group'
  | 'unit_organization'
  | 'company';

export type DPJourneyResolutionCandidate = Pick<DPJourney,
  | 'id'
  | 'lineageId'
  | 'version'
  | 'status'
  | 'name'
  | 'weeklyMinutes'
  | 'cycleLengthDays'
  | 'days'
  | 'regime'
  | 'weeklyRest'
  | 'scaleValidation'
  | 'expectedBreakMinutes'
  | 'useDefinedShiftWhenShorter'
  | 'allowedShiftDefinitionIds'
  | 'applicability'
  | 'validFrom'
  | 'validTo'
>;

export type DPJourneyResolution<TJourney extends DPJourneyResolutionCandidate = DPJourney> =
  | { status: 'none'; candidates: [] }
  | { status: 'ambiguous'; candidates: TJourney[] }
  | { status: 'resolved'; journey: TJourney; resolvedBy: DPJourneyResolvedBy; candidates: TJourney[] };

function asIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry)))]
    : [];
}

function dimensionMatches(configured: string[] | undefined, actual: string[]) {
  const expected = asIds(configured);
  if (expected.length === 0) return true;
  const actualIds = new Set(actual);
  return expected.some((id) => actualIds.has(id));
}

function scopeMatches(scope: DPTimeApplicability['scope'], target: DPJourneyResolutionTarget) {
  if (scope.kind === 'company') return true;
  if (scope.kind === 'unit') return [target.unitId, ...(target.unitIds ?? [])].includes(scope.id);
  if (scope.kind === 'unit_group') return [target.unitGroupId, ...(target.unitGroupIds ?? [])].includes(scope.id);
  return [target.unitOrganizationId, ...(target.unitOrganizationIds ?? [])].includes(scope.id);
}

function applicabilityMatches(applicability: DPTimeApplicability, target: DPJourneyResolutionTarget) {
  return scopeMatches(applicability.scope, target)
    && dimensionMatches(applicability.jobRoleIds, target.jobRoleId ? [target.jobRoleId] : [])
    && dimensionMatches(applicability.jobFunctionIds, target.jobFunctionIds ?? [])
    && dimensionMatches(applicability.collaboratorIds, [target.collaboratorId]);
}

function isEffective(journey: DPJourneyResolutionCandidate, date: string) {
  if (journey.status === 'draft') return false;
  if (journey.status === 'archived' && !journey.validTo) return false;
  return journey.validFrom <= date && (!journey.validTo || journey.validTo >= date);
}

function resolvedBy(applicability: DPTimeApplicability): DPJourneyResolvedBy {
  if (asIds(applicability.collaboratorIds).length) return 'collaborator';
  if (asIds(applicability.jobFunctionIds).length) return 'function';
  if (asIds(applicability.jobRoleIds).length) return 'job_role';
  if (applicability.scope.kind === 'unit_organization') return 'unit_organization';
  if (applicability.scope.kind === 'unit_group') return 'unit_group';
  return applicability.scope.kind;
}

export function resolveDPJourney<TJourney extends DPJourneyResolutionCandidate = DPJourney>(params: {
  journeys: TJourney[];
  target: DPJourneyResolutionTarget;
  date: string;
}): DPJourneyResolution<TJourney> {
  const matches = params.journeys
    .filter((journey) => isEffective(journey, params.date) && applicabilityMatches(journey.applicability, params.target))
    .sort((left, right) => {
      const bySpecificity = applicabilitySpecificity(right.applicability).score
        - applicabilitySpecificity(left.applicability).score;
      if (bySpecificity !== 0) return bySpecificity;
      const byVersion = right.version - left.version;
      if (byVersion !== 0) return byVersion;
      return left.id.localeCompare(right.id);
    });

  if (matches.length === 0) return { status: 'none', candidates: [] };
  const topScore = applicabilitySpecificity(matches[0].applicability).score;
  const topMatches = matches.filter((journey) => applicabilitySpecificity(journey.applicability).score === topScore);
  if (topMatches.length > 1) return { status: 'ambiguous', candidates: topMatches };
  return {
    status: 'resolved',
    journey: matches[0],
    resolvedBy: resolvedBy(matches[0].applicability),
    candidates: matches,
  };
}
