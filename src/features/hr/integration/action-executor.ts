import type { IntegrationProcessExecution } from "./process";
import type { IntegrationSimulation } from "./engine";
import type { IntegrationRule } from "./schemas";

export type IntegrationActionResult = { status: "completed" | "failed"; executedAt: string; output?: Record<string, unknown>; error?: string };
export type IntegrationActionAdapter = {
  createTask(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  notify(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  requestSignature(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  generateDocument(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateProfile(input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export type ExecutableIntegrationProcess = IntegrationProcessExecution & {
  assignees?: Record<string, { strategy: string; referenceId?: string; resolvedId?: string; resolvedType?: string }>;
  actionResults?: Record<string, IntegrationActionResult>;
  optionFilters?: Record<string, unknown>;
  completionRequestedAt?: string | null;
};

function actionKey(ruleId: string, actionId: string) { return `${ruleId}:${actionId}`; }
function ruleAction(rules: IntegrationRule[], ruleId: string, actionId: string) { return rules.find((rule) => rule.id === ruleId)?.actions.find((action) => action.id === actionId); }

export async function executeIntegrationActions(params: {
  execution: ExecutableIntegrationProcess;
  simulation: IntegrationSimulation;
  adapter: IntegrationActionAdapter;
  processContext: Record<string, unknown>;
  now: string;
}) {
  let execution: ExecutableIntegrationProcess = { ...params.execution, answers: { ...params.execution.answers }, assignees: { ...(params.execution.assignees ?? {}) }, actionResults: { ...(params.execution.actionResults ?? {}) }, optionFilters: { ...(params.execution.optionFilters ?? {}) } };
  for (const triggered of params.simulation.actions) {
    const key = actionKey(triggered.ruleId, triggered.actionId);
    if (execution.actionResults?.[key]?.status === "completed") continue;
    const action = ruleAction(execution.snapshot.rules, triggered.ruleId, triggered.actionId);
    if (!action) continue;
    const input = { ...action.config, actionId: action.id, ruleId: triggered.ruleId, targetId: action.targetId, process: params.processContext };
    try {
      let output: Record<string, unknown> = {};
      if (action.type === "set_value" && action.targetId) execution.answers[action.targetId] = action.config.value;
      else if (action.type === "filter_options" && action.targetId) execution.optionFilters![action.targetId] = action.config.allowedValues ?? [];
      else if (action.type === "assign_responsible" && action.targetId) execution.assignees![action.targetId] = { strategy: String(action.config.strategy ?? "selected_during_execution"), ...(typeof action.config.referenceId === "string" ? { referenceId: action.config.referenceId } : {}), ...(typeof action.config.resolvedId === "string" ? { resolvedId: action.config.resolvedId } : {}), ...(typeof action.config.resolvedType === "string" ? { resolvedType: action.config.resolvedType } : {}) };
      else if (action.type === "create_task") output = await params.adapter.createTask(input);
      else if (action.type === "notify") output = await params.adapter.notify(input);
      else if (action.type === "request_signature") output = await params.adapter.requestSignature(input);
      else if (action.type === "generate_document") output = await params.adapter.generateDocument(input);
      else if (action.type === "set_value" || action.type === "filter_options" || action.type === "assign_responsible") { /* handled above */ }
      else if (action.type === "complete_integration") execution.completionRequestedAt = params.now;
      if (action.type === "set_value" && action.config.updateProfile === true) output = await params.adapter.updateProfile({ ...input, value: action.config.value });
      execution.actionResults![key] = { status: "completed", executedAt: params.now, ...(Object.keys(output).length ? { output } : {}) };
    } catch (cause) {
      execution.actionResults![key] = { status: "failed", executedAt: params.now, error: cause instanceof Error ? cause.message : "Falha ao executar ação." };
    }
  }
  return execution;
}
