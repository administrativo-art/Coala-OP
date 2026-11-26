import 'server-only';
import type { Firestore, DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { assertPayslipReconciliationManager } from './payslip-reconciliation.server';
import { readClosingSummary } from './closing-package.server';
import { sha256 } from './closure-core';
import { closingPhase } from './closing-progress';

type Dependencies = { mainDb: Firestore; hrDb: Firestore; now: () => Date; summary: typeof readClosingSummary };
async function batchRead(db: Firestore, refs: DocumentReference[], fields?: string[]) {
  const result: DocumentSnapshot[] = [];
  for (let start = 0; start < refs.length; start += 50) {
    const chunk = refs.slice(start, start + 50);
    result.push(...await (fields ? db.getAll(...chunk, { fieldMask: fields }) : db.getAll(...chunk)));
  }
  return result;
}
export async function readClosingProgress(context: ServerUserContext, competence: string, injected: Partial<Dependencies> = {}) {
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, now: () => new Date(), summary: readClosingSummary, ...injected };
  const summary = await deps.summary(context, competence, { mainDb: deps.mainDb, hrDb: deps.hrDb, now: deps.now });
  const finance = context.permissions.financial;
  let canReview = true;
  try { assertPayslipReconciliationManager(context); }
  catch (cause) { if (!(cause instanceof AppError) || cause.kind !== 'AUTHORIZATION') throw cause; canReview = false; }
  const canReadFinance = canReview && (context.isDefaultAdmin || finance?.view === true && finance.expenses?.view === true && finance.personnelCosts?.view === true);
  const capability = { canReadFinance, canWriteFinance: canReadFinance && (context.isDefaultAdmin || finance?.expenses?.edit === true) };
  if (!canReview || !summary.people.length) return { ...summary, ...capability, people: summary.people.map((person) => ({ ...person,
    phase: closingPhase({ packageStatus: person.packageStatus, overdue: person.overdue, document: false, contact: false, review: 'restricted' }) })) };
  if (summary.people.length > 450) throw new AppError({ code: 'PTRP_PROGRESS_LIMIT', kind: 'CONFLICT', safeMessage: 'O acompanhamento admite até 450 pessoas por competência.' });
  const uids = summary.people.map((person) => person.uid);
  const [users, states] = await Promise.all([
    batchRead(deps.mainDb, uids.map((uid) => deps.mainDb.collection('users').doc(uid)), ['hrEmployeeId', 'email', 'username']),
    batchRead(deps.hrDb, uids.map((uid) => deps.hrDb.collection('ptrp_payslipReconciliationState').doc(sha256([context.workspace_id, competence, uid])))),
  ]);
  const employeeIds = [...new Set(users.map((doc) => doc.get('hrEmployeeId')).filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(id)))];
  const employees = new Map((await batchRead(deps.hrDb, employeeIds.map((id) => deps.hrDb.collection('employees').doc(id)), ['auth_uid', 'source_user_id'])).map((doc) => [doc.id, doc]));
  const documents = new Map<string, DocumentSnapshot[]>();
  for (let start = 0; start < employeeIds.length; start += 30) {
    const chunk = employeeIds.slice(start, start + 30);
    const found = await deps.hrDb.collection('employeeDocuments').where('employeeId', 'in', chunk).where('caseId', '==', 'month-' + competence)
      .where('documentTypeCode', '==', 'PAYSLIP').select('employeeId', 'version', 'contentHash', 'status', 'deletedAt', 'storagePath', 'createdAt', 'uploadedAt').limit(chunk.length * 20 + 1).get();
    if (found.size > chunk.length * 20) throw new AppError({ code: 'PTRP_PROGRESS_DOCUMENT_LIMIT', kind: 'CONFLICT', safeMessage: 'Confira o histórico documental desta competência.' });
    for (const doc of found.docs) { const id = String(doc.get('employeeId')); documents.set(id, [...documents.get(id) ?? [], doc]); }
  }
  const revisionIds = [...new Set(states.map((doc) => doc.get('currentRevisionId')).filter((id): id is string => typeof id === 'string' && Boolean(id)))];
  const revisions = new Map((await batchRead(deps.hrDb, revisionIds.map((id) => deps.hrDb.collection('ptrp_payslipReconciliations').doc(id)),
    ['workspaceId', 'employeeUid', 'employeeId', 'competence', 'closureVersion', 'comparison.status', 'documentId', 'documentHash', 'documentVersion', 'releaseId', 'releaseContentHash'])).map((doc) => [doc.id, doc]));
  const releaseIds = [...new Set([...revisions.values()].map((doc) => doc.get('releaseId')).filter((id): id is string => typeof id === 'string' && Boolean(id)))];
  const releases = new Map((await batchRead(deps.hrDb, releaseIds.map((id) => deps.hrDb.collection('providerClosureReleases').doc(id)),
    ['workspaceId', 'employeeUid', 'competence', 'closureVersion', 'grantId', 'contentHash'])).map((doc) => [doc.id, doc]));
  const pointerRefs = [...releases.values()].filter((doc) => typeof doc.get('grantId') === 'string').map((doc) => deps.hrDb.collection('providerClosureAccess').doc(sha256([doc.get('grantId'), doc.get('employeeUid')])));
  const pointers = new Map((await batchRead(deps.hrDb, pointerRefs, ['workspaceId', 'employeeUid', 'releaseId'])).map((doc) => [doc.id, doc]));
  const date = (value: unknown) => typeof value === 'string' ? Date.parse(value) || 0 : value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function' ? value.toMillis() : 0;
  return { ...summary, ...capability, people: summary.people.map((person, index) => {
    const user = users[index], employeeId = user.get('hrEmployeeId'), employee = employees.get(employeeId);
    const links = employee ? [employee.get('auth_uid'), employee.get('source_user_id')].filter(Boolean) : [];
    const linked = employee?.exists && links.length > 0 && links.every((id) => id === person.uid) && users.filter((doc) => doc.get('hrEmployeeId') === employeeId).length === 1;
    const allDocs = documents.get(employeeId) ?? [];
    const active = allDocs.filter((doc) => !doc.get('deletedAt') && !['rejected', 'archived'].includes(doc.get('status')))
      .sort((a, b) => Number(b.get('version')) - Number(a.get('version')) || date(b.get('createdAt') ?? b.get('uploadedAt')) - date(a.get('createdAt') ?? a.get('uploadedAt')) || a.id.localeCompare(b.id));
    const latest = active[0];
    const revision = revisions.get(states[index].get('currentRevisionId'));
    const release = revision && releases.get(revision.get('releaseId'));
    const pointer = release && pointers.get(sha256([release.get('grantId'), person.uid]));
    let review: 'missing' | 'match' | 'divergent' | 'stale' = revision ? revision.get('comparison.status') === 'match' ? 'match' : 'divergent' : 'missing';
    const ambiguous = active[1] && active[1].get('version') === latest?.get('version') && date(active[1].get('createdAt') ?? active[1].get('uploadedAt')) === date(latest?.get('createdAt') ?? latest?.get('uploadedAt'));
    if (!linked || allDocs.length > 20 || ambiguous || revision && (revision.get('workspaceId') !== context.workspace_id || revision.get('employeeUid') !== person.uid
      || revision.get('competence') !== competence || revision.get('employeeId') !== employeeId || revision.get('closureVersion') !== summary.closure?.version
      || revision.get('documentId') !== latest?.id || revision.get('documentHash') !== latest?.get('contentHash') || revision.get('documentVersion') !== latest?.get('version')
      || !release?.exists || release.get('workspaceId') !== context.workspace_id || release.get('employeeUid') !== person.uid || release.get('competence') !== competence
      || release.get('closureVersion') !== summary.closure?.version || release.get('contentHash') !== revision.get('releaseContentHash')
      || pointer?.get('workspaceId') !== context.workspace_id || pointer.get('employeeUid') !== person.uid || pointer.get('releaseId') !== release.id)) review = 'stale';
    return { ...person, phase: closingPhase({ packageStatus: person.packageStatus, overdue: person.overdue, identity: Boolean(linked), document: Boolean(linked && latest?.get('storagePath')), contact: typeof user.get('email') === 'string' && Boolean(user.get('email').trim()) && typeof user.get('username') === 'string' && Boolean(user.get('username').trim()), review }) };
  }) };
}
