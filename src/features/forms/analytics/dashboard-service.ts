import {
  AggregateField,
  FieldPath,
  Timestamp as AdminTimestamp,
  type Firestore,
  type Query,
  type Timestamp,
  type WhereFilterOp,
} from "firebase-admin/firestore";

import { getCardsFromDailyMetrics } from "./daily-aggregates";
import { ANALYTICS_COLLECTIONS } from "./types";
import type { AnalyticsResolutionStatus } from "./occurrence-model";

export const OPEN_STATUSES: readonly AnalyticsResolutionStatus[] = [
  "open",
  "in_progress",
  "waiting",
  "blocked",
  "pending_validation",
];

export interface DashboardFilters {
  workspaceId: string;
  from: Date;
  to: Date;
  domainId?: string;
  unitId?: string;
  criterionId?: string;
  statusGroup?: "open" | "resolved" | "all";
}

export type FilterOp = "==" | ">=" | "<=" | "in";

export interface FilterConstraint {
  field: string;
  op: FilterOp;
  value: unknown;
}

export function buildFilterPlan(
  filters: DashboardFilters,
  metric: "evaluations" | "non_conformities" | "open_occurrences" | "list"
): FilterConstraint[] {
  const plan: FilterConstraint[] = [
    { field: "workspace_id", op: "==", value: filters.workspaceId },
    { field: "is_current", op: "==", value: true },
    { field: "occurred_at", op: ">=", value: filters.from },
    { field: "occurred_at", op: "<=", value: filters.to },
  ];

  if (filters.domainId) {
    plan.push({ field: "domain_id", op: "==", value: filters.domainId });
  }
  if (filters.unitId) {
    plan.push({ field: "unit_id", op: "==", value: filters.unitId });
  }
  if (filters.criterionId) {
    plan.push({
      field: "criterion_id",
      op: "==",
      value: filters.criterionId,
    });
  }

  switch (metric) {
    case "evaluations":
      plan.push(
        { field: "counts_as_evaluation", op: "==", value: true },
        { field: "denominator_scope", op: "==", value: "absolute" }
      );
      break;
    case "non_conformities":
      plan.push(
        { field: "counts_as_non_conformity", op: "==", value: true },
        { field: "denominator_scope", op: "==", value: "absolute" }
      );
      break;
    case "open_occurrences":
      plan.push(
        { field: "counts_as_occurrence", op: "==", value: true },
        { field: "resolution_status", op: "in", value: [...OPEN_STATUSES] }
      );
      break;
    case "list":
      if (filters.statusGroup === "open") {
        plan.push({
          field: "resolution_status",
          op: "in",
          value: [...OPEN_STATUSES],
        });
      } else if (filters.statusGroup === "resolved") {
        plan.push({
          field: "resolution_status",
          op: "==",
          value: "resolved",
        });
      }
      plan.push({ field: "record_type", op: "==", value: "occurrence" });
      break;
  }

  return plan;
}

export function computeConformity(
  evaluations: number,
  nonConformities: number
) {
  if (evaluations <= 0) return null;
  return 1 - nonConformities / evaluations;
}

export interface DashboardDeps {
  db: Firestore;
}

function applyPlan(base: Query, plan: readonly FilterConstraint[]) {
  let query = base;
  for (const constraint of plan) {
    const value =
      constraint.value instanceof Date
        ? AdminTimestamp.fromDate(constraint.value)
        : constraint.value;
    query = query.where(
      constraint.field,
      constraint.op as WhereFilterOp,
      value
    );
  }
  return query;
}

async function countWithPlan(
  deps: DashboardDeps,
  plan: readonly FilterConstraint[]
) {
  const query = applyPlan(
    deps.db.collection(ANALYTICS_COLLECTIONS.occurrences),
    plan
  );
  const snap = await query.count().get();
  return snap.data().count;
}

export interface DashboardCards {
  evaluations: number;
  non_conformities: number;
  open_occurrences: number;
  conformity_rate: number | null;
}

export async function getDashboardCards(
  deps: DashboardDeps,
  filters: DashboardFilters
): Promise<DashboardCards> {
  const [evaluations, nonConformities, openOccurrences] = await Promise.all([
    countWithPlan(deps, buildFilterPlan(filters, "evaluations")),
    countWithPlan(deps, buildFilterPlan(filters, "non_conformities")),
    countWithPlan(deps, buildFilterPlan(filters, "open_occurrences")),
  ]);

  return {
    evaluations,
    non_conformities: nonConformities,
    open_occurrences: openOccurrences,
    conformity_rate: computeConformity(evaluations, nonConformities),
  };
}

// Acima deste limiar de dias, o dashboard prefere agregados diários pré-computados
// (a cascata multiplica volume; ~50 mil registros/30 dias chega antes do que parece).
export const AGGREGATE_PREFERENCE_DAYS = 45;

function localDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function shouldPreferAggregates(from: Date, to: Date) {
  const days = Math.round((to.getTime() - from.getTime()) / (24 * 3600000));
  return days > AGGREGATE_PREFERENCE_DAYS;
}

// Lê os cards a partir dos agregados diários. Retorna null se não houver
// nenhum bucket no período (evita reportar zeros silenciosos quando o job
// de recomputação ainda não rodou).
export async function getDashboardCardsFromAggregates(
  deps: DashboardDeps,
  filters: DashboardFilters
): Promise<(DashboardCards & { avg_resolution_time_minutes: number | null }) | null> {
  const summed = await getCardsFromDailyMetrics(
    deps.db,
    filters.workspaceId,
    localDateString(filters.from),
    localDateString(filters.to),
    { domainId: filters.domainId, unitId: filters.unitId }
  );

  if (
    summed.evaluations === 0 &&
    summed.occurrences === 0 &&
    summed.occurrences_open === 0
  ) {
    return null;
  }

  return {
    evaluations: summed.evaluations,
    non_conformities: summed.non_conformities,
    open_occurrences: summed.occurrences_open,
    conformity_rate: summed.conformity_rate,
    avg_resolution_time_minutes: summed.avg_resolution_time_minutes,
  };
}

export interface ExtendedMetrics {
  resolved_occurrences: number;
  overdue_occurrences: number;
  open_without_task: number;
  open_with_cancelled_task: number;
  pending_validation: number;
  avg_resolution_time_minutes: number | null;
}

function occurrenceBaseQuery(deps: DashboardDeps, filters: DashboardFilters) {
  let query: Query = deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", filters.workspaceId)
    .where("is_current", "==", true)
    .where("occurred_at", ">=", AdminTimestamp.fromDate(filters.from))
    .where("occurred_at", "<=", AdminTimestamp.fromDate(filters.to));
  if (filters.domainId) query = query.where("domain_id", "==", filters.domainId);
  if (filters.unitId) query = query.where("unit_id", "==", filters.unitId);
  return query;
}

export async function getExtendedMetrics(
  deps: DashboardDeps,
  filters: DashboardFilters
): Promise<ExtendedMetrics> {
  const occurrenceOnly = occurrenceBaseQuery(deps, filters).where(
    "counts_as_occurrence",
    "==",
    true
  );

  const [
    resolvedSnap,
    openWithoutTaskSnap,
    cancelledTaskSnap,
    pendingValidationSnap,
    avgSnap,
  ] = await Promise.all([
    occurrenceOnly.where("resolution_status", "==", "resolved").count().get(),
    occurrenceOnly
      .where("resolution_status", "in", [...OPEN_STATUSES])
      .where("has_active_task", "==", false)
      .count()
      .get(),
    occurrenceOnly
      .where("resolution_status", "in", [...OPEN_STATUSES])
      .where("last_task_lifecycle_state", "==", "cancelled")
      .count()
      .get(),
    occurrenceOnly
      .where("resolution_status", "==", "pending_validation")
      .count()
      .get(),
    occurrenceOnly
      .where("resolution_status", "==", "resolved")
      .aggregate({ avg: AggregateField.average("resolution_time_minutes") })
      .get(),
  ]);

  // Vencidas: due_at no passado e ainda em aberto. Range em due_at + "in" em
  // resolution_status são campos distintos (permitido); precisa de índice próprio.
  let overdue = 0;
  try {
    const overdueSnap = await occurrenceBaseQuery(deps, filters)
      .where("counts_as_occurrence", "==", true)
      .where("resolution_status", "in", [...OPEN_STATUSES])
      .where("due_at", "<=", AdminTimestamp.now())
      .count()
      .get();
    overdue = overdueSnap.data().count;
  } catch {
    overdue = 0; // índice ainda não criado: degrada sem quebrar o painel
  }

  return {
    resolved_occurrences: resolvedSnap.data().count,
    overdue_occurrences: overdue,
    open_without_task: openWithoutTaskSnap.data().count,
    open_with_cancelled_task: cancelledTaskSnap.data().count,
    pending_validation: pendingValidationSnap.data().count,
    avg_resolution_time_minutes: avgSnap.data().avg ?? null,
  };
}

export interface RecurrenceRow {
  target_identity_key: string;
  target_name_snapshot: string;
  occurrences: number;
}

const RECURRENCE_SCAN_LIMIT = 5000;

export async function getRecurrenceByTarget(
  deps: DashboardDeps,
  filters: DashboardFilters,
  opts: { minOccurrences?: number; limit?: number; includePersonalData?: boolean } = {}
): Promise<RecurrenceRow[]> {
  const snap = await occurrenceBaseQuery(deps, filters)
    .where("counts_as_occurrence", "==", true)
    .select(
      "target_identity_key",
      "target_name_snapshot",
      "contains_personal_data"
    )
    .limit(RECURRENCE_SCAN_LIMIT)
    .get();

  const rows = new Map<string, RecurrenceRow>();
  for (const doc of snap.docs) {
    if (doc.get("contains_personal_data") === true && !opts.includePersonalData) {
      continue;
    }
    const key = String(doc.get("target_identity_key") ?? "sem_alvo");
    const current = rows.get(key);
    if (current) current.occurrences += 1;
    else
      rows.set(key, {
        target_identity_key: key,
        target_name_snapshot: String(doc.get("target_name_snapshot") ?? "Sem alvo"),
        occurrences: 1,
      });
  }

  const min = opts.minOccurrences ?? 2;
  return [...rows.values()]
    .filter((row) => row.occurrences >= min)
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, Math.min(Math.max(opts.limit ?? 10, 1), 50));
}

export interface BrandRankingRow {
  brand: string;
  non_conformities: number;
}

export async function getBrandRanking(
  deps: DashboardDeps,
  filters: DashboardFilters,
  opts: { limit?: number } = {}
): Promise<BrandRankingRow[]> {
  const snap = await occurrenceBaseQuery(deps, filters)
    .where("counts_as_non_conformity", "==", true)
    .where("denominator_scope", "==", "absolute")
    .select("target_brand", "target_model")
    .limit(RECURRENCE_SCAN_LIMIT)
    .get();

  const rows = new Map<string, BrandRankingRow>();
  for (const doc of snap.docs) {
    const brand = String(doc.get("target_brand") ?? "").trim();
    if (!brand) continue;
    const model = String(doc.get("target_model") ?? "").trim();
    const label = model ? `${brand} · ${model}` : brand;
    const current = rows.get(label);
    if (current) current.non_conformities += 1;
    else rows.set(label, { brand: label, non_conformities: 1 });
  }

  return [...rows.values()]
    .sort((a, b) => b.non_conformities - a.non_conformities)
    .slice(0, Math.min(Math.max(opts.limit ?? 10, 1), 50));
}

export interface OccurrenceListItem {
  id: string;
  occurred_at: Date;
  occurred_local_date: string;
  domain_name_snapshot: string;
  criterion_name_snapshot?: string;
  result_name_snapshot: string;
  severity?: string;
  target_name_snapshot: string;
  unit_name_snapshot?: string;
  resolution_status: string;
  description?: string;
  execution_id: string;
  contains_personal_data: boolean;
  collaborator_name_snapshot?: string;
}

export interface OccurrenceListItemJson
  extends Omit<OccurrenceListItem, "occurred_at"> {
  occurred_at: string;
}

export interface ListPage {
  items: OccurrenceListItem[];
  next_cursor: string | null;
}

export interface ListPageJson {
  items: OccurrenceListItemJson[];
  next_cursor: string | null;
}

export function serializeOccurrenceListPage(page: ListPage): ListPageJson {
  return {
    items: page.items.map((item) => ({
      ...item,
      occurred_at: item.occurred_at.toISOString(),
    })),
    next_cursor: page.next_cursor,
  };
}

export async function listOccurrences(
  deps: DashboardDeps,
  filters: DashboardFilters,
  opts: {
    pageSize?: number;
    cursor?: string | null;
    includePersonalData?: boolean;
  } = {}
): Promise<ListPage> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  let query = applyPlan(
    deps.db.collection(ANALYTICS_COLLECTIONS.occurrences),
    buildFilterPlan(filters, "list")
  )
    .orderBy("occurred_at", "desc")
    .orderBy(FieldPath.documentId(), "desc")
    .limit(pageSize + 1);

  if (opts.cursor) {
    const [iso, docId] = decodeCursor(opts.cursor);
    query = query.startAfter(AdminTimestamp.fromDate(new Date(iso)), docId);
  }

  const snap = await query.get();
  const docs = snap.docs.slice(0, pageSize);
  const hasMore = snap.docs.length > pageSize;

  const items = docs.map((doc) =>
    redactPersonal(
      {
        id: doc.id,
        occurred_at: (doc.get("occurred_at") as Timestamp).toDate(),
        occurred_local_date: String(doc.get("occurred_local_date") ?? ""),
        domain_name_snapshot: String(doc.get("domain_name_snapshot") ?? ""),
        criterion_name_snapshot:
          typeof doc.get("criterion_name_snapshot") === "string"
            ? String(doc.get("criterion_name_snapshot"))
            : undefined,
        result_name_snapshot: String(doc.get("result_name_snapshot") ?? ""),
        severity:
          typeof doc.get("severity") === "string"
            ? String(doc.get("severity"))
            : undefined,
        target_name_snapshot: String(doc.get("target_name_snapshot") ?? ""),
        unit_name_snapshot:
          typeof doc.get("unit_name_snapshot") === "string"
            ? String(doc.get("unit_name_snapshot"))
            : undefined,
        resolution_status: String(doc.get("resolution_status") ?? ""),
        description:
          typeof doc.get("description") === "string"
            ? String(doc.get("description"))
            : undefined,
        execution_id: String(doc.get("execution_id") ?? ""),
        contains_personal_data: doc.get("contains_personal_data") === true,
        collaborator_name_snapshot:
          typeof doc.get("collaborator_name_snapshot") === "string"
            ? String(doc.get("collaborator_name_snapshot"))
            : undefined,
      },
      opts.includePersonalData === true
    )
  );

  const last = docs[docs.length - 1];
  return {
    items,
    next_cursor:
      hasMore && last
        ? encodeCursor((last.get("occurred_at") as Timestamp).toDate(), last.id)
        : null,
  };
}

export interface RankingRow {
  key: string;
  label: string;
  non_conformities: number;
}

const RANKING_SCAN_LIMIT = 5000;

export async function getSimpleRanking(
  deps: DashboardDeps,
  filters: DashboardFilters,
  groupBy: "criterion" | "target",
  opts: { limit?: number; includePersonalData?: boolean } = {}
): Promise<RankingRow[]> {
  const plan = buildFilterPlan(filters, "non_conformities");
  const snap = await applyPlan(
    deps.db.collection(ANALYTICS_COLLECTIONS.occurrences),
    plan
  )
    .select(
      "criterion_id",
      "criterion_name_snapshot",
      "target_identity_key",
      "target_name_snapshot",
      "contains_personal_data"
    )
    .limit(RANKING_SCAN_LIMIT)
    .get();

  const rows = new Map<string, RankingRow>();
  for (const doc of snap.docs) {
    const personal = doc.get("contains_personal_data") === true;
    if (groupBy === "target" && personal && !opts.includePersonalData) continue;

    const key =
      groupBy === "criterion"
        ? String(doc.get("criterion_id") ?? "sem_quesito")
        : String(doc.get("target_identity_key") ?? "sem_alvo");
    const label =
      groupBy === "criterion"
        ? String(doc.get("criterion_name_snapshot") ?? "Sem quesito")
        : String(doc.get("target_name_snapshot") ?? "Sem alvo");

    const current = rows.get(key);
    if (current) current.non_conformities += 1;
    else rows.set(key, { key, label, non_conformities: 1 });
  }

  return [...rows.values()]
    .sort((a, b) => b.non_conformities - a.non_conformities)
    .slice(0, Math.min(Math.max(opts.limit ?? 10, 1), 50));
}

export interface ExecutionOccurrenceItem extends OccurrenceListItemJson {
  template_item_id: string;
  option_label_snapshot?: string;
  has_active_task: boolean;
  current_primary_task_id?: string;
  last_task_lifecycle_state?: string;
  resolved_at?: string;
  resolution_time_minutes?: number;
}

export async function listOccurrencesForExecution(
  deps: DashboardDeps,
  workspaceId: string,
  executionId: string,
  opts: { includePersonalData?: boolean } = {}
): Promise<ExecutionOccurrenceItem[]> {
  const snap = await deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", workspaceId)
    .where("execution_id", "==", executionId)
    .where("is_current", "==", true)
    .where("record_type", "==", "occurrence")
    .get();

  return snap.docs
    .map((doc) => {
      const occurredAt = doc.get("occurred_at") as Timestamp | undefined;
      const resolvedAt = doc.get("resolved_at") as Timestamp | undefined;
      const str = (field: string) =>
        typeof doc.get(field) === "string" && doc.get(field)
          ? String(doc.get(field))
          : undefined;
      return redactPersonal<ExecutionOccurrenceItem>(
        {
          id: doc.id,
          occurred_at: occurredAt?.toDate().toISOString() ?? "",
          occurred_local_date: String(doc.get("occurred_local_date") ?? ""),
          domain_name_snapshot: String(doc.get("domain_name_snapshot") ?? ""),
          criterion_name_snapshot: str("criterion_name_snapshot"),
          result_name_snapshot: String(doc.get("result_name_snapshot") ?? ""),
          severity: str("severity"),
          target_name_snapshot: String(doc.get("target_name_snapshot") ?? ""),
          unit_name_snapshot: str("unit_name_snapshot"),
          resolution_status: String(doc.get("resolution_status") ?? ""),
          description: str("description"),
          execution_id: executionId,
          contains_personal_data: doc.get("contains_personal_data") === true,
          collaborator_name_snapshot: str("collaborator_name_snapshot"),
          template_item_id: String(doc.get("template_item_id") ?? ""),
          option_label_snapshot: str("option_label_snapshot"),
          has_active_task: doc.get("has_active_task") === true,
          current_primary_task_id: str("current_primary_task_id"),
          last_task_lifecycle_state: str("last_task_lifecycle_state"),
          resolved_at: resolvedAt?.toDate().toISOString(),
          resolution_time_minutes:
            typeof doc.get("resolution_time_minutes") === "number"
              ? (doc.get("resolution_time_minutes") as number)
              : undefined,
        },
        opts.includePersonalData === true
      );
    })
    .sort((a, b) => a.template_item_id.localeCompare(b.template_item_id));
}

export interface OccurrenceDetail extends OccurrenceListItemJson {
  workspace_id: string;
  record_type: string;
  record_status: string;
  is_current: boolean;
  result_polarity?: string;
  counts_as_evaluation: boolean;
  counts_as_occurrence: boolean;
  counts_as_non_conformity: boolean;
  denominator_scope?: string;
  domain_id: string;
  criterion_id?: string;
  result_id: string;
  template_id: string;
  template_version?: number;
  template_item_id: string;
  item_title_snapshot: string;
  option_label_snapshot?: string;
  answer_label?: string;
  target_type?: string;
  target_id?: string;
  unit_id?: string;
  resolution_behavior?: string;
  resolution_source?: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution_time_minutes?: number;
  resolution_note?: string;
  has_active_task: boolean;
  current_primary_task_id?: string;
  last_task_id?: string;
  last_task_lifecycle_state?: string;
  last_task_completion_result?: string;
  evidence_refs?: Array<{ type: string; item_id: string; ref: string }>;
  analytics_revision?: number;
  occurred_year_month?: string;
}

export async function getOccurrenceDetail(
  deps: DashboardDeps,
  workspaceId: string,
  occurrenceId: string,
  opts: { includePersonalData?: boolean } = {}
): Promise<OccurrenceDetail | null> {
  const snap = await deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .doc(occurrenceId)
    .get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};
  if (String(data.workspace_id ?? "") !== workspaceId) return null;

  const str = (key: string) =>
    typeof data[key] === "string" && data[key] ? String(data[key]) : undefined;
  const num = (key: string) =>
    typeof data[key] === "number" ? (data[key] as number) : undefined;
  const iso = (key: string) => {
    const value = data[key];
    return value instanceof AdminTimestamp ? value.toDate().toISOString() : undefined;
  };

  const detail: OccurrenceDetail = {
    id: snap.id,
    workspace_id: workspaceId,
    occurred_at: iso("occurred_at") ?? new Date(0).toISOString(),
    occurred_local_date: String(data.occurred_local_date ?? ""),
    occurred_year_month: str("occurred_year_month"),
    domain_name_snapshot: String(data.domain_name_snapshot ?? ""),
    criterion_name_snapshot: str("criterion_name_snapshot"),
    result_name_snapshot: String(data.result_name_snapshot ?? ""),
    severity: str("severity"),
    target_name_snapshot: String(data.target_name_snapshot ?? ""),
    unit_name_snapshot: str("unit_name_snapshot"),
    resolution_status: String(data.resolution_status ?? ""),
    description: str("description"),
    execution_id: String(data.execution_id ?? ""),
    contains_personal_data: data.contains_personal_data === true,
    collaborator_name_snapshot: str("collaborator_name_snapshot"),
    record_type: String(data.record_type ?? ""),
    record_status: String(data.record_status ?? ""),
    is_current: data.is_current === true,
    result_polarity: str("result_polarity"),
    counts_as_evaluation: data.counts_as_evaluation === true,
    counts_as_occurrence: data.counts_as_occurrence === true,
    counts_as_non_conformity: data.counts_as_non_conformity === true,
    denominator_scope: str("denominator_scope"),
    domain_id: String(data.domain_id ?? ""),
    criterion_id: str("criterion_id"),
    result_id: String(data.result_id ?? ""),
    template_id: String(data.template_id ?? ""),
    template_version: num("template_version"),
    template_item_id: String(data.template_item_id ?? ""),
    item_title_snapshot: String(data.item_title_snapshot ?? ""),
    option_label_snapshot: str("option_label_snapshot"),
    answer_label: str("answer_label"),
    target_type: str("target_type"),
    target_id: str("target_id"),
    unit_id: str("unit_id"),
    resolution_behavior: str("resolution_behavior"),
    resolution_source: str("resolution_source"),
    resolved_at: iso("resolved_at"),
    resolved_by: str("resolved_by"),
    resolution_time_minutes: num("resolution_time_minutes"),
    resolution_note: str("resolution_note"),
    has_active_task: data.has_active_task === true,
    current_primary_task_id: str("current_primary_task_id"),
    last_task_id: str("last_task_id"),
    last_task_lifecycle_state: str("last_task_lifecycle_state"),
    last_task_completion_result: str("last_task_completion_result"),
    evidence_refs: Array.isArray(data.evidence_refs)
      ? (data.evidence_refs as Array<{ type: string; item_id: string; ref: string }>)
      : undefined,
    analytics_revision: num("analytics_revision"),
  };

  return redactPersonal(detail, opts.includePersonalData === true);
}

function encodeCursor(occurredAt: Date, docId: string) {
  return Buffer.from(`${occurredAt.toISOString()}|${docId}`).toString(
    "base64url"
  );
}

function decodeCursor(cursor: string): [string, string] {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const index = raw.indexOf("|");
  if (index < 0) throw new Error("Cursor inválido.");
  return [raw.slice(0, index), raw.slice(index + 1)];
}

const REDACTED = "[restrito]";

export function redactPersonal<
  T extends {
    contains_personal_data: boolean;
    target_name_snapshot: string;
    collaborator_name_snapshot?: string;
    description?: string;
  },
>(row: T, includePersonalData: boolean): T {
  if (includePersonalData || !row.contains_personal_data) return row;
  return {
    ...row,
    target_name_snapshot: REDACTED,
    collaborator_name_snapshot: row.collaborator_name_snapshot
      ? REDACTED
      : undefined,
    description: row.description ? REDACTED : undefined,
  };
}

const CSV_COLUMNS = [
  "occurred_local_date",
  "domain_name_snapshot",
  "criterion_name_snapshot",
  "result_name_snapshot",
  "severity",
  "target_name_snapshot",
  "unit_name_snapshot",
  "resolution_status",
  "description",
  "execution_id",
] as const;

export function toCsv(
  rows: readonly OccurrenceListItem[],
  opts: { includePersonalData?: boolean } = {}
) {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((raw) => {
    const row = redactPersonal(raw, opts.includePersonalData === true);
    return CSV_COLUMNS.map((column) => csvEscape(row[column])).join(",");
  });
  return `\uFEFF${[header, ...lines].join("\r\n")}`;
}

function csvEscape(value: unknown) {
  if (value === undefined || value === null) return "";
  const stringValue = String(value);
  const safe = /^[=+\-@]/.test(stringValue) ? `'${stringValue}` : stringValue;
  return /[",\r\n]/.test(safe)
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}
