import { applicabilityOverlaps, applicabilitySpecificity } from '@/lib/dp-time-config-rules';
import type { DPAbsencePolicy, DPAbsenceType, DPTimeApplicability } from '@/types';

export type DPAbsenceResolutionTarget = {
  collaboratorId: string;
  employmentRelationshipType: 'clt' | 'apprenticeship' | 'internship' | 'pj';
  unitId?: string;
  unitGroupId?: string;
  unitOrganizationId?: string;
  jobRoleId?: string;
  jobFunctionIds?: string[];
};

function includesOrUnrestricted(values: string[] | undefined, candidates: string[]) {
  return !values?.length || candidates.some((candidate) => values.includes(candidate));
}

export function absenceApplicabilityMatches(
  applicability: DPTimeApplicability,
  target: DPAbsenceResolutionTarget,
) {
  const scopeMatches = applicability.scope.kind === 'company'
    || (applicability.scope.kind === 'unit' && applicability.scope.id === target.unitId)
    || (applicability.scope.kind === 'unit_group' && applicability.scope.id === target.unitGroupId)
    || (applicability.scope.kind === 'unit_organization' && applicability.scope.id === target.unitOrganizationId);
  return scopeMatches
    && includesOrUnrestricted(applicability.jobRoleIds, target.jobRoleId ? [target.jobRoleId] : [])
    && includesOrUnrestricted(applicability.jobFunctionIds, target.jobFunctionIds ?? [])
    && includesOrUnrestricted(applicability.collaboratorIds, [target.collaboratorId]);
}

export function absencePoliciesConflict(left: DPAbsencePolicy, right: DPAbsencePolicy) {
  const relationshipsIntersect = left.employmentRelationshipTypes.some((relationship) => (
    right.employmentRelationshipTypes.includes(relationship)
  ));
  return relationshipsIntersect
    && applicabilityOverlaps(left.applicability, right.applicability)
    && applicabilitySpecificity(left.applicability).score === applicabilitySpecificity(right.applicability).score;
}

export type DPAbsencePolicyResolution =
  | { status: 'matched'; policy: DPAbsencePolicy }
  | { status: 'not_applicable' }
  | { status: 'ambiguous'; policies: DPAbsencePolicy[] };

export function resolveAbsencePolicy(
  absenceType: Pick<DPAbsenceType, 'validFrom' | 'validTo' | 'policies'>,
  date: string,
  target: DPAbsenceResolutionTarget,
): DPAbsencePolicyResolution {
  if (target.employmentRelationshipType === 'pj') return { status: 'not_applicable' };
  const eligibleRelationship = target.employmentRelationshipType;
  if (date < absenceType.validFrom || date > (absenceType.validTo ?? '9999-12-31')) {
    return { status: 'not_applicable' };
  }
  const candidates = absenceType.policies
    .filter((policy) => policy.employmentRelationshipTypes.includes(eligibleRelationship))
    .filter((policy) => absenceApplicabilityMatches(policy.applicability, target))
    .map((policy) => ({ policy, score: applicabilitySpecificity(policy.applicability).score }))
    .sort((left, right) => right.score - left.score);
  if (!candidates.length) return { status: 'not_applicable' };
  const highest = candidates[0].score;
  const winners = candidates.filter((candidate) => candidate.score === highest).map((candidate) => candidate.policy);
  return winners.length === 1
    ? { status: 'matched', policy: winners[0] }
    : { status: 'ambiguous', policies: winners };
}
