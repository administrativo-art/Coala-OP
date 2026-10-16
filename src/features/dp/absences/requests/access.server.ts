import 'server-only';

import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export async function requireOwnAbsencePreviewAccess(request: NextRequest) {
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  if (!actor.isDefaultAdmin && (actor.permissions.dashboard.collaborator ?? actor.permissions.dashboard.view) !== true) {
    throw new AppError({ code: 'ABSENCE_PREVIEW_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para consultar suas ausências.' });
  }
  if (actor.userDoc.id !== actor.decoded.uid) {
    throw new AppError({ code: 'ABSENCE_OWNER_MISMATCH', kind: 'AUTHORIZATION', safeMessage: 'Não foi possível validar a pessoa autenticada.' });
  }
  return actor;
}

export async function requireAbsenceRequestAccess(request: NextRequest) {
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  const collaborator = (actor.permissions.dashboard.collaborator ?? actor.permissions.dashboard.view) === true;
  if (!actor.isDefaultAdmin && !collaborator && actor.permissions.dp.requests.view !== true && actor.permissions.dp.requests.review !== true) {
    throw new AppError({ code: 'ABSENCE_REQUEST_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para consultar solicitações de ausência.' });
  }
  if (actor.userDoc.id !== actor.decoded.uid) throw new AppError({ code: 'ABSENCE_OWNER_MISMATCH', kind: 'AUTHORIZATION' });
  return actor;
}
