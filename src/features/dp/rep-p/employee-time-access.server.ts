import 'server-only';

import type { ServerUserContext } from '@/lib/auth-server';

/** Leitura administrativa do ponto; fechar/reabrir mantém compatibilidade com perfis já publicados. */
export function canReadEmployeeTimeRecording(context: ServerUserContext) {
  const closure = context.permissions.dp.timeClosure;
  return context.isDefaultAdmin || context.permissions.dp.timeRecording?.view === true
    || closure?.close === true || closure?.reopen === true;
}
