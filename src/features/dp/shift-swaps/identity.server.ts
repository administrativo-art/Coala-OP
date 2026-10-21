import 'server-only';

import type { NextRequest } from 'next/server';

import type { ServerUserContext } from '@/lib/auth-server';
import type { ShiftSwapIdentityEvidence } from './types';

function text(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}
function authTime(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1_000).toISOString()
    : null;
}

/** Evidência técnica do ato autenticado; não é assinatura reconhecida nem biometria. */
export function shiftSwapIdentityEvidence(
  request: NextRequest,
  actor: ServerUserContext,
  operationId: string,
): ShiftSwapIdentityEvidence {
  const firebase = actor.decoded.firebase as { sign_in_provider?: unknown } | undefined;
  const forwarded = text(request.headers.get('x-forwarded-for'), 500)?.split(',')[0]?.trim() ?? null;
  return {
    authenticatedUid: actor.decoded.uid,
    authenticatedEmail: text(actor.decoded.email ?? actor.userDoc.email, 320),
    actorName: text(actor.userDoc.username, 180) ?? actor.decoded.uid,
    authTime: authTime(actor.decoded.auth_time),
    signInProvider: text(firebase?.sign_in_provider, 80),
    ipAddress: forwarded ?? text(request.headers.get('x-real-ip'), 80),
    userAgent: text(request.headers.get('user-agent'), 500),
    operationId,
  };
}
