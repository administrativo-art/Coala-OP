import { simulateIntegrationTemplate } from "./engine";
import { integrationTemplateVersionSchema, type IntegrationTemplateVersion } from "./schemas";

export type IntegrationProcessExecution = {
  mode: "import" | "blank";
  templateId: string | null;
  templateVersion: number | null;
  snapshot: IntegrationTemplateVersion;
  answers: Record<string, unknown>;
  uploads: Record<string, unknown>;
  stageStatuses: Record<string, "pending" | "active" | "completed" | "skipped">;
  currentStageId: string | null;
  currentStageStartedAt?: string | null;
  startedAt: string;
  updatedAt: string;
  assignees?: Record<string, { strategy: string; referenceId?: string; resolvedId?: string; resolvedType?: string }>;
  actionResults?: Record<string, { status: "completed" | "failed"; executedAt: string; output?: Record<string, unknown>; error?: string }>;
  optionFilters?: Record<string, unknown>;
  completionRequestedAt?: string | null;
};

export function createIntegrationExecution(params: {
  mode: "import" | "blank";
  snapshot: IntegrationTemplateVersion;
  now: string;
}): IntegrationProcessExecution {
  const snapshot = integrationTemplateVersionSchema.parse(params.snapshot);
  const orderedStages = [...snapshot.stages].sort((left, right) => left.order - right.order);
  const firstStageId = orderedStages[0]?.id ?? null;
  return {
    mode: params.mode,
    templateId: params.mode === "import" ? snapshot.templateId : null,
    templateVersion: params.mode === "import" ? snapshot.version : null,
    snapshot,
    answers: {},
    uploads: {},
    stageStatuses: Object.fromEntries(orderedStages.map((stage, index) => [stage.id, index === 0 ? "active" : "pending"])),
    currentStageId: firstStageId,
    currentStageStartedAt: firstStageId ? params.now : null,
    startedAt: params.now,
    updatedAt: params.now,
    assignees: {},
    actionResults: {},
    optionFilters: {},
    completionRequestedAt: null,
  };
}

export function updateIntegrationExecution(
  execution: IntegrationProcessExecution,
  patch: { answers?: Record<string, unknown>; uploads?: Record<string, unknown> },
  now: string,
): IntegrationProcessExecution {
  const answers = { ...execution.answers, ...(patch.answers ?? {}) };
  const uploads = { ...execution.uploads, ...(patch.uploads ?? {}) };
  const simulation = simulateIntegrationTemplate(execution.snapshot, { answers, uploads });
  const orderedVisibleStages = execution.snapshot.stages
    .filter((stage) => simulation.visibleStageIds.includes(stage.id))
    .sort((left, right) => left.order - right.order);
  const statuses = { ...execution.stageStatuses };
  simulation.skippedStageIds.forEach((id) => { statuses[id] = "skipped"; });
  const currentStageId = statuses[execution.currentStageId ?? ""] === "skipped"
    ? orderedVisibleStages.find((stage) => statuses[stage.id] !== "completed")?.id ?? null
    : execution.currentStageId;
  if (currentStageId && statuses[currentStageId] !== "completed") statuses[currentStageId] = "active";
  return {
    ...execution,
    answers,
    uploads,
    stageStatuses: statuses,
    currentStageId,
    currentStageStartedAt: currentStageId === execution.currentStageId
      ? execution.currentStageStartedAt ?? execution.startedAt
      : currentStageId
        ? now
        : null,
    updatedAt: now,
  };
}

export function advanceIntegrationExecution(execution: IntegrationProcessExecution, now: string) {
  const simulation = simulateIntegrationTemplate(execution.snapshot, { answers: execution.answers, uploads: execution.uploads });
  if (simulation.blockedReasons.length) throw new Error(simulation.blockedReasons.join(" "));
  const visible = execution.snapshot.stages
    .filter((stage) => simulation.visibleStageIds.includes(stage.id))
    .sort((left, right) => left.order - right.order);
  const currentIndex = visible.findIndex((stage) => stage.id === execution.currentStageId);
  const statuses = { ...execution.stageStatuses };
  if (execution.currentStageId) statuses[execution.currentStageId] = "completed";
  const next = visible.slice(currentIndex + 1).find((stage) => statuses[stage.id] !== "completed");
  if (next) statuses[next.id] = "active";
  return {
    ...execution,
    stageStatuses: statuses,
    currentStageId: next?.id ?? null,
    currentStageStartedAt: next ? now : null,
    updatedAt: now,
  };
}
