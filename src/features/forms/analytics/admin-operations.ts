import {
  Timestamp as AdminTimestamp,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";

import { type FormExecution, type FormTemplate } from "@/types/forms";

import {
  DEFAULT_FORMS_ANALYTICS_TIMEZONE,
  loadGenerationLookups,
  mapExecutionToAnalyticsView,
  mapTemplateToAnalyticsViews,
} from "./execution-adapter";
import type { ExecutionLoader, ReprocessScope } from "./reprocess-service";

const MAX_REPROCESS_EXECUTIONS = 200;
const MAX_RECOMPUTE_DAYS = 400;

export interface ReprocessScopeInput {
  executionIds?: string[];
  from?: string;
  to?: string;
  templateId?: string;
  projectId?: string;
  status?: "completed";
  workspaceTimezone?: string;
}

export interface DateRangeInput {
  from?: string;
  to?: string;
}

export class AnalyticsAdminInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsAdminInputError";
  }
}

export function analyticsAdminErrorResponse(error: AnalyticsAdminInputError) {
  return Response.json({ error: error.message }, { status: 400 });
}

export async function buildReprocessScope(
  db: Firestore,
  workspaceId: string,
  input: ReprocessScopeInput
): Promise<ReprocessScope> {
  const executionIds =
    Array.isArray(input.executionIds) && input.executionIds.length > 0
      ? normalizeIds(input.executionIds).slice(0, MAX_REPROCESS_EXECUTIONS)
      : await resolveExecutionIds(db, workspaceId, input);

  if (executionIds.length === 0) {
    throw new AnalyticsAdminInputError(
      "Nenhuma execução encontrada para o escopo informado."
    );
  }

  const lookups = await loadGenerationLookups({ db, workspaceId });
  return {
    workspaceId,
    executionIds,
    lookups,
    workspaceTimezone:
      input.workspaceTimezone?.trim() || DEFAULT_FORMS_ANALYTICS_TIMEZONE,
  };
}

export function createExecutionLoader(
  db: Firestore,
  workspaceId: string
): ExecutionLoader {
  return async (executionId: string) => {
    const snap = await db.collection("form_executions").doc(executionId).get();
    if (!snap.exists || snap.get("workspace_id") !== workspaceId) {
      return null;
    }

    const execution = {
      id: snap.id,
      ...(serializeFormValue(snap.data() ?? {}) as Record<string, unknown>),
    } as FormExecution;

    if (execution.status !== "completed") {
      return null;
    }

    const template =
      execution.template_snapshot ??
      (await loadTemplate(db, workspaceId, execution.template_id));
    if (!template) return null;

    return {
      execution: mapExecutionToAnalyticsView(execution),
      items: mapTemplateToAnalyticsViews(template),
    };
  };
}

async function resolveExecutionIds(
  db: Firestore,
  workspaceId: string,
  input: ReprocessScopeInput
) {
  const { from, to } = parseDateRange(input, {
    defaultDays: 30,
    maxDays: MAX_RECOMPUTE_DAYS,
  });

  let query: Query = db
    .collection("form_executions")
    .where("workspace_id", "==", workspaceId)
    .where("status", "==", input.status ?? "completed")
    .where("completed_at", ">=", from.toISOString())
    .where("completed_at", "<=", to.toISOString())
    .limit(MAX_REPROCESS_EXECUTIONS);

  if (input.templateId) {
    query = query.where("template_id", "==", input.templateId);
  }
  if (input.projectId) {
    query = query.where("form_project_id", "==", input.projectId);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => doc.id);
}

export function parseLocalDateRange(
  input: DateRangeInput,
  options: { defaultDays?: number; maxDays?: number } = {}
) {
  const { from, to } = parseDateRange(input, options);
  return {
    fromLocalDate: from.toISOString().slice(0, 10),
    toLocalDate: to.toISOString().slice(0, 10),
  };
}

export function parseDateRange(
  input: DateRangeInput,
  options: { defaultDays?: number; maxDays?: number } = {}
) {
  const defaultDays = options.defaultDays ?? 1;
  const maxDays = options.maxDays ?? MAX_RECOMPUTE_DAYS;
  const now = new Date();
  const fallbackTo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
  );
  const fallbackFrom = new Date(fallbackTo);
  fallbackFrom.setUTCDate(fallbackFrom.getUTCDate() - (defaultDays - 1));
  fallbackFrom.setUTCHours(0, 0, 0, 0);

  const from = parseDateParam(input.from, fallbackFrom, "start");
  const to = parseDateParam(input.to, fallbackTo, "end");

  if (from > to) {
    throw new AnalyticsAdminInputError(
      "Período inválido: from deve ser menor ou igual a to."
    );
  }
  const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  if (days > maxDays) {
    throw new AnalyticsAdminInputError(
      `Período inválido: selecione no máximo ${maxDays} dias.`
    );
  }

  return { from, to };
}

export function normalizeRetentionDays(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AnalyticsAdminInputError("retentionDays deve ser maior que zero.");
  }
  return parsed;
}

export function parseWorkspaceIds(value: string | null | undefined) {
  return (value ?? process.env.FORMS_ANALYTICS_JOB_WORKSPACE_IDS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function assertCronSecret(request: Request) {
  const expected =
    process.env.CRON_SECRET ??
    process.env.FORMS_ANALYTICS_JOB_SECRET ??
    process.env.FORMS_SCHEDULER_SECRET;
  if (!expected) {
    throw new AnalyticsAdminInputError("CRON_SECRET não configurado.");
  }

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret");

  if (provided !== expected) {
    const error = new Error("Não autorizado.");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
}

export function parsePositiveInt(
  value: string | null | undefined,
  fallback: number,
  max: number
) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

async function loadTemplate(
  db: Firestore,
  workspaceId: string,
  templateId: string
) {
  const snap = await db.collection("form_templates").doc(templateId).get();
  if (!snap.exists || snap.get("workspace_id") !== workspaceId) {
    return null;
  }
  return {
    id: snap.id,
    ...(serializeFormValue(snap.data() ?? {}) as Record<string, unknown>),
  } as FormTemplate;
}

function normalizeIds(ids: readonly string[]) {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

function parseDateParam(
  value: string | undefined,
  fallback: Date,
  boundary: "start" | "end"
) {
  if (!value) return fallback;
  const trimmed = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const parsed = dateOnly
    ? new Date(
        `${trimmed}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}Z`
      )
    : new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    throw new AnalyticsAdminInputError(`Data inválida: ${value}.`);
  }
  return parsed;
}

function serializeFormValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeFormValue);
  if (value instanceof AdminTimestamp) return value.toDate().toISOString();
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        serializeFormValue(entry),
      ])
    );
  }
  return value;
}
