import {
  FieldPath,
  Timestamp as AdminTimestamp,
  type Firestore,
  type Query,
  type Timestamp,
  type WhereFilterOp,
} from "firebase-admin/firestore";

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
