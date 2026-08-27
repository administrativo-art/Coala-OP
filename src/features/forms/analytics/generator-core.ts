import type {
  AnalyticsItemView,
  FormItemAnalyticsConfig,
  FormItemOption,
  ShowIfCondition,
} from "./analytics-config-schema";
import {
  buildDedupeKey,
  buildOccurrenceIdentityKey,
  buildTargetIdentityKey,
  localDateParts,
  type AnalyticsCreatedFrom,
  type AnalyticsEvidenceRef,
  type AnalyticsGeneratedBy,
  type OccurrenceDraft,
} from "./occurrence-model";
import type {
  AnalyticsResultPolarity,
  AnalyticsSeverity,
  AnalyticsTargetScope,
  AnalyticsTargetType,
} from "./types";

export interface AnswerTargetRef {
  target_type: AnalyticsTargetType;
  id: string;
  name: string;
  code?: string;
  unit_id?: string;
  metadata?: {
    brand?: string;
    model?: string;
    category?: string;
    asset_code?: string;
    role?: string;
    [key: string]: unknown;
  };
}

export interface ExecutionAnswer {
  value: unknown;
  label?: string;
  selected_option_ids?: string[];
  is_out_of_range?: boolean;
  target_ref?: AnswerTargetRef;
  photo_urls?: string[];
  file_refs?: string[];
  signature_url?: string;
  location_ref?: string;
}

export interface ExecutionView {
  id: string;
  workspace_id: string;
  form_project_id?: string;
  template_id: string;
  template_version: number;
  completed_at: Date;
  unit_id?: string;
  unit_name?: string;
  assigned_collaborator?: { id: string; name: string; role?: string };
  executor?: { id: string; name: string; role?: string };
  answers: ReadonlyMap<string, ExecutionAnswer>;
}

export interface GenerationLookups {
  domains: ReadonlyMap<string, { name: string; is_active: boolean }>;
  criteria: ReadonlyMap<
    string,
    {
      name: string;
      domain_id: string;
      default_severity?: AnalyticsSeverity;
      is_active: boolean;
    }
  >;
  results: ReadonlyMap<
    string,
    {
      name: string;
      polarity: AnalyticsResultPolarity;
      counts_as_evaluation: boolean;
      counts_as_occurrence: boolean;
      counts_as_non_conformity: boolean;
      is_active: boolean;
    }
  >;
  freeTargets: ReadonlyMap<
    string,
    {
      name: string;
      code?: string;
      type: string;
      target_scope: AnalyticsTargetScope;
      unit_ids?: string[];
    }
  >;
}

export interface GenerationContext {
  workspace_timezone: string;
  analytics_revision: number;
  generation_batch_id: string;
  created_from: AnalyticsCreatedFrom;
}

export class GenerationError extends Error {
  constructor(message: string, public readonly item_id: string) {
    super(message);
    this.name = "GenerationError";
  }
}

export function isItemVisible(
  item: AnalyticsItemView,
  answers: ReadonlyMap<string, ExecutionAnswer>
) {
  if (!item.show_if) return true;
  return matchesShowIf(item.show_if, answers);
}

function matchesShowIf(
  condition: ShowIfCondition,
  answers: ReadonlyMap<string, ExecutionAnswer>
) {
  const answer = answers.get(condition.item_id);
  const actual = normalize(answer?.value);
  const expected = normalize(condition.value);
  return condition.operator === "equals"
    ? Object.is(actual, expected)
    : !Object.is(actual, expected);
}

function normalize(value: unknown) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export function evaluateOccurrenceCondition(
  condition: FormItemAnalyticsConfig["occurrence_condition"],
  answer: ExecutionAnswer | undefined
) {
  const value = normalize(answer?.value);

  switch (condition.operator) {
    case "always":
      return true;
    case "equals":
      return Object.is(value, normalize(condition.value));
    case "not_equals":
      return !Object.is(value, normalize(condition.value));
    case "contains":
      if (Array.isArray(value)) return value.includes(condition.value);
      if (typeof value === "string" && typeof condition.value === "string") {
        return value.toLowerCase().includes(condition.value.toLowerCase());
      }
      return false;
    case "out_of_range":
      return answer?.is_out_of_range === true;
    case "is_empty":
      return (
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      );
    case "is_not_empty":
      return !(
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      );
  }
}

export interface ResolvedTarget {
  target_type: AnalyticsTargetType;
  target_id?: string;
  target_name_snapshot: string;
  target_code_snapshot?: string;
  target_scope?: AnalyticsTargetScope;
  target_identity_key: string;
  unit_id?: string;
  unit_name_snapshot?: string;
  asset_id?: string;
  target_brand?: string;
  target_model?: string;
  target_category?: string;
  target_asset_code?: string;
  collaborator_id?: string;
  collaborator_name_snapshot?: string;
  collaborator_role_snapshot?: string;
  target_metadata_snapshot?: Record<string, unknown>;
  contains_personal_data: boolean;
}

export function resolveOccurrenceTarget(
  item: AnalyticsItemView,
  config: FormItemAnalyticsConfig,
  execution: ExecutionView,
  lookups: GenerationLookups
): ResolvedTarget {
  const fail = (message: string): never => {
    throw new GenerationError(`[${item.id}] ${message}`, item.id);
  };
  const type = config.target_type ?? fail("target_type ausente.");

  const base = (params: {
    target_id?: string;
    name: string;
    code?: string;
    unit_id?: string;
    scope?: AnalyticsTargetScope;
    extra?: Partial<ResolvedTarget>;
  }): ResolvedTarget => ({
    target_type: type,
    target_id: params.target_id,
    target_name_snapshot: params.name,
    target_code_snapshot: params.code,
    target_scope: params.scope,
    unit_id: params.unit_id ?? execution.unit_id,
    unit_name_snapshot: execution.unit_name,
    target_identity_key: buildTargetIdentityKey({
      workspace_id: execution.workspace_id,
      target_type: type,
      target_id: params.target_id,
      unit_id:
        params.scope === "workspace"
          ? undefined
          : params.unit_id ?? execution.unit_id,
    }),
    contains_personal_data: type === "collaborator",
    ...params.extra,
  });

  switch (config.target_source) {
    case "execution_unit":
      return base({
        target_id: execution.unit_id,
        name: execution.unit_name ?? execution.unit_id ?? "Unidade",
        scope: "unit",
      });
    case "assigned_collaborator": {
      const collaborator =
        execution.assigned_collaborator ??
        fail("execução sem colaborador atribuído.");
      return base({
        target_id: collaborator.id,
        name: collaborator.name,
        scope: "unit",
        extra: {
          collaborator_id: collaborator.id,
          collaborator_name_snapshot: collaborator.name,
          collaborator_role_snapshot: collaborator.role,
        },
      });
    }
    case "executor": {
      const executor = execution.executor ?? fail("execução sem executor.");
      return base({
        target_id: executor.id,
        name: executor.name,
        scope: "unit",
        extra: {
          collaborator_id: executor.id,
          collaborator_name_snapshot: executor.name,
          collaborator_role_snapshot: executor.role,
        },
      });
    }
    case "answered_item": {
      const sourceId = config.target_item_id ?? fail("target_item_id ausente.");
      const ref =
        execution.answers.get(sourceId)?.target_ref ??
        fail(`pergunta ${sourceId} não respondeu um alvo.`);

      return base({
        target_id: ref.id,
        name: ref.name,
        code: ref.code,
        unit_id: ref.unit_id,
        scope: config.target_scope,
        extra: {
          asset_id: ref.target_type === "asset" ? ref.id : undefined,
          target_brand: ref.metadata?.brand,
          target_model: ref.metadata?.model,
          target_category: ref.metadata?.category,
          target_asset_code: ref.metadata?.asset_code,
          collaborator_id:
            ref.target_type === "collaborator" ? ref.id : undefined,
          collaborator_name_snapshot:
            ref.target_type === "collaborator" ? ref.name : undefined,
          collaborator_role_snapshot: ref.metadata?.role,
          target_metadata_snapshot: ref.metadata,
          contains_personal_data: ref.target_type === "collaborator",
        },
      });
    }
    case "fixed": {
      const id = config.fixed_target_id ?? fail("fixed_target_id ausente.");
      const free = lookups.freeTargets.get(id);
      if (free) {
        return base({
          target_id: id,
          name: free.name,
          code: free.code,
          scope: free.target_scope,
          unit_id:
            free.target_scope === "workspace"
              ? undefined
              : free.unit_ids?.[0] ?? execution.unit_id,
        });
      }
      return base({
        target_id: id,
        name: config.fixed_target_name ?? id,
        scope: config.target_scope,
      });
    }
    case "selected_option":
    case "manual":
      return fail(`target_source "${config.target_source}" não suportado nesta fase.`);
    default:
      return fail("target_source ausente.");
  }
}

export function generateDraftsForExecution(
  execution: ExecutionView,
  items: readonly AnalyticsItemView[],
  lookups: GenerationLookups,
  context: GenerationContext
): OccurrenceDraft[] {
  const drafts: OccurrenceDraft[] = [];
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const item of items) {
    const config = item.analytics_config;
    if (!config?.enabled) continue;
    if (!isItemVisible(item, execution.answers)) continue;

    const answer = execution.answers.get(item.id);
    const target = resolveOccurrenceTarget(item, config, execution, lookups);
    const negative = evaluateOccurrenceCondition(
      config.occurrence_condition,
      answer
    );

    if (config.occurrence_mode === "per_selected_option") {
      drafts.push(
        ...generatePerOption(
          item,
          config,
          answer,
          target,
          execution,
          lookups,
          context
        )
      );
    } else if (negative) {
      drafts.push(
        makeDraft({
          item,
          config,
          answer,
          target,
          execution,
          lookups,
          context,
          result_id: requireResult(config.negative_result_id, item, "negative"),
          record_type: "occurrence",
          generated_by: "direct_item",
        })
      );
    } else if (config.evaluation_mode === "positive_and_negative") {
      drafts.push(
        makeDraft({
          item,
          config,
          answer,
          target,
          execution,
          lookups,
          context,
          result_id: requireResult(config.positive_result_id, item, "positive"),
          record_type: "evaluation",
          generated_by: "direct_item",
        })
      );
    }

    const cascade = config.cascade_evaluations;
    if (cascade?.enabled) {
      const fires =
        cascade.trigger.operator === "equals"
          ? Object.is(normalize(answer?.value), normalize(cascade.trigger.value))
          : !Object.is(normalize(answer?.value), normalize(cascade.trigger.value));

      if (fires) {
        const child =
          byId.get(cascade.expands_from_item_id) ??
          failGeneration(item.id, "item filho da cascata ausente.");

        for (const option of activeAnalyticOptions(child)) {
          drafts.push(
            makeDraft({
              item,
              config,
              answer,
              target,
              execution,
              lookups,
              context,
              result_id: cascade.result_id,
              record_type: "evaluation",
              generated_by: "cascade_from_parent",
              criterion_id: option.analytics!.criterion_id!,
              option,
              expanded_from_child_item_id: child.id,
            })
          );
        }
      }
    }
  }

  assertNoDuplicateDedupe(drafts);
  return drafts;
}

function generatePerOption(
  item: AnalyticsItemView,
  config: FormItemAnalyticsConfig,
  answer: ExecutionAnswer | undefined,
  target: ResolvedTarget,
  execution: ExecutionView,
  lookups: GenerationLookups,
  context: GenerationContext
) {
  const drafts: OccurrenceDraft[] = [];
  const selected = new Set(answer?.selected_option_ids ?? []);

  for (const option of activeAnalyticOptions(item)) {
    const isSelected = selected.has(option.id);
    if (isSelected) {
      drafts.push(
        makeDraft({
          item,
          config,
          answer,
          target,
          execution,
          lookups,
          context,
          result_id:
            option.analytics?.result_id ??
            requireResult(config.negative_result_id, item, "negative"),
          record_type: "occurrence",
          generated_by: "direct_item",
          criterion_id: option.analytics?.criterion_id ?? config.criterion_id,
          severity: option.analytics?.severity ?? config.severity,
          option,
        })
      );
    } else if (config.evaluation_mode === "all_options_when_visible") {
      drafts.push(
        makeDraft({
          item,
          config,
          answer,
          target,
          execution,
          lookups,
          context,
          result_id: requireResult(config.positive_result_id, item, "positive"),
          record_type: "evaluation",
          generated_by: "direct_item",
          criterion_id: option.analytics?.criterion_id ?? config.criterion_id,
          option,
        })
      );
    }
  }

  return drafts;
}

function makeDraft(params: {
  item: AnalyticsItemView;
  config: FormItemAnalyticsConfig;
  answer: ExecutionAnswer | undefined;
  target: ResolvedTarget;
  execution: ExecutionView;
  lookups: GenerationLookups;
  context: GenerationContext;
  result_id: string;
  record_type: "evaluation" | "occurrence";
  generated_by: AnalyticsGeneratedBy;
  criterion_id?: string;
  severity?: AnalyticsSeverity;
  option?: FormItemOption;
  expanded_from_child_item_id?: string;
}): OccurrenceDraft {
  const { item, config, execution, lookups, context } = params;
  const domainId = config.domain_id ?? failGeneration(item.id, "domain_id ausente.");
  const domain =
    lookups.domains.get(domainId) ??
    failGeneration(item.id, `domínio ${domainId} não encontrado.`);
  const result =
    lookups.results.get(params.result_id) ??
    failGeneration(item.id, `resultado ${params.result_id} não encontrado.`);
  const criterionId = params.criterion_id ?? config.criterion_id;
  const criterion = criterionId ? lookups.criteria.get(criterionId) : undefined;
  if (criterionId && !criterion) {
    failGeneration(item.id, `quesito ${criterionId} não encontrado.`);
  }

  const identityKey = buildOccurrenceIdentityKey({
    workspace_id: execution.workspace_id,
    execution_id: execution.id,
    template_item_id: item.id,
    record_type: params.record_type,
    domain_id: domainId,
    criterion_id: criterionId,
    target_type: params.target.target_type,
    target_identity_key: params.target.target_identity_key,
    option_id: params.option?.id,
  });
  const bucket = localDateParts(
    execution.completed_at,
    context.workspace_timezone
  );
  const resolvedDescription = resolveDescription({
    config,
    execution,
    option: params.option,
  });
  const evidence = (config.evidence_item_ids ?? []).flatMap((itemId) => {
    const answer = execution.answers.get(itemId);
    return [
      ...(answer?.photo_urls ?? []).map<AnalyticsEvidenceRef>((ref) => ({
        type: "photo",
        item_id: itemId,
        ref,
      })),
      ...(answer?.file_refs ?? []).map<AnalyticsEvidenceRef>((ref) => ({
        type: "file",
        item_id: itemId,
        ref,
      })),
      ...(answer?.signature_url
        ? [
            {
              type: "signature" as const,
              item_id: itemId,
              ref: answer.signature_url,
            },
          ]
        : []),
      ...(answer?.location_ref
        ? [
            {
              type: "location" as const,
              item_id: itemId,
              ref: answer.location_ref,
            },
          ]
        : []),
    ];
  });

  return {
    workspace_id: execution.workspace_id,
    form_project_id: execution.form_project_id,
    template_id: execution.template_id,
    template_version: execution.template_version,
    execution_id: execution.id,
    execution_completed_at: execution.completed_at,
    template_item_id: item.id,
    item_title_snapshot: item.title,
    answer_value: params.answer?.value,
    answer_label: params.answer?.label,
    option_id: params.option?.id,
    option_label_snapshot: params.option?.label,
    generated_by: params.generated_by,
    expanded_from_item_id:
      params.generated_by === "cascade_from_parent" ? item.id : undefined,
    expanded_from_child_item_id: params.expanded_from_child_item_id,
    record_type: params.record_type,
    domain_id: domainId,
    domain_name_snapshot: domain.name,
    criterion_id: criterionId,
    criterion_name_snapshot: criterion?.name,
    result_id: params.result_id,
    result_name_snapshot: result.name,
    result_polarity: result.polarity,
    counts_as_evaluation: result.counts_as_evaluation,
    counts_as_occurrence: result.counts_as_occurrence,
    counts_as_non_conformity: result.counts_as_non_conformity,
    denominator_scope: "absolute",
    severity: params.severity ?? config.severity ?? criterion?.default_severity,
    ...params.target,
    personal_data_subject_type: params.target.contains_personal_data
      ? "collaborator"
      : undefined,
    description: resolvedDescription.text,
    description_source_item_id: resolvedDescription.text
      ? config.description_item_id
      : undefined,
    description_extraction: resolvedDescription.text
      ? resolvedDescription.extraction
      : undefined,
    description_confidence: resolvedDescription.text
      ? resolvedDescription.confidence
      : undefined,
    evidence_refs: evidence.length > 0 ? evidence : undefined,
    occurred_at: execution.completed_at,
    bucket_timezone: context.workspace_timezone,
    ...bucket,
    record_status: "valid",
    is_current: true,
    resolution_status:
      params.record_type === "evaluation"
        ? "not_required"
        : result.counts_as_occurrence
          ? "open"
          : "not_required",
    resolution_behavior: config.resolution_behavior ?? "none",
    ...(params.record_type === "occurrence" &&
    result.counts_as_occurrence &&
    config.create_task === true
      ? {
          create_task: true,
          ...(config.task_trigger_id
            ? { task_trigger_id: config.task_trigger_id }
            : {}),
        }
      : {}),
    ...(params.record_type === "occurrence" &&
    result.counts_as_occurrence &&
    typeof config.sla_hours === "number"
      ? {
          due_at: new Date(
            execution.completed_at.getTime() + config.sla_hours * 3600000
          ),
        }
      : {}),
    has_active_task: false,
    occurrence_identity_key: identityKey,
    dedupe_key: buildDedupeKey(identityKey, context.analytics_revision),
    analytics_revision: context.analytics_revision,
    generation_batch_id: context.generation_batch_id,
    created_from: context.created_from,
  };
}

interface ResolvedDescription {
  text?: string;
  extraction?: "shared_text" | "parsed_by_prefix" | "per_option_detail";
  confidence?: "high" | "medium" | "low";
}

function resolveDescription(params: {
  config: FormItemAnalyticsConfig;
  execution: ExecutionView;
  option?: FormItemOption;
}): ResolvedDescription {
  const { config, execution, option } = params;
  if (!config.description_item_id) return {};

  const answer = execution.answers.get(config.description_item_id);
  const mode = config.description_mapping_mode ?? "shared_text";

  if (mode === "per_option_detail") {
    // Espera um mapa opção→detalhe (por option_id ou label) na resposta.
    const detail = pickPerOptionDetail(answer?.value, option);
    return detail
      ? { text: detail, extraction: "per_option_detail", confidence: "high" }
      : {};
  }

  if (mode === "prefix_parser" && option) {
    // Texto com linhas "Label: detalhe"; extrai a linha da opção.
    const parsed = parseByPrefix(asText(answer?.value), option.label);
    return parsed
      ? { text: parsed, extraction: "parsed_by_prefix", confidence: "medium" }
      : {};
  }

  const shared = asText(answer?.value);
  return shared
    ? { text: shared, extraction: "shared_text", confidence: "high" }
    : {};
}

function pickPerOptionDetail(value: unknown, option?: FormItemOption) {
  if (!option || value === null || typeof value !== "object") return undefined;
  const map = value as Record<string, unknown>;
  return asText(map[option.id]) ?? asText(map[option.label]);
}

function parseByPrefix(text: string | undefined, label: string) {
  if (!text) return undefined;
  const target = label.trim().toLowerCase();
  for (const line of text.split(/\r?\n/)) {
    const separatorIndex = line.search(/[:\-–]/);
    if (separatorIndex < 0) continue;
    const prefix = line.slice(0, separatorIndex).trim().toLowerCase();
    if (prefix === target) {
      const detail = line.slice(separatorIndex + 1).trim();
      if (detail) return detail;
    }
  }
  return undefined;
}

function activeAnalyticOptions(item: AnalyticsItemView): FormItemOption[] {
  return (item.options ?? []).filter(
    (option) => option.is_active !== false && option.analytics?.criterion_id
  );
}

function requireResult(
  id: string | undefined,
  item: AnalyticsItemView,
  kind: "positive" | "negative"
) {
  return id ?? failGeneration(item.id, `${kind}_result_id ausente.`);
}

function asText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function failGeneration(itemId: string, message: string): never {
  throw new GenerationError(`[${itemId}] ${message}`, itemId);
}

function assertNoDuplicateDedupe(drafts: readonly OccurrenceDraft[]) {
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.dedupe_key)) {
      throw new GenerationError(
        `dedupe_key duplicado na mesma rodada: ${draft.dedupe_key}.`,
        draft.template_item_id
      );
    }
    seen.add(draft.dedupe_key);
  }
}
