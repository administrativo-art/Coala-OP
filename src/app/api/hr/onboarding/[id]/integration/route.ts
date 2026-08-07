import { NextRequest, NextResponse } from "next/server";

import { advanceIntegrationExecution, type IntegrationProcessExecution, updateIntegrationExecution } from "@/features/hr/integration/process";
import { evaluateIntegrationCondition, simulateIntegrationTemplate } from "@/features/hr/integration/engine";
import { executeIntegrationActions, type ExecutableIntegrationProcess } from "@/features/hr/integration/action-executor";
import { buildIntegrationProcessContext, createIntegrationActionAdapter, syncIntegrationProfileWrites } from "@/features/hr/integration/runtime-actions.server";
import { integrationTemplateContentSchema } from "@/features/hr/integration/schemas";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function completionRulesPassed(execution: IntegrationProcessExecution, processContext: Record<string, unknown>) {
  return execution.snapshot.completionRules.some((condition) =>
    evaluateIntegrationCondition(condition, {
      answers: execution.answers,
      uploads: execution.uploads,
      context: processContext,
    })
  );
}

function completeIfReady(params: {
  execution: ExecutableIntegrationProcess;
  simulation: ReturnType<typeof simulateIntegrationTemplate>;
  processContext: Record<string, unknown>;
  now: string;
  action: string;
}) {
  const requested =
    Boolean(params.execution.completionRequestedAt) ||
    completionRulesPassed(params.execution, params.processContext) ||
    (params.action === "advance" && !params.execution.currentStageId);
  if (!requested || params.simulation.blockedReasons.length) {
    return { execution: params.execution, completed: false };
  }
  const stageStatuses = { ...params.execution.stageStatuses };
  params.simulation.visibleStageIds.forEach((stageId) => { stageStatuses[stageId] = "completed"; });
  params.simulation.skippedStageIds.forEach((stageId) => { stageStatuses[stageId] = "skipped"; });
  return {
    execution: {
      ...params.execution,
      stageStatuses,
      currentStageId: null,
      completionRequestedAt: params.execution.completionRequestedAt ?? params.now,
      updatedAt: params.now,
    },
    completed: true,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, "view").catch(() => null);
  if (!access) return error("Sem permissão para acessar a integração.", 403);
  const { id } = await context.params;
  const document = await hrDbAdmin.collection("onboardingProcesses").doc(id).get();
  if (!document.exists) return error("Integração não encontrada.", 404);
  const execution = document.get("integrationV2") as IntegrationProcessExecution | undefined;
  if (!execution?.snapshot) return error("Esta integração ainda usa o fluxo legado.", 409);
  const processContext = buildIntegrationProcessContext(id, record(document.data()));
  return NextResponse.json({
    execution: serializeHrValue(execution),
    simulation: simulateIntegrationTemplate(execution.snapshot, { answers: execution.answers, uploads: execution.uploads, context: processContext }),
  });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, "onboarding.manage").catch(() => null);
  if (!access) return error("Sem permissão para atualizar a integração.", 403);
  const { id } = await context.params;
  const body = record(await request.json().catch(() => null));
  const action = typeof body.action === "string" ? body.action : "save";
  const reference = hrDbAdmin.collection("onboardingProcesses").doc(id);
  const document = await reference.get();
  if (!document.exists) return error("Integração não encontrada.", 404);
  const processData = record(document.data());
  const current = document.get("integrationV2") as IntegrationProcessExecution | undefined;
  if (!current?.snapshot) return error("Esta integração ainda usa o fluxo legado.", 409);
  const now = new Date().toISOString();
  let next: IntegrationProcessExecution;
  let profileWriteResults: Record<string, Record<string, unknown>> = {};
  try {
    if (action === "configure") {
      if (current.mode !== "blank") return error("O snapshot de um modelo importado é imutável.", 409);
      const content = integrationTemplateContentSchema.parse(body.content);
      const stageStatuses = { ...current.stageStatuses };
      content.stages.forEach((stage) => { if (!stageStatuses[stage.id]) stageStatuses[stage.id] = "pending"; });
      Object.keys(stageStatuses).forEach((stageId) => { if (!content.stages.some((stage) => stage.id === stageId)) delete stageStatuses[stageId]; });
      const currentStageId = current.currentStageId && content.stages.some((stage) => stage.id === current.currentStageId)
        ? current.currentStageId
        : [...content.stages].sort((left, right) => left.order - right.order)[0]?.id ?? null;
      if (currentStageId && stageStatuses[currentStageId] !== "completed") stageStatuses[currentStageId] = "active";
      next = {
        ...current,
        snapshot: { ...current.snapshot, ...content },
        stageStatuses,
        currentStageId,
        currentStageStartedAt: currentStageId === current.currentStageId
          ? current.currentStageStartedAt ?? current.startedAt
          : currentStageId
            ? now
            : null,
        updatedAt: now,
      };
    } else if (action === "advance") next = advanceIntegrationExecution(current, now);
    else next = updateIntegrationExecution(current, { answers: record(body.answers), uploads: record(body.uploads) }, now);
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Não foi possível avançar.");
  }
  const processContext = buildIntegrationProcessContext(id, processData);
  let simulation = simulateIntegrationTemplate(next.snapshot, { answers: next.answers, uploads: next.uploads, context: processContext });
  if (action !== "configure") {
    let executable: ExecutableIntegrationProcess = next;
    executable = await executeIntegrationActions({
      execution: executable,
      simulation,
      adapter: createIntegrationActionAdapter({
        access,
        execution: executable,
        processId: id,
        processData,
        now,
      }),
      processContext,
      now,
    });
    simulation = simulateIntegrationTemplate(executable.snapshot, { answers: executable.answers, uploads: executable.uploads, context: processContext });
    profileWriteResults = await syncIntegrationProfileWrites({
      execution: executable,
      simulation,
      processId: id,
      processData,
      access,
      now,
    });
    const completed = completeIfReady({ execution: executable, simulation, processContext, now, action });
    executable = completed.execution;
    next = executable;
    if (completed.completed) {
      simulation = simulateIntegrationTemplate(next.snapshot, { answers: next.answers, uploads: next.uploads, context: processContext });
    }
  }
  const update: Record<string, unknown> = { integrationV2: next, updatedAt: now };
  if (next.currentStageId === null && (next.completionRequestedAt || action === "advance")) {
    update.status = "completed";
    update.completedAt = now;
  }
  await reference.update(update);
  return NextResponse.json({
    execution: serializeHrValue(next),
    simulation,
    profileWriteResults: serializeHrValue(profileWriteResults),
  });
}
