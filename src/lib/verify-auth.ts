import { NextRequest } from 'next/server';
import { requiresProfileCompliance } from '@/features/hr/profile-compliance-access.server';
import { authAdmin, dbAdmin } from './firebase-admin';

/**
 * Verifica o Firebase ID Token enviado no header Authorization: Bearer <token>.
 * Lança erro se o token estiver ausente, malformado ou inválido.
 */
export async function verifyAuth(
  req: NextRequest,
  options: { enforceProfileCompliance?: boolean } = {},
) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Authorization header ausente ou inválido.');
  }
  const idToken = authHeader.slice(7);
  const decoded = await authAdmin.verifyIdToken(idToken);
  if (options.enforceProfileCompliance !== false) {
    const userSnap = await dbAdmin.collection('users').doc(decoded.uid).get();
    if (!userSnap.exists) throw new Error('Usuário não encontrado.');
    if (requiresProfileCompliance(userSnap.data() ?? {}, req)) {
      throw new Error('Atualização cadastral obrigatória pendente.');
    }
  }
  return decoded;
}
