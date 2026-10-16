import type { User as FirebaseUser } from 'firebase/auth';
import { authenticatedApiRequest } from '@/lib/authenticated-api-client';

export type UserNotification = {
  id: string; title: string; body: string; path: string; eventId: string;
  createdAt: string; readAt: string | null;
};

export function listUserNotifications(firebaseUser: FirebaseUser, cursor?: string) {
  const query = new URLSearchParams({ limit: '25' });
  if (cursor) query.set('cursor', cursor);
  return authenticatedApiRequest<{ notifications: UserNotification[]; nextCursor: string | null }>(`/api/user-notifications?${query}`, {
    getIdToken: () => firebaseUser.getIdToken(), fallbackError: 'Não foi possível carregar os avisos.',
  });
}

export function markUserNotificationsRead(firebaseUser: FirebaseUser, ids: string[]) {
  return authenticatedApiRequest<{ marked: number }>('/api/user-notifications', {
    method: 'PATCH', getIdToken: () => firebaseUser.getIdToken(), json: { ids },
    fallbackError: 'Não foi possível marcar os avisos como lidos.',
  });
}
