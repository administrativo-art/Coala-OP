import { createHash } from 'node:crypto';
import { matchesPersonWorkspace } from '../src/features/privacy/person-workspace.ts';

// A deliberately small projection. Never spread a Firestore document into an export row.
export const CENSUS_FIELDS = [
  'source', 'employmentRelationshipType', 'applicationId', 'jobOpeningId', 'jobRoleId', 'functionId', 'employerUnitId',
  'integrationV2.snapshot.schemaVersion', 'pjWorkflow.version', 'providerCnpj', 'pjWorkflow.provider.cnpj',
  'personOrigin.schemaVersion', 'personOrigin.kind', 'personIdentity.schemaVersion', 'personIdentity.kind', 'personIdentity.ref.namespace', 'personIdentity.ref.id',
  'personIdentity.sourceLocator.onboardingId', 'personIdentity.sourceLocator.slot', 'personIdentity.provisioningLink.operationId', 'personIdentity.provisioningLink.uid', 'personIdentity.provisioningLink.hrEmployeeId',
  'onboardingPersonRef.namespace', 'onboardingPersonRef.id', 'onboardingProvisioningId',
  'personProvisioning.schemaVersion', 'personProvisioning.operationId', 'personProvisioning.uid', 'personProvisioning.hrEmployeeId', 'personProvisioning.origin', 'personProvisioning.state', 'personProvisioning.subjectRef.namespace', 'personProvisioning.subjectRef.id',
  'workspaceId', 'workspace_id', 'unitId', 'unitIds', 'version', 'updatedAt',
  'employeeId', 'userId', 'auth_uid', 'source_user_id', 'hrEmployeeId',
  'recruitmentCandidateId', 'candidateId', 'collaboratorUserId', 'onboardingId',
  'sourceOnboardingId', 'subjectKeys', 'signerKeys', 'actorKeys', 'partyKeys', 'beneficiaryUid', 'employeeUid',
  'personBinding.schemaVersion', 'personBinding.requestId', 'personBinding.subjectKeys', 'personBinding.partyKeys', 'personBinding.bindingHash',
  'sourceGeneratedVersion', 'sourceGeneratedHash', 'sourceGeneratedDocumentId', 'generatedDocumentId',
  'sourceType', 'beneficiaryReference.sourceType', 'beneficiaryReference.sourceId',
  'toHolder.holderId', 'toHolder.holderType', 'metadata.target_id', 'metadata.target_type',
  'purpose', 'terminationId', 'scheduleId', 'revisionId', 'competence',
];
export const safeIdentifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) && !/^\d{11}(\d{3})?$/.test(value);
const safeSegment = safeIdentifier;
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function projectCensusData(raw) {
  const result = {};
  for (const path of CENSUS_FIELDS) {
    const parts = path.split('.');
    const value = parts.reduce((item, part) => item?.[part], raw);
    if (value === null && ['applicationId', 'jobOpeningId'].includes(path)) { result[path] = null; continue; }
    if (value === undefined || value === null) continue;
    if (['providerCnpj', 'pjWorkflow.provider.cnpj'].includes(path)) { if (typeof value === 'string' && /^\d{14}$/.test(value)) result[`${path}Hash`] = sha256(value); continue; }
    if (path.endsWith('.namespace')) { if (['main.users', 'hr.employees', 'hr.candidates', 'hr.onboardingPersons'].includes(value)) result[path] = value; continue; }
    if (typeof value === 'string' && (path === 'updatedAt' ? /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/.test(value) : safeIdentifier(value))) result[path] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) result[path] = value;
    else if (Array.isArray(value) && value.length <= 100 && value.every((item) =>
      ['subjectKeys', 'signerKeys', 'actorKeys', 'partyKeys', 'personBinding.subjectKeys', 'personBinding.partyKeys'].includes(path)
        ? /^(main\.users|hr\.employees|hr\.candidates|hr\.onboardingPersons):[A-Za-z0-9_-]{1,200}$/.test(item)
        : safeIdentifier(item))) result[path] = value;
    else if (path === 'updatedAt' && typeof value.toDate === 'function') result[path] = value.toDate().toISOString();
  }
  return result;
}
/** Rebuild only the whitelisted metadata for StrictCore, never names/contact/content. */
export function censusIdentityData(data) {
  const result = {};
  for (const [path, value] of Object.entries(data ?? {})) {
    const target = path === 'providerCnpjHash' ? 'providerCnpj' : path === 'pjWorkflow.provider.cnpjHash' ? 'pjWorkflow.provider.cnpj' : path;
    const parts = target.split('.'); let node = result;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts.at(-1)] = value;
  }
  return result;
}
export function assertCensusProjection(raw, projected) {
  const fields = ['employeeId', 'userId', 'auth_uid', 'source_user_id', 'hrEmployeeId', 'recruitmentCandidateId',
    'candidateId', 'collaboratorUserId', 'onboardingId', 'sourceOnboardingId', 'subjectKeys', 'signerKeys', 'actorKeys', 'partyKeys',
    'personBinding.subjectKeys', 'personBinding.partyKeys'];
  for (const field of fields) {
    const value = field.split('.').reduce((item, part) => item?.[part], raw);
    if (value === undefined || value === null) continue;
    const references = field.endsWith('Keys');
    if (references ? !Array.isArray(value) : !safeIdentifier(value)) throw new Error('projection_invalid');
    if (projected[field] === undefined) throw new Error('projection_invalid');
  }
  for (const [value, prefix] of [[raw?.onboardingPersonRef, 'onboardingPersonRef'], [raw?.personIdentity?.ref, 'personIdentity.ref']]) {
    if (value !== undefined && value !== null && (!value || typeof value !== 'object' || Array.isArray(value) || !projected[`${prefix}.namespace`] || !projected[`${prefix}.id`])) throw new Error('projection_invalid');
  }
  if (raw?.personBinding !== undefined && raw.personBinding !== null && projected['personBinding.bindingHash'] === undefined) throw new Error('projection_invalid');
}

// One query per explicit workspace field. Documents without either field require a separate,
// evidence-backed ID/parent traversal; they are never silently treated as this tenant.
export async function censusSource({ db, database, collection, workspace, scopeField, pageSize, maxReads, maxPages, onRow }) {
  if (![database, collection, workspace, scopeField].every(safeSegment) || !['workspaceId', 'workspace_id'].includes(scopeField)) throw new Error('Invalid census scope');
  const result = { database, collection, scopeField, status: 'incomplete', scanned: 0, pages: 0, lastId: null, reason: null };
  let cursor = null;
  try {
    for (;;) {
      if (result.pages >= maxPages || result.scanned >= maxReads) { result.reason = 'limit_reached'; break; }
      const remaining = maxReads - result.scanned;
      const size = Math.min(pageSize, remaining);
      let query = db.collection(collection).where(scopeField, '==', workspace).orderBy('__name__').limit(size);
      if (cursor) query = query.startAfter(cursor);
      // Query projection prevents retrieval of document bodies and sensitive nested objects.
      const snap = await query.select(...CENSUS_FIELDS).get();
      result.pages++;
      if (!snap.docs.length) { result.status = 'complete'; break; }
      for (const doc of snap.docs) {
        if (!safeSegment(doc.id) || doc.id === cursor || (cursor && doc.id <= cursor)) throw new Error('cursor_repeated');
        const raw = doc.data();
        if (!matchesPersonWorkspace(raw, workspace) || raw[scopeField] !== workspace) throw new Error('scope_mismatch');
        const data = projectCensusData(raw);
        assertCensusProjection(raw, data);
        if (data[scopeField] !== workspace) throw new Error('scope_mismatch');
        await onRow({ database, collection, id: doc.id, data, scopeEvidence: 'explicit-workspace' });
        result.scanned++;
        cursor = doc.id;
        result.lastId = cursor;
      }
      if (snap.docs.length < size) { result.status = 'complete'; break; }
    }
  } catch (error) {
    result.reason = ['cursor_repeated', 'scope_mismatch', 'projection_invalid'].includes(error?.message) ? error.message : 'read_failed';
  }
  return result;
}

/** Full ID-ordered scan is allowed only for a caller-verified deployment-global source. */
export async function censusLegacyDeploymentSource({ db, database, collection, workspace, pageSize, maxReads, maxPages, onRow }) {
  const result = { database, collection, scopeField: 'legacy-deployment', status: 'incomplete', scanned: 0, emitted: 0, pages: 0, lastId: null, reason: null };
  let cursor = null;
  try {
    for (;;) {
      if (result.pages >= maxPages || result.scanned >= maxReads) { result.reason = 'limit_reached'; break; }
      const size = Math.min(pageSize, maxReads - result.scanned);
      let query = db.collection(collection).orderBy('__name__').limit(size);
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.select(...CENSUS_FIELDS).get();
      result.pages++;
      if (!snap.docs.length) { result.status = 'complete'; break; }
      for (const doc of snap.docs) {
        if (!safeSegment(doc.id) || cursor && doc.id <= cursor) throw new Error('cursor_repeated');
        const raw = doc.data();
        if (!matchesPersonWorkspace(raw, workspace, true)) throw new Error('scope_mismatch');
        const explicit = raw.workspaceId !== undefined && raw.workspaceId !== null || raw.workspace_id !== undefined && raw.workspace_id !== null;
        const data = projectCensusData(raw);
        assertCensusProjection(raw, data);
        await onRow({ database, collection, id: doc.id, data, scopeEvidence: explicit ? 'explicit-workspace' : 'legacy-deployment' });
        result.emitted++;
        result.scanned++; cursor = doc.id; result.lastId = cursor;
      }
      if (snap.docs.length < size) { result.status = 'complete'; break; }
    }
  } catch (error) {
    result.reason = ['cursor_repeated', 'scope_mismatch', 'projection_invalid'].includes(error?.message) ? error.message : 'read_failed';
  }
  return result;
}
