import { NextRequest } from 'next/server';
import { authAdmin } from './firebase-admin';

/**
 * Verifica o Firebase ID Token enviado no header Authorization: Bearer <token>.
 * Lança erro se o token estiver ausente, malformado ou inválido.
 */
export async function verifyAuth(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Authorization header ausente ou inválido.');
  }
  const idToken = authHeader.slice(7);
  return authAdmin.verifyIdToken(idToken);
}
