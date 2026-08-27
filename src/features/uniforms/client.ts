"use client";

import type {
  LotEntry,
  UniformCondition,
  UniformAssignment,
  UniformEvent,
  UniformReturnedCondition,
  UniformStockDisposition,
  UniformStockStatus,
  UniformTransaction,
} from "@/types";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

async function authedJson<T>(
  firebaseUser: FirebaseUserLike,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await firebaseUser.getIdToken();
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Falha na operação de uniformes.");
  }
  return payload as T;
}

export type UniformOverview = {
  lots: LotEntry[];
  assignments: UniformAssignment[];
  events: UniformEvent[];
};

export function fetchUniformOverview(
  firebaseUser: FirebaseUserLike,
  collaboratorUserId?: string,
) {
  const search = collaboratorUserId
    ? `?collaboratorUserId=${encodeURIComponent(collaboratorUserId)}`
    : "";
  return authedJson<UniformOverview>(firebaseUser, `/api/uniforms${search}`);
}

export function adjustUniformLot(
  firebaseUser: FirebaseUserLike,
  input: {
    lotId: string;
    quantity: number;
    condition: UniformCondition;
    uniformStockStatus: UniformStockStatus;
    notes?: string;
  },
) {
  return authedJson<{ lot: LotEntry }>(
    firebaseUser,
    "/api/uniforms",
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deliverUniform(
  firebaseUser: FirebaseUserLike,
  input: {
    lotId: string;
    collaboratorUserId: string;
    quantity: number;
    occurredAt: string;
    notes?: string;
    transactionId: string;
    collaboratorSignature: string;
    responsibleSignature: string;
  },
) {
  return authedJson<{ assignment: UniformAssignment; transaction: Pick<UniformTransaction, "id"> & { termDocumentId?: string } }>(
    firebaseUser,
    "/api/uniforms/deliver",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function returnUniform(
  firebaseUser: FirebaseUserLike,
  input: {
    assignmentId: string;
    quantity: number;
    occurredAt: string;
    returnedCondition: UniformReturnedCondition;
    stockDisposition: UniformStockDisposition;
    notes?: string;
    transactionId: string;
    collaboratorSignature: string;
    responsibleSignature: string;
  },
) {
  return authedJson<{ assignment: UniformAssignment; transaction: Pick<UniformTransaction, "id"> & { termDocumentId?: string } }>(
    firebaseUser,
    "/api/uniforms/return",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function exchangeUniform(
  firebaseUser: FirebaseUserLike,
  input: {
    assignmentId: string;
    newLotId: string;
    quantity: number;
    occurredAt: string;
    returnedCondition: UniformReturnedCondition;
    stockDisposition: UniformStockDisposition;
    notes?: string;
    transactionId: string;
    collaboratorSignature: string;
    responsibleSignature: string;
  },
) {
  return authedJson<{ assignment: UniformAssignment; transaction: Pick<UniformTransaction, "id"> & { termDocumentId?: string } }>(
    firebaseUser,
    "/api/uniforms/exchange",
    { method: "POST", body: JSON.stringify(input) },
  );
}
