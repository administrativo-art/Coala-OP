import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";

import type { AnalyticsItemView } from "./analytics-config-schema";
import {
  buildRecordStatusPatch,
  dedupeDocId,
  type AnalyticsRecordStatusReason,
  type OccurrenceDraft,
} from "./occurrence-model";
import { computeAnonymizeAfter } from "./anonymization-service";
import { ANALYTICS_COLLECTIONS } from "./types";
import {
  generateDraftsForExecution,
  type ExecutionView,
  type GenerationLookups,
} from "./generator-core";

const STALE_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const WRITE_BATCH_LIMIT = 400;
const PERSONAL_RETENTION_DAYS_ENV = "FORMS_ANALYTICS_PERSONAL_RETENTION_DAYS";

export class GenerationInProgressError extends Error {
  constructor() {
    super("Geração de analytics já em andamento para esta execução.");
    this.name = "GenerationInProgressError";
  }
}

export interface GeneratorDeps {
  db: Firestore;
  executionsCollection: string;
}

export interface RetentionResolution {
  id?: string;
  days: number;
}

export interface GenerateOccurrencesParams {
  execution: ExecutionView;
  items: readonly AnalyticsItemView[];
  lookups: GenerationLookups;
  workspaceTimezone: string;
  userId: string;
  requestId: string;
  mode: "complete" | "reprocess";
  // Política de retenção resolvida para dados pessoais. Ausente → fallback env.
  retention?: RetentionResolution | null;
}

export interface GenerateOccurrencesReport {
  analytics_revision: number;
  generation_batch_id: string;
  written: number;
  superseded: number;
}

interface AcquiredRevision {
  revision: number;
  batch_id: string;
  is_retry: boolean;
}

async function acquireGenerationRevision(
  deps: GeneratorDeps,
  executionId: string,
  requestId: string
): Promise<AcquiredRevision> {
  const ref = deps.db.collection(deps.executionsCollection).doc(executionId);

  return deps.db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new Error(`Execução não encontrada: ${executionId}`);
    }

    const state = snap.get("analytics_generation_state") as string | undefined;
    const lockId = snap.get("analytics_generation_lock_id") as
      | string
      | undefined;
    const lockAt = snap.get("analytics_generation_lock_at") as
      | Timestamp
      | undefined;
    const revision = (snap.get("analytics_revision") as number | undefined) ?? 0;

    if (state === "generating" && lockId === requestId) {
      return {
        revision,
        batch_id: String(snap.get("analytics_generation_batch_id") ?? ""),
        is_retry: true,
      };
    }

    if (state === "generating") {
      const age = Date.now() - (lockAt?.toMillis() ?? 0);
      if (age < STALE_LOCK_TIMEOUT_MS) {
        throw new GenerationInProgressError();
      }
      transaction.update(ref, {
        analytics_generation_error: `Lock obsoleto assumido por ${requestId}.`,
      });
    }

    const nextRevision = revision + 1;
    const batchId = `gen_${executionId}_rev${nextRevision}`;
    transaction.update(ref, {
      analytics_revision: nextRevision,
      analytics_generation_state: "generating",
      analytics_generation_batch_id: batchId,
      analytics_generation_lock_id: requestId,
      analytics_generation_lock_at: FieldValue.serverTimestamp(),
    });

    return { revision: nextRevision, batch_id: batchId, is_retry: false };
  });
}

async function finalizeGeneration(
  deps: GeneratorDeps,
  executionId: string,
  outcome: { ok: true } | { ok: false; error: string }
) {
  await deps.db
    .collection(deps.executionsCollection)
    .doc(executionId)
    .update(
      outcome.ok
        ? {
            analytics_generation_state: "generated",
            analytics_generated_at: FieldValue.serverTimestamp(),
            analytics_generation_error: FieldValue.delete(),
          }
        : {
            analytics_generation_state: "failed",
            analytics_generation_error: outcome.error.slice(0, 1000),
          }
    );
}

export async function generateOccurrencesForExecution(
  deps: GeneratorDeps,
  params: GenerateOccurrencesParams
): Promise<GenerateOccurrencesReport> {
  const acquired = await acquireGenerationRevision(
    deps,
    params.execution.id,
    params.requestId
  );

  try {
    let superseded = 0;
    if (!acquired.is_retry) {
      const reason: AnalyticsRecordStatusReason =
        params.mode === "reprocess" ? "reprocess" : "execution_reopened";
      superseded = await supersedeCurrentForExecution(
        deps,
        params.execution.workspace_id,
        params.execution.id,
        reason,
        acquired.batch_id,
        acquired.revision
      );
    }

    const drafts = generateDraftsForExecution(
      params.execution,
      params.items,
      params.lookups,
      {
        workspace_timezone: params.workspaceTimezone,
        analytics_revision: acquired.revision,
        generation_batch_id: acquired.batch_id,
        created_from:
          params.mode === "reprocess" ? "reprocess" : "form_execution",
      }
    );

    await writeDrafts(deps, drafts, params.userId, params.retention ?? null);
    await finalizeGeneration(deps, params.execution.id, { ok: true });

    return {
      analytics_revision: acquired.revision,
      generation_batch_id: acquired.batch_id,
      written: drafts.length,
      superseded,
    };
  } catch (error) {
    await finalizeGeneration(deps, params.execution.id, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function writeDrafts(
  deps: GeneratorDeps,
  drafts: readonly OccurrenceDraft[],
  userId: string,
  retention: { id?: string; days: number } | null
) {
  const collection = deps.db.collection(ANALYTICS_COLLECTIONS.occurrences);
  // Política resolvida vence; sem política, cai no fallback por env.
  const retentionDays = retention?.days ?? readPersonalRetentionDays();
  const retentionPolicyId = retention?.id;
  for (let index = 0; index < drafts.length; index += WRITE_BATCH_LIMIT) {
    const batch = deps.db.batch();
    drafts.slice(index, index + WRITE_BATCH_LIMIT).forEach((draft) => {
      const anonymizeAfter =
        draft.contains_personal_data && retentionDays
          ? Timestamp.fromDate(
              computeAnonymizeAfter(draft.occurred_at, retentionDays)
            )
          : null;

      batch.set(collection.doc(dedupeDocId(draft.dedupe_key)), {
        ...stripUndefinedDeep({
          ...draft,
          execution_completed_at: Timestamp.fromDate(draft.execution_completed_at),
          occurred_at: Timestamp.fromDate(draft.occurred_at),
          ...(draft.due_at ? { due_at: Timestamp.fromDate(draft.due_at) } : {}),
          ...(draft.contains_personal_data && retentionPolicyId
            ? { retention_policy_id: retentionPolicyId }
            : {}),
          is_anonymized: false,
          anonymize_after: anonymizeAfter,
          opened_at: FieldValue.serverTimestamp(),
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
          created_by: userId,
        }),
      });
    });
    await batch.commit();
  }
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }

  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !(value instanceof Timestamp) &&
    !(value instanceof FieldValue)
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefinedDeep(entry)])
    ) as T;
  }

  return value;
}

function readPersonalRetentionDays() {
  const raw = process.env[PERSONAL_RETENTION_DAYS_ENV];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function supersedeCurrentForExecution(
  deps: GeneratorDeps,
  workspaceId: string,
  executionId: string,
  reason: AnalyticsRecordStatusReason,
  newBatchId: string,
  keepRevision?: number
) {
  const snap = await deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", workspaceId)
    .where("execution_id", "==", executionId)
    .where("is_current", "==", true)
    .get();

  let count = 0;
  for (let index = 0; index < snap.docs.length; index += WRITE_BATCH_LIMIT) {
    const batch = deps.db.batch();
    snap.docs.slice(index, index + WRITE_BATCH_LIMIT).forEach((doc) => {
      if (
        keepRevision !== undefined &&
        doc.get("analytics_revision") === keepRevision
      ) {
        return;
      }
      batch.update(doc.ref, {
        ...buildRecordStatusPatch(
          reason === "execution_cancelled" ? "cancelled" : "superseded",
          reason,
          newBatchId
        ),
        record_status_changed_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      count += 1;
    });
    await batch.commit();
  }

  return count;
}

export async function supersedeOccurrencesForExecution(
  deps: GeneratorDeps,
  workspaceId: string,
  executionId: string
) {
  return supersedeCurrentForExecution(
    deps,
    workspaceId,
    executionId,
    "execution_reopened",
    "reopen_no_batch"
  );
}

export async function cancelOccurrencesForExecution(
  deps: GeneratorDeps,
  workspaceId: string,
  executionId: string
) {
  const snap = await deps.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", workspaceId)
    .where("execution_id", "==", executionId)
    .where("is_current", "==", true)
    .get();

  let count = 0;
  for (let index = 0; index < snap.docs.length; index += WRITE_BATCH_LIMIT) {
    const batch = deps.db.batch();
    snap.docs.slice(index, index + WRITE_BATCH_LIMIT).forEach((doc) => {
      batch.update(doc.ref, {
        ...buildRecordStatusPatch("cancelled", "execution_cancelled"),
        resolution_status: "cancelled",
        resolution_source: "execution_cancelled",
        record_status_changed_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      count += 1;
    });
    await batch.commit();
  }

  return count;
}
