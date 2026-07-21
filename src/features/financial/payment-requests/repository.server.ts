import { randomUUID } from "node:crypto";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { BankPaymentRequest, BankPaymentRequestStatus, PaymentActor } from "./types";

const COLLECTION = "bankPaymentRequests";

export function paymentRequestRef(id: string) {
  return financialDbAdmin.collection(COLLECTION).doc(id);
}

export async function getPaymentRequest(id: string): Promise<BankPaymentRequest> {
  const snapshot = await paymentRequestRef(id).get();
  if (!snapshot.exists) throw new Error("Solicitação de pagamento não encontrada.");
  return { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
}

export async function findPaymentRequestBySource(sourceType: string, sourceId: string) {
  const snapshot = await financialDbAdmin.collection(COLLECTION)
    .where("sourceType", "==", sourceType).where("sourceId", "==", sourceId).limit(1).get();
  return snapshot.empty ? null : ({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as BankPaymentRequest);
}

export async function findPaymentRequestByInterId(interRequestId: string) {
  const snapshot = await financialDbAdmin.collection(COLLECTION).where("interRequestId", "==", interRequestId).limit(1).get();
  return snapshot.empty ? null : ({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as BankPaymentRequest);
}

export async function listPaymentRequests(limit = 100) {
  const snapshot = await financialDbAdmin.collection(COLLECTION).orderBy("createdAt", "desc").limit(limit).get();
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as BankPaymentRequest));
}

export async function addPaymentEvent(requestId: string, type: string, actor: PaymentActor | "system", data: Record<string, unknown> = {}, eventId: string = randomUUID()) {
  const at = new Date().toISOString();
  await paymentRequestRef(requestId).collection("events").doc(eventId).create({
    type, at,
    actorId: actor === "system" ? "system" : actor.uid,
    actorEmail: actor === "system" ? null : actor.email ?? null,
    ...data,
  }).catch((error: unknown) => {
    if ((error as { code?: number | string })?.code === 6 || String((error as Error)?.message).includes("ALREADY_EXISTS")) return;
    throw error;
  });
}

export async function transitionPaymentRequest(id: string, allowedFrom: BankPaymentRequestStatus[], next: BankPaymentRequestStatus, patch: Record<string, unknown> = {}) {
  const ref = paymentRequestRef(id);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Solicitação de pagamento não encontrada.");
    const current = snapshot.data() as BankPaymentRequest;
    if (!allowedFrom.includes(current.status)) throw new Error(`A solicitação está em ${current.status} e não pode avançar para ${next}.`);
    const updatedAt = new Date().toISOString();
    transaction.set(ref, { status: next, updatedAt, ...patch }, { merge: true });
    return { ...current, id: snapshot.id, status: next, updatedAt, ...patch } as BankPaymentRequest;
  });
}
