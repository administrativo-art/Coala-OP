import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import type { ServerUserContext } from '@/lib/auth-server';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { AppError } from '@/lib/observability/app-error';
import { requireAbsenceWorkflowReady } from '../catalog.server';
import type { AbsenceAttachment } from './workflow-types';
import { resolveAbsenceBeneficiary } from './beneficiary.server';
import type { User } from '@/types';
import { absenceCivilDateSchema } from './schemas';

export type AbsenceFileStore = {
  bucketName: string;
  put(path: string, bytes: Buffer, mime: string, sha256: string): Promise<{ generation: string }>;
  verify(path: string, generation: string, sha256: string): Promise<boolean>;
  read(path: string, generation: string): Promise<Buffer>;
  remove(path: string, generation: string): Promise<void>;
  inspect(path: string, generation: string, sha256: string): Promise<'exact' | 'missing' | 'different'>;
  removeExact(path: string, generation: string): Promise<'removed' | 'missing' | 'different'>;
};
const bucket = () => getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
export const absenceFileStore: AbsenceFileStore = {
  bucketName: firebaseClientConfig.storageBucket,
  async put(path, bytes, mime, sha256) {
    const file = bucket().file(path);
    await file.save(bytes, { resumable: false, contentType: mime, metadata: { cacheControl: 'private, no-store', metadata: { sha256 } } });
    const [metadata] = await file.getMetadata();
    return { generation: String(metadata.generation) };
  },
  async verify(path, generation, sha256) {
    try {
      const [metadata] = await bucket().file(path).getMetadata();
      return String(metadata.generation) === generation && metadata.metadata?.sha256 === sha256;
    } catch { return false; }
  },
  async read(path, generation) {
    const [bytes] = await bucket().file(path, { generation: Number(generation) }).download();
    return bytes;
  },
  async remove(path, generation) {
    try { await bucket().file(path).delete({ ifGenerationMatch: generation }); }
    catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
  },
  async inspect(path, generation, sha256) {
    try {
      const [metadata] = await bucket().file(path).getMetadata();
      return String(metadata.generation) === generation && metadata.metadata?.sha256 === sha256
        ? 'exact' : 'different';
    } catch (error) {
      if (Number((error as { code?: unknown }).code) === 404) return 'missing';
      throw error;
    }
  },
  async removeExact(path, generation) {
    try {
      await bucket().file(path).delete({ ifGenerationMatch: generation });
      return 'removed';
    } catch (error) {
      const code = Number((error as { code?: unknown }).code);
      if (code === 404) return 'missing';
      if (code === 409 || code === 412) return 'different';
      throw error;
    }
  },
};

function mimeOf(bytes: Buffer): AbsenceAttachment['mime'] | null {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  return null;
}
export function terminationCivilDate(value: unknown): string | null {
  const candidate = typeof value === 'string' ? value
    : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
      ? value.toDate().toISOString().slice(0, 10) : null;
  return absenceCivilDateSchema.safeParse(candidate).success ? candidate : null;
}
export function retentionReviewAfter(date: string | null): string | null {
  if (!date || !absenceCivilDateSchema.safeParse(date).success) return null;
  const year = Number(date.slice(0, 4)) + 20;
  if (year > 9999) return null;
  const candidate = `${String(year).padStart(4, '0')}${date.slice(4)}`;
  return candidate.endsWith('-02-29') && !absenceCivilDateSchema.safeParse(candidate).success
    ? `${year}-02-28` : candidate;
}
function retention(beneficiary: User, sourceDocumentVersion: number | null): AbsenceAttachment['retention'] {
  const termination = beneficiary.terminationDate;
  const date = terminationCivilDate(termination);
  const reviewAfter = retentionReviewAfter(date);
  return { policy: 'employment_plus_20_years', source: 'coala.users.terminationDate',
    sourceVersion: termination && typeof (termination as { toMillis?: unknown }).toMillis === 'function'
      ? (termination as { toMillis(): number }).toMillis() : null,
    sourceDocumentVersion, terminationDate: date, reviewAfter };
}

export async function prepareAbsenceFiles(actor: ServerUserContext, form: FormData, store: AbsenceFileStore = absenceFileStore) {
  await requireAbsenceWorkflowReady();
  const beneficiaryUid = form.get('beneficiaryUid');
  const requestedUid = beneficiaryUid === null ? undefined : String(beneficiaryUid);
  const { beneficiary } = await resolveAbsenceBeneficiary(actor, requestedUid);
  const beneficiarySource = await dbAdmin.collection('users').doc(beneficiary.id).get();
  if (!beneficiarySource.exists) throw new AppError({ code: 'ABSENCE_BENEFICIARY_UNAVAILABLE', kind: 'NOT_FOUND' });
  const beneficiaryForRetention = { id: beneficiarySource.id, ...beneficiarySource.data() } as User;
  const sourceDocumentVersion = beneficiarySource.updateTime?.toMillis() ?? null;
  const parentRequestId = form.get('parentRequestId');
  const parentId = parentRequestId === null ? null : String(parentRequestId);
  if (parentId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(parentId)) throw new AppError({ code: 'ABSENCE_PREPARATION_INVALID', kind: 'VALIDATION' });
    const parent = await hrDbAdmin.collection('dp_absenceRequests').doc(parentId).get();
    if (!parent.exists || parent.get('workspaceId') !== actor.workspace_id || parent.get('requesterUid') !== actor.decoded.uid
      || parent.get('beneficiaryUid') !== beneficiary.id || !['draft', 'adjustments_requested'].includes(parent.get('status'))) {
      throw new AppError({ code: 'ABSENCE_PREPARATION_UNAVAILABLE', kind: 'NOT_FOUND' });
    }
  }
  const proposed = form.get('proposedRequestId');
  const requestId = proposed === null ? randomUUID() : String(proposed);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new AppError({ code: 'ABSENCE_PREPARATION_INVALID', kind: 'VALIDATION' });
  const raw = form.getAll('files');
  if (raw.length < 1 || raw.length > 5 || [...form.keys()].some((key) => !['files', 'proposedRequestId', 'beneficiaryUid', 'parentRequestId'].includes(key))) throw new AppError({ code: 'ABSENCE_PREPARATION_INVALID', kind: 'VALIDATION' });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const staged: Array<{ id: string; bytes: Buffer; mime: AbsenceAttachment['mime']; sha256: string }> = [];
  for (const item of raw) {
    if (!(item instanceof File) || item.size < 1 || item.size > 10 * 1024 * 1024) throw new AppError({ code: 'ABSENCE_FILE_INVALID', kind: 'VALIDATION', safeMessage: 'Arquivo inválido ou maior que 10 MB.' });
    const bytes = Buffer.from(await item.arrayBuffer());
    const mime = mimeOf(bytes);
    if (!mime || item.type !== mime) throw new AppError({ code: 'ABSENCE_FILE_INVALID', kind: 'VALIDATION', safeMessage: 'Use PDF, JPEG ou PNG válido.' });
    const id = randomUUID();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    staged.push({ id, bytes, mime, sha256 });
  }
  const ref = hrDbAdmin.collection('dp_absencePreparations').doc(requestId);
  const before = await ref.get();
  if (before.exists && (before.get('ownerUid') !== actor.decoded.uid || before.get('workspaceId') !== actor.workspace_id
    || before.get('beneficiaryUid') !== beneficiary.id || (before.get('parentRequestId') ?? null) !== parentId
    || before.get('status') !== 'prepared' || String(before.get('expiresAt')) <= now.toISOString()
    || ((before.get('files') ?? []) as unknown[]).length + staged.length > 5)) {
    throw new AppError({ code: 'ABSENCE_PREPARATION_UNAVAILABLE', kind: 'CONFLICT' });
  }
  const files: AbsenceAttachment[] = [];
  try {
    for (const item of staged) {
      const storagePath = `absence-requests/${actor.workspace_id}/${parentId ?? requestId}/${actor.decoded.uid}/${item.id}`;
      const { generation } = await store.put(storagePath, item.bytes, item.mime, item.sha256);
      files.push({ id: item.id, mime: item.mime, size: item.bytes.length, sha256: item.sha256,
        storagePath, generation, classification: 'sensitive', retention: retention(beneficiaryForRetention, sourceDocumentVersion) });
    }
    await hrDbAdmin.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (snapshot.exists && (snapshot.get('ownerUid') !== actor.decoded.uid || snapshot.get('workspaceId') !== actor.workspace_id
        || snapshot.get('beneficiaryUid') !== beneficiary.id || (snapshot.get('parentRequestId') ?? null) !== parentId
        || snapshot.get('status') !== 'prepared' || String(snapshot.get('expiresAt')) <= now.toISOString())) {
        throw new AppError({ code: 'ABSENCE_PREPARATION_UNAVAILABLE', kind: 'CONFLICT' });
      }
      const old = snapshot.exists ? snapshot.get('files') as AbsenceAttachment[] : [];
      if (old.length + files.length > 5) throw new AppError({ code: 'ABSENCE_FILE_LIMIT', kind: 'VALIDATION', safeMessage: 'São permitidos até cinco arquivos.' });
      tx.set(ref, { ownerUid: actor.decoded.uid, beneficiaryUid: beneficiary.id, workspaceId: actor.workspace_id,
        ...(parentId ? { parentRequestId: parentId } : {}),
        status: 'prepared', files: [...old, ...files], createdAt: snapshot.exists ? snapshot.get('createdAt') : now.toISOString(), expiresAt, updatedAt: now.toISOString() });
      tx.create(hrDbAdmin.collection('dp_absenceAudit').doc(`prepare_${requestId}_${randomUUID()}`), {
        workspaceId: actor.workspace_id, actorUid: actor.decoded.uid, beneficiaryUid: beneficiary.id,
        action: 'files_prepared', fileCount: files.length, requestId, at: now.toISOString(), ttl: new Date(now.getTime() + 365 * 86_400_000),
      });
    });
  } catch (error) {
    const cleanup = await Promise.allSettled(files.map((file) => store.remove(file.storagePath, file.generation)));
    if (cleanup.some((entry) => entry.status === 'rejected')) throw new AppError({ code: 'ABSENCE_PREPARATION_CLEANUP_FAILED', kind: 'UNEXPECTED_APPLICATION', safeMessage: 'Falha ao preparar comprovantes. Contate o suporte.' });
    throw error;
  }
  return { proposedRequestId: requestId, preparationIds: files.map((file) => file.id), expiresAt };
}

export async function verifyAbsenceFiles(files: AbsenceAttachment[], store: AbsenceFileStore = absenceFileStore) {
  for (const file of files) if (!await store.verify(file.storagePath, file.generation, file.sha256)) {
    throw new AppError({ code: 'ABSENCE_FILE_MISSING', kind: 'CONFLICT', safeMessage: 'Um comprovante não está mais disponível. Envie novamente.' });
  }
}

export async function removeExpiredAbsencePreparations(limit = 50, store: AbsenceFileStore = absenceFileStore) {
  const snapshot = await hrDbAdmin.collection('dp_absencePreparations').where('status', 'in', ['prepared', 'expiring', 'cleanup_failed'])
    .where('expiresAt', '<', new Date().toISOString()).limit(Math.min(limit, 50)).get();
  for (const document of snapshot.docs) {
    const claimed = await hrDbAdmin.runTransaction(async (tx) => {
      const current = await tx.get(document.ref);
      if (!current.exists || !['prepared', 'expiring', 'cleanup_failed'].includes(current.get('status'))
        || String(current.get('expiresAt')) >= new Date().toISOString()) return false;
      tx.update(document.ref, { status: 'expiring', updatedAt: new Date().toISOString() });
      return true;
    });
    if (!claimed) continue;
    try {
      for (const file of document.get('files') as AbsenceAttachment[]) await store.remove(file.storagePath, file.generation);
      await document.ref.update({ status: 'expired', updatedAt: new Date().toISOString() });
    } catch (error) {
      await document.ref.update({ status: 'cleanup_failed', updatedAt: new Date().toISOString() });
      throw new AppError({ code: 'ABSENCE_PREPARATION_CLEANUP_FAILED', kind: 'UNEXPECTED_APPLICATION', cause: error });
    }
  }
  return snapshot.size;
}
