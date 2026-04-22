import { NextRequest } from 'next/server';

import { type User, type Profile } from '@/types';

import { dbAdmin } from './firebase-admin';
import { verifyAuth } from './verify-auth';

export type SignageAccess = {
  user: User;
  isAdmin: boolean;
  canView: boolean;
  canManage: boolean;
  allowedKioskIds: string[];
};

export async function assertSignageAccess(req: NextRequest, mode: 'view' | 'manage' = 'view'): Promise<SignageAccess> {
  const decodedToken = await verifyAuth(req);
  const isAdmin = decodedToken.isDefaultAdmin === true;
  const fallbackUser: User = {
    id: decodedToken.uid,
    username: typeof decodedToken.name === 'string' ? decodedToken.name : decodedToken.email ?? 'Admin',
    email: decodedToken.email ?? '',
    profileId: typeof decodedToken.profileId === 'string' ? decodedToken.profileId : '',
    assignedKioskIds: Array.isArray(decodedToken.assignedKioskIds)
      ? decodedToken.assignedKioskIds.filter((value): value is string => typeof value === 'string')
      : [],
  };

  if (isAdmin) {
    return {
      user: fallbackUser,
      isAdmin: true,
      canView: true,
      canManage: true,
      allowedKioskIds: [],
    };
  }

  const userSnap = await dbAdmin.collection('users').doc(decodedToken.uid).get();

  if (!userSnap.exists) {
    throw new Error('Usuário não encontrado no ERP.');
  }

  const user = { id: userSnap.id, ...userSnap.data() } as User;

  let canView = false;
  let canManage = false;

  const profileId = decodedToken.profileId ?? user.profileId;
  if (profileId) {
    const profileSnap = await dbAdmin.collection('profiles').doc(profileId).get();
    const profile = profileSnap.exists ? ({ id: profileSnap.id, ...profileSnap.data() } as Profile) : null;
    canView = profile?.permissions?.signage?.view === true || profile?.permissions?.signage?.manage === true;
    canManage = profile?.permissions?.signage?.manage === true;
  }

  if (mode === 'view' && !canView && !canManage) {
    throw new Error('Sem permissão para acessar o signage.');
  }

  if (mode === 'manage' && !canManage) {
    throw new Error('Sem permissão para gerenciar o signage.');
  }

  return {
    user,
    isAdmin,
    canView,
    canManage,
    allowedKioskIds: isAdmin ? [] : user.assignedKioskIds ?? [],
  };
}
