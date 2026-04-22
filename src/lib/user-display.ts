import { type User } from '@/types';

export type UserIdentityLike = Partial<Pick<User, 'id' | 'username' | 'email' | 'registrationIdBizneo' | 'registrationIdPdv'>>;

export function looksLikeOpaqueUserIdentifier(value?: string | null): boolean {
  if (!value) return true;

  const trimmed = value.trim();
  if (!trimmed) return true;

  return /^[A-Za-z0-9_-]{20,}$/.test(trimmed);
}

export function getUserDisplayName(user?: UserIdentityLike | null, fallbackId?: string | null): string {
  const candidates = [
    user?.username,
    user?.email?.split('@')[0],
    user?.registrationIdBizneo,
    user?.registrationIdPdv,
    fallbackId ?? undefined,
  ];

  const preferred = candidates.find(candidate => candidate && !looksLikeOpaqueUserIdentifier(candidate));
  return preferred ?? 'Colaborador';
}

export function pickUserIdentitySnapshot(id: string, data: Record<string, unknown>): UserIdentityLike {
  const username = typeof data.username === 'string' ? data.username : undefined;
  const email = typeof data.email === 'string' ? data.email : undefined;
  const registrationIdBizneo = typeof data.registrationIdBizneo === 'string' ? data.registrationIdBizneo : undefined;
  const registrationIdPdv = typeof data.registrationIdPdv === 'string' ? data.registrationIdPdv : undefined;

  return {
    id,
    username,
    email,
    registrationIdBizneo,
    registrationIdPdv,
  };
}
