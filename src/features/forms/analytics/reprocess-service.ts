import type { Firestore } from "firebase-admin/firestore";

import type { AnalyticsItemView } from "./analytics-config-schema";
import {
  generateOccurrencesForExecution,
  type GeneratorDeps,
} from "./generator";
import {
  generateDraftsForExecution,
  type ExecutionView,
  type GenerationLookups,
} from "./generator-core";
import { ANALYTICS_COLLECTIONS } from "./types";

export type ExecutionLoader = (executionId: string) => Promise<{
  execution: ExecutionView;
  items: readonly AnalyticsItemView[];
} | null>;

export interface ReprocessScope {
  workspaceId: string;
  executionIds: readonly string[];
  lookups: GenerationLookups;
  workspaceTimezone: string;
}

export interface ExecutionSimulation {
  execution_id: string;
  status: "ok" | "skipped" | "error";
  skip_reason?: "not_found" | "no_analytics_items";
  error?: string;
  will_create_evaluations: number;
  will_create_occurrences: number;
  will_supersede: number;
}

export interface SimulationReport {
  executions: ExecutionSimulation[];
  totals: {
    executions_ok: number;
    executions_skipped: number;
    executions_error: number;
    evaluations: number;
    occurrences: number;
    superseded: number;
  };
}

export function summarizeDrafts(
  drafts: readonly { record_type: "evaluation" | "occurrence" }[]
): { evaluations: number; occurrences: number } {
  let evaluations = 0;
  let occurrences = 0;

  for (const draft of drafts) {
    if (draft.record_type === "evaluation") evaluations += 1;
    else occurrences += 1;
  }

  return { evaluations, occurrences };
}

export function aggregateSimulations(
  simulations: readonly ExecutionSimulation[]
): SimulationReport["totals"] {
  const totals = {
    executions_ok: 0,
    executions_skipped: 0,
    executions_error: 0,
    evaluations: 0,
    occurrences: 0,
    superseded: 0,
  };

  for (const simulation of simulations) {
    if (simulation.status === "ok") totals.executions_ok += 1;
    else if (simulation.status === "skipped") {
      totals.executions_skipped += 1;
    } else {
      totals.executions_error += 1;
    }

    totals.evaluations += simulation.will_create_evaluations;
    totals.occurrences += simulation.will_create_occurrences;
    totals.superseded += simulation.will_supersede;
  }

  return totals;
}

export async function simulateReprocess(
  db: Firestore,
  scope: ReprocessScope,
  loadExecution: ExecutionLoader
): Promise<SimulationReport> {
  const executions: ExecutionSimulation[] = [];

  for (const executionId of scope.executionIds) {
    try {
      const loaded = await loadExecution(executionId);
      if (!loaded) {
        executions.push(emptySimulation(executionId, "skipped", "not_found"));
        continue;
      }

      const hasAnalytics = loaded.items.some(
        (item) => item.analytics_config?.enabled === true
      );
      if (!hasAnalytics) {
        executions.push(
          emptySimulation(executionId, "skipped", "no_analytics_items")
        );
        continue;
      }

      const drafts = generateDraftsForExecution(
        loaded.execution,
        loaded.items,
        scope.lookups,
        {
          workspace_timezone: scope.workspaceTimezone,
          analytics_revision: -1,
          generation_batch_id: "simulation",
          created_from: "reprocess",
        }
      );
      const { evaluations, occurrences } = summarizeDrafts(drafts);

      const currentSnap = await db
        .collection(ANALYTICS_COLLECTIONS.occurrences)
        .where("workspace_id", "==", scope.workspaceId)
        .where("execution_id", "==", executionId)
        .where("is_current", "==", true)
        .count()
        .get();

      executions.push({
        execution_id: executionId,
        status: "ok",
        will_create_evaluations: evaluations,
        will_create_occurrences: occurrences,
        will_supersede: currentSnap.data().count,
      });
    } catch (error) {
      executions.push({
        ...emptySimulation(executionId, "error"),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { executions, totals: aggregateSimulations(executions) };
}

function emptySimulation(
  execution_id: string,
  status: ExecutionSimulation["status"],
  skip_reason?: ExecutionSimulation["skip_reason"]
): ExecutionSimulation {
  return {
    execution_id,
    status,
    skip_reason,
    will_create_evaluations: 0,
    will_create_occurrences: 0,
    will_supersede: 0,
  };
}

export interface ReprocessResult {
  execution_id: string;
  status: "ok" | "skipped" | "error";
  error?: string;
  written: number;
  superseded: number;
  analytics_revision?: number;
}

export async function executeReprocess(
  deps: GeneratorDeps,
  scope: ReprocessScope,
  loadExecution: ExecutionLoader,
  confirmation: {
    simulation: SimulationReport;
    simulatedAt: Date;
    confirmedBy: string;
    simulationMaxAgeMs?: number;
  }
): Promise<ReprocessResult[]> {
  const maxAge = confirmation.simulationMaxAgeMs ?? 30 * 60 * 1000;
  if (Date.now() - confirmation.simulatedAt.getTime() > maxAge) {
    throw new Error(
      "Simulacao expirada: simule novamente antes de executar o reprocessamento."
    );
  }

  const executableIds = new Set(
    confirmation.simulation.executions
      .filter((simulation) => simulation.status === "ok")
      .map((simulation) => simulation.execution_id)
  );

  const results: ReprocessResult[] = [];
  for (const executionId of scope.executionIds) {
    if (!executableIds.has(executionId)) {
      results.push({
        execution_id: executionId,
        status: "skipped",
        written: 0,
        superseded: 0,
      });
      continue;
    }

    try {
      const loaded = await loadExecution(executionId);
      if (!loaded) {
        results.push({
          execution_id: executionId,
          status: "skipped",
          written: 0,
          superseded: 0,
        });
        continue;
      }

      const report = await generateOccurrencesForExecution(deps, {
        execution: loaded.execution,
        items: loaded.items,
        lookups: scope.lookups,
        workspaceTimezone: scope.workspaceTimezone,
        userId: confirmation.confirmedBy,
        requestId: `reprocess_${executionId}_${confirmation.simulatedAt.getTime()}`,
        mode: "reprocess",
      });

      results.push({
        execution_id: executionId,
        status: "ok",
        written: report.written,
        superseded: report.superseded,
        analytics_revision: report.analytics_revision,
      });
    } catch (error) {
      results.push({
        execution_id: executionId,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        written: 0,
        superseded: 0,
      });
    }
  }

  return results;
}
