import { isDocumentVariableKey } from "./document-variables";
import type {
  IntegrationBlock,
  IntegrationCondition,
  IntegrationRule,
  IntegrationSubfield,
  IntegrationTemplateVersion,
} from "./schemas";

export type IntegrationEvaluationContext = {
  answers?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  context?: Record<string, unknown>;
  stages?: Record<string, unknown>;
  uploads?: Record<string, unknown>;
  evaluations?: Record<string, unknown>;
};

export type IntegrationValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  targetId?: string;
};

export type IntegrationSimulation = {
  visibleStageIds: string[];
  skippedStageIds: string[];
  visibleBlockIds: string[];
  hiddenBlockIds: string[];
  requiredBlockIds: string[];
  effectiveAnswers: Record<string, unknown>;
  triggeredRuleIds: string[];
  blockedReasons: string[];
  actions: Array<{ ruleId: string; actionId: string; type: string; targetId?: string }>;
};

function valueAtPath(root: unknown, path: string): unknown {
  if (!root || typeof root !== "object") return undefined;
  const record = root as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, path)) return record[path];
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, root);
}

function sourceRecord(condition: Extract<IntegrationCondition, { kind: "predicate" }>, context: IntegrationEvaluationContext) {
  if (condition.source === "answer") return context.answers;
  if (condition.source === "variable") return context.variables;
  if (condition.source === "context") return context.context;
  if (condition.source === "stage") return context.stages;
  if (condition.source === "upload") return context.uploads;
  return context.evaluations;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isEmpty(value: unknown) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function comparable(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [value];
}

export function evaluateIntegrationCondition(
  condition: IntegrationCondition | undefined,
  context: IntegrationEvaluationContext,
): boolean {
  if (!condition) return true;
  if (condition.kind === "group") {
    if (condition.operator === "and") return condition.conditions.every((child) => evaluateIntegrationCondition(child, context));
    if (condition.operator === "or") return condition.conditions.some((child) => evaluateIntegrationCondition(child, context));
    return !evaluateIntegrationCondition(condition.conditions[0], context);
  }

  const actual = valueAtPath(sourceRecord(condition, context), condition.key);
  const expected = condition.value;
  switch (condition.operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "contains":
      return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? "").includes(String(expected ?? ""));
    case "not_contains":
      return Array.isArray(actual) ? !actual.includes(expected) : !String(actual ?? "").includes(String(expected ?? ""));
    case "gt":
      return (comparable(actual) as number) > (comparable(expected) as number);
    case "gte":
      return (comparable(actual) as number) >= (comparable(expected) as number);
    case "lt":
      return (comparable(actual) as number) < (comparable(expected) as number);
    case "lte":
      return (comparable(actual) as number) <= (comparable(expected) as number);
    case "between": {
      const [min, max] = list(expected).map(comparable) as number[];
      const value = comparable(actual) as number;
      return value >= min && value <= max;
    }
    case "in":
      return list(expected).includes(actual);
    case "not_in":
      return !list(expected).includes(actual);
    case "is_empty":
      return isEmpty(actual);
    case "is_not_empty":
      return !isEmpty(actual);
    case "file_uploaded":
      return actual === true || Boolean(actual && typeof actual === "object" && (actual as Record<string, unknown>).status !== "pending");
    case "file_approved":
      return actual === "approved" || Boolean(actual && typeof actual === "object" && (actual as Record<string, unknown>).status === "approved");
    case "date_before":
      return typeof actual === "string" && typeof expected === "string" && actual < expected;
    case "date_after":
      return typeof actual === "string" && typeof expected === "string" && actual > expected;
    default:
      return false;
  }
}

function conditionDependencies(condition: IntegrationCondition | undefined): string[] {
  if (!condition) return [];
  if (condition.kind === "predicate") return condition.source === "answer" ? [condition.key] : [];
  return condition.conditions.flatMap(conditionDependencies);
}

function findCycles(blocks: IntegrationBlock[]) {
  const ids = new Set(blocks.map((block) => block.id));
  const graph = new Map(blocks.map((block) => [
    block.id,
    Array.from(new Set([
      ...conditionDependencies(block.visibilityCondition),
      ...conditionDependencies(block.requiredCondition),
    ].filter((dependency) => ids.has(dependency)))),
  ]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function visit(id: string, path: string[]) {
    if (visiting.has(id)) {
      const index = path.indexOf(id);
      cycles.push([...path.slice(index), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  }
  blocks.forEach((block) => visit(block.id, []));
  return cycles;
}

function duplicateIds(values: string[]) {
  const seen = new Set<string>();
  return Array.from(new Set(values.filter((value) => seen.has(value) || !seen.add(value))));
}

export function validateIntegrationTemplate(template: IntegrationTemplateVersion): IntegrationValidationIssue[] {
  const issues: IntegrationValidationIssue[] = [];
  const stageIds = new Set(template.stages.map((stage) => stage.id));
  const blockIds = new Set(template.blocks.map((block) => block.id));
  const ruleIds = new Set(template.rules.map((rule) => rule.id));

  duplicateIds(template.stages.map((stage) => stage.id)).forEach((id) => issues.push({ severity: "error", code: "duplicate_stage", message: `Etapa duplicada: ${id}.`, targetId: id }));
  duplicateIds(template.blocks.map((block) => block.id)).forEach((id) => issues.push({ severity: "error", code: "duplicate_block", message: `Bloco duplicado: ${id}.`, targetId: id }));
  duplicateIds(template.rules.map((rule) => rule.id)).forEach((id) => issues.push({ severity: "error", code: "duplicate_rule", message: `Regra duplicada: ${id}.`, targetId: id }));

  template.blocks.forEach((block) => {
    if (!stageIds.has(block.stageId)) issues.push({ severity: "error", code: "unknown_stage", message: `O bloco “${block.label}” aponta para uma etapa inexistente.`, targetId: block.id });
    if (block.variableKey && !isDocumentVariableKey(block.variableKey)) {
      issues.push({ severity: "error", code: "unknown_variable", message: `Variável desconhecida no bloco “${block.label}”: ${block.variableKey}.`, targetId: block.id });
    }
    [...conditionDependencies(block.visibilityCondition), ...conditionDependencies(block.requiredCondition)].forEach((dependency) => {
      if (!blockIds.has(dependency)) issues.push({ severity: "error", code: "unknown_dependency", message: `O bloco “${block.label}” depende da resposta inexistente ${dependency}.`, targetId: block.id });
    });
  });

  template.rules.forEach((rule) => {
    rule.actions.forEach((action) => {
      if (["show_block", "hide_block", "require_block", "require_upload"].includes(action.type) && action.targetId && !blockIds.has(action.targetId)) {
        issues.push({ severity: "error", code: "unknown_action_target", message: `A regra “${rule.label}” aponta para o bloco inexistente ${action.targetId}.`, targetId: rule.id });
      }
      if (["skip_stage", "activate_stage"].includes(action.type) && action.targetId && !stageIds.has(action.targetId)) {
        issues.push({ severity: "error", code: "unknown_action_target", message: `A regra “${rule.label}” aponta para a etapa inexistente ${action.targetId}.`, targetId: rule.id });
      }
    });
  });

  findCycles(template.blocks).forEach((cycle) => issues.push({
    severity: "error",
    code: "conditional_cycle",
    message: `Dependência circular: ${cycle.join(" → ")}.`,
    targetId: cycle[0],
  }));

  if (stageIds.size === 0) issues.push({ severity: "error", code: "no_stages", message: "O modelo deve possuir ao menos uma etapa." });
  if (ruleIds.size !== template.rules.length) {
    // A mensagem detalhada já foi adicionada por duplicateIds.
  }
  return issues;
}

function answered(value: unknown) {
  return !isEmpty(value);
}

function answeredStructured(type: IntegrationBlock["type"] | IntegrationSubfield["type"], value: unknown) {
  if (type === "repeatable_group" || type === "repeatable_table") {
    return Array.isArray(value) && value.length > 0;
  }
  if (type === "subform") {
    return Object.keys(record(value)).some((key) => answered(record(value)[key]));
  }
  return answered(value);
}

function nestedRequiredIssues(fields: IntegrationSubfield[] | undefined, value: unknown, prefix: string) {
  if (!fields?.length) return [] as string[];
  const issues: string[] = [];
  const container = record(value);
  fields.forEach((field) => {
    const current = container[field.id];
    if (field.required && !answeredStructured(field.type, current)) {
      issues.push(`Campo obrigatório pendente: ${prefix} / ${field.label}.`);
    }
    if (field.type === "subform" && field.fields?.length && answeredStructured(field.type, current)) {
      issues.push(...nestedRequiredIssues(field.fields, current, `${prefix} / ${field.label}`));
    }
    if ((field.type === "repeatable_group" || field.type === "repeatable_table") && field.fields?.length && Array.isArray(current)) {
      current.forEach((row, index) => {
        issues.push(...nestedRequiredIssues(field.fields, row, `${prefix} / ${field.label} #${index + 1}`));
      });
    }
  });
  return issues;
}

function blockRequiredIssues(block: IntegrationBlock, value: unknown) {
  if (!block.fields?.length) return [] as string[];
  if (block.type === "subform") {
    return nestedRequiredIssues(block.fields, value, block.label);
  }
  if ((block.type === "repeatable_group" || block.type === "repeatable_table") && Array.isArray(value)) {
    return value.flatMap((row, index) => nestedRequiredIssues(block.fields, row, `${block.label} #${index + 1}`));
  }
  return [];
}

export function simulateIntegrationTemplate(
  template: IntegrationTemplateVersion,
  input: IntegrationEvaluationContext = {},
): IntegrationSimulation {
  const answers = { ...(input.answers ?? {}) };
  const context: IntegrationEvaluationContext = { ...input, answers };
  const skippedStages = new Set(template.stages.filter((stage) => !evaluateIntegrationCondition(stage.entryCondition, context)).map((stage) => stage.id));
  const visibleBlocks = new Set(template.blocks
    .filter((block) => !skippedStages.has(block.stageId))
    .filter((block) => block.active !== false && evaluateIntegrationCondition(block.visibilityCondition, context))
    .map((block) => block.id));
  const requiredBlocks = new Set(template.blocks
    .filter((block) => visibleBlocks.has(block.id))
    .filter((block) => block.required || evaluateIntegrationCondition(block.requiredCondition, context))
    .map((block) => block.id));
  const triggeredRuleIds: string[] = [];
  const actions: IntegrationSimulation["actions"] = [];
  const blockedReasons: string[] = [];

  [...template.rules]
    .filter((rule) => rule.active !== false)
    .sort((left, right) => right.priority - left.priority)
    .forEach((rule: IntegrationRule) => {
      if (!evaluateIntegrationCondition(rule.condition, context)) return;
      triggeredRuleIds.push(rule.id);
      rule.actions.forEach((action) => {
        actions.push({ ruleId: rule.id, actionId: action.id, type: action.type, targetId: action.targetId });
        if (action.type === "show_block" && action.targetId) visibleBlocks.add(action.targetId);
        if (action.type === "hide_block" && action.targetId) visibleBlocks.delete(action.targetId);
        if (action.type === "require_block" && action.targetId) requiredBlocks.add(action.targetId);
        if (action.type === "skip_stage" && action.targetId) skippedStages.add(action.targetId);
        if (action.type === "activate_stage" && action.targetId) skippedStages.delete(action.targetId);
        if (action.type === "block_progress") blockedReasons.push(String(action.config.message ?? rule.label));
      });
    });

  template.blocks.forEach((block) => {
    if (skippedStages.has(block.stageId)) visibleBlocks.delete(block.id);
  });
  const effectiveAnswers = Object.fromEntries(
    Object.entries(answers).filter(([blockId]) => visibleBlocks.has(blockId)),
  );
  requiredBlocks.forEach((blockId) => {
    const block = template.blocks.find((item) => item.id === blockId);
    if (visibleBlocks.has(blockId) && block && !answeredStructured(block.type, effectiveAnswers[blockId])) {
      const label = block.label ?? blockId;
      blockedReasons.push(`Campo obrigatório pendente: ${label}.`);
    }
  });
  template.blocks
    .filter((block) => visibleBlocks.has(block.id))
    .forEach((block) => {
      blockedReasons.push(...blockRequiredIssues(block, effectiveAnswers[block.id]));
    });

  const visibleStageIds = template.stages
    .filter((stage) => !skippedStages.has(stage.id))
    .sort((left, right) => left.order - right.order)
    .map((stage) => stage.id);
  const visibleBlockIds = template.blocks
    .filter((block) => visibleBlocks.has(block.id))
    .sort((left, right) => left.order - right.order)
    .map((block) => block.id);

  return {
    visibleStageIds,
    skippedStageIds: template.stages.filter((stage) => skippedStages.has(stage.id)).map((stage) => stage.id),
    visibleBlockIds,
    hiddenBlockIds: template.blocks.filter((block) => !visibleBlocks.has(block.id)).map((block) => block.id),
    requiredBlockIds: Array.from(requiredBlocks).filter((id) => visibleBlocks.has(id)),
    effectiveAnswers,
    triggeredRuleIds,
    blockedReasons: Array.from(new Set(blockedReasons)),
    actions,
  };
}
