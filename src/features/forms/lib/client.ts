import type {
  FormAssignment,
  FormExecution,
  FormExecutionEvent,
  FormModel,
  FormProject,
  FormSubtype,
  FormTemplate,
  FormType,
} from "@/types/forms";
import { fetchWithTimeout } from "@/lib/fetch-utils";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

export type FormsBootstrapPayload = {
  access: {
    can_view: boolean;
    can_create_projects: boolean;
    can_manage_templates: boolean;
    can_view_analytics: boolean;
    can_manage_analytics_taxonomy: boolean;
    can_configure_analytics_templates: boolean;
    can_reprocess_occurrences: boolean;
    can_manage_retention_policy: boolean;
    can_resolve_occurrences: boolean;
    can_validate_occurrence_resolution: boolean;
    can_view_personal_targets: boolean;
  };
  projects: FormProject[];
  types: FormType[];
  templates: FormTemplate[];
  template_options?: FormTemplate[];
  executions: FormExecution[];
};

async function parseError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
}

async function authorizedGet<T>(
  path: string,
  firebaseUser: FirebaseUserLike,
  fallbackError: string
) {
  const token = await firebaseUser.getIdToken();
  const response = await fetchWithTimeout(
    path,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
    20000
  );

  if (!response.ok) {
    throw new Error(await parseError(response, fallbackError));
  }

  return (await response.json()) as T;
}

export async function fetchFormsBootstrap(firebaseUser: FirebaseUserLike) {
  return authorizedGet<FormsBootstrapPayload>(
    "/api/forms/bootstrap",
    firebaseUser,
    "Falha ao carregar o bootstrap de formulários."
  );
}

export async function fetchFormTemplate(
  firebaseUser: FirebaseUserLike,
  templateId: string
) {
  return authorizedGet<FormTemplate>(
    `/api/forms/templates/${templateId}`,
    firebaseUser,
    "Falha ao carregar o formulário."
  );
}

export async function fetchFormExecution(
  firebaseUser: FirebaseUserLike,
  executionId: string
) {
  return authorizedGet<{
    execution: FormExecution;
    events: FormExecutionEvent[];
  }>(
    `/api/forms/executions/${executionId}`,
    firebaseUser,
    "Falha ao carregar o preenchimento."
  );
}

async function authorizedJsonRequest<T>(
  path: string,
  firebaseUser: FirebaseUserLike,
  method: "POST" | "PATCH",
  body: unknown,
  fallbackError: string,
  timeoutMs = 20000
) {
  const token = await firebaseUser.getIdToken();
  const response = await fetchWithTimeout(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(await parseError(response, fallbackError));
  }

  return (await response.json()) as T;
}

export type AnalyticsSimulationReport = {
  executions: Array<{
    execution_id: string;
    status: "ok" | "skipped" | "error";
    skip_reason?: string;
    error?: string;
    will_create_evaluations: number;
    will_create_occurrences: number;
    will_supersede: number;
  }>;
  totals: {
    executions_ok: number;
    executions_skipped: number;
    executions_error: number;
    evaluations: number;
    occurrences: number;
    superseded: number;
  };
};

export type AnalyticsReprocessScopeBody = {
  from?: string;
  to?: string;
  templateId?: string;
  projectId?: string;
  executionIds?: string[];
};

export async function simulateAnalyticsReprocess(
  firebaseUser: FirebaseUserLike,
  body: AnalyticsReprocessScopeBody
) {
  return authorizedJsonRequest<{
    simulation: AnalyticsSimulationReport;
    simulated_at: string;
    scope: {
      execution_ids: string[];
      execution_count: number;
      workspace_timezone: string;
      fromLocalDate: string;
      toLocalDate: string;
    };
  }>(
    "/api/forms/analytics/admin/reprocess/simulate",
    firebaseUser,
    "POST",
    body,
    "Falha ao simular reprocessamento.",
    120000
  );
}

export async function executeAnalyticsReprocess(
  firebaseUser: FirebaseUserLike,
  body: AnalyticsReprocessScopeBody & {
    simulation: AnalyticsSimulationReport;
    simulatedAt: string;
    recomputeAggregates?: boolean;
  }
) {
  return authorizedJsonRequest<{
    results: Array<{
      execution_id: string;
      status: "ok" | "skipped" | "error";
      error?: string;
      written: number;
      superseded: number;
      analytics_revision?: number;
    }>;
    aggregates: { days: number; rows_read: number } | null;
  }>(
    "/api/forms/analytics/admin/reprocess/execute",
    firebaseUser,
    "POST",
    body,
    "Falha ao executar reprocessamento.",
    180000
  );
}

export async function recomputeAnalyticsAggregates(
  firebaseUser: FirebaseUserLike,
  body: { from?: string; to?: string }
) {
  return authorizedJsonRequest<{
    days: number;
    rows_read: number;
    fromLocalDate: string;
    toLocalDate: string;
  }>(
    "/api/forms/analytics/admin/aggregates/recompute",
    firebaseUser,
    "POST",
    body,
    "Falha ao recomputar agregados.",
    120000
  );
}

export async function backfillAnalyticsRetention(
  firebaseUser: FirebaseUserLike,
  body: { retentionDays: number; batchLimit?: number }
) {
  return authorizedJsonRequest<{
    stamped: number;
    has_more: boolean;
    retention_days: number;
  }>(
    "/api/forms/analytics/admin/privacy/backfill",
    firebaseUser,
    "POST",
    body,
    "Falha ao executar backfill de retenção.",
    120000
  );
}

export async function anonymizeDueAnalyticsOccurrences(
  firebaseUser: FirebaseUserLike,
  body: { batchLimit?: number; keepOriginalInVault?: boolean }
) {
  return authorizedJsonRequest<{
    anonymized: number;
    vaulted: number;
    remaining_due: number;
  }>(
    "/api/forms/analytics/admin/privacy/anonymize-due",
    firebaseUser,
    "POST",
    body,
    "Falha ao anonimizar ocorrências vencidas.",
    120000
  );
}

async function authorizedDeleteRequest<T>(
  path: string,
  firebaseUser: FirebaseUserLike,
  fallbackError: string
) {
  const token = await firebaseUser.getIdToken();
  const response = await fetchWithTimeout(
    path,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
    20000
  );

  if (!response.ok) {
    throw new Error(await parseError(response, fallbackError));
  }

  return (await response.json()) as T;
}

export async function claimFormExecution(
  firebaseUser: FirebaseUserLike,
  executionId: string
) {
  return authorizedJsonRequest<{ execution: FormExecution }>(
    `/api/forms/executions/${executionId}/claim`,
    firebaseUser,
    "POST",
    {},
    "Falha ao assumir o preenchimento."
  );
}

export async function updateFormExecution(
  firebaseUser: FirebaseUserLike,
  executionId: string,
  body: {
    action: "save" | "complete" | "reopen" | "cancel";
    items?: Array<Record<string, unknown>>;
    sections?: Array<Record<string, unknown>>;
  }
) {
  return authorizedJsonRequest<{ execution: FormExecution }>(
    `/api/forms/executions/${executionId}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar o preenchimento."
  );
}

export async function createFormProject(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ project: FormProject }>(
    "/api/forms/projects",
    firebaseUser,
    "POST",
    body,
    "Falha ao criar o projeto."
  );
}

export async function fetchFormModels(firebaseUser: FirebaseUserLike) {
  return authorizedGet<{ models: FormModel[] }>(
    "/api/forms/models",
    firebaseUser,
    "Falha ao carregar modelos."
  );
}

export async function runFormsScheduler(
  firebaseUser: FirebaseUserLike,
  body: { fromDate?: string; toDate?: string; dryRun?: boolean } = {}
) {
  return authorizedJsonRequest<{
    created_count: number;
    skipped_count: number;
    overdue_updated: number;
    created: FormExecution[];
    skipped: Array<{ id: string; reason: string }>;
  }>(
    "/api/forms/scheduler",
    firebaseUser,
    "POST",
    body,
    "Falha ao gerar execuções recorrentes."
  );
}

export async function createFormModel(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ model: FormModel }>(
    "/api/forms/models",
    firebaseUser,
    "POST",
    body,
    "Falha ao criar modelo."
  );
}

export async function updateFormModel(
  firebaseUser: FirebaseUserLike,
  modelId: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ model: FormModel }>(
    `/api/forms/models/${modelId}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao editar modelo."
  );
}

export async function deleteFormModel(
  firebaseUser: FirebaseUserLike,
  modelId: string
) {
  return authorizedDeleteRequest<{ ok: true }>(
    `/api/forms/models/${modelId}`,
    firebaseUser,
    "Falha ao arquivar modelo."
  );
}

export async function fetchMyFormExecutions(firebaseUser: FirebaseUserLike) {
  return authorizedGet<{ executions: FormExecution[] }>(
    "/api/forms/executions?assignedToMe=true&limit=100",
    firebaseUser,
    "Falha ao carregar meus formulários."
  );
}

export async function updateFormProject(
  firebaseUser: FirebaseUserLike,
  projectId: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ project: FormProject }>(
    `/api/forms/projects/${projectId}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar o projeto."
  );
}

export async function deleteFormProject(
  firebaseUser: FirebaseUserLike,
  projectId: string
) {
  return authorizedDeleteRequest<{ ok: true }>(
    `/api/forms/projects/${projectId}`,
    firebaseUser,
    "Falha ao excluir o projeto."
  );
}

export async function createFormTemplate(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ template: FormTemplate }>(
    "/api/forms/templates",
    firebaseUser,
    "POST",
    body,
    "Falha ao criar o formulário."
  );
}

export async function fetchFormTypes(
  firebaseUser: FirebaseUserLike,
  search?: { formProjectId?: string; active?: boolean }
) {
  const query = new URLSearchParams();
  if (search?.formProjectId) query.set("formProjectId", search.formProjectId);
  if (typeof search?.active === "boolean") query.set("active", String(search.active));
  const suffix = query.size ? `?${query.toString()}` : "";
  return authorizedGet<{ types: FormType[] }>(
    `/api/forms/types${suffix}`,
    firebaseUser,
    "Falha ao carregar tipos de formulário."
  );
}

export async function createFormType(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ type: FormType }>(
    "/api/forms/types",
    firebaseUser,
    "POST",
    body,
    "Falha ao criar tipo."
  );
}

export async function updateFormType(
  firebaseUser: FirebaseUserLike,
  typeId: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ type: FormType }>(
    `/api/forms/types/${typeId}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar tipo."
  );
}

export async function fetchFormSubtypes(
  firebaseUser: FirebaseUserLike,
  search?: { formProjectId?: string; formTypeId?: string; active?: boolean }
) {
  const query = new URLSearchParams();
  if (search?.formProjectId) query.set("formProjectId", search.formProjectId);
  if (search?.formTypeId) query.set("formTypeId", search.formTypeId);
  if (typeof search?.active === "boolean") query.set("active", String(search.active));
  const suffix = query.size ? `?${query.toString()}` : "";
  return authorizedGet<{ subtypes: FormSubtype[] }>(
    `/api/forms/subtypes${suffix}`,
    firebaseUser,
    "Falha ao carregar subtipos de formulário."
  );
}

export async function createFormSubtype(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ subtype: FormSubtype }>(
    "/api/forms/subtypes",
    firebaseUser,
    "POST",
    body,
    "Falha ao criar subtipo."
  );
}

export async function updateFormSubtype(
  firebaseUser: FirebaseUserLike,
  subtypeId: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ subtype: FormSubtype }>(
    `/api/forms/subtypes/${subtypeId}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar subtipo."
  );
}

export type TemplateValidationIssue = {
  level: "error" | "warning";
  item_id: string;
  field?: string;
  code: string;
  message: string;
};

export class TemplatePublicationError extends Error {
  constructor(
    message: string,
    public readonly issues: TemplateValidationIssue[]
  ) {
    super(message);
    this.name = "TemplatePublicationError";
  }
}

export async function updateFormTemplate(
  firebaseUser: FirebaseUserLike,
  templateId: string,
  body: Record<string, unknown>
) {
  const token = await firebaseUser.getIdToken();
  const response = await fetchWithTimeout(
    `/api/forms/templates/${templateId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
    20000
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const issues = (payload?.validation?.issues ??
      []) as TemplateValidationIssue[];
    if (issues.length > 0) {
      throw new TemplatePublicationError(
        payload?.error || "Configuração analítica inválida.",
        issues
      );
    }
    throw new Error(payload?.error || "Falha ao atualizar o formulário.");
  }

  return (await response.json()) as { template: FormTemplate };
}

export async function fetchFormTemplateApplication(
  firebaseUser: FirebaseUserLike,
  templateId: string
) {
  return authorizedGet<{
    active_assignment: FormAssignment | null;
    assignments: FormAssignment[];
  }>(
    `/api/forms/templates/${templateId}/application`,
    firebaseUser,
    "Falha ao carregar aplicação do formulário."
  );
}

export async function updateFormTemplateApplication(
  firebaseUser: FirebaseUserLike,
  templateId: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ assignment: FormAssignment }>(
    `/api/forms/templates/${templateId}/application`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar aplicação do formulário."
  );
}

export async function uploadFormAsset(
  firebaseUser: FirebaseUserLike,
  params: {
    file: File;
    kind: "photo" | "signature" | "file";
    executionId: string;
    scope: "item" | "section";
    targetId: string;
  }
) {
  const token = await firebaseUser.getIdToken();
  const formData = new FormData();
  formData.append("file", params.file);
  formData.append("kind", params.kind);
  formData.append("executionId", params.executionId);
  formData.append("scope", params.scope);
  formData.append("targetId", params.targetId);

  const response = await fetchWithTimeout(
    "/api/forms/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
      cache: "no-store",
    },
    30000
  );

  if (!response.ok) {
    throw new Error(await parseError(response, "Falha ao enviar arquivo."));
  }

  return (await response.json()) as {
    kind: "photo" | "signature" | "file";
    assetPath: string;
    assetUrl: string;
    fileName: string;
    mime: string;
  };
}

export async function deleteFormAsset(
  firebaseUser: FirebaseUserLike,
  input: {
    assetPath: string;
    executionId: string;
    scope: "item" | "section";
    targetId: string;
  }
) {
  return authorizedJsonRequest<{ ok: true }>(
    "/api/forms/upload",
    firebaseUser,
    "PATCH",
    { action: "delete", ...input },
    "Falha ao remover arquivo."
  );
}

// ─── Analytics: dashboard, ocorrências e taxonomia ─────────────────────────────

export type AnalyticsDashboardCards = {
  evaluations: number;
  non_conformities: number;
  open_occurrences: number;
  conformity_rate: number | null;
};

export type AnalyticsRankingRow = {
  key: string;
  label: string;
  non_conformities: number;
};

export type AnalyticsOccurrenceRow = {
  id: string;
  occurred_at: string;
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
  template_item_id?: string;
  option_label_snapshot?: string;
  has_active_task?: boolean;
  current_primary_task_id?: string;
  last_task_lifecycle_state?: string;
  resolved_at?: string;
  resolution_time_minutes?: number;
};

export type AnalyticsDashboardFilters = {
  from?: string;
  to?: string;
  domainId?: string;
  unitId?: string;
  statusGroup?: "open" | "resolved" | "all";
};

function analyticsFilterParams(filters: AnalyticsDashboardFilters) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.domainId && filters.domainId !== "all") {
    params.set("domain_id", filters.domainId);
  }
  if (filters.unitId && filters.unitId !== "all") {
    params.set("unit_id", filters.unitId);
  }
  if (filters.statusGroup && filters.statusGroup !== "all") {
    params.set("status_group", filters.statusGroup);
  }
  return params;
}

export type AnalyticsExtendedMetrics = {
  resolved_occurrences: number;
  overdue_occurrences: number;
  open_without_task: number;
  open_with_cancelled_task: number;
  pending_validation: number;
  avg_resolution_time_minutes: number | null;
};

export type AnalyticsRecurrenceRow = {
  target_identity_key: string;
  target_name_snapshot: string;
  occurrences: number;
};

export type AnalyticsBrandRankingRow = {
  brand: string;
  non_conformities: number;
};

export async function fetchAnalyticsSummary(
  firebaseUser: FirebaseUserLike,
  filters: AnalyticsDashboardFilters,
  options: {
    groupBy?: "criterion" | "target";
    extended?: boolean;
    recurrence?: boolean;
    brandRanking?: boolean;
  } = {}
) {
  const params = analyticsFilterParams(filters);
  if (options.groupBy) params.set("group_by", options.groupBy);
  if (options.extended) params.set("extended", "true");
  if (options.recurrence) params.set("recurrence", "true");
  if (options.brandRanking) params.set("brand_ranking", "true");
  return authorizedGet<{
    cards: AnalyticsDashboardCards;
    cards_source: "live" | "daily";
    ranking: AnalyticsRankingRow[] | null;
    extended: AnalyticsExtendedMetrics | null;
    recurrence: AnalyticsRecurrenceRow[] | null;
    brand_ranking: AnalyticsBrandRankingRow[] | null;
  }>(
    `/api/forms/analytics/summary?${params.toString()}`,
    firebaseUser,
    "Falha ao carregar indicadores."
  );
}

export async function fetchAnalyticsOccurrences(
  firebaseUser: FirebaseUserLike,
  filters: AnalyticsDashboardFilters,
  options: { cursor?: string | null; pageSize?: number } = {}
) {
  const params = analyticsFilterParams(filters);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.pageSize) params.set("page_size", String(options.pageSize));
  return authorizedGet<{
    items: AnalyticsOccurrenceRow[];
    next_cursor: string | null;
  }>(
    `/api/forms/analytics/occurrences?${params.toString()}`,
    firebaseUser,
    "Falha ao listar ocorrências."
  );
}

export async function fetchExecutionOccurrences(
  firebaseUser: FirebaseUserLike,
  executionId: string
) {
  return authorizedGet<{ items: AnalyticsOccurrenceRow[] }>(
    `/api/forms/analytics/occurrences?execution_id=${encodeURIComponent(executionId)}`,
    firebaseUser,
    "Falha ao carregar ocorrências da execução."
  );
}

export async function resolveAnalyticsOccurrence(
  firebaseUser: FirebaseUserLike,
  occurrenceId: string,
  note?: string
) {
  return authorizedJsonRequest<{ ok: true }>(
    `/api/forms/analytics/occurrences/${occurrenceId}/resolve`,
    firebaseUser,
    "POST",
    { note },
    "Falha ao resolver ocorrência."
  );
}

export async function cancelAnalyticsOccurrence(
  firebaseUser: FirebaseUserLike,
  occurrenceId: string,
  reason?: string
) {
  return authorizedJsonRequest<{ ok: true }>(
    `/api/forms/analytics/occurrences/${occurrenceId}/cancel`,
    firebaseUser,
    "POST",
    { reason },
    "Falha ao cancelar ocorrência."
  );
}

export async function validateAnalyticsOccurrence(
  firebaseUser: FirebaseUserLike,
  occurrenceId: string
) {
  return authorizedJsonRequest<{ ok: true }>(
    `/api/forms/analytics/occurrences/${occurrenceId}/validate-resolution`,
    firebaseUser,
    "POST",
    {},
    "Falha ao validar resolução."
  );
}

export async function rejectAnalyticsOccurrence(
  firebaseUser: FirebaseUserLike,
  occurrenceId: string,
  rejectionReason: string
) {
  return authorizedJsonRequest<{
    ok: true;
    follow_up_task_id: string | null;
  }>(
    `/api/forms/analytics/occurrences/${occurrenceId}/reject-resolution`,
    firebaseUser,
    "POST",
    { rejection_reason: rejectionReason },
    "Falha ao rejeitar resolução."
  );
}

export type AnalyticsTaxonomyEntry = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  color?: string;
  order?: number;
  is_active: boolean;
  is_editable?: boolean;
  is_deletable?: boolean;
  source?: string;
  domain_id?: string;
  polarity?: string;
  severity?: string;
  counts_as_evaluation?: boolean;
  counts_as_occurrence?: boolean;
  counts_as_non_conformity?: boolean;
  type?: string;
  target_scope?: string;
  unit_ids?: string[];
  code?: string;
};

export type AnalyticsTaxonomyKind =
  | "domains"
  | "criteria"
  | "results"
  | "targets";

export async function fetchAnalyticsTaxonomy(
  firebaseUser: FirebaseUserLike,
  kind: AnalyticsTaxonomyKind
) {
  const payload = await authorizedGet<Record<string, AnalyticsTaxonomyEntry[]>>(
    `/api/forms/analytics/${kind}`,
    firebaseUser,
    "Falha ao carregar taxonomia."
  );
  return payload[kind] ?? [];
}

export async function createAnalyticsTaxonomyEntry(
  firebaseUser: FirebaseUserLike,
  kind: AnalyticsTaxonomyKind,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ id: string }>(
    `/api/forms/analytics/${kind}`,
    firebaseUser,
    "POST",
    body,
    "Falha ao criar registro."
  );
}

export async function updateAnalyticsTaxonomyEntry(
  firebaseUser: FirebaseUserLike,
  kind: AnalyticsTaxonomyKind,
  id: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ ok: true }>(
    `/api/forms/analytics/${kind}/${id}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar registro."
  );
}

export async function seedAnalyticsTaxonomy(firebaseUser: FirebaseUserLike) {
  return authorizedJsonRequest<Record<string, unknown>>(
    "/api/forms/analytics/seed",
    firebaseUser,
    "POST",
    {},
    "Falha ao aplicar seed de taxonomia."
  );
}

// ─── Analytics: políticas de retenção ──────────────────────────────────────────

export type AnalyticsRetentionPolicy = {
  id: string;
  name: string;
  subject_type: "collaborator" | "customer" | "third_party" | "any";
  retention_days: number;
  keep_original_in_vault: boolean;
  is_default: boolean;
  is_active: boolean;
};

export async function fetchRetentionPolicies(firebaseUser: FirebaseUserLike) {
  const payload = await authorizedGet<{ policies: AnalyticsRetentionPolicy[] }>(
    "/api/forms/analytics/retention-policies",
    firebaseUser,
    "Falha ao carregar políticas de retenção."
  );
  return payload.policies;
}

export async function createRetentionPolicy(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ id: string }>(
    "/api/forms/analytics/retention-policies",
    firebaseUser,
    "POST",
    body,
    "Falha ao criar política de retenção."
  );
}

export async function updateRetentionPolicy(
  firebaseUser: FirebaseUserLike,
  id: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ ok: true }>(
    `/api/forms/analytics/retention-policies/${id}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar política de retenção."
  );
}
