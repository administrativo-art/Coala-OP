import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

type CallableIdentity = {
  uid: string;
  token: Record<string, unknown>;
};

function sessionVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Callable Functions validate the Firebase ID token, but do not automatically
 * compare it with the application's account lifecycle. Keep that decision in
 * the canonical users document so suspension takes effect before token expiry.
 */
export async function assertActiveSession(
  db: Firestore,
  identity: CallableIdentity,
): Promise<void> {
  const userSnapshot = await db.collection('users').doc(identity.uid).get();
  if (!userSnapshot.exists) {
    throw new HttpsError('permission-denied', 'Conta sem cadastro ativo.');
  }

  const user = userSnapshot.data() ?? {};
  if (user.isActive === false || user.active === false) {
    throw new HttpsError('permission-denied', 'Conta inativa.');
  }

  if (sessionVersion(user.sessionVersion) !== sessionVersion(identity.token.sessionVersion)) {
    throw new HttpsError('permission-denied', 'Sessão expirada. Faça login novamente.');
  }
}
