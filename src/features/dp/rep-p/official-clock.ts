/** Relógio do coletor: hora oficial corrigida pela diferença medida contra o relógio do aparelho. */
export function officialClockOffsetMs(officialInstantIso: string, deviceNowMs: number): number {
  return Date.parse(officialInstantIso) - deviceNowMs;
}

/** HH:MM:SS no fuso do estabelecimento, nunca no fuso do aparelho. */
export function formatOfficialClock(instantMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .format(new Date(instantMs));
}
