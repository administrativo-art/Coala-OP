import 'server-only';

import { createHash } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { PDFDocument } from 'pdf-lib';

import { signPtrpDetached } from '@/features/dp/rep-p/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { createAutentiqueDocument } from '@/lib/autentique.server';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { getHrEmployeeId } from '@/lib/hr/person-link';
import { AppError } from '@/lib/observability/app-error';

import { closingPackagePath, composeClosingPackage } from './closing-package';
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
};
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, storage: bucketStorage, now: () => new Date(), sign: (bytes) => signPtrpDetached(bytes),
  createDocument: createAutentiqueDocument, downloadSigned: downloadAutentiqueSigned, mirror: {} };

export type ClosingPackageRecord = {
  schemaVersion: 1; status: 'sending' | 'sent' | 'signed' | 'refused' | 'failed'; uid: string; employeeId: string; competence: string; closureVersion: number;
  mirrorHash: string; payslip: { documentId: string; sha256: string }; bundle: { storagePath: string; sha256: string; pageCount: number };
  employerSignature: { storagePath: string; certificateCnpj: string }; signatureRequestId: string; providerDocumentId: string | null;
  createdBy: string; createdAt: string; sentAt: string | null; signedAt: string | null; signedStoragePath: string | null; signedSha256: string | null;
  archivedDocumentId: string | null; lastError: string | null;
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

async function readiness(deps: Dependencies, workspaceId: string, competence: string, uid: string) {
  const closure = (await deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence)).get()).data() as ClosureRecord | undefined;
  const user = await deps.mainDb.collection('users').doc(uid).get();
  if (!user.exists) throw fail('PTRP_PACKAGE_SUBJECT_INVALID', 'Pessoa não encontrada.', 'NOT_FOUND');
  const employeeId = getHrEmployeeId({ id: uid, hrEmployeeId: text(user.get('hrEmployeeId')), registrationIdBizneo: text(user.get('registrationIdBizneo')) })!;
  const [payslip, pack] = await Promise.all([findPayslip(deps, employeeId, competence),
    closure?.status === 'closed' ? packageRef(deps, workspaceId, competence, closure.version, uid).get() : Promise.resolve(null)]);
  const record = (pack?.data() as ClosingPackageRecord | undefined) ?? null;
  return { closure, user, employeeId, payslip, pack: record ? await withRefusal(deps, record) : null };
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
    package: pack ? { status: pack.status, sentAt: pack.sentAt, signedAt: pack.signedAt, lastError: pack.lastError } : null,
  };
}

/**
 * POST (DP, `dp.timeClosure.close`): monta o pacote da pessoa no mês fechado (espelho gerado uma vez por versão e
 * contracheque do mês), assina com o e-CNPJ em arquivo destacado, guarda os dois e envia o PDF à Autentique para a
 * assinatura do trabalhador. Uma vez por pessoa e versão do fechamento; falha de envio pode ser repetida.
 */
export async function sendClosingPackage(context: ServerUserContext, input: ClosingPackageActionInput, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertClosureAccess(context, 'close');
  const { closure, user, employeeId, payslip, pack } = await readiness(deps, context.workspace_id, input.competence, input.employeeUid);
  if (closure?.status !== 'closed') throw fail('PTRP_PACKAGE_NOT_CLOSED', 'O pacote sai depois do fechamento do mês.');
  if (closure.version !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.');
  if (pack && !(await retryable(deps, pack))) return pack;
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
  const base = `${closingPackagePath(context.workspace_id, input.competence, closure.version, input.employeeUid)}/${bundle.sha256.slice(0, 16)}`;
  await deps.storage.save(`${base}/pacote.pdf`, bundle.bytes, 'application/pdf');
  await deps.storage.save(`${base}/pacote.pdf.p7s`, Buffer.from(signed.bytes), 'application/pkcs7-signature');

  const now = deps.now().toISOString();
  const signatureRequestId = requestIdOf(context.workspace_id, input.competence, closure.version, input.employeeUid);
  const target = packageRef(deps, context.workspace_id, input.competence, closure.version, input.employeeUid);
  const closureRef = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, input.competence));
  const record: ClosingPackageRecord = {
    schemaVersion: 1, status: 'sending', uid: input.employeeUid, employeeId, competence: input.competence, closureVersion: closure.version,
    mirrorHash: mirror.snapshotHash, payslip: { documentId: payslip.id, sha256: sha256(payslipBytes) },
    bundle: { storagePath: `${base}/pacote.pdf`, sha256: bundle.sha256, pageCount: bundle.pageCount },
    employerSignature: { storagePath: `${base}/pacote.pdf.p7s`, certificateCnpj: signed.certificateCnpj }, signatureRequestId, providerDocumentId: null,
    createdBy: context.decoded.uid, createdAt: now, sentAt: null, signedAt: null, signedStoragePath: null, signedSha256: null, archivedDocumentId: null, lastError: null,
  };
  const started = await deps.hrDb.runTransaction(async (tx) => {
    const [again, current] = await Promise.all([tx.get(target), tx.get(closureRef)]);
    if (current.get('status') !== 'closed' || current.get('version') !== closure.version) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou durante o envio. Atualize e confira.');
    if (again.exists && !(await retryable(deps, again.data() as ClosingPackageRecord))) return again.data() as ClosingPackageRecord;
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
  if (!current || current.status === 'signed') return current ?? null;
  const at = params.at ?? deps.now().toISOString();
  if (params.eventType === 'signature.rejected') {
    await target.update({ status: 'refused', lastError: 'O trabalhador recusou a assinatura. Trate a divergência com ele.' });
    return { ...current, status: 'refused' as const };
  }
  if (params.eventType !== 'document.finished' || !params.signedUrl) return current;
  const signedBytes = await deps.downloadSigned(params.signedUrl);
  const pdf = await PDFDocument.load(signedBytes, { updateMetadata: false }).catch(() => null);
  if (!pdf) throw fail('PTRP_PACKAGE_SIGNED_INVALID', 'O arquivo assinado recebido não é um PDF válido.', 'DATA_INTEGRITY');
  const signedStoragePath = `${closingPackagePath(String(request.get('workspaceId')), current.competence, current.closureVersion, current.uid)}/assinado.pdf`;
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
  return { ...current, status: 'signed' as const, signedAt: at, signedStoragePath, signedSha256, archivedDocumentId };
}
