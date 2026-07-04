import {
  FieldValue,
  type Firestore,
  type Query,
  type Timestamp,
} from "firebase-admin/firestore";

import { computeConformity } from "./dashboard-service";
import { ANALYTICS_COLLECTIONS } from "./types";

export const DAILY_METRICS_COLLECTION = "form_occurrence_daily_metrics";

export interface DailyMetricKey {
  workspace_id: string;
  occurred_local_date: string;
  domain_id: string;
  unit_id: string;
}

export interface DailyMetric extends DailyMetricKey {
  evaluations: number;
  non_conformities: number;
  occurrences: number;
  occurrences_open: number;
  occurrences_resolved: number;
  resolution_time_minutes_sum: number;
  resolution_time_minutes_count: number;
  computed_at?: Timestamp;
}

export function dailyMetricDocId(key: DailyMetricKey): string {
  return [
    key.workspace_id,
    key.occurred_local_date,
    key.domain_id,
    key.unit_id,
  ].join("__");
}

export interface OccurrenceRowForAggregate {
  workspace_id: string;
  occurred_local_date: string;
  domain_id: string;
  unit_id?: string;
  is_current: boolean;
  record_status: string;
  counts_as_evaluation: boolean;
  counts_as_occurrence: boolean;
  counts_as_non_conformity: boolean;
  denominator_scope: "absolute" | "conditional";
  resolution_status: string;
  resolution_time_minutes?: number;
}

const OPEN_RESOLUTION_STATUSES = new Set([
  "open",
  "in_progress",
  "waiting",
  "blocked",
  "pending_validation",
]);

export function reduceDailyMetrics(
  rows: readonly OccurrenceRowForAggregate[]
): DailyMetric[] {
  const buckets = new Map<string, DailyMetric>();

  for (const row of rows) {
    if (!row.is_current || row.record_status !== "valid") continue;

    const key: DailyMetricKey = {
      workspace_id: row.workspace_id,
      occurred_local_date: row.occurred_local_date,
      domain_id: row.domain_id,
      unit_id: row.unit_id ?? "no_unit",
    };
    const id = dailyMetricDocId(key);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = {
        ...key,
        evaluations: 0,
        non_conformities: 0,
        occurrences: 0,
        occurrences_open: 0,
        occurrences_resolved: 0,
        resolution_time_minutes_sum: 0,
        resolution_time_minutes_count: 0,
      };
      buckets.set(id, bucket);
    }

    if (
      row.counts_as_evaluation &&
      row.denominator_scope === "absolute"
    ) {
      bucket.evaluations += 1;
    }
    if (
      row.counts_as_non_conformity &&
      row.denominator_scope === "absolute"
    ) {
      bucket.non_conformities += 1;
    }

    if (row.counts_as_occurrence) {
      bucket.occurrences += 1;
      if (OPEN_RESOLUTION_STATUSES.has(row.resolution_status)) {
        bucket.occurrences_open += 1;
      }
      if (row.resolution_status === "resolved") {
        bucket.occurrences_resolved += 1;
        if (typeof row.resolution_time_minutes === "number") {
          bucket.resolution_time_minutes_sum += row.resolution_time_minutes;
          bucket.resolution_time_minutes_count += 1;
        }
      }
    }
  }

  return [...buckets.values()];
}

export function sumDailyMetrics(metrics: readonly DailyMetric[]): {
  evaluations: number;
  non_conformities: number;
  occurrences: number;
  occurrences_open: number;
  occurrences_resolved: number;
  conformity_rate: number | null;
  avg_resolution_time_minutes: number | null;
} {
  let evaluations = 0;
  let nonConformities = 0;
  let occurrences = 0;
  let openOccurrences = 0;
  let resolvedOccurrences = 0;
  let resolutionMinutesSum = 0;
  let resolutionMinutesCount = 0;

  for (const metric of metrics) {
    evaluations += metric.evaluations;
    nonConformities += metric.non_conformities;
    occurrences += metric.occurrences;
    openOccurrences += metric.occurrences_open;
    resolvedOccurrences += metric.occurrences_resolved;
    resolutionMinutesSum += metric.resolution_time_minutes_sum;
    resolutionMinutesCount += metric.resolution_time_minutes_count;
  }

  return {
    evaluations,
    non_conformities: nonConformities,
    occurrences,
    occurrences_open: openOccurrences,
    occurrences_resolved: resolvedOccurrences,
    conformity_rate: computeConformity(evaluations, nonConformities),
    avg_resolution_time_minutes:
      resolutionMinutesCount > 0
        ? resolutionMinutesSum / resolutionMinutesCount
        : null,
  };
}

const WRITE_BATCH_LIMIT = 400;

export async function recomputeDailyMetrics(
  db: Firestore,
  workspaceId: string,
  localDate: string
): Promise<{
  buckets_written: number;
  buckets_cleared: number;
  rows_read: number;
}> {
  const snap = await db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", workspaceId)
    .where("occurred_local_date", "==", localDate)
    .get();

  const rows: OccurrenceRowForAggregate[] = snap.docs.map((doc) => ({
    workspace_id: String(doc.get("workspace_id") ?? ""),
    occurred_local_date: String(doc.get("occurred_local_date") ?? ""),
    domain_id: String(doc.get("domain_id") ?? ""),
    unit_id:
      typeof doc.get("unit_id") === "string"
        ? String(doc.get("unit_id"))
        : undefined,
    is_current: doc.get("is_current") === true,
    record_status: String(doc.get("record_status") ?? ""),
    counts_as_evaluation: doc.get("counts_as_evaluation") === true,
    counts_as_occurrence: doc.get("counts_as_occurrence") === true,
    counts_as_non_conformity:
      doc.get("counts_as_non_conformity") === true,
    denominator_scope:
      doc.get("denominator_scope") === "conditional"
        ? "conditional"
        : "absolute",
    resolution_status: String(doc.get("resolution_status") ?? ""),
    resolution_time_minutes:
      typeof doc.get("resolution_time_minutes") === "number"
        ? Number(doc.get("resolution_time_minutes"))
        : undefined,
  }));

  const metrics = reduceDailyMetrics(rows);
  const newIds = new Set(metrics.map((metric) => dailyMetricDocId(metric)));
  const collection = db.collection(DAILY_METRICS_COLLECTION);

  for (let index = 0; index < metrics.length; index += WRITE_BATCH_LIMIT) {
    const batch = db.batch();
    for (const metric of metrics.slice(index, index + WRITE_BATCH_LIMIT)) {
      batch.set(collection.doc(dailyMetricDocId(metric)), {
        ...metric,
        computed_at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  const existing = await collection
    .where("workspace_id", "==", workspaceId)
    .where("occurred_local_date", "==", localDate)
    .get();
  let cleared = 0;

  for (let index = 0; index < existing.docs.length; index += WRITE_BATCH_LIMIT) {
    const batch = db.batch();
    for (const doc of existing.docs.slice(index, index + WRITE_BATCH_LIMIT)) {
      if (!newIds.has(doc.id)) {
        batch.delete(doc.ref);
        cleared += 1;
      }
    }
    await batch.commit();
  }

  return {
    buckets_written: metrics.length,
    buckets_cleared: cleared,
    rows_read: rows.length,
  };
}

export async function recomputeDailyMetricsRange(
  db: Firestore,
  workspaceId: string,
  fromLocalDate: string,
  toLocalDate: string
): Promise<{ days: number; rows_read: number }> {
  let days = 0;
  let rowsRead = 0;

  for (const date of iterateLocalDates(fromLocalDate, toLocalDate)) {
    const report = await recomputeDailyMetrics(db, workspaceId, date);
    days += 1;
    rowsRead += report.rows_read;
  }

  return { days, rows_read: rowsRead };
}

export function* iterateLocalDates(
  from: string,
  to: string
): Generator<string> {
  const current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(current.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Intervalo invalido: datas devem estar em YYYY-MM-DD.");
  }
  if (current > end) {
    throw new Error(`Intervalo invalido: ${from} > ${to}`);
  }

  while (current <= end) {
    yield current.toISOString().slice(0, 10);
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

export async function getCardsFromDailyMetrics(
  db: Firestore,
  workspaceId: string,
  fromLocalDate: string,
  toLocalDate: string,
  filters: { domainId?: string; unitId?: string } = {}
): Promise<ReturnType<typeof sumDailyMetrics>> {
  let query: Query = db
    .collection(DAILY_METRICS_COLLECTION)
    .where("workspace_id", "==", workspaceId)
    .where("occurred_local_date", ">=", fromLocalDate)
    .where("occurred_local_date", "<=", toLocalDate);

  if (filters.domainId) {
    query = query.where("domain_id", "==", filters.domainId);
  }
  if (filters.unitId) {
    query = query.where("unit_id", "==", filters.unitId);
  }

  const snap = await query.get();
  return sumDailyMetrics(snap.docs.map((doc) => doc.data() as DailyMetric));
}
