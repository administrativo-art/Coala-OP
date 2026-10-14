import 'server-only';

import type { NextRequest } from 'next/server';

import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { resolveUnitAccess } from '@/lib/unit-access';

export async function requireTimeManager(request: NextRequest): Promise<ServerUserContext> {
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  if (!actor.isDefaultAdmin && actor.permissions.dp.settings.manageTime !== true) {
    throw new AppError({ code: 'DP_TIME_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para gerenciar configurações de tempo.' });
  }
  if (!resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin }).allUnits) {
    throw new AppError({
      code: 'DP_TIME_GLOBAL_SCOPE_REQUIRED',
      kind: 'AUTHORIZATION',
      safeMessage: 'Configurações de tempo exigem acesso a todas as unidades.',
    });
  }
  return actor;
}

export async function requireShiftManager(request: NextRequest): Promise<ServerUserContext> {
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  if (!actor.isDefaultAdmin && actor.permissions.dp.settings.manageShifts !== true) {
    throw new AppError({ code: 'DP_SHIFT_DEFINITION_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para gerenciar turnos.' });
  }
  return actor;
}

export async function requireAbsenceManager(request: NextRequest): Promise<ServerUserContext> {
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  if (!actor.isDefaultAdmin && actor.permissions.dp.settings.manageAbsences !== true) {
    throw new AppError({ code: 'DP_ABSENCE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para gerenciar tipos de ausência.' });
  }
  if (!resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin }).allUnits) {
    throw new AppError({
      code: 'DP_ABSENCE_GLOBAL_SCOPE_REQUIRED',
      kind: 'AUTHORIZATION',
      safeMessage: 'A configuração de ausências exige acesso a todas as unidades.',
    });
  }
  return actor;
}
