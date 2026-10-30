import 'server-only';

import { createHash } from 'node:crypto';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';

/**
 * Relógio da agenda de cada pessoa: toda gravação de turno avulso sobe a versão na mesma transação.
 * Quem confere a agenda fora da transação (a cobertura de turno) lê a versão antes de conferir e exige a mesma
 * versão ao gravar; se outra gravação entrou no meio, a cobertura é recusada em vez de nascer sobre uma conferência velha.
 */
export const PERSON_AGENDA_CLOCKS = 'dp_personAgendaClocks';

export function personAgendaClockRef(workspaceId: string, userId: string) {
  return dbAdmin.collection(PERSON_AGENDA_CLOCKS).doc(createHash('sha256').update(`${workspaceId}:${userId}`).digest('hex'));
}

export function personAgendaVersion(snapshot: DocumentSnapshot) {
  const version = snapshot.exists ? snapshot.get('version') : 0;
  if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) {
    throw new AppError({ code: 'DP_SHIFT_AGENDA_CLOCK_INVALID', kind: 'DATA_INTEGRITY', safeMessage: 'O controle da agenda da pessoa está inválido.' });
  }
  return version as number;
}

export async function readPersonAgendaVersion(workspaceId: string, userId: string) {
  return personAgendaVersion(await personAgendaClockRef(workspaceId, userId).get());
}

export function assertPersonAgendaUnchanged(current: number, expected: number | undefined) {
  if (expected !== undefined && current !== expected) {
    throw new AppError({ code: 'DP_SHIFT_AGENDA_CHANGED', kind: 'CONFLICT',
      safeMessage: 'A agenda da pessoa mudou enquanto a cobertura era conferida. Atualize a lista e escolha de novo.' });
  }
}
