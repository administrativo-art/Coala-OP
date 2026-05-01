"use client";

import { type ItemAdditionRequest } from "@/types";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

type ItemRequestCreateInput = Partial<
  Omit<
    ItemAdditionRequest,
    "id" | "kioskName" | "requestedBy" | "status" | "createdAt" | "taskId"
  >
> & {
  assigneeProfileId?: string | null;
};

async function parseJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: ({ error?: string } | T | null) = null;

  if (raw) {
    try {
      payload = JSON.parse(raw) as { error?: string } | T;
    } catch (error) {
      console.error("[ITEM REQUESTS CLIENT] Resposta não-JSON da API", {
        status: response.status,
        url: response.url,
        raw: raw.slice(0, 500),
        error,
      });
      throw new Error(`Resposta inválida da API (${response.status}). Veja o console/terminal.`);
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : "Falha na operação da solicitação.";
    throw new Error(message || "Falha na operação da solicitação.");
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

export async function fetchItemRequests(firebaseUser: FirebaseUserLike) {
  const response = await authedFetch(firebaseUser, "/api/stock/item-requests", {
    method: "GET",
  });

  return parseJson<{ requests: ItemAdditionRequest[] }>(response);
}

export async function createItemRequest(
  firebaseUser: FirebaseUserLike,
  input: ItemRequestCreateInput
) {
  const response = await authedFetch(firebaseUser, "/api/stock/item-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseJson<{ request: ItemAdditionRequest }>(response);
}

export async function updateItemRequestStatus(
  firebaseUser: FirebaseUserLike,
  requestId: string,
  status: "completed" | "rejected"
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/item-requests/${requestId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }
  );

  return parseJson<{ request: ItemAdditionRequest }>(response);
}

export async function deleteItemRequest(
  firebaseUser: FirebaseUserLike,
  requestId: string
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/item-requests/${requestId}`,
    {
      method: "DELETE",
    }
  );

  return parseJson<{ ok: true }>(response);
}
