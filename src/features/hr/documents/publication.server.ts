import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import type { ServerUserContext } from '@/lib/auth-server';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { isDocumentsDp, subjectFromPermissions } from '@/lib/hr/employee-document-access';
import {
  canPublishManually, isPublishedToEmployee, resolvePublicationPolicy, shouldAutoPublish,
  type DocumentPublication, type DocumentPublicationPolicy, type DocumentPublicationTrigger,
} from '@/lib/hr/employee-document-publication';
import { AppError } from '@/lib/observability/app-error';
import { getDocumentTypeConfig, activeDocumentTypeCodes } from '@/lib/hr/employee-document-catalog';
import { EMPLOYEE_DOCUMENT_TYPE_CATALOG } from '@/lib/hr/employee-document-options';
import { canAccessUserByUnit, resolveUnitAccess } from '@/lib/unit-access';

const COLLECTION = 'employeeDocuments';
// Só os publicados da pessoa; o teto protege a leitura sem cortar o uso normal.
const OWN_LIMIT = 500;

type Storage = { download(path: string): Promise<Buffer> };
const bucketStorage: Storage = { async download(path) { return (await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download())[0]; } };
type Dependencies = { hrDb: Firestore; mainDb: Firestore; storage: Storage; now: () => Date; overrides: () => Promise<Record<string, DocumentPublicationPolicy> | null> };
async function storedOverrides(): Promise<Record<string, DocumentPublicationPolicy> | null> {
  const snapshot = await hrDbAdmin.collection('schema').doc('document_publication').get();
  const value = snapshot.get('policies');
  return value && typeof value === 'object' ? value as Record<string, DocumentPublicationPolicy> : null;
}
const defaults: Dependencies = { hrDb: hrDbAdmin, mainDb: dbAdmin, storage: bucketStorage, now: () => new Date(), overrides: storedOverrides };

const notFound = () => new AppError({ code: 'EMPLOYEE_DOCUMENT_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Documento não encontrado.' });
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Identificadores do próprio titular: uid, cadastro do RH e matrícula Bizneo. */
function ownEmployeeIds(context: ServerUserContext) {
  const user = context.userDoc as { id?: string; hrEmployeeId?: string | null; registrationIdBizneo?: string | null };
  return [...new Set([context.decoded.uid, user.id, user.hrEmployeeId, user.registrationIdBizneo].map(text).filter((value): value is string => Boolean(value)))].slice(0, 10);
}
const publicView = (id: string, data: FirebaseFirestore.DocumentData) => ({
  id, displayName: text(data.displayName) ?? text(data.documentType) ?? 'Documento', documentType: text(data.documentType), documentTypeCode: text(data.documentTypeCode),
  category: text(data.category), mimeType: text(data.mimeType), size: typeof data.size === 'number' ? data.size : null,
  publishedAt: (data.publication as DocumentPublication | undefined)?.at ?? null,
});

/**
 * Macro 02, a própria pasta: só os documentos do titular que foram publicados para ele. Qualquer colaborador acessa a
 * sua; a consulta já filtra pelo titular (nunca lê a coleção inteira) e o resto é recusado como "não encontrado".
 */
export async function listOwnPublishedDocuments(context: ServerUserContext, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  // A consulta já filtra titular e publicação (índice employeeId + publication.status), nunca a coleção inteira.
  const snapshot = await deps.hrDb.collection(COLLECTION).where('employeeId', 'in', ownEmployeeIds(context)).where('publication.status', '==', 'published').limit(OWN_LIMIT).get();
  return snapshot.docs.filter((doc) => isPublishedToEmployee(doc.data() as Parameters<typeof isPublishedToEmployee>[0]))
    .map((doc) => publicView(doc.id, doc.data()))
    .sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)));
}

/** Abre um documento da própria pasta: titular e publicado, senão "não encontrado" (sem revelar que existe). */
export async function openOwnPublishedDocument(context: ServerUserContext, id: string, action: 'view' | 'download', injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const ref = deps.hrDb.collection(COLLECTION).doc(id);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!data || !ownEmployeeIds(context).includes(String(data.employeeId ?? '')) || !isPublishedToEmployee(data as Parameters<typeof isPublishedToEmployee>[0])) throw notFound();
  const path = text(data.storagePath);
  if (!path) throw notFound();
  const bytes = await deps.storage.download(path);
  await ref.collection('audit').add({ action: action === 'download' ? 'downloaded' : 'viewed', actorId: context.decoded.uid, channel: 'own_folder', at: Timestamp.fromDate(deps.now()) });
  return { bytes, mimeType: text(data.mimeType) ?? 'application/pdf', fileName: text(data.originalName) ?? text(data.storedName) ?? `${id}.pdf` };
}

export function assertDocumentsDp(context: ServerUserContext) {
  const subject = subjectFromPermissions(context.permissions, { isDefaultAdmin: context.isDefaultAdmin, isOwner: false });
  const canManage = context.isDefaultAdmin || context.permissions.settings?.manageUsers === true || context.permissions.dp?.collaborators?.edit === true;
  if (!isDocumentsDp(subject) || !canManage) throw new AppError({ code: 'EMPLOYEE_DOCUMENT_PUBLICATION_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Só o DP autorizado publica ou retira documentos.' });
}

function assertGlobalDocumentsDp(context: ServerUserContext) {
  assertDocumentsDp(context);
  if (!resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin }).allUnits) {
    throw new AppError({ code: 'EMPLOYEE_DOCUMENT_PUBLICATION_POLICY_GLOBAL_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'A política geral de documentos exige acesso a todas as unidades.' });
  }
}

async function assertDocumentUnitScope(context: ServerUserContext, employeeId: string | null, deps: Dependencies) {
  if (!employeeId) throw notFound();
  if (context.isDefaultAdmin || employeeId === context.decoded.uid) return;
  let target = await deps.mainDb.collection('users').doc(employeeId).get();
  if (!target.exists) {
    const byHr = await deps.mainDb.collection('users').where('hrEmployeeId', '==', employeeId).limit(2).get();
    if (byHr.size === 1) target = byHr.docs[0];
  }
  if (!target.exists) {
    const byBizneo = await deps.mainDb.collection('users').where('registrationIdBizneo', '==', employeeId).limit(2).get();
    if (byBizneo.size === 1) target = byBizneo.docs[0];
  }
  if (!target.exists || !canAccessUserByUnit(context.userDoc, target.data() ?? {}, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw new AppError({ code: 'EMPLOYEE_DOCUMENT_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade deste colaborador.' });
  }
}

async function documentForDp(context: ServerUserContext, id: string, deps: Dependencies) {
  const snapshot = await deps.hrDb.collection(COLLECTION).doc(id).get();
  const data = snapshot.data();
  if (!data || data.deletedAt) throw notFound();
  await assertDocumentUnitScope(context, text(data.employeeId), deps);
  return data;
}

/**
 * Publicar ou retirar um documento da pasta do colaborador (DP autorizado com edição de colaboradores). Marca o próprio
 * registro, sem copiar arquivo; retirar exige motivo e mantém o arquivo e o histórico.
 */
export async function changeDocumentPublication(context: ServerUserContext, input: { id: string; action: 'publish' | 'withdraw'; reason?: string },
  injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertDocumentsDp(context);
  const ref = deps.hrDb.collection(COLLECTION).doc(input.id);
  const scoped = await documentForDp(context, input.id, deps);
  const overrides = await deps.overrides();
  return deps.hrDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (!data || data.deletedAt || text(data.employeeId) !== text(scoped.employeeId)) throw notFound();
    const current = data.publication as DocumentPublication | undefined;
    const at = deps.now().toISOString();
    if (input.action === 'publish') {
      if (current?.status === 'published') return current;
      if (!canPublishManually(resolvePublicationPolicy(text(data.documentTypeCode), overrides), data)) {
        throw new AppError({ code: 'EMPLOYEE_DOCUMENT_NOT_PUBLISHABLE', kind: 'CONFLICT', safeMessage: 'Este documento não pode ser publicado: tipo restrito, não identificado ou assinatura pendente.' });
      }
      const publication: DocumentPublication = { status: 'published', at, by: context.decoded.uid, source: 'manual', reason: null };
      tx.update(ref, { publication, updatedAt: Timestamp.fromDate(deps.now()) });
      tx.create(ref.collection('audit').doc(), { action: 'DOCUMENT_PUBLISHED', actorId: context.decoded.uid, source: 'manual', at: Timestamp.fromDate(deps.now()) });
      return publication;
    }
    if (current?.status !== 'published') return current ?? null;
    const reason = text(input.reason);
    if (!reason || reason.length < 10) throw new AppError({ code: 'EMPLOYEE_DOCUMENT_WITHDRAW_REASON', kind: 'VALIDATION', safeMessage: 'Informe o motivo da retirada (mínimo de 10 caracteres).' });
    const publication: DocumentPublication = { status: 'withdrawn', at, by: context.decoded.uid, source: 'manual', reason };
    tx.update(ref, { publication, updatedAt: Timestamp.fromDate(deps.now()) });
    tx.create(ref.collection('audit').doc(), { action: 'DOCUMENT_WITHDRAWN', actorId: context.decoded.uid, reason, at: Timestamp.fromDate(deps.now()) });
    return publication;
  });
}

/**
 * Publicação automática pelos fluxos do sistema (documento validado ou assinado), conforme a política do tipo.
 * Idempotente; não publica de novo um documento retirado pelo DP.
 */
export async function autoPublishDocument(documentId: string, event: DocumentPublicationTrigger, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const ref = deps.hrDb.collection(COLLECTION).doc(documentId);
  const overrides = await deps.overrides();
  return deps.hrDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (!data || data.deletedAt || data.publication || !text(data.employeeId)) return null;
    if (!shouldAutoPublish(resolvePublicationPolicy(text(data.documentTypeCode), overrides), event, data)) return null;
    const publication: DocumentPublication = { status: 'published', at: deps.now().toISOString(), by: 'system:publication-policy', source: 'policy', reason: null };
    tx.update(ref, { publication });
    tx.create(ref.collection('audit').doc(), { action: 'DOCUMENT_PUBLISHED', actorId: 'system:publication-policy', source: 'policy', event, at: Timestamp.fromDate(deps.now()) });
    return publication;
  });
}

const PUBLICATION_MODES = new Set(['automatic', 'manual', 'never']);
const PUBLICATION_TRIGGERS = new Set(['validated', 'signed']);

function normalizePolicy(code: string, value: unknown): DocumentPublicationPolicy {
  const raw = value && typeof value === 'object' ? value as Partial<DocumentPublicationPolicy> : {};
  if (!PUBLICATION_MODES.has(String(raw.mode)) || !PUBLICATION_TRIGGERS.has(String(raw.trigger))) {
    throw new AppError({ code: 'EMPLOYEE_DOCUMENT_PUBLICATION_POLICY_INVALID', kind: 'VALIDATION', safeMessage: `Política de ${code} inválida.` });
  }
  if (code === 'UNKNOWN_DOCUMENT' && raw.mode !== 'never') {
    throw new AppError({ code: 'EMPLOYEE_DOCUMENT_PUBLICATION_POLICY_UNKNOWN', kind: 'VALIDATION', safeMessage: 'Documento não identificado nunca pode ser publicado.' });
  }
  return { mode: raw.mode!, trigger: raw.trigger! };
}

/** Configuração efetiva da política, sempre cobrindo o catálogo atual e mantendo tipo novo fechado por padrão. */
export async function readDocumentPublicationPolicies(context: ServerUserContext, injected: Partial<Dependencies> = {}) {
  assertGlobalDocumentsDp(context);
  const deps = { ...defaults, ...injected };
  const overrides = await deps.overrides();
  return EMPLOYEE_DOCUMENT_TYPE_CATALOG.map((type) => ({
    code: type.code,
    label: type.label,
    category: type.category,
    policy: resolvePublicationPolicy(type.code, overrides),
    customized: Boolean(overrides?.[type.code]),
  }));
}

/** Salva a política completa por tipo conhecido e audita a alteração no mesmo batch. */
export async function saveDocumentPublicationPolicies(context: ServerUserContext, policies: Record<string, unknown>, injected: Partial<Dependencies> = {}) {
  assertGlobalDocumentsDp(context);
  const deps = { ...defaults, ...injected };
  const existing = await deps.overrides();
  const allowed = new Set(activeDocumentTypeCodes());
  const unknown = Object.keys(policies).filter((code) => !allowed.has(code));
  if (unknown.length) throw new AppError({ code: 'EMPLOYEE_DOCUMENT_PUBLICATION_POLICY_TYPE_INVALID', kind: 'VALIDATION', safeMessage: 'A política contém tipo documental inválido.' });
  const normalized = Object.fromEntries([...allowed].sort().map((code) => [code,
    normalizePolicy(code, policies[code] ?? existing?.[code] ?? resolvePublicationPolicy(code))]));
  const now = Timestamp.fromDate(deps.now());
  const ref = deps.hrDb.collection('schema').doc('document_publication');
  const batch = deps.hrDb.batch();
  batch.set(ref, { schemaVersion: 1, policies: normalized, updatedAt: now, updatedBy: context.decoded.uid }, { merge: true });
  batch.create(ref.collection('audit').doc(), { action: 'DOCUMENT_PUBLICATION_POLICY_UPDATED', actorId: context.decoded.uid, policies: normalized, at: now });
  await batch.commit();
  return readDocumentPublicationPolicies(context, { ...injected, overrides: async () => normalized });
}

/** Classifica documento legado ainda sem tipo; não publica por consequência. */
export async function classifyLegacyEmployeeDocument(context: ServerUserContext, input: { id: string; documentTypeCode: string }, injected: Partial<Dependencies> = {}) {
  assertDocumentsDp(context);
  const deps = { ...defaults, ...injected };
  const allowed = new Set(activeDocumentTypeCodes());
  if (!allowed.has(input.documentTypeCode) || input.documentTypeCode === 'UNKNOWN_DOCUMENT') {
    throw new AppError({ code: 'EMPLOYEE_DOCUMENT_CLASSIFICATION_INVALID', kind: 'VALIDATION', safeMessage: 'Escolha um tipo documental identificado.' });
  }
  const ref = deps.hrDb.collection(COLLECTION).doc(input.id);
  const config = getDocumentTypeConfig(input.documentTypeCode);
  const scoped = await documentForDp(context, input.id, deps);
  const result = await deps.hrDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (!data || data.deletedAt || text(data.employeeId) !== text(scoped.employeeId)) throw notFound();
    const currentCode = text(data.documentTypeCode);
    if (currentCode && currentCode !== 'UNKNOWN_DOCUMENT') {
      throw new AppError({ code: 'EMPLOYEE_DOCUMENT_ALREADY_CLASSIFIED', kind: 'CONFLICT', safeMessage: 'Este documento já possui classificação.' });
    }
    const at = deps.now();
    const update = {
      documentTypeCode: config.code, documentType: config.label, category: config.category,
      folderCode: config.folderCode, accessLevel: config.defaultAccessLevel, accessPolicyId: config.accessPolicyId,
      classification: { source: 'manual_legacy', at: at.toISOString(), by: context.decoded.uid },
      updatedAt: Timestamp.fromDate(at),
    };
    tx.update(ref, update);
    tx.create(ref.collection('audit').doc(), { action: 'DOCUMENT_CLASSIFIED', actorId: context.decoded.uid,
      previousDocumentTypeCode: currentCode, documentTypeCode: config.code, at: Timestamp.fromDate(at) });
    return { id: snapshot.id, ...update };
  });
  return result;
}

/** Validação manual passa pelo mesmo gatilho de publicação automática configurado para o tipo. */
export async function changeEmployeeDocumentStatus(context: ServerUserContext, input: { id: string; status: 'pending' | 'received' | 'validated' | 'rejected' }, injected: Partial<Dependencies> = {}) {
  assertDocumentsDp(context);
  const deps = { ...defaults, ...injected };
  const ref = deps.hrDb.collection(COLLECTION).doc(input.id);
  const scoped = await documentForDp(context, input.id, deps);
  await deps.hrDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (!data || data.deletedAt || text(data.employeeId) !== text(scoped.employeeId)) throw notFound();
    const at = deps.now();
    tx.update(ref, { status: input.status, updatedAt: Timestamp.fromDate(at),
      ...(input.status === 'validated' ? { validatedBy: context.decoded.uid, validatedAt: Timestamp.fromDate(at) } : {}) });
    tx.create(ref.collection('audit').doc(), { action: `status_${input.status}`, actorId: context.decoded.uid, at: Timestamp.fromDate(at) });
  });
  const publication = input.status === 'validated' ? await autoPublishDocument(input.id, 'validated', deps) : null;
  return { status: input.status, publication };
}
