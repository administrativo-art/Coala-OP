export type JourneyLocationState = 'active' | 'paused' | 'stopped';
export type JourneyLocationEventType = 'start' | 'sample' | 'pause' | 'resume' | 'stop';

/**
 * Server-authoritative state machine for the optional between-units trail. The
 * mobile service proposes events; only this transition table decides whether
 * they may become evidence.
 */
export function nextJourneyLocationState(current: JourneyLocationState | null, event: JourneyLocationEventType) {
  if (current === null && event === 'start') return 'active' as const;
  if (current === 'active' && event === 'sample') return 'active' as const;
  if (current === 'active' && event === 'pause') return 'paused' as const;
  if (current === 'active' && event === 'stop') return 'stopped' as const;
  if (current === 'paused' && event === 'resume') return 'active' as const;
  if (current === 'paused' && event === 'stop') return 'stopped' as const;
  throw new TypeError(`Transição de localização inválida: ${current ?? 'new'} -> ${event}`);
}

export function orderedJourneyEvents<T extends { capturedAt: string }>(events: T[]) {
  return events.every((event, index) => index === 0 || Date.parse(events[index - 1].capturedAt) <= Date.parse(event.capturedAt));
}
