export type RepPAvailabilityState = 'open' | 'closed';

export type RepPAvailabilityTransitionPlan = Readonly<{
  eventCodes: readonly ('07' | '08')[];
  openIncidentIds: readonly string[];
  serviceStatus: 'available' | 'unavailable';
  replayed: boolean;
}>;

const MAX_OPEN_INCIDENTS = 20;

/**
 * Decide a transição sem depender do Firestore. Mais de um incidente aberto mantém o serviço indisponível;
 * somente a primeira abertura grava 08 e somente o encerramento da última grava 07.
 */
export function planRepPAvailabilityTransition(input: {
  incidentId: string;
  incomingState: RepPAvailabilityState;
  storedIncidentState: RepPAvailabilityState | null;
  storedUnavailableNsr: number | null;
  openIncidentIds: readonly string[];
}): RepPAvailabilityTransitionPlan {
  const open = [...new Set(input.openIncidentIds)];
  if (input.storedIncidentState === 'closed'
    || input.storedIncidentState === input.incomingState) {
    return { eventCodes: [], openIncidentIds: open,
      serviceStatus: open.length ? 'unavailable' : 'available', replayed: true };
  }

  if (input.incomingState === 'open') {
    const alreadyTracked = open.includes(input.incidentId);
    const next = alreadyTracked ? open : [...open, input.incidentId];
    if (next.length > MAX_OPEN_INCIDENTS) throw new TypeError('REP_P_AVAILABILITY_TOO_MANY_INCIDENTS');
    return { eventCodes: open.length === 0 && !alreadyTracked ? ['08'] : [], openIncidentIds: next,
      serviceStatus: 'unavailable', replayed: alreadyTracked };
  }

  const tracked = open.includes(input.incidentId);
  const next = open.filter((id) => id !== input.incidentId);
  if (tracked) {
    return { eventCodes: next.length === 0 ? ['07'] : [], openIncidentIds: next,
      serviceStatus: next.length ? 'unavailable' : 'available', replayed: false };
  }
  // Uma notificação de fechamento pode chegar antes da abertura. Com o serviço já disponível,
  // preserva-se o par fiscal na ordem 08/07; o incidente continuará idempotente em novos envios.
  if (open.length === 0 && input.storedIncidentState === null) {
    return { eventCodes: ['08', '07'], openIncidentIds: [], serviceStatus: 'available', replayed: false };
  }
  if (input.storedIncidentState === 'open' && input.storedUnavailableNsr !== null) {
    return { eventCodes: open.length === 0 ? ['07'] : [], openIncidentIds: open,
      serviceStatus: open.length ? 'unavailable' : 'available', replayed: false };
  }
  return { eventCodes: [], openIncidentIds: open,
    serviceStatus: open.length ? 'unavailable' : 'available', replayed: false };
}
