import type { SubjectRef } from './person-subject';
export type OnboardingPersonIdentity = { schemaVersion: 1; kind: 'natural-person'; ref: { namespace: 'hr.onboardingPersons'; id: string }; sourceLocator: { onboardingId: string; slot: 'applicant' }; provisioningLink?: { operationId: string; uid: string; hrEmployeeId: string } };
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown): value is string => typeof value === 'string' && Boolean(value) && value.length <= 180 && !value.includes('/');
/** Native intake discriminator: prefix is only a compatibility checksum after origin/workflow validation. */
export function onboardingOrigin(process: Record<string, unknown>): 'manual-natural' | 'recruitment' | 'pj-company' | 'unknown' {
  if (process.source === 'recruitment' && id(process.candidateId) && process.employmentRelationshipType !== 'pj') return 'recruitment';
  if (process.source !== 'manual' || process.applicationId !== null || process.jobOpeningId !== null) return 'unknown';
  if (process.employmentRelationshipType === 'pj') {
    const workflow = record(process.pjWorkflow), provider = record(workflow.provider);
    return workflow.version === 1 && id(process.providerCnpj) && provider.cnpj === process.providerCnpj && id(process.employerUnitId) ? 'pj-company' : 'unknown';
  }
  const snapshot = record(record(process.integrationV2).snapshot);
  return ['clt', 'apprenticeship', 'internship'].includes(String(process.employmentRelationshipType)) && id(process.jobRoleId) && id(process.functionId)
    // Native manual intake before 1ad9d0a3 persisted unitId, without employerUnitId.
    // This proves origin only; authorization still checks the native operational unit.
    && (id(process.employerUnitId) || (process.employerUnitId === undefined || process.employerUnitId === null) && id(process.unitId) && process.unitId.trim() === process.unitId) && snapshot.schemaVersion === 'coala-integration-v1' ? 'manual-natural' : 'unknown';
}
export function provenPlaceholder(process: Record<string, unknown>, candidateId: unknown): boolean {
  const origin = onboardingOrigin(process);
  return (origin === 'manual-natural' && candidateId === `manual_${process.id}`) || (origin === 'pj-company' && candidateId === `pj_${process.id}`);
}
export function readOnboardingPerson(process: Record<string, unknown>, processId: string): OnboardingPersonIdentity | null {
  const identity = record(process.personIdentity), ref = record(identity.ref), locator = record(identity.sourceLocator);
  if (onboardingOrigin(process) !== 'manual-natural' || identity.schemaVersion !== 1 || identity.kind !== 'natural-person'
    || ref.namespace !== 'hr.onboardingPersons' || typeof ref.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(ref.id)
    || ref.id === processId || locator.onboardingId !== processId || locator.slot !== 'applicant') return null;
  if (identity.provisioningLink !== undefined) {
    const link = record(identity.provisioningLink);
    if (!id(link.uid) || !id(link.hrEmployeeId) || !id(link.operationId)) return null;
  }
  return identity as OnboardingPersonIdentity;
}
export function processSubjectRef(process: Record<string, unknown>): SubjectRef | null {
  const origin = onboardingOrigin(process);
  if (origin === 'pj-company') return null;
  if (origin === 'manual-natural') return readOnboardingPerson(process, String(process.id))?.ref ?? null;
  return origin === 'recruitment' && id(process.candidateId) ? { namespace: 'hr.candidates', id: process.candidateId } : null;
}

/** Native onboarding has historically persisted the Auth UID in process.employeeId.
 * It may name only this proven UID or its reciprocal HR ID, never another alias. */
export function matchesLegacyProcessEmployeeId(value: unknown, uid: unknown, hrEmployeeId: unknown): boolean {
  return id(uid) && id(hrEmployeeId) && (value === undefined || value === null || value === uid || value === hrEmployeeId);
}

/** A missing embedded PID may be exported as context, never as a new person/patch.
 * Caller must have resolved these UID/HR refs strictly and checked workspace first. */
export function isLegacyManualAccountContext(process: Record<string, unknown>, user: Record<string, unknown> | null, refs: readonly SubjectRef[]): boolean {
  if (!user || process.personIdentity !== undefined && process.personIdentity !== null || onboardingOrigin(process) !== 'manual-natural'
    || !provenPlaceholder(process, process.candidateId) || !id(user.id) || !id(user.hrEmployeeId)
    || user.source !== 'recruitment_onboarding' || user.onboardingId !== process.id || process.collaboratorUserId !== user.id
    || !matchesLegacyProcessEmployeeId(process.employeeId, user.id, user.hrEmployeeId)
    || user.recruitmentCandidateId !== undefined && user.recruitmentCandidateId !== null && user.recruitmentCandidateId !== process.candidateId) return false;
  return !refs.some((ref) => ref.namespace === 'hr.candidates')
    && refs.some((ref) => ref.namespace === 'main.users' && ref.id === user.id)
    && refs.some((ref) => ref.namespace === 'hr.employees' && ref.id === user.hrEmployeeId);
}
