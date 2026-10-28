const TIMESTAMP_KEYS = new Set(['seconds', 'nanoseconds', '_seconds', '_nanoseconds', 'type', '__type']);

/**
 * Reconhece uma data do Firestore que virou objeto ao passar por JSON (`Timestamp.toJSON()` no navegador produz
 * `{ seconds, nanoseconds, type: "firestore/timestamp/1.0" }`; o Admin SDK produz `_seconds`). Gravar esse objeto
 * como veio deixa a data ilegível para as telas, como aconteceu com datas de admissão em 10/2026.
 */
export function serializedTimestampParts(value: unknown): { seconds: number; nanoseconds: number } | null {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const source = value as Record<string, unknown>;
  if (!Object.keys(source).every((key) => TIMESTAMP_KEYS.has(key))) return null;
  const seconds = source.seconds ?? source._seconds;
  const nanoseconds = source.nanoseconds ?? source._nanoseconds ?? 0;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  if (typeof nanoseconds !== 'number' || !Number.isFinite(nanoseconds)) return null;
  if (source.type !== undefined && source.type !== 'firestore/timestamp/1.0') return null;
  return { seconds, nanoseconds };
}
