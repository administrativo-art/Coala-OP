import type { User, UserPdvAccess } from '@/types';

export function activePdvPasswordAccesses(user: Pick<User,
  'pdvAccesses' | 'pdvAccessEnabled' | 'registrationIdPdv' | 'pdvAccessFilialId' | 'pdvAccessFilialName' | 'pdvAccessProfileId'
>): UserPdvAccess[] {
  if (user.pdvAccessEnabled === false) return [];
  if (user.pdvAccesses?.length) {
    return user.pdvAccesses.filter((access) => access.status === 'active' && /^\d+$/.test(access.externalUserId) && /^\d+$/.test(access.filialId));
  }
  if (!user.registrationIdPdv || !/^\d+$/.test(user.registrationIdPdv) || !user.pdvAccessFilialId || !/^\d+$/.test(user.pdvAccessFilialId)) return [];
  return [{
    externalUserId: user.registrationIdPdv,
    filialId: user.pdvAccessFilialId,
    filialName: user.pdvAccessFilialName,
    profileId: user.pdvAccessProfileId ?? '',
    status: 'active',
  }];
}
