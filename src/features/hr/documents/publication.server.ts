import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import type { ServerUserContext } from '@/lib/auth-server';
import { adminApp } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { isDocumentsDp, subjectFromPermissions } from '@/lib/hr/employee-document-access';
import {
  canPublishManually, isPublishedToEmployee, resolvePublicationPolicy, shouldAutoPublish,
  type DocumentPublication, type DocumentPublicationPolicy, type DocumentPublicationTrigger,
} from '@/lib/hr/employee-document-publication';
import { AppError } from '@/lib/observability/app-error';

const COLLECTION = 'employeeDocuments';
// Só os publicados da pessoa; o teto protege a leitura sem cortar o uso normal.
const OWN_LIMIT = 500;

type Storage = { download(path: string): Promise<Buffer> };
const bucketStorage: Storage = { async download(path) { return (await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download())[0]; } };
type Dependencies = { hrDb: Firestore; storage: Storage; now: () => Date; overrides: () => Promise<Record<string, DocumentPublicationPolicy> | null> };
async function storedOverrides(): Promise<Record<string, DocumentPublicationPolicy> | null> {
  const snapshot = await hrDbAdmin.collection('schema').doc('document_publication').get();
  const value = snapshot.get('policies');
  return value && typeof value === 'object' ? value as Record<string, DocumentPublicationPolicy> : null;
}
const defaults: Dependencies = { hrDb: hrDbAdmin, storage: bucketStorage, now: () => new Date(), overrides: storedOverrides };

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

function assertDp(context: ServerUserContext) {
  const subject = subjectFromPermissions(context.permissions, { isDefaultAdmin: context.isDefaultAdmin, isOwner: false });
  const canManage = context.isDefaultAdmin || context.permissions.settings?.manageUsers === true || context.permissions.dp?.collaborators?.edit === true;
  if (!isDocumentsDp(subject) || !canManage) throw new AppError({ code: 'EMPLOYEE_DOCUMENT_PUBLICATION_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Só o DP autorizado publica ou retira documentos.' });
}

/**
 * Publicar ou retirar um documento da pasta do colaborador (DP autorizado com edição de colaboradores). Marca o próprio
 * registro, sem copiar arquivo; retirar exige motivo e mantém o arquivo e o histórico.
 */
export async function changeDocumentPublication(context: ServerUserContext, input: { id: string; action: 'publish' | 'withdraw'; reason?: string },
  injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertDp(context);
  const ref = deps.hrDb.collection(COLLECTION).doc(input.id);
  const overrides = await deps.overrides();
  return deps.hrDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (!data || data.deletedAt) throw notFound();
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
