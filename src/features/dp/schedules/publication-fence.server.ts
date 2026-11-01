import 'server-only';

import { createHash } from 'node:crypto';
import { Timestamp, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';

// A fixed number of shards bounds the pointer transaction even when 500 shifts
// belong to 500 different people. Every schedule occupancy writer must advance
// the same shard in its own transaction before this fence can guard publication.
const SHARD_COUNT = 64;
const MAX_PARTICIPANTS = 1_000;

function invalid(): never {
  throw new AppError({ code: 'DP_PUBLICATION_FENCE_INVALID', kind: 'DATA_INTEGRITY',
    safeMessage: 'A barreira de publicação está inconsistente.' });
}

function refs(workspaceId: string, userIds: Iterable<string>) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) invalid();
  const users = [...new Set(userIds)];
  if (users.length > MAX_PARTICIPANTS || users.some((id) => !id || id.includes('/'))) invalid();
  const shards = [...new Set(users.map((id) => Number.parseInt(createHash('sha256')
    .update(`${workspaceId}:${id}`).digest('hex').slice(0, 8), 16) % SHARD_COUNT))].sort((a, b) => a - b);
  return shards.map((shard) => dbAdmin.collection('dp_schedulePublicationFences').doc(`${workspaceId}_${shard}`));
}

function version(snapshot: DocumentSnapshot, workspaceId: string) {
  if (!snapshot.exists) return 0;
  const value = snapshot.get('version');
  if (snapshot.get('workspaceId') !== workspaceId || !Number.isSafeInteger(value) || value < 0
    || value === Number.MAX_SAFE_INTEGER) invalid();
  return value as number;
}

/** Capture before reading shifts/availability; compare in the final pointer transaction. */
export async function capturePublicationFence(workspaceId: string, userIds: Iterable<string>) {
  const documents = await Promise.all(refs(workspaceId, userIds).map((ref) => ref.get()));
  return new Map(documents.map((snapshot) => [snapshot.ref.path, version(snapshot, workspaceId)]));
}

/** Must be called after all reads and before writes in each occupancy writer's transaction. */
export async function preparePublicationFenceAdvance(tx: Transaction, workspaceId: string, userIds: Iterable<string>) {
  const documents = await Promise.all(refs(workspaceId, userIds).map((ref) => tx.get(ref)));
  const versions = documents.map((snapshot) => version(snapshot, workspaceId));
  return { apply() {
    const now = Timestamp.now();
    documents.forEach((snapshot, index) => tx.set(snapshot.ref,
      { workspaceId, shard: Number(snapshot.id.slice(snapshot.id.lastIndexOf('_') + 1)),
        version: versions[index] + 1, updatedAt: now }));
  } };
}

/** Final pointer transaction: validate the preflight view and advance its shards. */
export async function preparePublicationFenceCommit(tx: Transaction, workspaceId: string,
  userIds: Iterable<string>, captured: ReadonlyMap<string, number>) {
  const documents = await Promise.all(refs(workspaceId, userIds).map((ref) => tx.get(ref)));
  if (documents.length !== captured.size || documents.some((snapshot) => captured.get(snapshot.ref.path) !== version(snapshot, workspaceId))) {
    throw new AppError({ code: 'DP_SCHEDULE_PUBLICATION_OCCUPANCY_CHANGED', kind: 'CONFLICT',
      safeMessage: 'A disponibilidade das pessoas mudou durante a publicação. Revise e tente novamente.' });
  }
  return { apply() {
    const now = Timestamp.now();
    documents.forEach((snapshot) => tx.set(snapshot.ref,
      { workspaceId, shard: Number(snapshot.id.slice(snapshot.id.lastIndexOf('_') + 1)),
        version: version(snapshot, workspaceId) + 1, updatedAt: now }));
  } };
}
