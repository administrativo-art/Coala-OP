"use client";

import { type RepositionRequest } from "@/types";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

type RepositionRequestCreateInput = Pick<
  RepositionRequest,
  "kioskId" | "kioskName" | "items" | "notes"
>;

async function parseJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: ({ error?: string } | T | null) = null;

  if (raw) {
    payload = JSON.parse(raw) as { error?: string } | T;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : "Falha na operação de solicitação de reposição.";
    throw new Error(message || "Falha na operação de solicitação de reposição.");
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

export async function fetchRepositionRequests(firebaseUser: FirebaseUserLike) {
  const response = await authedFetch(firebaseUser, "/api/stock/reposition-requests");
  return parseJson<{ requests: RepositionRequest[] }>(response);
}

export async function createRepositionRequest(
  firebaseUser: FirebaseUserLike,
  input: RepositionRequestCreateInput
) {
  const response = await authedFetch(firebaseUser, "/api/stock/reposition-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseJson<{ request: RepositionRequest }>(response);
}

export async function updateRepositionRequestRequest(
  firebaseUser: FirebaseUserLike,
  requestId: string,
  updates: Partial<RepositionRequest>
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/reposition-requests/${requestId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );

  return parseJson<{ request: RepositionRequest }>(response);
}
