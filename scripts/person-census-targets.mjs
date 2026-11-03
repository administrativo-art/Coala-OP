import { CENSUS_FIELDS, censusIdentityData } from './person-census-core.mjs';
import { isLegacyManualAccountContext, onboardingOrigin, processSubjectRef, provenPlaceholder, readOnboardingPerson } from '../src/features/privacy/onboarding-person.ts';
import { resolveStrictPersonRefs, subjectKey } from '../src/features/privacy/person-subject.ts';
import { FieldPath } from 'firebase-admin/firestore';

const IDENTITY_FIELDS = ['workspaceId', 'workspace_id', 'hrEmployeeId', 'recruitmentCandidateId', 'auth_uid', 'source_user_id', 'onboardingId', 'source', 'onboardingPersonRef', 'onboardingProvisioningId'];
const PROCESS_FIELDS = CENSUS_FIELDS;
const MIXED_DOCUMENTS = new Set(['main/generatedDocuments', 'hr/employeeDocuments', 'hr/hrSignatureRequests']);
import { matchesPersonWorkspace } from '../src/features/privacy/person-workspace.ts';
function safeId(value) { return typeof value === 'string' && value.length > 0 && !value.includes('/'); }
export async function projectedById(db, collection, id, fields) {
  const snap = await db.collection(collection).where(FieldPath.documentId(), '==', id).limit(1).select(...fields).get();
  return snap.docs[0] ?? null;
}

/** Reserve each query ceiling synchronously, including concurrent identity proofs.
 * Failed reads keep their full reservation because their actual cost is unknown. */
export function targetReadBudget(maxReads) {
  let charged = 0;
  return async (query, ceiling) => {
    if (!Number.isSafeInteger(ceiling) || ceiling < 1 || charged + ceiling > maxReads) throw new Error('target_read_limit');
    charged += ceiling;
    const snap = await query.get();
    const actual = Math.max(1, snap.size);
    if (actual > ceiling) throw new Error('target_read_limit');
    charged -= ceiling - actual;
    return snap;
  };
}

export async function verifyCensusTarget({ target, data, workspace, maxReads, dbFor, allowLegacyIdentity = () => false }) {
  if (!matchesPersonWorkspace(data, workspace, true)) return { ok: false, reason: 'scope_mismatch' };
  const limited = targetReadBudget(maxReads);
  const anchor = target.subject;
  const identity = (ref) => ref.namespace === 'main.users' ? ['main', 'users']
    : ['hr', ref.namespace === 'hr.employees' ? 'employees' : ref.namespace === 'hr.onboardingPersons' ? 'onboardingProcesses' : 'candidates'];
  const getIdentity = async (ref) => {
    if (ref.namespace === 'hr.onboardingPersons') {
      const snap = await limited(dbFor('hr').collection('onboardingProcesses').where('personIdentity.ref.id', '==', ref.id).limit(2).select(...PROCESS_FIELDS), 2);
      if (snap.size !== 1) return null;
      const row = snap.docs[0], process = { ...row.data(), id: row.id };
      return readOnboardingPerson(process, row.id) ? { ...process, id: ref.id, processId: row.id } : null;
    }
    const [database, collection] = identity(ref);
    const snap = await limited(dbFor(database).collection(collection).where(FieldPath.documentId(), '==', ref.id).limit(1).select(...IDENTITY_FIELDS), 1);
    const doc = snap.docs[0];
    if (doc && !matchesPersonWorkspace(doc.data(), workspace, allowLegacyIdentity(database, collection))) throw new Error('scope_mismatch');
    return doc ? { id: doc.id, ...doc.data() } : null;
  };
  const anchorDoc = await getIdentity(anchor);
  const [anchorDatabase, anchorCollection] = identity(anchor);
  if (!anchorDoc || !matchesPersonWorkspace(anchorDoc, workspace, allowLegacyIdentity(anchorDatabase, anchorCollection))) return { ok: false, reason: 'unresolved_scope' };
  const processById = async (id) => {
    const snap = await limited(dbFor('hr').collection('onboardingProcesses').where(FieldPath.documentId(), '==', id).limit(1).select(...PROCESS_FIELDS), 1);
    const row = snap.docs[0]; if (row && !matchesPersonWorkspace(row.data(), workspace, true)) throw new Error('scope_mismatch');
    return row ? { ...row.data(), id: row.id } : null;
  };
  const lookup = {
    processById,
    async onboardingPerson(id) { const owned = await getIdentity({ namespace: 'hr.onboardingPersons', id }); return owned ? { id, processId: owned.processId, process: { ...owned, id: owned.processId } } : null; },
    user: (id) => getIdentity({ namespace: 'main.users', id }),
    employee: (id) => getIdentity({ namespace: 'hr.employees', id }),
    candidate: (id) => getIdentity({ namespace: 'hr.candidates', id }),
    async usersByEmployee(id) {
      const snap = await limited(dbFor('main').collection('users').where('hrEmployeeId', '==', id).limit(2).select(...IDENTITY_FIELDS), 2);
      return snap.docs.map((doc) => { if (!matchesPersonWorkspace(doc.data(), workspace, allowLegacyIdentity('main', 'users'))) throw new Error('scope_mismatch'); return { id: doc.id, ...doc.data() }; });
    },
    async employeesByUser(id) {
      const results = [];
      for (const field of ['auth_uid', 'source_user_id']) results.push(await limited(dbFor('hr').collection('employees').where(field, '==', id).limit(2).select(...IDENTITY_FIELDS), 2));
      return [...new Map(results.flatMap((snap) => snap.docs.map((doc) => [doc.id, (() => { if (!matchesPersonWorkspace(doc.data(), workspace, allowLegacyIdentity('hr', 'employees'))) throw new Error('scope_mismatch'); return { id: doc.id, ...doc.data() }; })()]))).values()];
    },
    async processesByUser(id) {
      const snap = await limited(dbFor('hr').collection('onboardingProcesses').where('collaboratorUserId', '==', id).limit(21).select(...PROCESS_FIELDS), 21);
      if (snap.size >= 21) throw new Error('process_limit');
      return snap.docs.map((doc) => { if (!matchesPersonWorkspace(doc.data(), workspace, true)) throw new Error('scope_mismatch'); return { id: doc.id, ...doc.data() }; });
    },
    async processesByCandidate(id) {
      const snap = await limited(dbFor('hr').collection('onboardingProcesses').where('candidateId', '==', id).limit(21).select(...PROCESS_FIELDS), 21);
      if (snap.size >= 21) throw new Error('process_limit');
      return snap.docs.map((doc) => { if (!matchesPersonWorkspace(doc.data(), workspace, true)) throw new Error('scope_mismatch'); return { id: doc.id, ...doc.data() }; });
    },
  };
  const resolution = await resolveStrictPersonRefs(anchor, lookup);
  if (resolution.conflicts.length) return { ok: false, reason: 'identity_conflict' };
  for (const ref of resolution.refs) {
    const doc = await getIdentity(ref);
    const [database, collection] = identity(ref);
    if (!doc || !matchesPersonWorkspace(doc, workspace, allowLegacyIdentity(database, collection))) return { ok: false, reason: 'unresolved_scope' };
  }
  const keys = new Set(resolution.refs.map(subjectKey));
  let hasSubjectKey = false;
  if (Array.isArray(data.subjectKeys)) {
    if (data.subjectKeys.some((key) => !keys.has(key))) return { ok: false, reason: 'subject_conflict' };
    hasSubjectKey = data.subjectKeys.some((key) => keys.has(key));
  }
  const source = `${target.database}/${target.collection}`;
  if (source === 'hr/onboardingProcesses') {
    const process = { ...censusIdentityData(data), id: target.id };
    const own = processSubjectRef(process);
    if (onboardingOrigin(process) === 'pj-company') return { ok: false, reason: 'organization_context_not_human_owner' };
    if (!own && onboardingOrigin(process) === 'manual-natural') {
      const uid = process.collaboratorUserId;
      const user = typeof uid === 'string' ? await lookup.user(uid) : null;
      if (isLegacyManualAccountContext(process, user, resolution.refs)) return { ok: true, reason: 'strict_native_process_context', contextOnly: true, contextReason: 'manual_person_identity_missing' };
      return { ok: false, reason: 'manual_person_identity_missing' };
    }
    if (!own || !keys.has(subjectKey(own)) || safeId(data.collaboratorUserId) && !keys.has(`main.users:${data.collaboratorUserId}`)) return { ok: false, reason: 'process_mismatch' };
    return { ok: true, reason: 'strict_process_id' };
  }
  if (!MIXED_DOCUMENTS.has(source)) return hasSubjectKey ? { ok: true, reason: 'subjectKeys' } : { ok: false, reason: 'unsupported_legacy_target' };
  const employeeId = data.employeeId;
  if (safeId(employeeId)) {
    if (!resolution.refs.some((ref) => ref.id === employeeId)) return { ok: false, reason: 'unlinked_employeeId' };
    const [user, employee] = await Promise.all([lookup.user(employeeId), lookup.employee(employeeId)]);
    if (user && employee && (!keys.has(`main.users:${employeeId}`) || !keys.has(`hr.employees:${employeeId}`))) return { ok: false, reason: 'literal_collision' };
  } else if (!hasSubjectKey && !safeId(data.onboardingId) && !safeId(data.sourceOnboardingId)) return { ok: false, reason: 'unlinked_employeeId' };
  const processId = data.onboardingId ?? data.sourceOnboardingId;
  let processMatched = false;
  if (safeId(processId)) {
    const process = (await limited(dbFor('hr').collection('onboardingProcesses').where(FieldPath.documentId(), '==', processId).limit(1).select(...PROCESS_FIELDS), 1)).docs[0];
    if (!process || !matchesPersonWorkspace(process.data(), workspace, true)) return { ok: false, reason: 'process_mismatch' };
    const processData = process.data();
    if (safeId(processData.candidateId) && !provenPlaceholder({ ...processData, id: process.id }, processData.candidateId) && !keys.has(`hr.candidates:${processData.candidateId}`)
      || safeId(processData.collaboratorUserId) && !keys.has(`main.users:${processData.collaboratorUserId}`)) return { ok: false, reason: 'process_mismatch' };
    const processWithId = { ...processData, id: process.id }, own = processSubjectRef(processWithId);
    if (own && !keys.has(subjectKey(own))) return { ok: false, reason: 'process_mismatch' };
    if (onboardingOrigin(processWithId) === 'pj-company' && !safeId(employeeId)) return { ok: false, reason: 'organization_context_not_human_owner' };
    processMatched = Boolean(own && keys.has(subjectKey(own))) || safeId(processData.collaboratorUserId);
  }
  if (!safeId(employeeId) && !hasSubjectKey && !processMatched) return { ok: false, reason: 'unlinked_employeeId' };
  return { ok: true, reason: hasSubjectKey ? 'subjectKeys' : 'strict_legacy_id' };
}
