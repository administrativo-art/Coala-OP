import { randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { subjectKey, type SubjectRef } from './person-subject';

export const PERSON_CURSOR_TTL_MS = 15 * 60_000;
function invalid() { return new AppError({ code: 'PERSON_CURSOR_INVALID', kind: 'VALIDATION', safeMessage: 'Continuação inválida ou expirada. Reinicie a consulta.' }); }
function binding(actor: ServerUserContext, sourceId: string, ref: SubjectRef, limit: number) {
  return { schemaVersion: 1, realActorUid: actor.authenticatedActor?.uid ?? actor.decoded.uid, effectiveActorUid: actor.decoded.uid,
    viewAsTargetUserId: actor.viewAs?.targetUserId ?? null, workspaceId: actor.workspace_id, subjectKey: subjectKey(ref), sourceId, limit };
}
export async function savePersonCursor(actor: ServerUserContext, sourceId: string, ref: SubjectRef, limit: number, position: string) {
  const token = `pc1_${randomBytes(32).toString('base64url')}`;
  const bound = binding(actor, sourceId, ref, limit);
  const now = Date.now();
  await dbAdmin.collection('privacyPersonCursorStates').doc(token).create({ ...bound, position,
    subjectKeys: [subjectKey(ref)], actorKeys: [...new Set([bound.realActorUid, bound.effectiveActorUid])].map((id) => subjectKey({ namespace: 'main.users', id })),
    createdAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + PERSON_CURSOR_TTL_MS) });
  return token;
}
/** Retryable until expiry; the caller rechecks source and record authorization on every read. */
export async function readPersonCursor(token: string, actor: ServerUserContext, sourceId: string, ref: SubjectRef, limit: number) {
  if (!/^pc1_[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
  const expected = binding(actor, sourceId, ref, limit);
  const snapshot = await dbAdmin.collection('privacyPersonCursorStates').doc(token).get();
  const state = snapshot.data();
  if (!state || Object.entries(expected).some(([key, value]) => state[key] !== value)
    || !(state.expiresAt instanceof Timestamp) || state.expiresAt.toMillis() <= Date.now()
    || typeof state.position !== 'string' || !state.position || state.position.includes('/')) throw invalid();
  return state.position as string;
}
