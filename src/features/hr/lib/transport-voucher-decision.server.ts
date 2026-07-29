import "server-only";

import { createHash } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";

import {
  normalizeTransportVoucherEffectiveDate,
  transportVoucherDecisionKey,
  transportVoucherDecisionMode,
  transportVoucherDocumentKind,
  type TransportVoucherDecision,
} from "@/features/hr/lib/transport-voucher-decision";
import { documentProtocolEntityCode, formatDocumentProtocol } from "@/features/hr/documents/document-protocol";
import { dbAdmin } from "@/lib/firebase-admin";

function cleanText(value: unknown, max = 500) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export async function recordTransportVoucherDecision(input: {
  employeeId: string;
  active: boolean;
  dailyValue?: number | null;
  effectiveDate?: string | null;
  reason?: string | null;
  entity?: unknown;
  actorId: string;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const effectiveDate = normalizeTransportVoucherEffectiveDate(input.effectiveDate, now);
  const mode = transportVoucherDecisionMode(input.active);
  const latestQuery = dbAdmin.collection("transportVoucherDecisions")
    .where("employeeId", "==", input.employeeId)
    .where("status", "==", "current")
    .limit(1);
  const entity = documentProtocolEntityCode(input.entity);
  const year = Number(effectiveDate.slice(0, 4));
  const protocolType = mode === "requested" ? "VT" : "VTN";
  const counterId = createHash("sha256")
    .update(`${entity}:${protocolType}:${year}`)
    .digest("hex")
    .slice(0, 32);
  const counterRef = dbAdmin.collection("documentProtocolCounters").doc(counterId);

  return dbAdmin.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(latestQuery);
    const current = currentSnapshot.docs[0];
    const currentVersion = Number(current?.get("decisionVersion") ?? 0);
    const decisionVersion = currentVersion + 1;
    const idempotencyKey = transportVoucherDecisionKey({
      employeeId: input.employeeId,
      decisionVersion,
      effectiveDate,
      mode,
    });
    const decisionRef = dbAdmin.collection("transportVoucherDecisions").doc(idempotencyKey);
    const existing = await transaction.get(decisionRef);
    if (existing.exists) return existing.data() as TransportVoucherDecision;

    const counterSnapshot = await transaction.get(counterRef);
    const sequence = Number(counterSnapshot.get("lastSequence") ?? 0) + 1;
    const protocol = formatDocumentProtocol({ entity, type: protocolType, year, sequence });
    const decision: TransportVoucherDecision = {
      decisionId: decisionRef.id,
      employeeId: input.employeeId,
      mode,
      documentKind: transportVoucherDocumentKind(mode),
      decisionVersion,
      effectiveDate,
      dailyValue: mode === "requested" && Number.isFinite(input.dailyValue)
        ? Number(input.dailyValue)
        : null,
      reason: cleanText(input.reason),
      status: "current",
      protocol,
      idempotencyKey,
      supersedesDecisionId: current?.id ?? null,
      supersededByDecisionId: null,
      generatedDocumentId: null,
      createdAt: now,
      createdBy: input.actorId,
    };
    transaction.set(counterRef, {
      entity,
      type: protocolType,
      year,
      lastSequence: sequence,
      updatedAt: Timestamp.fromDate(new Date(now)),
      updatedBy: input.actorId,
    }, { merge: true });
    if (current) {
      transaction.update(current.ref, {
        status: "superseded",
        supersededByDecisionId: decisionRef.id,
        supersededAt: now,
        supersededBy: input.actorId,
      });
    }
    transaction.create(decisionRef, decision);
    return decision;
  });
}
