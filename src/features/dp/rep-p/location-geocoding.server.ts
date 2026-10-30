import 'server-only';

import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { reportSystemError } from '@/lib/observability/reporter';

import { repPLocationDistanceMeters } from './location';

type Entry = { id: string; capturedAt: string | null; position: { latitude: number; longitude: number; accuracyMeters: number } | null };
type Dependencies = { db: Firestore; now: () => Date; fetcher: typeof fetch; apiKey: string | null; dailyLimit: number };
const configuredDailyLimit = Number(process.env.GOOGLE_MAPS_GEOCODING_DAILY_LIMIT ?? 100);
const defaults: Dependencies = { db: repPDbAdmin, now: () => new Date(), fetcher: fetch,
  apiKey: process.env.GOOGLE_MAPS_GEOCODING_API_KEY?.trim() || null,
  dailyLimit: Number.isFinite(configuredDailyLimit) ? Math.max(1, Math.min(1_000, configuredDailyLimit)) : 100, };
const cacheKey = (point: { latitude: number; longitude: number }) => createHash('sha256')
  .update(`${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`).digest('hex');

export function selectJourneyGeocodeMilestones(entries: Entry[]) {
  const positioned = entries.filter((entry): entry is Entry & { position: NonNullable<Entry['position']> } => Boolean(entry.position));
  const result: typeof positioned = [];
  for (const entry of positioned) {
    const previous = result.at(-1);
    if (!previous || repPLocationDistanceMeters(previous.position, entry.position) >= 1_000) result.push(entry);
    if (result.length >= 5) break;
  }
  const last = positioned.at(-1);
  if (last && !result.some((item) => item.id === last.id) && result.length < 5) result.push(last);
  return result;
}

async function reserve(db: Firestore, day: string, limit: number) {
  const ref = db.collection('dp_locationGeocodeDailyUsage').doc(day);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const count = Number(snapshot.get('count') ?? 0);
    if (count >= limit) return false;
    tx.set(ref, { count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.parse(`${day}T00:00:00Z`) + 35 * 86_400_000) }, { merge: true });
    return true;
  });
}

/** Reverse-geocodes only sparse milestones; raw movement and redundant samples never reach Google. */
export async function enrichJourneyAddresses(entries: Entry[], injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  if (!deps.apiKey) return new Map<string, string>();
  const output = new Map<string, string>();
  for (const entry of selectJourneyGeocodeMilestones(entries)) {
    try {
      const key = cacheKey(entry.position);
      const ref = deps.db.collection('dp_locationGeocodeCache').doc(key);
      const cached = await ref.get();
      const now = deps.now();
      if (cached.exists && cached.get('expiresAt') instanceof Timestamp && cached.get('expiresAt').toMillis() > now.getTime()) {
        output.set(entry.id, String(cached.get('formattedAddress') ?? '')); continue;
      }
      const day = now.toISOString().slice(0, 10);
      if (!await reserve(deps.db, day, deps.dailyLimit)) break;
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('latlng', `${entry.position.latitude},${entry.position.longitude}`);
      url.searchParams.set('language', 'pt-BR'); url.searchParams.set('region', 'br'); url.searchParams.set('key', deps.apiKey);
      const response = await deps.fetcher(url, { signal: AbortSignal.timeout(5_000) });
      const body = await response.json() as { status?: string; results?: Array<{ formatted_address?: string; place_id?: string }> };
      const address = body.status === 'OK' ? body.results?.[0]?.formatted_address?.trim() : null;
      if (!response.ok || !address) continue;
      await ref.set({ formattedAddress: address, placeId: body.results?.[0]?.place_id ?? null,
        createdAt: Timestamp.fromDate(now), expiresAt: Timestamp.fromMillis(now.getTime() + 30 * 86_400_000) });
      output.set(entry.id, address);
    } catch (error) {
      reportSystemError({ error, source: 'rep-p', operation: 'reverse-geocode-journey-milestone' });
    }
  }
  return output;
}
