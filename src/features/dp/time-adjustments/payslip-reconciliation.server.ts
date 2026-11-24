import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { ServerUserContext } from '@/lib/auth-server';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { AppError } from '@/lib/observability/app-error';
import { resolveUnitAccess } from '@/lib/unit-access';
import { readStaffClosureRelease } from '@/features/service-portal/closure-server';
import type { ProviderClosureRelease, ClosureReleaseDependencies } from '@/features/service-portal/closure-types';
import { assertClosureAccess } from './closure.server';
import { canReview, closureKey } from './service.server';
import { sha256 } from './closure-core';
import { isOverdue } from './closing-package';
import {
  comparePayslipQuantities, PAYSLIP_RECONCILIATION_SCOPE, payslipReconciliationQuerySchema,
  payslipReconciliationPreviewSchema, payslipReconciliationSubmitSchema, reconciliationDocumentSchema,
  type PayslipComparison, type ReconciliationPreviewInput, type ReconciliationSubmitInput, type PayslipReconciliationStamp,
} from './payslip-reconciliation';

type Query = { competence: string; employeeUid: string };
export type ReconciliationDocument = { id: string; name: string; employeeId: string; version: number; sha256: string; storagePath: string; createdAt: number };
export type PayslipReconciliationRevision = Query & {
  id: string; workspaceId: string; employeeId: string; releaseId: string; releaseContentHash: string;
  releaseSourceHash: string; releaseEmploymentProofHash: string; closureVersion: number;
  documentId: string; documentHash: string; documentVersion: number; documentStoragePath: string;
  requestId: string; requestHash: string; inputHash: string; input: ReconciliationPreviewInput;
  comparison: PayslipComparison; createdAt: string; createdBy: string;
};
export type ReconciliationLease = { id: string; until: string; reconciliationId: string; inputHash: string };
type ReconciliationState = Query & { id: string; workspaceId: string; employeeId: string; version: number;
  currentRevisionId: string; updatedAt: string; updatedBy: string; sendingLease?: ReconciliationLease | null };
export type PayslipReconciliationDependencies = {
  mainDb: Firestore; hrDb: Firestore; now: () => Date; randomId: () => string;
  readStorage: (path: string) => Promise<Buffer>;
  readRelease: (context: ServerUserContext, releaseId: string, tx?: Transaction) => Promise<ProviderClosureRelease>;
  releaseDependencies?: Partial<ClosureReleaseDependencies>;
};
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const LEASE_MS = 10 * 60_000;
const defaults: Omit<PayslipReconciliationDependencies, 'readRelease'> = {
  mainDb: dbAdmin, hrDb: hrDbAdmin, now: () => new Date(), randomId: randomUUID,
  async readStorage(path) { return (await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download())[0]; },
};
function dependencies(injected: Partial<PayslipReconciliationDependencies>) {
  const deps = { ...defaults, ...injected };
  const readRelease = injected.readRelease ?? ((context: ServerUserContext, releaseId: string, tx?: Transaction) => readStaffClosureRelease(context, releaseId,
    { mainDb: deps.mainDb, hrDb: deps.hrDb, now: deps.now, readStorage: deps.readStorage, ...deps.releaseDependencies }, tx));
  return { ...deps, readRelease };
}
function failure(message: string, kind: 'CONFLICT' | 'AUTHORIZATION' | 'NOT_FOUND' = 'CONFLICT') {
  return new AppError({ code: 'PTRP_PAYSLIP_RECONCILIATION_REQUIRED', kind, safeMessage: message });
}
export function assertPayslipReconciliationManager(context: ServerUserContext) {
  assertClosureAccess(context, 'close');
  if (context.viewAs || !canReview(context) || !resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin }).allUnits) throw failure('A conferência exige revisão e fechamento do RH com acesso a todas as unidades.', 'AUTHORIZATION');
}
const stateKey = (workspaceId: string, query: Query) => sha256([workspaceId, query.competence, query.employeeUid]);
const stateRef = (db: Firestore, workspaceId: string, query: Query) => db.collection('ptrp_payslipReconciliationState').doc(stateKey(workspaceId, query));
const revisions = (db: Firestore) => db.collection('ptrp_payslipReconciliations');
const audits = (db: Firestore) => db.collection('ptrp_payslipReconciliationAudit');
const packageVersionRef = (db: Firestore, workspaceId: string, query: Query, version: number) => reconciliationClosures(db)
  .doc(closureKey(workspaceId, query.competence)).collection('versions').doc(String(version));
function packageRef(db: Firestore, workspaceId: string, query: Query, version: number) { return reconciliationPackages(packageVersionRef(db, workspaceId, query, version)).doc(query.employeeUid); };
const LEGACY_CLOSURES = 'ptrp_competenceClosures';
const LEGACY_PEOPLE = 'people';
const LEGACY_PACKAGES = 'packages';
function reconciliationClosures(db: Firestore) { return db.collection(LEGACY_CLOSURES); }
function reconciliationPeople(ref: DocumentReference) { return ref.collection(LEGACY_PEOPLE); }
function reconciliationPackages(ref: DocumentReference) { return ref.collection(LEGACY_PACKAGES); }
function bytesHash(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
function dateValue(value: unknown) {
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}
async function employeeIdFor(deps: PayslipReconciliationDependencies, context: ServerUserContext, query: Query, tx?: Transaction) {
  const user = await deps.mainDb.collection('users').doc(query.employeeUid).get();
  const employeeId = user.get('hrEmployeeId');
  if (!user.exists || typeof employeeId !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(employeeId)) throw failure('Confira o vínculo do colaborador com o cadastro RH.');
  const ref = deps.hrDb.collection('employees').doc(employeeId);
  const employee = await (tx ? tx.get(ref) : ref.get());
  const links = [employee.get('auth_uid'), employee.get('source_user_id')].filter((value) => typeof value === 'string' && value);
  if (!employee.exists || !links.length || links.some((value) => value !== query.employeeUid)) throw failure('O cadastro RH não confirma o titular do contracheque.');
  return employeeId;
}
async function documentCandidates(deps: PayslipReconciliationDependencies, employeeId: string, competence: string, tx?: Transaction) {
  const query = deps.hrDb.collection('employeeDocuments').where('employeeId', '==', employeeId).where('documentTypeCode', '==', 'PAYSLIP')
    .where('caseId', '==', 'month-' + competence).limit(21);
  const docs = await (tx ? tx.get(query) : query.get());
  if (docs.size > 20) throw failure('Há mais documentos que a consulta comporta. Confira os contracheques desta competência.');
  return docs.docs.filter((doc) => !doc.get('deletedAt') && !['rejected', 'archived'].includes(doc.get('status')))
    .map((doc): ReconciliationDocument => ({ id: doc.id, name: typeof doc.get('displayName') === 'string' ? doc.get('displayName') : 'Contracheque', employeeId,
      version: Number(doc.get('version')), sha256: doc.get('contentHash'), storagePath: doc.get('storagePath'), createdAt: dateValue(doc.get('createdAt') ?? doc.get('uploadedAt')) }))
    .sort((left, right) => right.version - left.version || right.createdAt - left.createdAt || left.id.localeCompare(right.id));
}
function latestDocument(documents: ReconciliationDocument[], documentId: string, hash: string) {
  const selected = documents.find((doc) => doc.id === documentId);
  const latest = documents[0];
  if (!selected || latest?.id !== selected.id || latest.sha256 !== hash) throw failure('Selecione o contracheque ativo mais recente e confira seu arquivo.');
  if (documents[1] && documents[1].version === latest.version && documents[1].createdAt === latest.createdAt) throw failure('Há contracheques ativos sem ordem de versão definida. Confira o cadastro documental.');
  if (!Number.isSafeInteger(selected.version) || selected.version < 1 || typeof selected.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(selected.sha256)
    || typeof selected.storagePath !== 'string' || !selected.storagePath) throw failure('O contracheque não tem versão e hash válidos.');
  return selected;
}
async function validateRelease(deps: PayslipReconciliationDependencies, context: ServerUserContext, query: Query, releaseId: string, tx?: Transaction) {
  const release = await deps.readRelease(context, releaseId, tx);
  if (release.workspaceId !== context.workspace_id || release.employeeUid !== query.employeeUid || release.competence !== query.competence
    || release.contentHash !== sha256(release.content)) throw failure('A entrega não corresponde à pessoa e à competência desta conferência.');
  return release;
}
async function selectedSource(deps: PayslipReconciliationDependencies, context: ServerUserContext, input: ReconciliationPreviewInput, tx?: Transaction) {
  const release = await validateRelease(deps, context, input, input.releaseId, tx);
  const employeeId = await employeeIdFor(deps, context, input, tx);
  const documents = await documentCandidates(deps, employeeId, input.competence, tx);
  const document = latestDocument(documents, input.documentId, input.documentHash);
  let comparison: PayslipComparison;
  try { comparison = comparePayslipQuantities(release.content, input.lines, input.absentKinds); }
  catch (cause) { throw new AppError({ code: 'PTRP_PAYSLIP_QUANTITIES_INCOMPLETE', kind: 'CONFLICT', safeMessage: 'A entrega ou a transcrição precisa de dados completos no escopo desta conferência.', cause }); }
  return { release, employeeId, document, comparison };
}
async function checkedBytes(deps: PayslipReconciliationDependencies, document: ReconciliationDocument) {
  const metadata = await deps.hrDb.collection('employeeDocuments').doc(document.id).get();
  const size = metadata.get('size');
  if (typeof size === 'number' && (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PDF_BYTES)) throw failure('O contracheque deve ser um PDF de até 20 MiB.');
  const mime = metadata.get('mimeType');
  if (mime && mime !== 'application/pdf') throw failure('O contracheque precisa ser um documento PDF.');
  const bytes = await deps.readStorage(document.storagePath);
  if (bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString('ascii') !== '%PDF-' || bytesHash(bytes) !== document.sha256) throw failure('O arquivo do contracheque falhou na conferência de integridade.');
  return bytes;
}
function stampOf(revision: PayslipReconciliationRevision): PayslipReconciliationStamp {
  return { id: revision.id, inputHash: revision.inputHash, releaseId: revision.releaseId, documentId: revision.documentId, documentHash: revision.documentHash, documentVersion: revision.documentVersion };
}
async function assertPackageReplaceable(deps: PayslipReconciliationDependencies, context: ServerUserContext, query: Query, version: number, tx: Transaction) {
  const pack = await tx.get(packageRef(deps.hrDb, context.workspace_id, query, version));
  if (!pack.exists) return;
  let status = pack.get('status');
  let request: DocumentData | undefined;
  const requestId = pack.get('signatureRequestId');
  if (typeof requestId === 'string') request = (await tx.get(deps.hrDb.collection('hrSignatureRequests').doc(requestId))).data();
  if (status === 'sent' && request?.status === 'rejected') status = 'refused';
  const staleSending = status === 'sending' && !pack.get('providerDocumentId') && !request?.providerDocumentId
    && deps.now().getTime() - Date.parse(pack.get('createdAt')) >= LEASE_MS;
  const canReplace = status === 'failed' && !pack.get('providerDocumentId') || isOverdue({ status, sentAt: pack.get('sentAt') ?? null }, deps.now()) || staleSending;
  if (!canReplace) throw failure('Este pacote já está em assinatura ou foi assinado. Preserve a conferência desta tentativa.');
}
function requestHash(context: ServerUserContext, input: ReconciliationSubmitInput) { return sha256({ actorUid: context.decoded.uid, workspaceId: context.workspace_id, ...input }); }
export async function previewPayslipReconciliation(context: ServerUserContext, raw: ReconciliationPreviewInput, injected: Partial<PayslipReconciliationDependencies> = {}) {
  assertPayslipReconciliationManager(context);
  const input = payslipReconciliationPreviewSchema.parse(raw); const deps = dependencies(injected);
  const source = await selectedSource(deps, context, input);
  await checkedBytes(deps, source.document);
  return { comparison: source.comparison, release: { id: source.release.id, closureVersion: source.release.closureVersion, contentHash: source.release.contentHash },
    document: { id: source.document.id, name: source.document.name, version: source.document.version, sha256: source.document.sha256 } };
}
export async function submitPayslipReconciliation(context: ServerUserContext, raw: ReconciliationSubmitInput, injected: Partial<PayslipReconciliationDependencies> = {}) {
  assertPayslipReconciliationManager(context);
  const input = payslipReconciliationSubmitSchema.parse(raw); const deps = dependencies(injected);
  const hash = requestHash(context, input);
  const ref = revisions(deps.hrDb).doc(input.requestId);
  const existing = await ref.get();
  if (existing.exists) {
    const record = existing.data() as PayslipReconciliationRevision;
    if (record.requestHash !== hash) throw failure('A tentativa já foi usada para outra conferência.');
    return record;
  }
  const selected = await selectedSource(deps, context, input);
  await checkedBytes(deps, selected.document);
  return deps.hrDb.runTransaction(async (tx) => {
    const [stateDoc, replay] = await Promise.all([tx.get(stateRef(deps.hrDb, context.workspace_id, input)), tx.get(ref)]);
    if (replay.exists) {
      const record = replay.data() as PayslipReconciliationRevision;
      if (record.requestHash !== hash) throw failure('A tentativa já foi usada para outra conferência.');
      return record;
    }
    const state = stateDoc.data() as ReconciliationState | undefined;
    if ((state?.version ?? 0) !== input.expectedVersion) throw failure('A conferência mudou. Atualize a tela.');
    if (state?.sendingLease && state.sendingLease.until > deps.now().toISOString()) throw failure('O pacote está sendo preparado para assinatura. Aguarde a conclusão.');
    const fresh = await selectedSource(deps, context, input, tx);
    if (fresh.release.sourceHash !== selected.release.sourceHash || fresh.release.employmentProofHash !== selected.release.employmentProofHash
      || fresh.document.version !== selected.document.version || fresh.document.storagePath !== selected.document.storagePath) throw failure('A fonte da conferência mudou. Confira uma nova prévia.');
    await assertPackageReplaceable(deps, context, input, fresh.release.closureVersion, tx);
    const at = deps.now().toISOString();
    const previewInput: ReconciliationPreviewInput = { competence: input.competence, employeeUid: input.employeeUid, releaseId: input.releaseId,
      documentId: input.documentId, documentHash: input.documentHash, lines: input.lines, absentKinds: input.absentKinds, acknowledgment: true };
    const inputHash = sha256({ scope: PAYSLIP_RECONCILIATION_SCOPE, releaseId: fresh.release.id, contentHash: fresh.release.contentHash,
      sourceHash: fresh.release.sourceHash, employmentProofHash: fresh.release.employmentProofHash,
      document: { id: fresh.document.id, hash: fresh.document.sha256, version: fresh.document.version }, input: previewInput, comparison: fresh.comparison });
    const record: PayslipReconciliationRevision = { id: ref.id, workspaceId: context.workspace_id, employeeUid: input.employeeUid, employeeId: fresh.employeeId,
      competence: input.competence, closureVersion: fresh.release.closureVersion, releaseId: fresh.release.id, releaseContentHash: fresh.release.contentHash,
      releaseSourceHash: fresh.release.sourceHash, releaseEmploymentProofHash: fresh.release.employmentProofHash, documentId: fresh.document.id,
      documentHash: fresh.document.sha256, documentVersion: fresh.document.version, documentStoragePath: fresh.document.storagePath,
      requestId: input.requestId, requestHash: hash, inputHash, input: previewInput, comparison: fresh.comparison, createdAt: at, createdBy: context.decoded.uid };
    const stateValue: ReconciliationState = { id: stateDoc.id, workspaceId: context.workspace_id, employeeUid: input.employeeUid, employeeId: fresh.employeeId,
      competence: input.competence, version: (state?.version ?? 0) + 1, currentRevisionId: ref.id, updatedAt: at, updatedBy: context.decoded.uid, sendingLease: null };
    tx.create(ref, record); tx.set(stateDoc.ref, stateValue);
    return record;
  });
}

async function assertClosedPerson(deps: PayslipReconciliationDependencies, context: ServerUserContext, query: Query) {
  const ref = reconciliationClosures(deps.hrDb).doc(closureKey(context.workspace_id, query.competence));
  const closure = await ref.get();
  const version = Number(closure.get('version'));
  if (!closure.exists || closure.get('workspaceId') !== context.workspace_id || closure.get('competence') !== query.competence || !Number.isSafeInteger(version) || version < 1) throw failure('A pessoa precisa pertencer a uma versão fechada desta competência.', 'NOT_FOUND');
  const [frozen, person] = await Promise.all([ref.collection('versions').doc(String(version)).get(),
    reconciliationPeople(ref.collection('versions').doc(String(version))).doc(query.employeeUid).get()]);
  if (!frozen.exists || frozen.get('workspaceId') !== context.workspace_id || frozen.get('competence') !== query.competence || frozen.get('status') !== 'closed'
    || !person.exists || person.get('uid') !== query.employeeUid) throw failure('A pessoa não pertence ao fechamento deste workspace.', 'NOT_FOUND');
  return { version, closed: closure.get('status') === 'closed' };
}
async function validateRevision(deps: PayslipReconciliationDependencies, context: ServerUserContext, revision: PayslipReconciliationRevision, tx?: Transaction) {
  if (revision.workspaceId !== context.workspace_id) throw failure('Conferência indisponível.', 'NOT_FOUND');
  const source = await selectedSource(deps, context, revision.input, tx);
  if (source.release.closureVersion !== revision.closureVersion || source.release.contentHash !== revision.releaseContentHash
    || source.release.sourceHash !== revision.releaseSourceHash || source.release.employmentProofHash !== revision.releaseEmploymentProofHash
    || source.employeeId !== revision.employeeId || source.document.version !== revision.documentVersion || source.document.storagePath !== revision.documentStoragePath
    || source.document.sha256 !== revision.documentHash || sha256(source.comparison) !== sha256(revision.comparison)) throw failure('A entrega ou o contracheque mudou. Faça uma nova conferência.');
  const expectedHash = sha256({ scope: PAYSLIP_RECONCILIATION_SCOPE, releaseId: source.release.id, contentHash: source.release.contentHash,
    sourceHash: source.release.sourceHash, employmentProofHash: source.release.employmentProofHash,
    document: { id: source.document.id, hash: source.document.sha256, version: source.document.version }, input: revision.input, comparison: source.comparison });
  if (expectedHash !== revision.inputHash) throw failure('A conferência falhou na verificação de integridade.');
  return source;
}
export type ReconciliationCurrentView = {
  id: string; status: 'match' | 'divergent' | 'stale'; comparison: PayslipComparison;
  releaseId: string; documentId: string; documentHash: string; documentVersion: number; inputHash: string;
  input: ReconciliationPreviewInput; createdAt: string; createdBy: string;
};
function currentView(record: PayslipReconciliationRevision, status: ReconciliationCurrentView['status']): ReconciliationCurrentView {
  return { id: record.id, status, comparison: record.comparison, releaseId: record.releaseId, documentId: record.documentId,
    documentHash: record.documentHash, documentVersion: record.documentVersion, inputHash: record.inputHash,
    input: record.input, createdAt: record.createdAt, createdBy: record.createdBy };
}
export async function readPayslipReconciliation(context: ServerUserContext, raw: Query, injected: Partial<PayslipReconciliationDependencies> = {}) {
  assertPayslipReconciliationManager(context);
  const query = payslipReconciliationQuerySchema.parse(raw); const deps = dependencies(injected);
  await assertClosedPerson(deps, context, query);
  const employeeId = await employeeIdFor(deps, context, query);
  const [releaseDocs, documents, stateDoc] = await Promise.all([
    deps.hrDb.collection('providerClosureReleases').where('workspaceId', '==', context.workspace_id).where('competence', '==', query.competence)
      .where('employeeUid', '==', query.employeeUid).select('id', 'closureVersion', 'createdAt', 'content.employer.name').limit(51).get(),
    documentCandidates(deps, employeeId, query.competence), stateRef(deps.hrDb, context.workspace_id, query).get(),
  ]);
  if (releaseDocs.size > 50) throw failure('Há mais entregas que a consulta comporta. Solicite a paginação deste histórico.');
  const state = stateDoc.data() as ReconciliationState | undefined;
  let current: ReconciliationCurrentView | null = null;
  if (state?.currentRevisionId) {
    const record = (await revisions(deps.hrDb).doc(state.currentRevisionId).get()).data() as PayslipReconciliationRevision | undefined;
    if (!record || record.workspaceId !== context.workspace_id || record.employeeUid !== query.employeeUid || record.competence !== query.competence) throw failure('O registro da conferência atual está incompleto.');
    let status: ReconciliationCurrentView['status'] = record.comparison.status;
    try { await validateRevision(deps, context, record); }
    catch (cause) {
      if (!(cause instanceof AppError) || !['CONFLICT', 'AUTHORIZATION', 'NOT_FOUND'].includes(cause.kind)) throw cause;
      status = 'stale';
    }
    current = currentView(record, status);
  }
  return { version: state?.version ?? 0, scope: PAYSLIP_RECONCILIATION_SCOPE,
    releases: releaseDocs.docs.map((doc) => ({ id: doc.id, closureVersion: Number(doc.get('closureVersion')), createdAt: String(doc.get('createdAt')),
      employerName: typeof doc.get('content.employer.name') === 'string' ? doc.get('content.employer.name') as string : 'Empregador' })),
    documents: documents.map((doc) => ({ id: doc.id, name: doc.name, version: doc.version, sha256: doc.sha256 })), current };
}
export async function readReconciliationPayslip(context: ServerUserContext, raw: Query & { documentId: string; documentHash: string }, injected: Partial<PayslipReconciliationDependencies> = {}) {
  assertPayslipReconciliationManager(context);
  const input = reconciliationDocumentSchema.parse(raw); const deps = dependencies(injected);
  await assertClosedPerson(deps, context, input);
  const employeeId = await employeeIdFor(deps, context, input);
  const document = latestDocument(await documentCandidates(deps, employeeId, input.competence), input.documentId, input.documentHash);
  const bytes = await checkedBytes(deps, document);
  if (await employeeIdFor(deps, context, input) !== employeeId) throw failure('O vínculo do documento mudou durante a leitura.');
  const fresh = latestDocument(await documentCandidates(deps, employeeId, input.competence), input.documentId, input.documentHash);
  if (fresh.version !== document.version || fresh.storagePath !== document.storagePath) throw failure('O contracheque mudou durante a leitura.');
  await audits(deps.hrDb).doc(deps.randomId()).create({ workspaceId: context.workspace_id, employeeUid: input.employeeUid, employeeId,
    actorUid: context.decoded.uid, action: 'download', documentId: document.id, documentHash: document.sha256, documentVersion: document.version, at: deps.now().toISOString() });
  return { bytes, filename: 'contracheque-' + input.competence + '.pdf' };
}
async function currentRevision(deps: PayslipReconciliationDependencies, context: ServerUserContext, query: Query, tx: Transaction) {
  const state = (await tx.get(stateRef(deps.hrDb, context.workspace_id, query))).data() as ReconciliationState | undefined;
  if (!state?.currentRevisionId) throw failure('Confira o retorno do contador antes de enviar o pacote para assinatura.');
  const revision = (await tx.get(revisions(deps.hrDb).doc(state.currentRevisionId))).data() as PayslipReconciliationRevision | undefined;
  if (!revision || revision.workspaceId !== context.workspace_id || revision.employeeUid !== query.employeeUid || revision.competence !== query.competence) throw failure('A conferência atual está incompleta.');
  const source = await validateRevision(deps, context, revision, tx);
  if (source.comparison.status !== 'match') throw failure('Resolva as divergências do retorno do contador antes de enviar o pacote para assinatura.');
  return { state, revision, document: source.document };
}
export async function assertCurrentPayslipReconciliation(context: ServerUserContext, query: Query & { closureVersion: number }, injected: Partial<PayslipReconciliationDependencies> = {}, tx?: Transaction) {
  assertPayslipReconciliationManager(context);
  const deps = dependencies(injected);
  const read = async (transaction: Transaction) => {
    const current = await currentRevision(deps, context, query, transaction);
    if (current.revision.closureVersion !== query.closureVersion) throw failure('A conferência pertence a outra versão do fechamento.');
    return current;
  };
  const current = tx ? await read(tx) : await deps.hrDb.runTransaction(read);
  if (!tx) await checkedBytes(deps, current.document);
  return { stamp: stampOf(current.revision), document: current.document };
}
export async function reserveReconciliationForPackage(context: ServerUserContext, query: Query & { closureVersion: number }, injected: Partial<PayslipReconciliationDependencies> = {}) {
  assertPayslipReconciliationManager(context);
  const deps = dependencies(injected);
  const verified = await assertCurrentPayslipReconciliation(context, query, deps);
  return deps.hrDb.runTransaction(async (tx) => {
    const current = await currentRevision(deps, context, query, tx);
    if (current.revision.closureVersion !== query.closureVersion || current.revision.id !== verified.stamp.id || current.revision.inputHash !== verified.stamp.inputHash) throw failure('A conferência mudou durante a preparação.');
    if (current.state.sendingLease && current.state.sendingLease.until > deps.now().toISOString()) throw failure('Já existe uma preparação de assinatura em andamento.');
    await assertPackageReplaceable(deps, context, query, query.closureVersion, tx);
    const lease: ReconciliationLease = { id: deps.randomId(), until: new Date(deps.now().getTime() + LEASE_MS).toISOString(), reconciliationId: current.revision.id, inputHash: current.revision.inputHash };
    tx.update(stateRef(deps.hrDb, context.workspace_id, query), { sendingLease: lease });
    return { ...verified, lease };
  });
}
export async function assertReconciliationPackageLease(context: ServerUserContext, query: Query & { closureVersion: number }, stamp: PayslipReconciliationStamp, lease: ReconciliationLease, injected: Partial<PayslipReconciliationDependencies> = {}, tx?: Transaction) {
  assertPayslipReconciliationManager(context);
  const deps = dependencies(injected);
  const read = async (transaction: Transaction) => {
    const current = await currentRevision(deps, context, query, transaction);
    if (current.state.sendingLease?.id !== lease.id || current.state.sendingLease.until <= deps.now().toISOString()
      || current.revision.id !== stamp.id || current.revision.inputHash !== stamp.inputHash || current.revision.closureVersion !== query.closureVersion) throw failure('A reserva da conferência expirou ou foi substituída.');
    return { stamp: stampOf(current.revision), document: current.document };
  };
  return tx ? read(tx) : deps.hrDb.runTransaction(read);
}
export async function releaseReconciliationPackageLease(context: ServerUserContext, query: Query, lease: ReconciliationLease, injected: Partial<PayslipReconciliationDependencies> = {}) {
  const deps = dependencies(injected);
  await deps.hrDb.runTransaction(async (tx) => {
    const ref = stateRef(deps.hrDb, context.workspace_id, query); const state = await tx.get(ref);
    if (state.get('sendingLease')?.id === lease.id) tx.update(ref, { sendingLease: null });
  });
}

export async function readPayslipReconciliationGate(context: ServerUserContext, query: Query, injected: Partial<PayslipReconciliationDependencies> = {}) {
  assertPayslipReconciliationManager(context);
  const deps = dependencies(injected);
  const state = (await stateRef(deps.hrDb, context.workspace_id, query).get()).data() as ReconciliationState | undefined;
  if (!state?.currentRevisionId) return { status: 'missing' as const, stamp: null };
  const revision = (await revisions(deps.hrDb).doc(state.currentRevisionId).get()).data() as PayslipReconciliationRevision | undefined;
  if (!revision || revision.workspaceId !== context.workspace_id || revision.employeeUid !== query.employeeUid || revision.competence !== query.competence) throw failure('A conferência atual está incompleta.');
  try { await validateRevision(deps, context, revision); }
  catch (cause) {
    if (!(cause instanceof AppError) || !['CONFLICT', 'AUTHORIZATION', 'NOT_FOUND'].includes(cause.kind)) throw cause;
    return { status: 'stale' as const, stamp: stampOf(revision) };
  }
  return { status: revision.comparison.status, stamp: stampOf(revision) };
}
