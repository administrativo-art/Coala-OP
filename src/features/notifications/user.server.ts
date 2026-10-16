import 'server-only';

import { FieldPath } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';

const collection = dbAdmin.collection('userNotifications');
const deny = () => new AppError({ code: 'USER_NOTIFICATION_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Aviso indisponível.' });
export async function listUserNotifications(actor: ServerUserContext, input: { limit: number; cursor?: string }) {
  let query: FirebaseFirestore.Query = collection.where('workspaceId', '==', actor.workspace_id)
    .where('ownerUid', '==', actor.decoded.uid).orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (input.cursor) {
    const cursor = await collection.doc(input.cursor).get();
    if (!cursor.exists || cursor.get('workspaceId') !== actor.workspace_id || cursor.get('ownerUid') !== actor.decoded.uid) throw deny();
    query = query.startAfter(cursor);
  }
  const snapshot = await query.limit(input.limit + 1).get();
  return { notifications: snapshot.docs.slice(0, input.limit).map((doc) => ({ id: doc.id,
    title: doc.get('title'), body: doc.get('body'), path: doc.get('path'), eventId: doc.get('eventId'),
    createdAt: doc.get('createdAt'), readAt: doc.get('readAt') ?? null })),
  nextCursor: snapshot.size > input.limit ? snapshot.docs[input.limit - 1].id : null };
}

export async function markUserNotificationsRead(actor: ServerUserContext, ids: string[]) {
  const unique = [...new Set(ids)];
  const marked = await dbAdmin.runTransaction(async (tx) => {
    const docs = await Promise.all(unique.map((id) => tx.get(collection.doc(id))));
    if (docs.some((doc) => !doc.exists || doc.get('ownerUid') !== actor.decoded.uid || doc.get('workspaceId') !== actor.workspace_id)) throw deny();
    const now = new Date().toISOString();
    const unread = docs.filter((doc) => !doc.get('readAt'));
    if (!unread.length) return 0;
    unread.forEach((doc) => tx.update(doc.ref, { readAt: now }));
    tx.create(dbAdmin.collection('actionLogs').doc(), { workspace_id: actor.workspace_id,
      user_id: actor.decoded.uid, module: 'user.notifications', action: 'marked_read',
      metadata: { count: unread.length }, timestamp: new Date(), ttl: new Date(Date.now() + 365 * 86_400_000) });
    return unread.length;
  });
  return { marked };
}
