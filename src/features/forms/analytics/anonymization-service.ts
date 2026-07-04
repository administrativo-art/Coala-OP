import {
  FieldValue,
  Timestamp as AdminTimestamp,
  type Firestore,
  type Timestamp,
} from "firebase-admin/firestore";

import { ANALYTICS_COLLECTIONS } from "./types";

export const RESTRICTED_TEXTS_COLLECTION = "restricted_occurrence_texts";

const REDACTED_TEXT = "[Removido por politica de privacidade]";
const REDACTED_NAME = "[Colaborador anonimizado]";

export interface AnonymizableView {
  contains_personal_data: boolean;
  is_anonymized?: boolean;
  target_type: string;
  target_name_snapshot?: string;
  collaborator_id?: string;
  collaborator_name_snapshot?: string;
  collaborator_role_snapshot?: string;
  description?: string;
  answer_label?: string;
}

export interface AnonymizationPatch {
  target_name_snapshot: string;
  collaborator_name_snapshot: null;
  collaborator_role_snapshot: null;
  description: string | null;
  answer_label: string | null;
  is_description_redacted: boolean;
  description_anonymization_status: "redacted" | "restricted";
  description_original_restricted_ref?: string;
  is_anonymized: true;
}

export function buildAnonymizationPatch(
  occurrence: AnonymizableView,
  opts: { restrictedRef?: string } = {}
): AnonymizationPatch | null {
  if (!occurrence.contains_personal_data) return null;
  if (occurrence.is_anonymized === true) return null;

  const hadDescription =
    typeof occurrence.description === "string" &&
    occurrence.description.length > 0;

  return {
    target_name_snapshot:
      occurrence.target_type === "collaborator"
        ? REDACTED_NAME
        : occurrence.target_name_snapshot ?? REDACTED_NAME,
    collaborator_name_snapshot: null,
    collaborator_role_snapshot: null,
    description: hadDescription ? REDACTED_TEXT : null,
    answer_label: occurrence.answer_label ? REDACTED_TEXT : null,
    is_description_redacted: hadDescription,
    description_anonymization_status: opts.restrictedRef
      ? "restricted"
      : "redacted",
    ...(opts.restrictedRef
      ? { description_original_restricted_ref: opts.restrictedRef }
      : {}),
    is_anonymized: true,
  };
}

export interface AnonymizeOptions {
  keepOriginalInVault: boolean;
  batchLimit?: number;
  now?: Date;
}

export interface AnonymizeReport {
  anonymized: number;
  vaulted: number;
  remaining_due: number;
}

export async function anonymizeDueOccurrences(
  db: Firestore,
  workspaceId: string,
  opts: AnonymizeOptions
): Promise<AnonymizeReport> {
  const limit = opts.batchLimit ?? 200;
  const now = opts.now ?? new Date();

  const snap = await db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", workspaceId)
    .where("contains_personal_data", "==", true)
    .where("is_anonymized", "==", false)
    .where("anonymize_after", "<=", AdminTimestamp.fromDate(now))
    .limit(limit + 1)
    .get();

  const due = snap.docs.slice(0, limit);
  const remaining = snap.docs.length > limit ? 1 : 0;
  let anonymized = 0;
  let vaulted = 0;

  for (const doc of due) {
    const view: AnonymizableView = {
      contains_personal_data: doc.get("contains_personal_data") === true,
      is_anonymized: doc.get("is_anonymized") === true,
      target_type: String(doc.get("target_type") ?? ""),
      target_name_snapshot:
        typeof doc.get("target_name_snapshot") === "string"
          ? String(doc.get("target_name_snapshot"))
          : undefined,
      collaborator_id:
        typeof doc.get("collaborator_id") === "string"
          ? String(doc.get("collaborator_id"))
          : undefined,
      collaborator_name_snapshot:
        typeof doc.get("collaborator_name_snapshot") === "string"
          ? String(doc.get("collaborator_name_snapshot"))
          : undefined,
      collaborator_role_snapshot:
        typeof doc.get("collaborator_role_snapshot") === "string"
          ? String(doc.get("collaborator_role_snapshot"))
          : undefined,
      description:
        typeof doc.get("description") === "string"
          ? String(doc.get("description"))
          : undefined,
      answer_label:
        typeof doc.get("answer_label") === "string"
          ? String(doc.get("answer_label"))
          : undefined,
    };

    let restrictedRef: string | undefined;
    if (
      opts.keepOriginalInVault &&
      (view.description || view.answer_label || view.collaborator_name_snapshot)
    ) {
      const vaultDoc = db.collection(RESTRICTED_TEXTS_COLLECTION).doc(doc.id);
      await vaultDoc.set({
        workspace_id: workspaceId,
        occurrence_id: doc.id,
        original_description: view.description ?? null,
        original_answer_label: view.answer_label ?? null,
        original_collaborator_name: view.collaborator_name_snapshot ?? null,
        original_target_name: view.target_name_snapshot ?? null,
        vaulted_at: FieldValue.serverTimestamp(),
      });
      restrictedRef = `${RESTRICTED_TEXTS_COLLECTION}/${doc.id}`;
      vaulted += 1;
    }

    const patch = buildAnonymizationPatch(view, { restrictedRef });
    if (!patch) continue;

    await doc.ref.update({
      ...patch,
      anonymized_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    anonymized += 1;
  }

  return { anonymized, vaulted, remaining_due: remaining };
}

export function computeAnonymizeAfter(
  occurredAt: Date,
  retentionDays: number
): Date {
  if (retentionDays <= 0) {
    throw new Error("retentionDays deve ser > 0");
  }
  return new Date(occurredAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

export async function backfillAnonymizeAfter(
  db: Firestore,
  workspaceId: string,
  retentionDays: number,
  batchLimit = 400
): Promise<{ stamped: number; has_more: boolean }> {
  const snap = await db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", workspaceId)
    .where("contains_personal_data", "==", true)
    .where("anonymize_after", "==", null)
    .limit(batchLimit + 1)
    .get();

  const docs = snap.docs.slice(0, batchLimit);
  const batch = db.batch();
  for (const doc of docs) {
    const occurredAt = (doc.get("occurred_at") as Timestamp).toDate();
    batch.update(doc.ref, {
      anonymize_after: AdminTimestamp.fromDate(
        computeAnonymizeAfter(occurredAt, retentionDays)
      ),
      is_anonymized: doc.get("is_anonymized") ?? false,
      updated_at: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  return { stamped: docs.length, has_more: snap.docs.length > batchLimit };
}
