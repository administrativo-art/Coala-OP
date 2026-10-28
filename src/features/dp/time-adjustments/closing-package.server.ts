import 'server-only';

import { createHash } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { PDFDocument } from 'pdf-lib';

import { signPtrpDetached } from '@/features/dp/rep-p/service.server';
import { autoPublishDocument } from '@/features/hr/documents/publication.server';
import { openSystemNotice, resolveSystemNoticeKeys as resolveNoticeKeys, resolveSystemNotices, type SystemNoticeInput } from '@/features/system-notices/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { createAutentiqueDocument } from '@/lib/autentique.server';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { getHrEmployeeId } from '@/lib/hr/person-link';
import { AppError } from '@/lib/observability/app-error';

import { closingPackagePath, composeClosingPackage, isOverdue } from './closing-package';
import { assertClosureAccess, type ClosureRecord } from './closure.server';
import { mirrorIncompleteReason } from './mirror-core';
import { generateMirror, mirrorPdf } from './mirror.server';
import type { ClosingPackageActionInput } from './schemas';
import { CLOSURES, closureKey } from './service.server';

const SIGNATURE_REQUESTS = 'hrSignatureRequests';
const EMPLOYEE_DOCUMENTS = 'employeeDocuments';
const PURPOSE = 'time_closing_package';
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const SIGNED_HOSTS = ['painel.autentique.com.br', 'api.autentique.com.br', 'storage.googleapis.com'];
const MAX_SIGNED_BYTES = 30 * 1024 * 1024;
/** PDF assinado da Autentique: só das origens conhecidas, até 30 MB e com cabeçalho de PDF. */
async function downloadAutentiqueSigned(url: string) {
  const host = (() => { try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.hostname : null; } catch { return null; } })();
  if (!host || !SIGNED_HOSTS.includes(host)) throw new AppError({ code: 'PTRP_PACKAGE_SIGNED_URL_REJECTED', kind: 'SECURITY_INCIDENT', safeMessage: 'A origem do documento assinado não foi autorizada.' });
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  if (!response.ok) throw new AppError({ code: 'PTRP_PACKAGE_SIGNED_DOWNLOAD_FAILED', kind: 'TRANSIENT_EXTERNAL', safeMessage: 'O documento assinado ainda não pôde ser arquivado.' });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_SIGNED_BYTES || bytes.subarray(0, 4).toString() !== '%PDF') throw new AppError({ code: 'PTRP_PACKAGE_SIGNED_INVALID', kind: 'DATA_INTEGRITY', safeMessage: 'O arquivo assinado recebido não é um PDF válido.' });
  return bytes;
}

type Storage = { save(path: string, bytes: Buffer, contentType: string): Promise<void>; download(path: string): Promise<Buffer> };
const bucketStorage: Storage = {
  async save(path, bytes, contentType) {
    await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path)
      .save(bytes, { resumable: false, metadata: { contentType, cacheControl: 'private, max-age=0, no-store' } });
  },
  async download(path) { return (await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download())[0]; },
};
type Dependencies = {
  mainDb: Firestore; hrDb: Firestore; storage: Storage; now: () => Date;
  sign: (bytes: Buffer) => Promise<{ bytes: Uint8Array; certificateCnpj: string }>;
  createDocument: typeof createAutentiqueDocument; downloadSigned: (url: string) => Promise<Buffer>;
  mirror: Parameters<typeof generateMirror>[2];
  publish: (documentId: string) => Promise<unknown>;
  notices: { open: (input: SystemNoticeInput) => Promise<unknown>; resolve: (workspaceId: string, keys: string[], onlyThese: boolean) => Promise<unknown> };
};
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, storage: bucketStorage, now: () => new Date(), sign: (bytes) => signPtrpDetached(bytes),
  createDocument: createAutentiqueDocument, downloadSigned: downloadAutentiqueSigned, mirror: {},
  publish: (documentId) => autoPublishDocument(documentId, 'signed'),
  notices: {
    open: (input) => openSystemNotice(input),
    // Na finalização, resolve só o aviso daquela versão; na rotina, resolve os que deixaram de ter atraso.
    resolve: async (workspaceId, keys, onlyThese) => onlyThese
      ? resolveNoticeKeys(workspaceId, keys)
      : resolveSystemNotices({ workspaceId, category: 'dp.time-closing', keepDedupeKeys: keys, reason: 'Sem pacote atrasado no fechamento.' }),
  } };

/** Tentativa anterior: o que foi enviado (arquivos e hash) e como terminou; assinatura recebida depois também fica aqui. */
type AttemptEntry = { attempt: number; signatureRequestId: string; providerDocumentId: string | null; sentAt: string | null; endedStatus: string;
  bundle: { storagePath: string; sha256: string } | null; employerSignaturePath: string | null; signedStoragePath?: string | null; signedSha256?: string | null; signedAt?: string | null };
const attemptEntry = (pack: ClosingPackageRecord, endedStatus: string): AttemptEntry => ({ attempt: pack.attempt ?? 1, signatureRequestId: pack.signatureRequestId,
  providerDocumentId: pack.providerDocumentId, sentAt: pack.sentAt, endedStatus, bundle: pack.bundle ? { storagePath: pack.bundle.storagePath, sha256: pack.bundle.sha256 } : null,
  employerSignaturePath: pack.employerSignature?.storagePath ?? null });

export type ClosingPackageRecord = {
  schemaVersion: 1; status: 'sending' | 'sent' | 'signed' | 'refused' | 'failed'; uid: string; employeeId: string; competence: string; closureVersion: number;
  mirrorHash: string; payslip: { documentId: string; sha256: string }; bundle: { storagePath: string; sha256: string; pageCount: number };
  employerSignature: { storagePath: string; certificateCnpj: string }; signatureRequestId: string; providerDocumentId: string | null;
  createdBy: string; createdAt: string; sentAt: string | null; signedAt: string | null; signedStoragePath: string | null; signedSha256: string | null;
  archivedDocumentId: string | null; lastError: string | null;
  /** Tentativa atual (1 na primeira) e as anteriores, que nunca são apagadas. */
  attempt?: number;
  attempts?: AttemptEntry[];
};

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'CONFLICT' | 'NOT_FOUND' | 'TRANSIENT_EXTERNAL' | 'DATA_INTEGRITY' = 'CONFLICT') {
  return new AppError({ code, kind, safeMessage });
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const packageRef = (deps: Dependencies, workspaceId: string, competence: string, version: number, uid: string) =>
  deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence)).collection('versions').doc(String(version)).collection('packages').doc(uid);
const requestIdOf = (workspaceId: string, competence: string, version: number, uid: string) => `time_closing_${workspaceId}_${competence}_v${version}_${uid}`;
const monthLabel = (competence: string) => `${MONTHS[Number(competence.slice(5, 7)) - 1]} de ${competence.slice(0, 4)}`;

/** Contracheque do mês nos documentos do colaborador (tipo PAYSLIP, caso `month-AAAA-MM`): a versão válida mais recente. */
async function findPayslip(deps: Dependencies, employeeId: string, competence: string) {
  const snapshot = await deps.hrDb.collection(EMPLOYEE_DOCUMENTS).where('employeeId', '==', employeeId).where('documentTypeCode', '==', 'PAYSLIP')
    .where('caseId', '==', `month-${competence}`).limit(20).get();
  const candidates = snapshot.docs.filter((doc) => !doc.get('deletedAt') && !['rejected', 'archived'].includes(String(doc.get('status'))) && text(doc.get('storagePath')))
    .sort((left, right) => Number(right.get('version') ?? 0) - Number(left.get('version') ?? 0));
  return candidates[0] ?? null;
}

/** A recusa chega pelo webhook genérico como `rejected` na solicitação; o pacote enviado passa a aparecer como recusado. */
export async function withRefusal<T extends { status: string; signatureRequestId: string }>(deps: Pick<Dependencies, 'hrDb'>, record: T): Promise<T> {
  if (record.status !== 'sent') return record;
  const request = await deps.hrDb.collection(SIGNATURE_REQUESTS).doc(record.signatureRequestId).get();
  return request.get('status') === 'rejected' ? { ...record, status: 'refused', lastError: 'O trabalhador recusou a assinatura. Trate a divergência com ele.' } : record;
}

const STALE_SENDING_MS = 10 * 60_000;
/**
 * Pode enviar de novo: falha antes de a Autentique criar o documento, ou envio parado em "enviando" há mais de 10 minutos
 * sem documento criado (nem no pacote nem na solicitação), para não duplicar a assinatura.
 */
async function retryable(deps: Dependencies, pack: ClosingPackageRecord) {
  if (pack.status === 'failed') return !pack.providerDocumentId;
  if (pack.status !== 'sending' || pack.providerDocumentId) return false;
  if (deps.now().getTime() - Date.parse(pack.createdAt) < STALE_SENDING_MS) return false;
  const request = await deps.hrDb.collection(SIGNATURE_REQUESTS).doc(pack.signatureRequestId).get();
  return !text(request.get('providerDocumentId'));
}

/** Quando a pessoa abriu o documento na Autentique (registrado pelo webhook genérico na solicitação). */
async function viewedAtOf(deps: Pick<Dependencies, 'hrDb'>, pack: ClosingPackageRecord) {
  const request = await deps.hrDb.collection(SIGNATURE_REQUESTS).doc(pack.signatureRequestId).get();
  return text(request.get('viewedAt'));
}

async function readiness(deps: Dependencies, workspaceId: string, competence: string, uid: string) {
  const closure = (await deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence)).get()).data() as ClosureRecord | undefined;
  const user = await deps.mainDb.collection('users').doc(uid).get();
  if (!user.exists) throw fail('PTRP_PACKAGE_SUBJECT_INVALID', 'Pessoa não encontrada.', 'NOT_FOUND');
  const employeeId = getHrEmployeeId({ id: uid, hrEmployeeId: text(user.get('hrEmployeeId')), registrationIdBizneo: text(user.get('registrationIdBizneo')) })!;
  const [payslip, pack, subject] = await Promise.all([findPayslip(deps, employeeId, competence),
    closure?.status === 'closed' ? packageRef(deps, workspaceId, competence, closure.version, uid).get() : Promise.resolve(null),
    closure?.status === 'closed' ? deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence)).collection('versions').doc(String(closure.version)).collection('people').doc(uid).get() : Promise.resolve(null)]);
  const record = (pack?.data() as ClosingPackageRecord | undefined) ?? null;
  return { closure, user, employeeId, payslip, subject: Boolean(subject?.exists), pack: record ? await withRefusal(deps, record) : null };
}

/** GET: o que falta para enviar o pacote da pessoa (mês fechado, contracheque, e-mail) e a situação do envio. Sem escrita. */
export async function readClosingPackage(context: ServerUserContext, query: { competence: string; employeeUid: string }, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertClosureAccess(context, 'read');
  const { closure, user, payslip, pack } = await readiness(deps, context.workspace_id, query.competence, query.employeeUid);
  return {
    closure: closure ? { status: closure.status, version: closure.version } : null,
    payslip: payslip ? { documentId: payslip.id, name: text(payslip.get('displayName')) ?? 'Contracheque' } : null,
    email: Boolean(text(user.get('email'))),
    package: pack ? { status: pack.status, sentAt: pack.sentAt, signedAt: pack.signedAt, lastError: pack.lastError, viewedAt: await viewedAtOf(deps, pack) } : null,
  };
}

/**
 * POST (DP, `dp.timeClosure.close`): monta o pacote da pessoa no mês fechado (espelho gerado uma vez por versão e
 * contracheque do mês), assina com o e-CNPJ em arquivo destacado, guarda os dois e envia o PDF à Autentique para a
 * assinatura do trabalhador. Uma vez por pessoa e versão do fechamento; falha de envio pode ser repetida.
 */
export async function sendClosingPackage(context: ServerUserContext, input: Extract<ClosingPackageActionInput, { action: 'send' }>, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertClosureAccess(context, 'close');
  const { closure, user, employeeId, payslip, subject, pack } = await readiness(deps, context.workspace_id, input.competence, input.employeeUid);
  if (closure?.status !== 'closed') throw fail('PTRP_PACKAGE_NOT_CLOSED', 'O pacote sai depois do fechamento do mês.');
  if (closure.version !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.');
  if (!subject) throw fail('PTRP_PACKAGE_SUBJECT_OUTSIDE_CLOSURE', 'A pessoa não faz parte desta versão do fechamento.', 'CONFLICT');
  const resend = Boolean(pack && isOverdue(pack, deps.now()));
  // Reenvio depois de recusa ou de 24 horas sem assinatura: nova tentativa, com a anterior guardada no histórico.
  const attempt = resend ? (pack?.attempt ?? 1) + 1 : pack?.attempt ?? 1;
  if (pack && !resend && !(await retryable(deps, pack))) return pack;
  const name = text(user.get('username'));
  const email = text(user.get('email'))?.toLowerCase();
  if (!name || !email) throw fail('PTRP_PACKAGE_CONTACT_REQUIRED', 'Cadastre o nome e o e-mail da pessoa antes de enviar.');
  if (!payslip) throw fail('PTRP_PACKAGE_PAYSLIP_MISSING', 'O contracheque deste mês ainda não está nos documentos da pessoa.');

  const mirror = await generateMirror(context, { action: 'generate', competence: input.competence, expectedVersion: closure.version, employeeUid: input.employeeUid }, deps.mirror);
  const incomplete = mirrorIncompleteReason(mirror.snapshot);
  if (incomplete) throw fail('PTRP_PACKAGE_MIRROR_INCOMPLETE', `${incomplete} Corrija antes de enviar.`);
  const mirrorFile = await mirrorPdf(context, input.competence, input.employeeUid, deps.mirror);
  const payslipBytes = await deps.storage.download(String(payslip.get('storagePath')));
  const expectedHash = text(payslip.get('contentHash'));
  if (!expectedHash) throw fail('PTRP_PACKAGE_PAYSLIP_UNVERIFIED', 'O contracheque não tem código de conferência (hash). Reenvie o arquivo pelos documentos da pessoa.', 'DATA_INTEGRITY');
  if (expectedHash !== sha256(payslipBytes)) throw fail('PTRP_PACKAGE_PAYSLIP_INTEGRITY', 'O contracheque falhou na conferência de integridade.', 'DATA_INTEGRITY');
  const documentName = `Coala Shakes - DP | Espelho de ponto e contracheque - ${monthLabel(input.competence)} - ${name}`;
  const bundle = await composeClosingPackage({ mirror: mirrorFile.bytes, payslip: payslipBytes, title: documentName, name, month: monthLabel(input.competence) })
    .catch(() => { throw fail('PTRP_PACKAGE_PDF_INVALID', 'Não foi possível juntar o espelho e o contracheque (PDF inválido ou protegido).', 'DATA_INTEGRITY'); });
  const signed = await deps.sign(bundle.bytes);
  // Uma pasta por conteúdo: nova tentativa com outro contracheque não regrava o pacote anterior.
  const base = `${closingPackagePath(context.workspace_id, input.competence, closure.version, input.employeeUid)}/t${attempt}`;
  await deps.storage.save(`${base}/pacote.pdf`, bundle.bytes, 'application/pdf');
  await deps.storage.save(`${base}/pacote.pdf.p7s`, Buffer.from(signed.bytes), 'application/pkcs7-signature');

  const now = deps.now().toISOString();
  const signatureRequestId = `${requestIdOf(context.workspace_id, input.competence, closure.version, input.employeeUid)}${attempt > 1 ? `_t${attempt}` : ''}`;
  const target = packageRef(deps, context.workspace_id, input.competence, closure.version, input.employeeUid);
  const closureRef = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, input.competence));
  const record: ClosingPackageRecord = {
    schemaVersion: 1, status: 'sending', uid: input.employeeUid, employeeId, competence: input.competence, closureVersion: closure.version,
    mirrorHash: mirror.snapshotHash, payslip: { documentId: payslip.id, sha256: sha256(payslipBytes) },
    bundle: { storagePath: `${base}/pacote.pdf`, sha256: bundle.sha256, pageCount: bundle.pageCount },
    employerSignature: { storagePath: `${base}/pacote.pdf.p7s`, certificateCnpj: signed.certificateCnpj }, signatureRequestId, providerDocumentId: null,
    createdBy: context.decoded.uid, createdAt: now, sentAt: null, signedAt: null, signedStoragePath: null, signedSha256: null, archivedDocumentId: null, lastError: null,
    attempt, attempts: resend && pack ? [...(pack.attempts ?? []), attemptEntry(pack, pack.status)] : pack?.attempts ?? [],
  };
  const started = await deps.hrDb.runTransaction(async (tx) => {
    const [again, current] = await Promise.all([tx.get(target), tx.get(closureRef)]);
    if (current.get('status') !== 'closed' || current.get('version') !== closure.version) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou durante o envio. Atualize e confira.');
    if (again.exists) {
      const fresh = await withRefusal(deps, again.data() as ClosingPackageRecord);
      const allowed = resend ? isOverdue(fresh, deps.now()) && fresh.signatureRequestId === pack?.signatureRequestId : await retryable(deps, fresh);
      if (!allowed) return again.data() as ClosingPackageRecord;
    }
    tx.set(target, record);
    tx.set(deps.hrDb.collection(SIGNATURE_REQUESTS).doc(signatureRequestId), {
      type: PURPOSE, purpose: PURPOSE, status: 'sending', provider: 'autentique', workspaceId: context.workspace_id, competence: input.competence,
      closureVersion: closure.version, employeeUid: input.employeeUid, employeeId, documentName, documentStoragePath: record.bundle.storagePath,
      documentHash: bundle.sha256, signers: [{ party: 'employee', name, email }], requestedAt: now, requestedBy: context.decoded.uid, updatedAt: now,
    }, { merge: true });
    return null;
  });
  if (started) return started;
  let created: Awaited<ReturnType<typeof deps.createDocument>>;
  try {
    created = await deps.createDocument({
      buffer: bundle.bytes, fileName: `espelho-e-contracheque-${input.competence}.pdf`, documentName,
      message: `Olá, ${name}. Este documento traz o seu espelho de ponto e o contracheque de ${monthLabel(input.competence)}. Confira e assine. Se discordar do espelho, fale com o Departamento Pessoal antes de assinar.`,
      signers: [{ email, name, action: 'SIGN', positions: [{ x: '50.0', y: '60.0', z: bundle.pageCount, element: 'SIGNATURE' }] }],
    });
  } catch (cause) {
    const failedAt = deps.now().toISOString();
    const safeMessage = 'Não foi possível enviar o pacote para assinatura.';
    await Promise.all([
      target.update({ status: 'failed', lastError: safeMessage }),
      deps.hrDb.collection(SIGNATURE_REQUESTS).doc(signatureRequestId).set({ status: 'failed', lastError: safeMessage, failedAt, updatedAt: failedAt }, { merge: true }),
    ]);
    throw new AppError({ code: 'PTRP_PACKAGE_SEND_FAILED', kind: 'TRANSIENT_EXTERNAL', safeMessage, cause });
  }
  // Criado na Autentique: daqui em diante nada marca "failed", para um novo envio não duplicar o documento.
  const sentAt = deps.now().toISOString();
  await Promise.all([
    target.update({ status: 'sent', providerDocumentId: created.document.id, sentAt }),
    deps.hrDb.collection(SIGNATURE_REQUESTS).doc(signatureRequestId).set({ status: 'sent', sandbox: created.sandbox, providerDocumentId: created.document.id,
      providerCreatedAt: created.document.created_at, sentAt, updatedAt: sentAt }, { merge: true }),
  ]);
  return { ...record, status: 'sent' as const, providerDocumentId: created.document.id, sentAt };
}

/**
 * Retorno da Autentique (webhook): assinado, guarda o PDF assinado e o arquiva nos documentos do colaborador; recusado,
 * marca o pacote para o DP tratar a divergência (reabrindo o mês). Idempotente.
 */
export async function syncClosingPackageSignature(params: { signatureRequestId: string; eventType: string; signedUrl?: string | null; at?: string | null },
  injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const request = await deps.hrDb.collection(SIGNATURE_REQUESTS).doc(params.signatureRequestId).get();
  if (!request.exists || request.get('purpose') !== PURPOSE) return null;
  const target = packageRef(deps, String(request.get('workspaceId')), String(request.get('competence')), Number(request.get('closureVersion')), String(request.get('employeeUid')));
  const current = (await target.get()).data() as ClosingPackageRecord | undefined;
  if (!current) return null;
  // Evento de tentativa anterior (reenvio): a assinatura é evidência e nunca é descartada; fica guardada na própria
  // tentativa, sem trocar o documento da tentativa atual.
  if (params.signatureRequestId !== current.signatureRequestId) {
    if (params.eventType !== 'document.finished' || !params.signedUrl) return current;
    const index = (current.attempts ?? []).findIndex((item) => item.signatureRequestId === params.signatureRequestId);
    if (index < 0 || current.attempts![index].signedStoragePath) return current;
    const bytes = await deps.downloadSigned(params.signedUrl);
    const path = `${closingPackagePath(String(request.get('workspaceId')), current.competence, current.closureVersion, current.uid)}/t${current.attempts![index].attempt}/assinado.pdf`;
    await deps.storage.save(path, bytes, 'application/pdf');
    const attempts = [...current.attempts!];
    attempts[index] = { ...attempts[index], signedStoragePath: path, signedSha256: sha256(bytes), signedAt: params.at ?? deps.now().toISOString() };
    await target.update({ attempts });
    return { ...current, attempts };
  }
  // Já assinado: garante a publicação (idempotente), caso o processo tenha caído entre o arquivamento e a publicação.
  if (current.status === 'signed') {
    if (current.archivedDocumentId) await deps.publish(current.archivedDocumentId).catch(() => undefined);
    return current;
  }
  const at = params.at ?? deps.now().toISOString();
  if (params.eventType === 'signature.rejected') {
    await target.update({ status: 'refused', lastError: 'O trabalhador recusou a assinatura. Trate a divergência com ele.' });
    return { ...current, status: 'refused' as const };
  }
  if (params.eventType !== 'document.finished' || !params.signedUrl) return current;
  const signedBytes = await deps.downloadSigned(params.signedUrl);
  const pdf = await PDFDocument.load(signedBytes, { updateMetadata: false }).catch(() => null);
  if (!pdf) throw fail('PTRP_PACKAGE_SIGNED_INVALID', 'O arquivo assinado recebido não é um PDF válido.', 'DATA_INTEGRITY');
  const signedStoragePath = `${closingPackagePath(String(request.get('workspaceId')), current.competence, current.closureVersion, current.uid)}/t${current.attempt ?? 1}/assinado.pdf`;
  await deps.storage.save(signedStoragePath, signedBytes, 'application/pdf');
  const signedSha256 = sha256(signedBytes);
  const archivedDocumentId = `time_closing_${current.competence}_v${current.closureVersion}_${current.uid}`;
  const documentRef = deps.hrDb.collection(EMPLOYEE_DOCUMENTS).doc(archivedDocumentId);
  const [year, month] = current.competence.split('-');
  const label = `Espelho de ponto e contracheque — ${MONTHS[Number(month) - 1]} de ${year}`;
  const timestamp = Timestamp.fromDate(new Date(at));
  await deps.hrDb.runTransaction(async (tx) => {
    const existing = await tx.get(documentRef);
    if (!existing.exists) {
      tx.create(documentRef, {
        employeeId: current.employeeId, category: 'remuneration', documentType: 'Espelho de ponto e contracheque', documentTypeCode: 'TIME_CLOSING_PACKAGE',
        accessLevel: 'confidential', accessPolicyId: 'HR_FINANCE', status: 'validated', signatureRequired: true, signatureStatus: 'signed',
        folderCode: 'REMUNERATION', caseId: `month-${current.competence}`, subcaseId: null, destinationTrail: [year, MONTHS[Number(month) - 1]],
        displayName: label, storedName: `espelho-e-contracheque-${current.competence}.pdf`, originalName: `espelho-e-contracheque-${current.competence}.pdf`,
        mimeType: 'application/pdf', size: signedBytes.byteLength, contentHash: signedSha256, hashAlgorithm: 'sha256',
        logicalKey: `${current.employeeId}:TIME_CLOSING_PACKAGE:${current.competence}:v${current.closureVersion}`, version: current.closureVersion,
        versionResolution: 'NEW_DOCUMENT', storagePath: signedStoragePath, storageSubfolder: signedStoragePath.replace(/\/assinado\.pdf$/, ''),
        source: 'autentique_signature', signatureRequestId: params.signatureRequestId, providerDocumentId: current.providerDocumentId,
        employerSignatureStoragePath: current.employerSignature.storagePath, bundleSha256: current.bundle.sha256,
        signedAt: timestamp, validatedBy: 'system:autentique', validatedByName: 'Autentique', validatedAt: timestamp, uploadedAt: timestamp,
        updatedAt: timestamp, accessCount: 0, deletedAt: null,
      });
    }
    tx.update(target, { status: 'signed', signedAt: at, signedStoragePath, signedSha256, archivedDocumentId, lastError: null });
  });
  // Pasta do colaborador: o pacote assinado é publicado pela política do tipo; falha não desfaz o arquivamento
  // (o próximo aviso da Autentique tenta de novo).
  await deps.publish(archivedDocumentId).catch(() => undefined);
  return { ...current, status: 'signed' as const, signedAt: at, signedStoragePath, signedSha256, archivedDocumentId };
}

async function closedOrFail(deps: Dependencies, workspaceId: string, competence: string, expectedVersion: number) {
  const closure = (await deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence)).get()).data() as (ClosureRecord & { finalization?: unknown }) | undefined;
  if (closure?.status !== 'closed') throw fail('PTRP_PACKAGE_NOT_CLOSED', 'O mês precisa estar fechado.');
  if (closure.version !== expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.');
  return closure;
}

/** Situação dos fechamentos individuais e do fechamento geral da competência. */
export async function readClosingSummary(context: ServerUserContext, competence: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertClosureAccess(context, 'read');
  const closure = (await deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence)).get()).data() as (ClosureRecord & { finalization?: { at: string; by: string } | null }) | undefined;
  if (closure?.status !== 'closed') return { closure: closure ? { status: closure.status, version: closure.version } : null,
    counts: { total: 0, closed: 0, pending: 0, overdue: 0 }, people: [] as Array<{ uid: string; name: string | null; status: 'closed' | 'pending'; packageStatus: string; sentAt: string | null; closedAt: string | null; overdue: boolean }>,
    overdue: [] as Array<{ uid: string; name: string | null; status: string; sentAt: string | null }>, finalization: null };
  const versionRef = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence)).collection('versions').doc(String(closure.version));
  const [packs, subjects] = await Promise.all([versionRef.collection('packages').limit(501).get(), versionRef.collection('people').limit(501).get()]);
  if (packs.size > 500 || subjects.size > 500) throw fail('PTRP_FINALIZE_TOO_LARGE', 'O fechamento ultrapassa o limite de 500 pessoas.', 'DATA_INTEGRITY');
  const records = await Promise.all(packs.docs.map((doc) => withRefusal(deps, doc.data() as ClosingPackageRecord)));
  const byUid = new Map(records.map((record) => [record.uid, record]));
  const expected = new Set(subjects.docs.map((doc) => doc.id));
  if (records.some((record) => !expected.has(record.uid))) throw fail('PTRP_FINALIZE_SUBJECT_MISMATCH', 'Há pacote fora da lista congelada do fechamento.', 'DATA_INTEGRITY');
  const people = subjects.docs.map((doc) => {
    const person = doc.data() as { uid?: string; name?: string | null };
    const uid = person.uid ?? doc.id;
    const record = byUid.get(uid);
    const overdue = record ? isOverdue(record, deps.now()) : false;
    return { uid, name: person.name ?? null, status: record?.status === 'signed' ? 'closed' as const : 'pending' as const,
      packageStatus: record?.status ?? 'not_sent', sentAt: record?.sentAt ?? null, closedAt: record?.signedAt ?? null, overdue };
  }).sort((left, right) => (left.name ?? '').localeCompare(right.name ?? '', 'pt-BR') || left.uid.localeCompare(right.uid));
  const closed = people.filter((person) => person.status === 'closed').length;
  const overdue = people.filter((person) => person.overdue).map((person) => ({ uid: person.uid, name: person.name, status: person.packageStatus, sentAt: person.sentAt }));
  return { closure: { status: closure.status, version: closure.version }, counts: { total: people.length, closed, pending: people.length - closed, overdue: overdue.length }, people, overdue,
    finalization: closure.finalization ?? null };
}

/**
 * Finaliza o fechamento geral: somente depois que cada pessoa da versão congelada concluiu seu fechamento individual
 * pela assinatura do pacote. Tratamento administrativo, recusa ou decurso de 24 horas não substituem a assinatura.
 */
export async function finalizeClosingMonth(context: ServerUserContext, input: { competence: string; expectedVersion: number }, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertClosureAccess(context, 'close');
  const closure = await closedOrFail(deps, context.workspace_id, input.competence, input.expectedVersion);
  if (closure.finalization) return closure.finalization;
  const summary = await readClosingSummary(context, input.competence, deps);
  if (!summary.counts.total) throw fail('PTRP_FINALIZE_NO_PEOPLE', 'A versão do fechamento não tem colaboradores.');
  if (summary.counts.pending) throw fail('PTRP_FINALIZE_PENDING', `Há ${summary.counts.pending} ${summary.counts.pending === 1 ? 'fechamento individual pendente' : 'fechamentos individuais pendentes'}. O fechamento geral exige a assinatura de todos.`);
  const closureRef = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, input.competence));
  const finalization = { at: deps.now().toISOString(), by: context.decoded.uid, people: summary.counts.total, signed: summary.counts.closed };
  await deps.hrDb.runTransaction(async (tx) => {
    const current = await tx.get(closureRef);
    if (current.get('status') !== 'closed' || current.get('version') !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou. Atualize e confira.');
    if (!current.get('finalization')) tx.update(closureRef, { finalization });
  });
  await deps.notices.resolve(context.workspace_id, [closureNoticeKey(context.workspace_id, input.competence, input.expectedVersion)], true);
  return finalization;
}

export const closureNoticeKey = (workspaceId: string, competence: string, version: number) => `time-closing:${workspaceId}:${competence}:v${version}`;

/**
 * Rotina de hora em hora: para cada fechamento geral com pacote recusado ou sem assinatura há mais de 24 horas, mantém
 * aberto um aviso no sino dos responsáveis; o atraso nunca encerra o fechamento individual.
 */
export async function checkOverdueClosingPackages(workspaceId: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const now = deps.now();
  // Precisa de atenção: enviado (atraso de 24 h ou recusa vinda pela solicitação), recusado, com falha ou parado em envio.
  const packs = await deps.hrDb.collectionGroup('packages').where('status', 'in', ['sent', 'refused', 'failed', 'sending']).limit(1000).get();
  const overdueByClosure = new Map<string, { competence: string; version: number; count: number }>();
  for (const doc of packs.docs) {
    const closureRef = doc.ref.parent.parent?.parent.parent;
    if (!closureRef || closureRef.parent.id !== CLOSURES || !closureRef.id.startsWith(`${workspaceId}_`)) continue;
    const record = await withRefusal(deps, doc.data() as ClosingPackageRecord);
    const stuck = record.status === 'failed' || (record.status === 'sending' && now.getTime() - Date.parse(record.createdAt) > 10 * 60_000);
    if (!isOverdue(record, now) && !stuck) continue;
    const key = closureNoticeKey(workspaceId, record.competence, record.closureVersion);
    const entry = overdueByClosure.get(key) ?? { competence: record.competence, version: record.closureVersion, count: 0 };
    entry.count += 1;
    overdueByClosure.set(key, entry);
  }
  for (const [key, entry] of overdueByClosure) {
    await deps.notices.open({ workspaceId, category: 'dp.time-closing', dedupeKey: key, severity: 'warning', audience: 'dp.time-closure',
      title: `Fechamento de ${monthLabel(entry.competence)} não finalizado`,
      body: `${entry.count} ${entry.count === 1 ? 'fechamento individual está' : 'fechamentos individuais estão'} pendente${entry.count === 1 ? '' : 's'}: sem assinatura em 24 horas, recusado ou com falha no envio. O fechamento geral aguarda a assinatura de todos.`,
      path: '/dashboard/dp/fechamento' });
  }
  await deps.notices.resolve(workspaceId, [...overdueByClosure.keys()], false);
  return { checked: packs.size, overdueClosures: overdueByClosure.size };
}
