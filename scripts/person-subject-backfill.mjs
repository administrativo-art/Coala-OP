import { isLegacyManualAccountContext, onboardingOrigin, processSubjectRef, readOnboardingPerson } from '../src/features/privacy/onboarding-person.ts';
import { matchesPersonWorkspace } from '../src/features/privacy/person-workspace.ts';
import { censusIdentityData } from './person-census-core.mjs';
import { createReadStream, writeFileSync, readFileSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { resolveStrictPersonRefs, subjectKey } from '../src/features/privacy/person-subject.ts';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const input = args.includes('--input') ? option('--input') : null;
const reportPath = args.includes('--report') ? option('--report') : null;
const manifestPath = args.includes('--manifest') ? option('--manifest') : null;
const apply = args.includes('--apply-emulator');
if (!input || !reportPath || !manifestPath) throw new Error('Use --input <jsonl> --manifest <json> --report <json>; --apply-emulator é opcional e separado.');
if (apply && (!process.env.FIRESTORE_EMULATOR_HOST || process.env.NODE_ENV === 'production')) throw new Error('Apply permitido somente com FIRESTORE_EMULATOR_HOST fora de produção.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schema !== 1 || !['emulator-readonly', 'real-readonly', 'fixture-readonly'].includes(manifest.mode)
  || !['complete', 'incomplete'].includes(manifest.status) || !Number.isSafeInteger(manifest.rows) || manifest.rows < 0
  || !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '') || !Array.isArray(manifest.sources) || !Array.isArray(manifest.gaps)) throw new Error('Manifesto inválido.');
if (apply && (manifest.status !== 'complete' || manifest.gaps.length || manifest.mode !== 'emulator-readonly')) throw new Error('Apply exige censo emulador completo, sem lacunas.');
const contentHash = createHash('sha256');
let lineCount = 0;
for await (const chunk of createReadStream(input)) contentHash.update(chunk);
for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) if (line.trim()) lineCount++;
if (contentHash.digest('hex') !== manifest.sha256 || lineCount !== manifest.rows) throw new Error('JSONL diverge do manifesto.');
const pageSize = args.includes('--page-size') ? Number(option('--page-size')) : 100;
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('page-size inválido.');
async function* lines() {
  const stream = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  for await (const line of stream) if (line.trim()) yield JSON.parse(line);
}
function key(row) { return `${row.database}/${row.collection}/${row.id}`; }
function text(value) { return typeof value === 'string' && value && !value.includes('/') ? value : null; }
function fingerprint(value) { const canonical = (item) => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : item; return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function identityFields(collection, data) {
  if (collection === 'users') return [data?.hrEmployeeId ?? null, data?.recruitmentCandidateId ?? null, data?.source ?? null, data?.onboardingId ?? null, data?.onboardingPersonRef ?? null, data?.onboardingProvisioningId ?? null];
  if (collection === 'employees') return [data?.auth_uid ?? null, data?.source_user_id ?? null, data?.onboardingId ?? null, data?.onboardingPersonRef ?? null, data?.onboardingProvisioningId ?? null];
  if (collection === 'onboardingProcesses') return [data?.candidateId ?? null, data?.collaboratorUserId ?? null, data?.employeeId ?? null, data?.source ?? null, data?.employmentRelationshipType ?? null, data?.applicationId ?? null, data?.jobOpeningId ?? null, data?.jobRoleId ?? null, data?.functionId ?? null, data?.employerUnitId ?? null, data?.unitId ?? null, data?.integrationV2?.snapshot?.schemaVersion ?? null, data?.workspaceId ?? null, data?.workspace_id ?? null, data?.personIdentity ?? null, data?.personProvisioning ?? null];
  return [data !== null];
}
const users = new Map(); const employees = new Map(); const candidates = new Set(); const processes = new Map();
for await (const row of lines()) {
  if (!text(row.id) || !row.data || typeof row.data !== 'object') continue;
  if (row.database === 'main' && row.collection === 'users') users.set(row.id, censusIdentityData(row.data));
  if (row.database === 'hr' && row.collection === 'employees') employees.set(row.id, censusIdentityData(row.data));
  if (row.database === 'hr' && row.collection === 'candidates') candidates.add(row.id);
  if (row.database === 'hr' && row.collection === 'onboardingProcesses') processes.set(row.id, { ...censusIdentityData(row.data), id: row.id });
}
// A small, separately verified context export can enrich an existing readonly lot.
// Never reread source documents or allocate PID during this operation.
let contextEvidence = null;
if (args.includes('--context-run')) {
  const root = realpathSync(resolve('.ai-work/development-technology/person-traceability-20261103/census'));
  const directory = resolve(option('--context-run'));
  const rel = relative(root, realpathSync(directory));
  if (!rel || rel.startsWith('..') || rel.startsWith('/') || lstatSync(directory).isSymbolicLink()) throw new Error('Contexto fora do diretório privado.');
  const path = join(directory, 'census.jsonl'), metaPath = join(directory, 'manifest.json');
  for (const file of [path, metaPath]) if (lstatSync(file).isSymbolicLink() || lstatSync(file).mode & 0o077 || lstatSync(file).size > 200_000) throw new Error('Contexto deve ser pequeno e privado.');
  const raw = readFileSync(path, 'utf8'), contextManifest = JSON.parse(readFileSync(metaPath, 'utf8'));
  const rows = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (contextManifest.schema !== 1 || contextManifest.mode !== manifest.mode || contextManifest.projectId !== manifest.projectId
    || contextManifest.workspace !== manifest.workspace || !manifest.projectId || !manifest.workspace
    || contextManifest.sha256 !== createHash('sha256').update(raw).digest('hex') || contextManifest.rows !== rows.length
    || !['complete', 'incomplete'].includes(contextManifest.status) || !Array.isArray(contextManifest.gaps)
    || contextManifest.gaps.some((gap) => gap.source !== 'hr/onboardingProcesses' || gap.reason !== 'manual_person_identity_missing')
    || contextManifest.targeted?.rejected !== 0 || contextManifest.targeted?.contextOnly !== rows.length
    || rows.length < 1 || rows.length > 20) throw new Error('Manifesto de contexto inválido ou incompatível.');
  const seen = new Set();
  for (const row of rows) {
    if (row.database !== 'hr' || row.collection !== 'onboardingProcesses' || !text(row.id) || seen.has(row.id)
      || row.contextOnly !== true || row.contextReason !== 'manual_person_identity_missing'
      || !matchesPersonWorkspace(row.data, manifest.workspace, true)) throw new Error('Linha de contexto inválida.');
    seen.add(row.id);
    if (processes.has(row.id) && fingerprint(processes.get(row.id)) !== fingerprint({ ...censusIdentityData(row.data), id: row.id })) throw new Error('Contexto diverge do lote base.');
    processes.set(row.id, { ...censusIdentityData(row.data), id: row.id });
  }
  contextEvidence = { sha256: contextManifest.sha256, rows: rows.length, status: contextManifest.status, gaps: contextManifest.gaps };
}
const lookup = {
  async processById(id) { return processes.get(id) ?? null; },
  async onboardingPerson(id) { const rows = [...processes].filter(([pid, process]) => readOnboardingPerson(process, pid)?.ref.id === id); return rows.length === 1 ? { id, processId: rows[0][0], process: rows[0][1] } : null; },
  async user(id) { return users.has(id) ? { id, ...users.get(id) } : null; },
  async employee(id) { return employees.has(id) ? { id, ...employees.get(id) } : null; },
  async candidate(id) { return candidates.has(id) ? { id } : null; },
  async usersByEmployee(id) { return [...users].filter(([, value]) => value.hrEmployeeId === id).map(([uid, value]) => ({ id: uid, ...value })); },
  async employeesByUser(id) { return [...employees].filter(([, value]) => value.auth_uid === id || value.source_user_id === id).map(([employeeId, value]) => ({ id: employeeId, ...value })); },
  async processesByUser(id) { return [...processes].filter(([, value]) => value.collaboratorUserId === id).map(([processId, value]) => ({ id: processId, ...value })); },
  async processesByCandidate(id) { return [...processes].filter(([, value]) => value.candidateId === id).map(([processId, value]) => ({ id: processId, ...value })); },
};
async function refs(id) {
  if (!id) return { keys: [], reason: 'no_id' };
  const user = users.has(id); const employee = employees.has(id);
  if (!user && !employee) return { keys: [], reason: 'no_id' };
  const result = await resolveStrictPersonRefs({ namespace: user ? 'main.users' : 'hr.employees', id }, lookup);
  if (user && employee && !result.refs.some((ref) => ref.namespace === 'hr.employees' && ref.id === id)) return { keys: [], reason: 'literal_collision' };
  const origin = user ? users.get(id) : employees.get(id)?.auth_uid ? users.get(employees.get(id).auth_uid) : users.get(employees.get(id)?.source_user_id);
  if (result.conflicts.includes('candidate_not_reciprocal') && origin?.source === 'recruitment_onboarding' && text(origin.onboardingId) && !processes.has(origin.onboardingId)) {
    const independent = result.conflicts.filter((conflict) => conflict !== 'candidate_not_reciprocal');
    return { keys: [], reason: [...independent, 'onboarding_context_missing'].join(',') };
  }
  return { keys: result.refs.map(subjectKey), reason: result.conflicts.join(',') || null };
}
async function processRefs(process, allowLegacyAccountContext = false) {
  if (!process) return { keys: [], reason: 'process_missing' };
  const own = processSubjectRef(process);
  if (onboardingOrigin(process) === 'pj-company') return { keys: [], reason: 'organization_context_not_human_owner' };
  if (!own) {
    if (allowLegacyAccountContext && onboardingOrigin(process) === 'manual-natural' && text(process.collaboratorUserId)) {
      const uid = process.collaboratorUserId;
      const result = await resolveStrictPersonRefs({ namespace: 'main.users', id: uid }, lookup);
      if (result.conflicts.length) return { keys: [], reason: result.conflicts.join(',') };
      if (isLegacyManualAccountContext(process, await lookup.user(uid), result.refs)) return {
        keys: result.refs.map(subjectKey), reason: null, contextGap: 'manual_person_identity_missing',
      };
    }
    return { keys: [], reason: onboardingOrigin(process) === 'manual-natural' ? 'manual_person_identity_missing' : 'process_origin_unconfirmed' };
  }
  const result = await resolveStrictPersonRefs(own, lookup);
  const userId = text(process.collaboratorUserId);
  if (userId && !result.refs.some((ref) => ref.namespace === 'main.users' && ref.id === userId)) return { keys: [], reason: 'process_user_mismatch' };
  return { keys: result.refs.map(subjectKey), reason: result.conflicts.join(',') || null };
}

if (apply && contextEvidence) throw new Error('Contexto suplementar permitido somente em dry-run.');
const report = { mode: apply ? 'emulator-apply' : 'dry-run', contextEvidence, contextGaps: {}, censusStatus: manifest.status, censusGaps: manifest.gaps,
  globalCoverage: manifest.globalCoverage ?? 'unknown', globalGaps: manifest.globalGaps ?? [],
  censusSha256: manifest.sha256, pageSize, scanned: 0, missingId: 0, conflicts: 0, evidenceMissing: 0, frozenHistory: 0, alreadyLinked: 0, patches: [], bySource: {}, unresolvedReasons: {} };
let page = [];
async function consume(rows) {
  for (const row of rows) {
    report.scanned++;
    const source = `${row.database}/${row.collection}`;
    report.bySource[source] ??= { scanned: 0, patchable: 0, unresolved: 0 };
    report.bySource[source].scanned++;
    if (!text(row.id) || !row.data || typeof row.data !== 'object') { report.missingId++; report.bySource[source].unresolved++; continue; }
    let found = { keys: [], reason: 'unsupported_source' };
    const value = row.data;
    if (row.collection === 'hrSignatureRequests' && (value['personBinding.bindingHash'] || value.personBinding)) {
      // The signed request owns its historical binding. Current aliases cannot replace it.
      report.frozenHistory++; report.bySource[source].unresolved++; continue;
    }
    if (['generatedDocuments', 'employeeDocuments', 'hrSignatureRequests'].includes(row.collection)) {
      const explicitEmployeeId = value.employeeId !== undefined && value.employeeId !== null;
      const employeeId = text(value.employeeId);
      found = explicitEmployeeId && (!employeeId || employeeId.trim() !== employeeId)
        ? { keys: [], reason: 'employee_id_invalid' } : await refs(employeeId);
      // An explicit unresolved ID is evidence against a fallback to another process owner.
      if (explicitEmployeeId && found.reason === 'no_id') found = { keys: [], reason: 'employee_id_unresolved' };
      const processId = text(value.onboardingId) ?? text(value.sourceOnboardingId);
      if (processId && processes.has(processId) && (!explicitEmployeeId || found.keys.length > 0)) {
        const linked = await processRefs(processes.get(processId), true);
        if (linked.contextGap) report.contextGaps[linked.contextGap] = (report.contextGaps[linked.contextGap] ?? 0) + 1;
        if (found.keys.length && linked.keys.length && !found.keys.some((item) => linked.keys.includes(item))) found = { keys: [], reason: 'subject_process_mismatch' };
        else found = { keys: [...new Set([...found.keys, ...linked.keys])], reason: linked.reason ?? (linked.keys.length && !explicitEmployeeId && found.reason === 'no_id' ? null : found.reason) };
      }
    }
    if (row.collection === 'onboardingProcesses') found = await processRefs(processes.get(row.id));
    const reasons = [...new Set((found.reason ?? '').split(',').filter(Boolean))];
    const missingEvidence = ['onboarding_context_missing', 'manual_person_identity_missing', 'process_missing'];
    if (reasons.some((reason) => missingEvidence.includes(reason))) report.evidenceMissing++;
    if (reasons.some((reason) => !missingEvidence.includes(reason) && !['no_id', 'unsupported_source'].includes(reason))) report.conflicts++;
    if (!found.keys.length || found.reason && !['no_id', 'unsupported_source'].includes(found.reason)) {
      report.bySource[source].unresolved++;
      for (const reason of reasons.length ? reasons : ['unlinked']) report.unresolvedReasons[reason] = (report.unresolvedReasons[reason] ?? 0) + 1;
      continue;
    }
    const existing = Array.isArray(value.subjectKeys) ? value.subjectKeys.filter((item) => typeof item === 'string') : [];
    if (existing.some((item) => !found.keys.includes(item))) { report.conflicts++; report.bySource[source].unresolved++; continue; }
    const missing = found.keys.filter((item) => !existing.includes(item));
    if (!missing.length) { report.alreadyLinked++; continue; }
    report.bySource[source].patchable++;
    const guards = found.keys.flatMap((item) => {
      const [namespace, id] = item.split(':');
      const database = namespace === 'main.users' ? 'main' : 'hr';
      const virtual = namespace === 'hr.onboardingPersons' ? [...processes].find(([pid, process]) => readOnboardingPerson(process, pid)?.ref.id === id) : null;
      const collection = virtual ? 'onboardingProcesses' : namespace === 'main.users' ? 'users' : namespace === 'hr.employees' ? 'employees' : 'candidates';
      const actualId = virtual ? virtual[0] : id;
      const data = virtual ? virtual[1] : collection === 'users' ? users.get(id) : collection === 'employees' ? employees.get(id) : candidates.has(id) ? {} : null;
      return [{ database, collection, id: actualId, fingerprint: fingerprint(identityFields(collection, data)) }];
    });
    const processId = text(value.onboardingId) ?? text(value.sourceOnboardingId) ?? (row.collection === 'onboardingProcesses' ? row.id : null);
    const processDependencies = new Set(processId ? [processId] : []);
    for (const item of found.keys) if (item.startsWith('main.users:')) { const onboardingId = text(users.get(item.slice('main.users:'.length))?.onboardingId); if (onboardingId) processDependencies.add(onboardingId); }
    for (const id of processDependencies) if (processes.has(id)) guards.push({ database: 'hr', collection: 'onboardingProcesses', id, fingerprint: fingerprint(identityFields('onboardingProcesses', processes.get(id))) });
    report.patches.push({ database: row.database, collection: row.collection, id: row.id, expected: existing, add: missing,
      expectedOrigin: Object.fromEntries(['employeeId', 'onboardingId', 'sourceOnboardingId', 'candidateId', 'collaboratorUserId'].map((field) => [field, value[field] ?? null])), guards });
  }
}
for await (const row of lines()) { page.push(row); if (page.length >= pageSize) { await consume(page); page = []; } }
if (page.length) await consume(page);
writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
if (apply) {
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const app = initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'person-backfill-emulator' }, `person-backfill-${Date.now()}`);
  const dbIds = JSON.parse(readFileSync('config/person-backfill-emulator-databases.json', 'utf8'));
  for (const patch of report.patches) {
    for (const guard of patch.guards) {
      const identity = await getFirestore(app, dbIds[guard.database]).collection(guard.collection).doc(guard.id).get();
      if (!identity.exists || fingerprint(identityFields(guard.collection, identity.data())) !== guard.fingerprint) throw new Error(`Vínculo mudou em ${key(guard)}`);
    }
    const db = getFirestore(app, dbIds[patch.database]);
    const ref = db.collection(patch.collection).doc(patch.id);
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      const keys = current.get('subjectKeys');
      if (!current.exists || JSON.stringify(Array.isArray(keys) ? keys : []) !== JSON.stringify(patch.expected)) throw new Error(`Conflito em ${key(patch)}`);
      if (Object.entries(patch.expectedOrigin).some(([field, value]) => (current.get(field) ?? null) !== value)) throw new Error(`Origem mudou em ${key(patch)}`);
      tx.update(ref, { subjectKeys: FieldValue.arrayUnion(...patch.add) });
    });
  }
}
console.log(`${report.mode}: ${report.scanned} registros; ${report.patches.length} patches propostos; ${report.conflicts} conflitos de vínculo; ${report.evidenceMissing} evidências ausentes; relatório ${reportPath}`);
