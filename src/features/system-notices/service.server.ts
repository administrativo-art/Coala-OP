import 'server-only';

import { createHash } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { buildPermissionSet } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { resolveUnitAccess } from '@/lib/unit-access';
import type { User } from '@/types';

import { belongsToSystemNoticeAudience, canViewSystemNotices, systemNoticeAudiencesFor,
  type SystemNoticeActor, type SystemNoticeAudience, type SystemNoticeCategory, type SystemNoticeSeverity } from './core';

const NOTICES = 'systemNotices';
const MAX_BELL_RECIPIENTS = 50;
const PAGE_SIZE = 50;

export type SystemNoticeInput = Readonly<{
  workspaceId: string; category: SystemNoticeCategory; dedupeKey: string; severity: SystemNoticeSeverity;
  audience: SystemNoticeAudience; title: string; body: string; path: string | null;
}>;

function noticeId(workspaceId: string, dedupeKey: string) {
  return createHash('sha256').update(JSON.stringify([workspaceId, dedupeKey])).digest('hex');
}

export function systemNoticeActor(context: Pick<ServerUserContext, 'isDefaultAdmin' | 'permissions' | 'userDoc'>): SystemNoticeActor {
  return { isDefaultAdmin: context.isDefaultAdmin, permissions: context.permissions,
    allUnits: resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin }).allUnits };
}

/**
 * Abre o aviso uma única vez por `dedupeKey`. Reexecuções do job não duplicam nem reabrem
 * um aviso já resolvido; um marco novo usa outra chave.
 */
export async function openSystemNotice(input: SystemNoticeInput, now = new Date(), database: Firestore = dbAdmin) {
  const ref = database.collection(NOTICES).doc(noticeId(input.workspaceId, input.dedupeKey));
  const created = await database.runTransaction(async (transaction) => {
    if ((await transaction.get(ref)).exists) return false;
    transaction.create(ref, { schemaVersion: 1, ...input, status: 'open', createdAt: now.toISOString(),
      updatedAt: now.toISOString(), resolvedAt: null, resolvedReason: null });
    return true;
  });
  if (created) await deliverSystemNoticeToBell(ref.id, database);
  return { noticeId: ref.id, created };
}

/** Resolve os avisos abertos da categoria, exceto as chaves que continuam vigentes. */
export async function resolveSystemNotices(params: {
  workspaceId: string; category: SystemNoticeCategory; keepDedupeKeys?: readonly string[]; reason: string;
}, now = new Date(), database: Firestore = dbAdmin) {
  const open = await database.collection(NOTICES).where('workspaceId', '==', params.workspaceId)
    .where('category', '==', params.category).where('status', '==', 'open').limit(100).get();
  const keep = new Set(params.keepDedupeKeys ?? []);
  const stale = open.docs.filter((document) => !keep.has(String(document.get('dedupeKey'))));
  if (!stale.length) return 0;
  const batch = database.batch();
  for (const document of stale) {
    batch.update(document.ref, { status: 'resolved', resolvedAt: now.toISOString(), resolvedReason: params.reason,
      updatedAt: now.toISOString() });
  }
  await batch.commit();
  return stale.length;
}

/**
 * Entrega no sino de quem pode ver a central e pertence ao público do aviso. A elegibilidade vem
 * do perfil; administradores definidos só por claim do token veem o aviso na central, não no sino.
 */
async function deliverSystemNoticeToBell(id: string, database: Firestore) {
  const notice = await database.collection(NOTICES).doc(id).get();
  const audience = notice.get('audience') as SystemNoticeAudience;
  const workspaceId = String(notice.get('workspaceId'));
  const profiles = await database.collection('profiles').limit(200).get();
  const eligibleProfiles = profiles.docs.filter((profile) => {
    const isDefaultAdmin = profile.get('isDefaultAdmin') === true;
    const permissions = buildPermissionSet(profile.get('permissions'), isDefaultAdmin);
    // Unidade é conferida por usuário abaixo; aqui só a permissão do perfil.
    const actor = { isDefaultAdmin, permissions, allUnits: true };
    return canViewSystemNotices(actor) && belongsToSystemNoticeAudience(actor, audience);
  });
  const recipients: { uid: string }[] = [];
  for (let index = 0; index < eligibleProfiles.length && recipients.length < MAX_BELL_RECIPIENTS; index += 30) {
    const chunk = eligibleProfiles.slice(index, index + 30);
    const users = await database.collection('users').where('profileId', 'in', chunk.map((profile) => profile.id))
      .where('isActive', '==', true).limit(MAX_BELL_RECIPIENTS).get();
    for (const user of users.docs) {
      const profile = chunk.find((item) => item.id === user.get('profileId'))!;
      const isDefaultAdmin = profile.get('isDefaultAdmin') === true;
      const actor = { isDefaultAdmin, permissions: buildPermissionSet(profile.get('permissions'), isDefaultAdmin),
        allUnits: resolveUnitAccess({ ...(user.data() as User) }, { isDefaultAdmin }).allUnits };
      if (belongsToSystemNoticeAudience(actor, audience) && recipients.length < MAX_BELL_RECIPIENTS) recipients.push({ uid: user.id });
    }
  }
  const createdAt = String(notice.get('createdAt'));
  await Promise.all(recipients.map(({ uid }) => database.collection('userNotifications')
    .doc(createHash('sha256').update(`system-notice:${id}:${uid}`).digest('hex'))
    .create({ ownerUid: uid, workspaceId, sourceEventId: `systemNotices/${id}`, eventId: id,
      title: String(notice.get('title')), body: String(notice.get('body')), path: '/dashboard/system-notices',
      readAt: null, createdAt })
    .catch(() => undefined)));
  return recipients.length;
}

/** Central: só avisos dos públicos do ator, filtrados no Firestore e paginados. */
export async function listSystemNotices(context: ServerUserContext, input: { status: 'open' | 'resolved'; cursor?: string },
  database: Firestore = dbAdmin) {
  const actor = systemNoticeActor(context);
  if (!canViewSystemNotices(actor)) {
    throw new AppError({ code: 'SYSTEM_NOTICES_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para ver avisos do sistema.' });
  }
  const audiences = systemNoticeAudiencesFor(actor);
  if (!audiences.length) return { notices: [], nextCursor: null };
  let query = database.collection(NOTICES).where('workspaceId', '==', context.workspace_id)
    .where('audience', 'in', audiences).where('status', '==', input.status).orderBy('createdAt', 'desc');
  if (input.cursor) {
    const cursor = await database.collection(NOTICES).doc(input.cursor).get();
    if (!cursor.exists || cursor.get('workspaceId') !== context.workspace_id || !audiences.includes(cursor.get('audience'))) {
      throw new AppError({ code: 'SYSTEM_NOTICES_CURSOR_INVALID', kind: 'VALIDATION', safeMessage: 'Página inválida.' });
    }
    query = query.startAfter(cursor);
  }
  const snapshot = await query.limit(PAGE_SIZE + 1).get();
  return {
    notices: snapshot.docs.slice(0, PAGE_SIZE).map((document) => ({ id: document.id,
      category: document.get('category') as SystemNoticeCategory, severity: document.get('severity') as SystemNoticeSeverity,
      title: String(document.get('title')), body: String(document.get('body')), path: (document.get('path') as string | null) ?? null,
      status: document.get('status') as 'open' | 'resolved', createdAt: String(document.get('createdAt')),
      resolvedAt: (document.get('resolvedAt') as string | null) ?? null, resolvedReason: (document.get('resolvedReason') as string | null) ?? null })),
    nextCursor: snapshot.size > PAGE_SIZE ? snapshot.docs[PAGE_SIZE - 1].id : null,
  };
}
