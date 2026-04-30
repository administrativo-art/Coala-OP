"use client";

import { type ReturnRequest } from "@/types";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

type ReturnRequestCreateInput = {
  tipo: "devolucao" | "bonificacao";
  insumoId: string;
  lote: string;
  quantidade: number;
  motivo: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : "Falha na operação da avaria.";
    throw new Error(message || "Falha na operação da avaria.");
  }

  return payload as T;
}

async function authedFetch(
  firebaseUser: FirebaseUserLike,
  url: string,
  init: RequestInit = {}
) {
  const token = await firebaseUser.getIdToken();
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function fetchReturnRequests(firebaseUser: FirebaseUserLike) {
  const response = await authedFetch(firebaseUser, "/api/stock/return-requests", {
    method: "GET",
  });

  return parseJson<{ requests: ReturnRequest[] }>(response);
}

export async function createReturnRequest(
  firebaseUser: FirebaseUserLike,
  input: ReturnRequestCreateInput
) {
  const response = await authedFetch(firebaseUser, "/api/stock/return-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseJson<{ request: ReturnRequest }>(response);
}

export async function updateReturnRequestRequest(
  firebaseUser: FirebaseUserLike,
  requestId: string,
  payload: Partial<ReturnRequest>
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/return-requests/${requestId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  return parseJson<{ request: ReturnRequest }>(response);
}

export async function deleteReturnRequestRequest(
  firebaseUser: FirebaseUserLike,
  requestId: string
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/return-requests/${requestId}`,
    {
      method: "DELETE",
    }
  );

  return parseJson<{ ok: true }>(response);
}
