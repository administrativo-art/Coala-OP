import "server-only";

import { createHash } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";

import {
  documentProtocolEntityCode,
  formatDocumentProtocol,
} from "@/features/hr/documents/document-protocol";
import { dbAdmin } from "@/lib/firebase-admin";

export async function allocateDocumentProtocol(params: {
  entity: unknown;
  type?: string;
  actorId: string;
}) {
  const year = new Date().getFullYear();
  const entity = documentProtocolEntityCode(params.entity);
  const counterId = createHash("sha256")
    .update(`${entity}:${params.type ?? "DOC"}:${year}`)
    .digest("hex")
    .slice(0, 32);
  const reference = dbAdmin.collection("documentProtocolCounters").doc(counterId);
  const sequence = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const next = Number(snapshot.get("lastSequence") ?? 0) + 1;
    transaction.set(reference, {
      entity,
      type: params.type ?? "DOC",
      year,
      lastSequence: next,
      updatedAt: Timestamp.now(),
      updatedBy: params.actorId,
    }, { merge: true });
    return next;
  });
  return formatDocumentProtocol({ entity, type: params.type, year, sequence });
}

/**
 * Reserva idempotente: uma repetição da mesma geração reutiliza o número e não
 * avança o contador novamente.
 */
export async function allocateIdempotentDocumentProtocol(params: {
  entity: unknown;
  type?: string;
  actorId: string;
  reservationKey: string;
}) {
  const year = new Date().getFullYear();
  const entity = documentProtocolEntityCode(params.entity);
  const type = params.type ?? "DOC";
  const counterId = createHash("sha256")
    .update(`${entity}:${type}:${year}`)
    .digest("hex")
    .slice(0, 32);
  const reservationId = createHash("sha256")
    .update(`${counterId}:${params.reservationKey}`)
    .digest("hex");
  const counterRef = dbAdmin.collection("documentProtocolCounters").doc(counterId);
  const reservationRef = dbAdmin.collection("documentProtocolReservations").doc(reservationId);
  return dbAdmin.runTransaction(async (transaction) => {
    const [reservation, counter] = await Promise.all([
      transaction.get(reservationRef),
      transaction.get(counterRef),
    ]);
    if (reservation.exists) return String(reservation.get("protocol"));
    const sequence = Number(counter.get("lastSequence") ?? 0) + 1;
    const protocol = formatDocumentProtocol({ entity, type, year, sequence });
    transaction.set(counterRef, {
      entity,
      type,
      year,
      lastSequence: sequence,
      updatedAt: Timestamp.now(),
      updatedBy: params.actorId,
    }, { merge: true });
    transaction.create(reservationRef, {
      reservationKey: params.reservationKey,
      protocol,
      entity,
      type,
      year,
      sequence,
      createdAt: Timestamp.now(),
      createdBy: params.actorId,
    });
    return protocol;
  });
}
