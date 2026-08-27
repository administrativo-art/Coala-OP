"use client";

import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import {
  fetchAnalyticsTaxonomy,
  type AnalyticsTaxonomyEntry,
} from "@/features/forms/lib/client";
import type {
  FormItemAnalyticsConfig,
  FormItemOption,
} from "@/features/forms/analytics/analytics-config-schema";

// ─── Estado de edição (strings, formulário controlado) ─────────────────────────

export type EditorOptionAnalytics = {
  criterion_id: string;
  result_id: string;
  severity: string;
};

export type EditorAnalyticsConfig = {
  enabled: boolean;
  domain_id: string;
  criterion_id: string;
  target_type: string;
  target_source: string;
  fixed_target_id: string;
  target_item_id: string;
  target_scope: string;
  occurrence_mode: string;
  condition_operator: string;
  condition_value: string;
  evaluation_mode: string;
  positive_result_id: string;
  negative_result_id: string;
  severity: string;
  description_item_id: string;
  evidence_item_ids: string[];
  create_task: boolean;
  task_trigger_id: string;
  sla_hours: string;
  description_mapping_mode: string;
  resolution_behavior: string;
  cascade_enabled: boolean;
  cascade_trigger_value: string;
  cascade_child_item_id: string;
  cascade_result_id: string;
};

export function emptyEditorAnalyticsConfig(): EditorAnalyticsConfig {
  return {
    enabled: false,
    domain_id: "",
    criterion_id: "",
    target_type: "unit",
    target_source: "execution_unit",
    fixed_target_id: "",
    target_item_id: "",
    target_scope: "",
    occurrence_mode: "single",
    condition_operator: "equals",
    condition_value: "false",
    evaluation_mode: "positive_and_negative",
    positive_result_id: "",
    negative_result_id: "",
    severity: "",
    description_item_id: "",
    evidence_item_ids: [],
    create_task: false,
    task_trigger_id: "",
    sla_hours: "",
    description_mapping_mode: "shared_text",
    resolution_behavior: "none",
    cascade_enabled: false,
    cascade_trigger_value: "true",
    cascade_child_item_id: "",
    cascade_result_id: "",
  };
}

export function analyticsConfigToEditor(
  config: FormItemAnalyticsConfig | undefined
): EditorAnalyticsConfig {
  if (!config) return emptyEditorAnalyticsConfig();
  return {
    enabled: config.enabled,
    domain_id: config.domain_id ?? "",
    criterion_id: config.criterion_id ?? "",
    target_type: config.target_type ?? "unit",
    target_source: config.target_source ?? "execution_unit",
    fixed_target_id: config.fixed_target_id ?? "",
    target_item_id: config.target_item_id ?? "",
    target_scope: config.target_scope ?? "",
    occurrence_mode: config.occurrence_mode ?? "single",
    condition_operator: config.occurrence_condition?.operator ?? "equals",
    condition_value:
      config.occurrence_condition?.value === undefined
        ? ""
        : String(config.occurrence_condition.value),
    evaluation_mode: config.evaluation_mode ?? "negative_only",
    positive_result_id: config.positive_result_id ?? "",
    negative_result_id: config.negative_result_id ?? "",
    severity: config.severity ?? "",
    description_item_id: config.description_item_id ?? "",
    evidence_item_ids: config.evidence_item_ids ?? [],
    create_task: config.create_task === true,
    task_trigger_id: config.task_trigger_id ?? "",
    sla_hours:
      typeof config.sla_hours === "number" ? String(config.sla_hours) : "",
    description_mapping_mode: config.description_mapping_mode ?? "shared_text",
    resolution_behavior: config.resolution_behavior ?? "none",
    cascade_enabled: config.cascade_evaluations?.enabled === true,
    cascade_trigger_value:
      config.cascade_evaluations?.trigger.value === undefined
        ? "true"
        : String(config.cascade_evaluations.trigger.value),
    cascade_child_item_id: config.cascade_evaluations?.expands_from_item_id ?? "",
    cascade_result_id: config.cascade_evaluations?.result_id ?? "",
  };
}

function parseConditionValue(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

export function editorAnalyticsToPayload(
  cfg: EditorAnalyticsConfig | null | undefined
): FormItemAnalyticsConfig | undefined {
  if (!cfg?.enabled) return undefined;

  const payload: Record<string, unknown> = {
    enabled: true,
    ...(cfg.domain_id ? { domain_id: cfg.domain_id } : {}),
    ...(cfg.criterion_id ? { criterion_id: cfg.criterion_id } : {}),
    ...(cfg.target_type ? { target_type: cfg.target_type } : {}),
    ...(cfg.target_source ? { target_source: cfg.target_source } : {}),
    ...(cfg.target_source === "fixed" && cfg.fixed_target_id
      ? { fixed_target_id: cfg.fixed_target_id }
      : {}),
    ...(cfg.target_source === "answered_item" && cfg.target_item_id
      ? { target_item_id: cfg.target_item_id }
      : {}),
    ...(cfg.target_scope ? { target_scope: cfg.target_scope } : {}),
    occurrence_mode: cfg.occurrence_mode || "single",
    occurrence_condition: {
      operator: cfg.condition_operator || "always",
      ...(cfg.condition_operator !== "always" &&
      cfg.condition_operator !== "out_of_range" &&
      cfg.condition_operator !== "is_empty" &&
      cfg.condition_operator !== "is_not_empty" &&
      cfg.condition_value.trim() !== ""
        ? { value: parseConditionValue(cfg.condition_value) }
        : {}),
    },
    evaluation_mode: cfg.evaluation_mode || "negative_only",
    ...(cfg.positive_result_id
      ? { positive_result_id: cfg.positive_result_id }
      : {}),
    ...(cfg.negative_result_id
      ? { negative_result_id: cfg.negative_result_id }
      : {}),
    ...(cfg.severity ? { severity: cfg.severity } : {}),
    ...(cfg.description_item_id
      ? {
          description_item_id: cfg.description_item_id,
          description_mapping_mode: cfg.description_mapping_mode || "shared_text",
        }
      : {}),
    ...(cfg.evidence_item_ids.length > 0
      ? { evidence_item_ids: cfg.evidence_item_ids }
      : {}),
    ...(cfg.create_task ? { create_task: true } : {}),
    ...(cfg.create_task && cfg.task_trigger_id
      ? { task_trigger_id: cfg.task_trigger_id }
      : {}),
    ...(cfg.sla_hours.trim() !== "" && Number(cfg.sla_hours) > 0
      ? { sla_hours: Math.round(Number(cfg.sla_hours)) }
      : {}),
    resolution_behavior: cfg.resolution_behavior || "none",
    ...(cfg.cascade_enabled && cfg.cascade_child_item_id && cfg.cascade_result_id
      ? {
          cascade_evaluations: {
            enabled: true,
            trigger: {
              operator: "equals",
              value: parseConditionValue(cfg.cascade_trigger_value),
            },
            expands_from_item_id: cfg.cascade_child_item_id,
            expansion_source: "child_item_options",
            expansion_mode: "generate_positive_evaluations_for_all_options",
            result_id: cfg.cascade_result_id,
            denominator_scope: "absolute",
            require_mutual_exclusion_with_child_visibility: true,
          },
        }
      : {}),
  };

  return payload as FormItemAnalyticsConfig;
}

// ─── Reconciliação de opções (preserva id por label) ───────────────────────────

function slugifyOptionLabel(label: string) {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function buildStructuredOptionsPayload(params: {
  labels: string[];
  structuredOptions: FormItemOption[];
  optionAnalytics: Record<string, EditorOptionAnalytics>;
}): FormItemOption[] {
  const byLabel = new Map(
    params.structuredOptions.map((option) => [option.label, option])
  );
  const usedIds = new Set<string>();

  return params.labels.map((label, index) => {
    const existing = byLabel.get(label);
    const analytics = params.optionAnalytics[label];
    const analyticsPayload =
      analytics &&
      (analytics.criterion_id || analytics.result_id || analytics.severity)
        ? {
            ...(analytics.criterion_id
              ? { criterion_id: analytics.criterion_id }
              : {}),
            ...(analytics.result_id ? { result_id: analytics.result_id } : {}),
            ...(analytics.severity
              ? { severity: analytics.severity as "low" | "medium" | "high" | "critical" }
              : {}),
          }
        : undefined;

    let id = existing?.id;
    if (!id) {
      const base = `opt_${slugifyOptionLabel(label) || `option_${index}`}`;
      id = base;
      let suffix = 2;
      while (usedIds.has(id)) id = `${base}_${suffix++}`;
    }
    usedIds.add(id);

    return {
      id,
      label,
      order: index,
      ...(analyticsPayload ? { analytics: analyticsPayload } : {}),
    };
  });
}

// ─── Taxonomia compartilhada (cache de módulo) ─────────────────────────────────

type TaxonomyBundle = {
  domains: AnalyticsTaxonomyEntry[];
  criteria: AnalyticsTaxonomyEntry[];
  results: AnalyticsTaxonomyEntry[];
  targets: AnalyticsTaxonomyEntry[];
};

let taxonomyCache: TaxonomyBundle | null = null;
let taxonomyPromise: Promise<TaxonomyBundle> | null = null;

function loadTaxonomyOnce(firebaseUser: {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}) {
  if (taxonomyCache) return Promise.resolve(taxonomyCache);
  if (!taxonomyPromise) {
    taxonomyPromise = Promise.all([
      fetchAnalyticsTaxonomy(firebaseUser, "domains"),
      fetchAnalyticsTaxonomy(firebaseUser, "criteria"),
      fetchAnalyticsTaxonomy(firebaseUser, "results"),
      fetchAnalyticsTaxonomy(firebaseUser, "targets"),
    ])
      .then(([domains, criteria, results, targets]) => {
        taxonomyCache = { domains, criteria, results, targets };
        return taxonomyCache;
      })
      .catch((error) => {
        taxonomyPromise = null;
        throw error;
      });
  }
  return taxonomyPromise;
}

export function invalidateAnalyticsTaxonomyCache() {
  taxonomyCache = null;
  taxonomyPromise = null;
}

// ─── Painel ────────────────────────────────────────────────────────────────────

const selectClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm";

export function AnalyticsConfigPanel({
  itemType,
  value,
  optionLabels,
  optionAnalytics,
  taskTriggerOptions,
  siblingItems,
  onChange,
  onOptionAnalyticsChange,
}: {
  itemType: string;
  value: EditorAnalyticsConfig;
  optionLabels: string[];
  optionAnalytics: Record<string, EditorOptionAnalytics>;
  taskTriggerOptions: Array<{ id: string; label: string }>;
  siblingItems: Array<{ id: string; title: string; type: string }>;
  onChange: (next: EditorAnalyticsConfig) => void;
  onOptionAnalyticsChange: (
    next: Record<string, EditorOptionAnalytics>
  ) => void;
}) {
  const { firebaseUser } = useAuth();
  const [taxonomy, setTaxonomy] = useState<TaxonomyBundle | null>(taxonomyCache);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseUser || !value.enabled || taxonomy) return;
    loadTaxonomyOnce(firebaseUser)
      .then(setTaxonomy)
      .catch((error) =>
        setTaxonomyError(
          error instanceof Error ? error.message : "Falha ao carregar taxonomia."
        )
      );
  }, [firebaseUser, value.enabled, taxonomy]);

  const patch = (partial: Partial<EditorAnalyticsConfig>) =>
    onChange({ ...value, ...partial });

  const activeCriteria = (taxonomy?.criteria ?? []).filter(
    (criterion) =>
      criterion.is_active &&
      (!value.domain_id || criterion.domain_id === value.domain_id)
  );
  const activeResults = (taxonomy?.results ?? []).filter(
    (result) => result.is_active
  );
  const positiveResults = activeResults.filter(
    (result) => result.polarity === "positive"
  );
  const negativeResults = activeResults.filter(
    (result) => result.polarity !== "positive"
  );
  const textItems = siblingItems.filter((sibling) => sibling.type === "text");
  const evidenceItems = siblingItems.filter((sibling) =>
    ["photo", "file_upload", "location", "signature"].includes(sibling.type)
  );
  const childCandidates = siblingItems.filter((sibling) =>
    ["select", "multi_select"].includes(sibling.type)
  );
  const isOptionType = itemType === "select" || itemType === "multi_select";
  const isRangeType = itemType === "number" || itemType === "temperature";
  const isBooleanType = itemType === "yes_no" || itemType === "checkbox";

  if (itemType === "text") {
    return (
      <div className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Texto livre serve como descrição de ocorrências de outras perguntas —
        não é métrica principal. Configure analytics na pergunta estruturada e
        aponte a descrição para cá.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-violet-900">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        <BarChart3 className="h-4 w-4" />
        Analytics e ocorrências
      </label>
      {!value.enabled ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Gere métricas estruturadas (avaliações e ocorrências) a partir desta
          pergunta.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {taxonomyError ? (
            <p className="text-xs text-destructive">{taxonomyError}</p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium">Domínio *</p>
              <select
                className={selectClass}
                value={value.domain_id}
                onChange={(event) =>
                  patch({ domain_id: event.target.value, criterion_id: "" })
                }
              >
                <option value="">Selecione</option>
                {(taxonomy?.domains ?? [])
                  .filter((domain) => domain.is_active)
                  .map((domain) => (
                    <option key={domain.id} value={domain.id}>
                      {domain.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium">Quesito</p>
              <select
                className={selectClass}
                value={value.criterion_id}
                onChange={(event) => patch({ criterion_id: event.target.value })}
              >
                <option value="">Sem quesito específico</option>
                {activeCriteria.map((criterion) => (
                  <option key={criterion.id} value={criterion.id}>
                    {criterion.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-medium">Tipo de alvo</p>
              <select
                className={selectClass}
                value={value.target_type}
                onChange={(event) => patch({ target_type: event.target.value })}
              >
                <option value="unit">Unidade</option>
                <option value="collaborator">Colaborador</option>
                <option value="asset">Patrimônio</option>
                <option value="location">Local</option>
                <option value="product">Produto</option>
                <option value="process">Processo</option>
                <option value="free_target">Item livre</option>
              </select>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium">Origem do alvo</p>
              <select
                className={selectClass}
                value={value.target_source}
                onChange={(event) => patch({ target_source: event.target.value })}
              >
                <option value="execution_unit">Unidade da execução</option>
                <option value="assigned_collaborator">Colaborador atribuído</option>
                <option value="executor">Executor</option>
                <option value="fixed">Alvo fixo (cadastro)</option>
                <option value="answered_item">Resposta de outra pergunta</option>
              </select>
            </div>
            {value.target_source === "fixed" ? (
              <div>
                <p className="mb-1 text-xs font-medium">Alvo fixo</p>
                <select
                  className={selectClass}
                  value={value.fixed_target_id}
                  onChange={(event) => patch({ fixed_target_id: event.target.value })}
                >
                  <option value="">Selecione</option>
                  {(taxonomy?.targets ?? [])
                    .filter((target) => target.is_active)
                    .map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.name}
                      </option>
                    ))}
                </select>
              </div>
            ) : null}
            {value.target_source === "answered_item" ? (
              <div>
                <p className="mb-1 text-xs font-medium">Pergunta do alvo</p>
                <select
                  className={selectClass}
                  value={value.target_item_id}
                  onChange={(event) => patch({ target_item_id: event.target.value })}
                >
                  <option value="">Selecione</option>
                  {siblingItems.map((sibling) => (
                    <option key={sibling.id} value={sibling.id}>
                      {sibling.title}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-medium">Gera ocorrência quando</p>
              {isBooleanType ? (
                <select
                  className={selectClass}
                  value={value.condition_value}
                  onChange={(event) =>
                    patch({
                      condition_operator: "equals",
                      condition_value: event.target.value,
                    })
                  }
                >
                  <option value="false">Resposta = Não</option>
                  <option value="true">Resposta = Sim</option>
                </select>
              ) : isRangeType ? (
                <select
                  className={selectClass}
                  value={value.condition_operator}
                  onChange={(event) =>
                    patch({ condition_operator: event.target.value })
                  }
                >
                  <option value="out_of_range">Fora da faixa de referência</option>
                  <option value="always">Sempre</option>
                </select>
              ) : isOptionType ? (
                <select
                  className={selectClass}
                  value={value.occurrence_mode}
                  onChange={(event) =>
                    patch({
                      occurrence_mode: event.target.value,
                      condition_operator: "always",
                    })
                  }
                >
                  <option value="per_selected_option">
                    Por opção selecionada
                  </option>
                  <option value="single">Registro único</option>
                </select>
              ) : (
                <select
                  className={selectClass}
                  value={value.condition_operator}
                  onChange={(event) =>
                    patch({ condition_operator: event.target.value })
                  }
                >
                  <option value="always">Sempre</option>
                  <option value="is_not_empty">Respondida</option>
                  <option value="is_empty">Vazia</option>
                </select>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium">Resultado conforme *</p>
              <select
                className={selectClass}
                value={value.positive_result_id}
                onChange={(event) =>
                  patch({ positive_result_id: event.target.value })
                }
              >
                <option value="">Selecione</option>
                {positiveResults.map((result) => (
                  <option key={result.id} value={result.id}>
                    {result.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium">Resultado não conforme *</p>
              <select
                className={selectClass}
                value={value.negative_result_id}
                onChange={(event) =>
                  patch({ negative_result_id: event.target.value })
                }
              >
                <option value="">Selecione</option>
                {negativeResults.map((result) => (
                  <option key={result.id} value={result.id}>
                    {result.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {isOptionType ? (
              <div>
                <p className="mb-1 text-xs font-medium">Modo de avaliação</p>
                <select
                  className={selectClass}
                  value={value.evaluation_mode}
                  onChange={(event) =>
                    patch({ evaluation_mode: event.target.value })
                  }
                >
                  <option value="all_options_when_visible">
                    Não selecionadas geram conformes (denominador)
                  </option>
                  <option value="negative_only">Só selecionadas (negativas)</option>
                </select>
              </div>
            ) : (
              <div>
                <p className="mb-1 text-xs font-medium">Modo de avaliação</p>
                <select
                  className={selectClass}
                  value={value.evaluation_mode}
                  onChange={(event) =>
                    patch({ evaluation_mode: event.target.value })
                  }
                >
                  <option value="positive_and_negative">
                    Gera conforme e não conforme
                  </option>
                  <option value="negative_only">Só não conformidade</option>
                </select>
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-medium">Gravidade padrão</p>
              <select
                className={selectClass}
                value={value.severity}
                onChange={(event) => patch({ severity: event.target.value })}
              >
                <option value="">Sem gravidade</option>
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="critical">Crítica</option>
              </select>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium">Comportamento de resolução</p>
              <select
                className={selectClass}
                value={value.resolution_behavior}
                onChange={(event) =>
                  patch({ resolution_behavior: event.target.value })
                }
              >
                <option value="none">Sem tratativa automática</option>
                <option value="auto_resolve_on_task_completion">
                  Resolve ao concluir tarefa
                </option>
                <option value="require_validation_after_task_completion">
                  Exige validação após tarefa
                </option>
                <option value="manual_resolution_only">Somente manual</option>
              </select>
            </div>
          </div>

          {isOptionType && optionLabels.length > 0 ? (
            <div className="rounded-md border bg-background p-2">
              <p className="mb-2 text-xs font-medium">
                Opções · quesito e resultado por opção
              </p>
              <div className="space-y-1">
                {optionLabels.map((label) => {
                  const current = optionAnalytics[label] ?? {
                    criterion_id: "",
                    result_id: "",
                    severity: "",
                  };
                  const update = (partial: Partial<EditorOptionAnalytics>) =>
                    onOptionAnalyticsChange({
                      ...optionAnalytics,
                      [label]: { ...current, ...partial },
                    });
                  return (
                    <div
                      key={label}
                      className="grid items-center gap-2 md:grid-cols-[1fr_1fr_1fr_110px]"
                    >
                      <span className="truncate text-xs">{label}</span>
                      <select
                        className={selectClass}
                        value={current.criterion_id}
                        onChange={(event) =>
                          update({ criterion_id: event.target.value })
                        }
                      >
                        <option value="">Quesito (herda geral)</option>
                        {activeCriteria.map((criterion) => (
                          <option key={criterion.id} value={criterion.id}>
                            {criterion.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className={selectClass}
                        value={current.result_id}
                        onChange={(event) =>
                          update({ result_id: event.target.value })
                        }
                      >
                        <option value="">Resultado (herda geral)</option>
                        {activeResults.map((result) => (
                          <option key={result.id} value={result.id}>
                            {result.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className={selectClass}
                        value={current.severity}
                        onChange={(event) => update({ severity: event.target.value })}
                      >
                        <option value="">Gravidade</option>
                        <option value="low">Baixa</option>
                        <option value="medium">Média</option>
                        <option value="high">Alta</option>
                        <option value="critical">Crítica</option>
                      </select>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Opções sem quesito não entram na cascata nem geram registro por
                opção.
              </p>
            </div>
          ) : null}

          {isBooleanType ? (
            <div className="rounded-md border bg-background p-2">
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={value.cascade_enabled}
                  onChange={(event) =>
                    patch({ cascade_enabled: event.target.checked })
                  }
                />
                Cascata de avaliações conformes (denominador absoluto)
              </label>
              {value.cascade_enabled ? (
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <select
                    className={selectClass}
                    value={value.cascade_trigger_value}
                    onChange={(event) =>
                      patch({ cascade_trigger_value: event.target.value })
                    }
                  >
                    <option value="true">Quando resposta = Sim</option>
                    <option value="false">Quando resposta = Não</option>
                  </select>
                  <select
                    className={selectClass}
                    value={value.cascade_child_item_id}
                    onChange={(event) =>
                      patch({ cascade_child_item_id: event.target.value })
                    }
                  >
                    <option value="">Item filho (multi seleção)</option>
                    {childCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title}
                      </option>
                    ))}
                  </select>
                  <select
                    className={selectClass}
                    value={value.cascade_result_id}
                    onChange={(event) =>
                      patch({ cascade_result_id: event.target.value })
                    }
                  >
                    <option value="">Resultado conforme</option>
                    {positiveResults.map((result) => (
                      <option key={result.id} value={result.id}>
                        {result.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {value.cascade_enabled ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  O item filho deve ter exibição condicional mutuamente exclusiva
                  com o gatilho da cascata; a publicação valida isso.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-medium">Descrição (pergunta texto)</p>
              <select
                className={selectClass}
                value={value.description_item_id}
                onChange={(event) =>
                  patch({ description_item_id: event.target.value })
                }
              >
                <option value="">Sem descrição</option>
                {textItems.map((sibling) => (
                  <option key={sibling.id} value={sibling.id}>
                    {sibling.title}
                  </option>
                ))}
              </select>
              {value.description_item_id ? (
                <select
                  className={`${selectClass} mt-1`}
                  value={value.description_mapping_mode}
                  onChange={(event) =>
                    patch({ description_mapping_mode: event.target.value })
                  }
                >
                  <option value="shared_text">Texto compartilhado</option>
                  {isOptionType ? (
                    <>
                      <option value="prefix_parser">
                        Por prefixo (&quot;Opção: detalhe&quot;)
                      </option>
                      <option value="per_option_detail">Detalhe por opção</option>
                    </>
                  ) : null}
                </select>
              ) : null}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium">Evidências</p>
              <div className="max-h-24 space-y-1 overflow-auto rounded-md border bg-background p-2">
                {evidenceItems.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Sem perguntas de foto/arquivo neste formulário.
                  </p>
                ) : (
                  evidenceItems.map((sibling) => (
                    <label
                      key={sibling.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={value.evidence_item_ids.includes(sibling.id)}
                        onChange={(event) =>
                          patch({
                            evidence_item_ids: event.target.checked
                              ? [...value.evidence_item_ids, sibling.id]
                              : value.evidence_item_ids.filter(
                                  (id) => id !== sibling.id
                                ),
                          })
                        }
                      />
                      {sibling.title}
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={value.create_task}
                  onChange={(event) => patch({ create_task: event.target.checked })}
                />
                Gerar tarefa para a ocorrência
              </label>
              {value.create_task ? (
                <select
                  className={selectClass}
                  value={value.task_trigger_id}
                  onChange={(event) => patch({ task_trigger_id: event.target.value })}
                >
                  <option value="">Regra padrão / primeiro gatilho</option>
                  {taskTriggerOptions.map((trigger) => (
                    <option key={trigger.id} value={trigger.id}>
                      {trigger.label}
                    </option>
                  ))}
                </select>
              ) : null}
              <div>
                <p className="mb-1 text-xs font-medium">Prazo (SLA em horas)</p>
                <input
                  className={selectClass}
                  type="number"
                  min={1}
                  value={value.sla_hours}
                  onChange={(event) => patch({ sla_hours: event.target.value })}
                  placeholder="Sem prazo"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
