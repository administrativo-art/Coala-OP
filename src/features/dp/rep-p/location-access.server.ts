import 'server-only';

import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { ServerUserContext } from '@/lib/auth-server';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { canAccessUnit } from '@/lib/unit-access';
import { AppError } from '@/lib/observability/app-error';
import { enrichJourneyAddresses } from './location-geocoding.server';

export const LOCATION_ACCESS_AUDIT = 'repP_locationAccessAudit';
const id = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/);
export const locationAccessSchema = z.object({
  employeeUid: id, unitId: id,
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
  source: z.enum(['marking', 'journey']),
  reason: z.enum(['own_data', 'employee_request', 'operational_review', 'privacy_review']),
  cursor: id.optional(), limit: z.number().int().min(1).max(50).default(20),
}).strict();
export type LocationAccessInput = z.infer<typeof locationAccessSchema>;
type Dependencies = { repDb: Firestore; hrDb: Firestore; now: () => Date; enrichAddresses: typeof enrichJourneyAddresses };
const defaults: Dependencies = { repDb: repPDbAdmin, hrDb: hrDbAdmin, now: () => new Date(), enrichAddresses: enrichJourneyAddresses };

function denied() {
  return new AppError({ code: 'REP_P_LOCATION_ACCESS_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para consultar esta localização.' });
}
export function canReadLocation(context: ServerUserContext, input: LocationAccessInput) {
  if (input.employeeUid === context.decoded.uid) return input.reason === 'own_data';
  // Even administrators need the express grant; managing point or policy is not sufficient.
  return input.reason !== 'own_data' && context.permissions.dp?.view === true
    && context.permissions.dp?.timeRecording?.readLocation === true
    && canAccessUnit(context.userDoc, input.unitId, { isDefaultAdmin: context.isDefaultAdmin });
}
function iso(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : typeof value === 'string' ? value : null;
}
function position(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.latitude !== 'number' || !Number.isFinite(raw.latitude) || Math.abs(raw.latitude) > 90
    || typeof raw.longitude !== 'number' || !Number.isFinite(raw.longitude) || Math.abs(raw.longitude) > 180
    || typeof raw.accuracyMeters !== 'number' || !Number.isFinite(raw.accuracyMeters) || raw.accuracyMeters < 0) return null;
  return { latitude: raw.latitude, longitude: raw.longitude, accuracyMeters: raw.accuracyMeters };
}

/** One person, execution unit and civil day per request. Audit must commit before any coordinates leave. */
export async function readLocation(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = locationAccessSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: 'REP_P_LOCATION_ACCESS_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Consulta de localização inválida.' });
  const input = parsed.data;
  if (!canReadLocation(context, input)) throw denied();
  const deps = { ...defaults, ...injected };
  const db = input.source === 'marking' ? deps.repDb : deps.hrDb;
  const dateField = input.source === 'marking' ? 'recordedDate' : 'workDate';
  let query = db.collection(input.source === 'marking' ? 'repP_locationEvidence' : 'dp_journeyLocationEvents')
    .where('workspaceId', '==', context.workspace_id).where('employeeId', '==', input.employeeUid)
    .where('executionUnitId', '==', input.unitId).where(dateField, '==', input.workDate)
    .orderBy(FieldPath.documentId()).limit(input.limit + 1);
  if (input.cursor) query = query.startAfter(input.cursor);
  const snapshot = await query.get();
  const now = deps.now();
  const page = snapshot.docs.slice(0, input.limit);
  const entries = page.filter((doc) => {
    const expiry = doc.get('expiresAt');
    // TTL deletion can lag. Retained legal-hold material is not automatically disclosed.
    return expiry instanceof Timestamp && expiry.toMillis() > now.getTime();
  }).map((doc) => {
    const data = doc.data();
    return { id: doc.id, capturedAt: iso(input.source === 'marking' ? data.capture?.location?.capturedAt : data.capturedAt),
      position: position(input.source === 'marking' ? data.capture?.location : data.position),
      status: input.source === 'marking' ? String(data.capture?.status ?? 'unavailable') : String(data.eventType ?? 'sample') };
  });
  const audit = deps.repDb.collection(LOCATION_ACCESS_AUDIT).doc();
  await audit.create({ schemaVersion: 1, workspaceId: context.workspace_id, actorUid: context.decoded.uid,
    employeeUid: input.employeeUid, executionUnitId: input.unitId, workDate: input.workDate, source: input.source,
    reason: input.reason, role: input.employeeUid === context.decoded.uid ? 'owner' : 'authorized_staff',
    evidenceIds: entries.map((entry) => entry.id), count: entries.length, cursor: input.cursor ?? null,
    viewedAt: Timestamp.fromDate(now), expiresAt: Timestamp.fromMillis(now.getTime() + 1_825 * 86_400_000) });
  // External enrichment happens only after the immutable access audit is committed.
  const addresses = input.source === 'journey' ? await deps.enrichAddresses(entries) : new Map<string, string>();
  const enrichedEntries = entries.map((entry) => ({ ...entry, formattedAddress: addresses.get(entry.id) ?? null }));
  return { entries: enrichedEntries, nextCursor: snapshot.size > input.limit ? page.at(-1)!.id : null, auditId: audit.id };
}
