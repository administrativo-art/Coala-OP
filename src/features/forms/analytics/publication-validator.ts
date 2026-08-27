import type {
  AnalyticsItemView,
  CascadeEvaluationsConfig,
  ShowIfCondition,
} from "./analytics-config-schema";
import type { AnalyticsResultPolarity } from "./types";

export interface TaxonomyLookups {
  domains: ReadonlyMap<string, { is_active: boolean }>;
  criteria: ReadonlyMap<string, { domain_id: string; is_active: boolean }>;
  results: ReadonlyMap<
    string,
    {
      polarity: AnalyticsResultPolarity;
      counts_as_non_conformity: boolean;
      is_active: boolean;
    }
  >;
}

export interface ValidationIssue {
  level: "error" | "warning";
  item_id: string;
  field?: string;
  code: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
}

export function validateTemplateAnalytics(
  items: readonly AnalyticsItemView[],
  taxonomy: TaxonomyLookups
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const item of items) {
    const cfg = item.analytics_config;
    if (!cfg?.enabled) continue;

    const err = (code: string, message: string, field?: string) => {
      issues.push({ level: "error", item_id: item.id, code, message, field });
    };
    const warn = (code: string, message: string, field?: string) => {
      issues.push({ level: "warning", item_id: item.id, code, message, field });
    };

    if (!cfg.domain_id) {
      err("domain_required", "Analytics ativo exige domínio.", "domain_id");
    } else if (!taxonomy.domains.get(cfg.domain_id)?.is_active) {
      err("domain_invalid", "Domínio inexistente ou inativo.", "domain_id");
    }

    if (cfg.criterion_id) {
      const criterion = taxonomy.criteria.get(cfg.criterion_id);
      if (!criterion?.is_active) {
        err(
          "criterion_invalid",
          "Quesito inexistente ou inativo.",
          "criterion_id"
        );
      } else if (cfg.domain_id && criterion.domain_id !== cfg.domain_id) {
        err(
          "criterion_wrong_domain",
          "Quesito pertence a outro domínio.",
          "criterion_id"
        );
      }
    }

    if (!cfg.negative_result_id) {
      err(
        "negative_result_required",
        "Configuração pode gerar não conformidade: resultado negativo é obrigatório.",
        "negative_result_id"
      );
    }

    const generatesPositive =
      cfg.evaluation_mode === "positive_and_negative" ||
      cfg.evaluation_mode === "all_options_when_visible" ||
      cfg.cascade_evaluations?.enabled === true;
    if (
      generatesPositive &&
      !cfg.positive_result_id &&
      !cfg.cascade_evaluations?.enabled
    ) {
      err(
        "positive_result_required",
        "Modo de avaliação gera registro positivo: resultado positivo é obrigatório.",
        "positive_result_id"
      );
    }

    for (const [field, expected] of [
      ["negative_result_id", "negative_or_corrective"],
      ["positive_result_id", "positive"],
    ] as const) {
      const id = cfg[field];
      if (!id) continue;
      const result = taxonomy.results.get(id);
      if (!result?.is_active) {
        err("result_invalid", "Resultado inexistente ou inativo.", field);
        continue;
      }
      if (expected === "positive" && result.polarity !== "positive") {
        err(
          "result_polarity_mismatch",
          "Resultado positivo deve ter polaridade positive.",
          field
        );
      }
      if (
        expected === "negative_or_corrective" &&
        result.polarity !== "negative" &&
        result.polarity !== "corrective"
      ) {
        err(
          "result_polarity_mismatch",
          "Resultado negativo deve ter polaridade negative ou corrective.",
          field
        );
      }
    }

    if (!cfg.target_type) {
      err("target_type_required", "Tipo de alvo é obrigatório.", "target_type");
    }
    if (!cfg.target_source) {
      err(
        "target_source_required",
        "Origem do alvo é obrigatória.",
        "target_source"
      );
    }
    if (cfg.target_source === "fixed" && !cfg.fixed_target_id) {
      err(
        "fixed_target_required",
        'Origem "fixed" exige fixed_target_id.',
        "fixed_target_id"
      );
    }
    if (cfg.target_source === "answered_item") {
      if (!cfg.target_item_id) {
        err(
          "target_item_required",
          'Origem "answered_item" exige target_item_id.',
          "target_item_id"
        );
      } else if (!byId.has(cfg.target_item_id)) {
        err(
          "target_item_missing",
          "target_item_id não aponta para item do template.",
          "target_item_id"
        );
      }
    }
    if (
      (cfg.target_type === "location" || cfg.target_type === "free_target") &&
      cfg.target_source === "fixed" &&
      !cfg.target_scope
    ) {
      err(
        "target_scope_required",
        "Alvo local exige escopo.",
        "target_scope"
      );
    }

    if (cfg.occurrence_mode === "per_selected_option") {
      if (item.type !== "select" && item.type !== "multi_select") {
        err(
          "per_option_wrong_type",
          "per_selected_option só vale para select/multi_select.",
          "occurrence_mode"
        );
      }

      const options = item.options ?? [];
      if (options.length === 0) {
        err("options_required", "Pergunta sem opções estruturadas.", "options");
      }

      const optionIds = options.map((option) => option.id);
      if (new Set(optionIds).size !== optionIds.length) {
        err("option_id_duplicate", "IDs de opção duplicados no item.", "options");
      }

      for (const option of options) {
        const criterionId = option.analytics?.criterion_id ?? cfg.criterion_id;
        if (!criterionId) {
          err(
            "option_criterion_required",
            `Opção "${option.label}" sem quesito próprio e sem quesito herdado do item.`,
            "options"
          );
          continue;
        }

        const criterion = taxonomy.criteria.get(criterionId);
        if (!criterion?.is_active) {
          err(
            "option_criterion_invalid",
            `Opção "${option.label}" aponta quesito inexistente/inativo.`,
            "options"
          );
        } else if (cfg.domain_id && criterion.domain_id !== cfg.domain_id) {
          err(
            "option_criterion_wrong_domain",
            `Opção "${option.label}": quesito de outro domínio.`,
            "options"
          );
        }
      }
    }

    if (cfg.requires_description && !cfg.description_item_id) {
      err(
        "description_item_required",
        "requires_description exige description_item_id.",
        "description_item_id"
      );
    }
    if (cfg.description_item_id && !byId.has(cfg.description_item_id)) {
      err(
        "description_item_missing",
        "description_item_id não existe no template.",
        "description_item_id"
      );
    }
    for (const evidenceItemId of cfg.evidence_item_ids ?? []) {
      if (!byId.has(evidenceItemId)) {
        err(
          "evidence_item_missing",
          `evidence_item_id "${evidenceItemId}" não existe no template.`,
          "evidence_item_ids"
        );
      }
    }

    if (cfg.create_task && !cfg.task_trigger_id) {
      warn(
        "task_trigger_missing",
        "create_task sem task_trigger_id: será usada a regra padrão de tarefa.",
        "task_trigger_id"
      );
    }
    if (
      (cfg.resolution_behavior === "auto_resolve_on_task_completion" ||
        cfg.resolution_behavior ===
          "require_validation_after_task_completion") &&
      !cfg.create_task &&
      !cfg.task_trigger_id
    ) {
      err(
        "resolution_needs_task",
        "Comportamento de resolução por tarefa exige criação ou vínculo de tarefa.",
        "resolution_behavior"
      );
    }

    if (cfg.cascade_evaluations?.enabled) {
      validateCascade(item, cfg.cascade_evaluations, byId, taxonomy, issues);
    }

    if (item.type === "text") {
      warn(
        "text_as_metric",
        "Texto livre é melhor como descrição de ocorrência, não como métrica principal.",
        "enabled"
      );
    }
  }

  return { ok: !issues.some((issue) => issue.level === "error"), issues };
}

function validateCascade(
  parent: AnalyticsItemView,
  cascade: CascadeEvaluationsConfig,
  byId: ReadonlyMap<string, AnalyticsItemView>,
  taxonomy: TaxonomyLookups,
  issues: ValidationIssue[]
) {
  const err = (code: string, message: string) => {
    issues.push({
      level: "error",
      item_id: parent.id,
      field: "cascade_evaluations",
      code,
      message,
    });
  };

  const child = byId.get(cascade.expands_from_item_id);
  if (!child) {
    err("cascade_child_missing", "expands_from_item_id não existe no template.");
    return;
  }

  if (child.type !== "select" && child.type !== "multi_select") {
    err(
      "cascade_child_wrong_type",
      "Item filho da cascata deve ser select ou multi_select."
    );
  }

  const activeOptions = (child.options ?? []).filter(
    (option) => option.is_active !== false
  );
  if (activeOptions.length === 0) {
    err("cascade_child_no_options", "Item filho sem opções estruturadas ativas.");
  }

  const optionsWithCriterion = activeOptions.filter(
    (option) => option.analytics?.criterion_id
  );
  if (optionsWithCriterion.length === 0 && activeOptions.length > 0) {
    err(
      "cascade_child_no_criteria",
      "Nenhuma opção do item filho tem analytics.criterion_id."
    );
  }

  for (const option of optionsWithCriterion) {
    const criterion = taxonomy.criteria.get(option.analytics!.criterion_id!);
    if (!criterion?.is_active) {
      err(
        "cascade_option_criterion_invalid",
        `Opção "${option.label}" do filho aponta quesito inexistente/inativo.`
      );
    }
  }

  const result = taxonomy.results.get(cascade.result_id);
  if (!result?.is_active) {
    err("cascade_result_invalid", "result_id da cascata inexistente ou inativo.");
  } else if (result.polarity !== "positive") {
    err(
      "cascade_result_not_positive",
      "Resultado da cascata deve ter polaridade positive."
    );
  }

  if (!child.show_if) {
    err(
      "cascade_child_always_visible",
      "Item filho sempre visível: cascata e filho podem disparar juntos."
    );
  } else if (!areMutuallyExclusive(parent.id, cascade.trigger, child.show_if)) {
    err(
      "cascade_not_exclusive",
      "A cascata e a visibilidade do item filho podem disparar juntas."
    );
  }
}

export function areMutuallyExclusive(
  parentItemId: string,
  trigger: { operator: "equals" | "not_equals"; value?: unknown },
  showIf: ShowIfCondition
) {
  if (showIf.item_id !== parentItemId) return false;

  const same = deepEquals(trigger.value, showIf.value);
  if (trigger.operator === "equals" && showIf.operator === "equals") {
    return !same;
  }
  if (trigger.operator === "equals" && showIf.operator === "not_equals") {
    return same;
  }
  if (trigger.operator === "not_equals" && showIf.operator === "equals") {
    return same;
  }
  return false;
}

function deepEquals(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  const normalize = (value: unknown) =>
    value === "true" ? true : value === "false" ? false : value;
  return Object.is(normalize(left), normalize(right));
}
