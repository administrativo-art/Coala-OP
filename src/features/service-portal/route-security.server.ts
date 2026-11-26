import 'server-only';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';

export const PORTAL_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-coala-provider' : 'coala-provider';
export function assertPortalOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  let sameOrigin = false;
  try {
    const source = new URL(origin ?? '');
    const secure = source.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && source.protocol === 'http:');
    sameOrigin = secure && source.origin === origin && source.host === request.headers.get('host');
  } catch { sameOrigin = false; }
  if (!sameOrigin) {
    throw new AppError({ code: 'PROVIDER_PORTAL_ORIGIN', kind: 'AUTHORIZATION', safeMessage: 'Abra o portal e tente novamente.' });
  }
}
export function publicPortalContract(path: `/api/${string}`) {
  return defineSecurityContract({
    schemaVersion: 1, id: 'service-portal.' + path.split('/').at(-1), version: 1,
    surface: { method: 'POST', path }, exposure: 'public', identity: { kind: 'none' },
    authorization: { kind: 'none' }, resourceScope: { kind: 'none' },
    input: { kind: 'schema', schema: 'service-portal.public', unknownFields: 'reject' },
    effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
  });
}
export function publicPortalEnforcer<T>(schema: z.ZodType<T>) {
  return defineSecurityEnforcer<NextRequest, unknown, unknown, null, T, null>({
    id: 'service-portal-public-v1',
    guarantees: ['input-validated', 'fields-allowlisted'],
    async enforce({ request }) {
      assertPortalOrigin(request);
      const parsed = schema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) throw new AppError({ code: 'PROVIDER_PORTAL_INPUT', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Dados inválidos.' });
      return { actor: null, input: parsed.data, resource: null };
    },
  });
}
export const sessionCookieOptions = (expires: Date) => ({
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const,
  path: '/', expires,
});
