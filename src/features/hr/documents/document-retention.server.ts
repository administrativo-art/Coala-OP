import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import {
  calculateRetentionUntil,
  documentRetentionPolicy,
} from "@/features/hr/documents/document-retention";
import { dbAdmin } from "@/lib/firebase-admin";

export async function recalculateEmploymentEndRetention(params: {
  employeeId: string;
  employmentEndedAt: string;
  actorId: string;
}) {
  const documents = await dbAdmin.collection("generatedDocuments")
    .where("employeeId", "==", params.employeeId)
    .get();
  const targets = documents.docs.filter(
    (document) =>
      document.get("retentionAnchorType") === "employment_end"
      && !document.get("retentionUntil"),
  );
  let updated = 0;
  for (let offset = 0; offset < targets.length; offset += 400) {
    const batch = dbAdmin.batch();
    targets.slice(offset, offset + 400).forEach((document) => {
      const policy = documentRetentionPolicy(document.get("retentionPolicyId"));
      const retentionUntil = calculateRetentionUntil({
        policy,
        anchorAt: params.employmentEndedAt,
      });
      const fields = {
        retentionAnchorAt: params.employmentEndedAt,
        retentionUntil,
        retentionCalculatedAt: Timestamp.now(),
        retentionCalculatedBy: params.actorId,
      };
      batch.set(document.ref, fields, { merge: true });
      batch.set(document.ref.collection("audit").doc("resolvedValues"), fields, { merge: true });
      updated += 1;
    });
    await batch.commit();
  }
  return { employeeId: params.employeeId, scanned: documents.size, updated };
}

export async function reconcileTerminatedEmployeeRetention(limit = 50) {
  const terminated = await dbAdmin.collection("users")
    .where("employmentStatus", "==", "terminated")
    .limit(Math.max(1, Math.min(limit, 100)))
    .get();
  const results = [];
  for (const user of terminated.docs) {
    const endedAt = user.get("terminationDate");
    const value = typeof endedAt === "string"
      ? endedAt
      : endedAt && typeof endedAt.toDate === "function"
        ? endedAt.toDate().toISOString()
        : null;
    if (!value) {
      results.push({ employeeId: user.id, status: "missing_employment_end" });
      continue;
    }
    const result = await recalculateEmploymentEndRetention({
      employeeId: user.id,
      employmentEndedAt: value,
      actorId: "system:retention-reconciliation",
    });
    results.push({
      employeeId: user.id,
      status: result.updated ? "reconciled" : "clean",
      updated: result.updated,
    });
  }
  return {
    scannedEmployees: terminated.size,
    unresolved: results.filter((item) => item.status === "missing_employment_end"),
    reconciled: results.filter((item) => item.status === "reconciled"),
    clean: results.filter((item) => item.status === "clean").length,
  };
}
