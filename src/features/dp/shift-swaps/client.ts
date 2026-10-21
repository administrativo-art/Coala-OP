import type { User as FirebaseUser } from 'firebase/auth';

import { authenticatedApiRequest } from '@/lib/authenticated-api-client';
import type { CreateShiftSwapInput, DecideShiftSwapInput } from './schemas';
import type { ShiftSwapOption, ShiftSwapRequest } from './types';

const base = '/api/collaborator/requests/shift-swaps';
const token = (user: FirebaseUser) => () => user.getIdToken();

export function fetchShiftSwapOptions(user: FirebaseUser) {
  return authenticatedApiRequest<{ ownShifts: ShiftSwapOption[]; candidateShifts: ShiftSwapOption[]; through: string }>(`${base}/options`,
    { getIdToken: token(user), fallbackError: 'Falha ao carregar os turnos.' });
}
export function fetchShiftSwaps(user: FirebaseUser) {
  return authenticatedApiRequest<{ requests: ShiftSwapRequest[] }>(base,
    { getIdToken: token(user), fallbackError: 'Falha ao carregar trocas de turno.' });
}
export function createShiftSwapRequest(user: FirebaseUser, input: CreateShiftSwapInput) {
  return authenticatedApiRequest<{ request: ShiftSwapRequest }>(base,
    { method: 'POST', getIdToken: token(user), json: input, fallbackError: 'Falha ao solicitar a troca.' });
}
export function updateShiftSwapRequest(user: FirebaseUser, requestId: string, input: DecideShiftSwapInput) {
  return authenticatedApiRequest<{ request: ShiftSwapRequest }>(`${base}/${encodeURIComponent(requestId)}`,
    { method: 'PATCH', getIdToken: token(user), json: input, fallbackError: 'Falha ao registrar a decisão.' });
}
