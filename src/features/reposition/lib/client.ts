"use client";

import { type RepositionActivity } from "@/types";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

type RepositionCreateInput = Omit<
  RepositionActivity,
  "id" | "status" | "createdAt" | "updatedAt" | "requestedBy" | "updatedBy"
>;

async function parseJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: ({ error?: string } | T | null) = null;

  if (raw) {
    try {
      payload = JSON.parse(raw) as { error?: string } | T;
    } catch (error) {
      console.error("[REPOSITION CLIENT] Resposta não-JSON da API", {
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
        : "Falha na operação de reposição.";
    throw new Error(message || "Falha na operação de reposição.");
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

export async function fetchRepositionActivities(firebaseUser: FirebaseUserLike) {
  const response = await authedFetch(
    firebaseUser,
    "/api/stock/reposition-activities",
    {
      method: "GET",
    }
  );

  return parseJson<{ activities: RepositionActivity[] }>(response);
}

export async function createRepositionActivityRequest(
  firebaseUser: FirebaseUserLike,
  input: RepositionCreateInput
) {
  const response = await authedFetch(
    firebaseUser,
    "/api/stock/reposition-activities",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  return parseJson<{ activity: RepositionActivity }>(response);
}

export async function updateRepositionActivityRequest(
  firebaseUser: FirebaseUserLike,
  activityId: string,
  updates: Partial<RepositionActivity>
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/reposition-activities/${activityId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );

  return parseJson<{ activity: RepositionActivity }>(response);
}

export async function cancelRepositionActivityRequest(
  firebaseUser: FirebaseUserLike,
  activityId: string
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/reposition-activities/${activityId}`,
    {
      method: "DELETE",
    }
  );

  return parseJson<{ activity: RepositionActivity }>(response);
}

export async function finalizeRepositionActivityRequest(
  firebaseUser: FirebaseUserLike,
  activityId: string,
  resolution: "trust_receipt" | "trust_dispatch"
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/reposition-activities/${activityId}/finalize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution }),
    }
  );

  return parseJson<{ ok: true }>(response);
}

export async function reopenRepositionDispatchRequest(
  firebaseUser: FirebaseUserLike,
  activityId: string
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/reposition-activities/${activityId}/reopen-dispatch`,
    {
      method: "POST",
    }
  );

  return parseJson<{ ok: true }>(response);
}

export async function reopenRepositionAuditRequest(
  firebaseUser: FirebaseUserLike,
  activityId: string
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/reposition-activities/${activityId}/reopen-audit`,
    {
      method: "POST",
    }
  );

  return parseJson<{ ok: true }>(response);
}

export async function revertRepositionActivityRequest(
  firebaseUser: FirebaseUserLike,
  activityId: string
) {
  const response = await authedFetch(
    firebaseUser,
    `/api/stock/reposition-activities/${activityId}/revert`,
    {
      method: "POST",
    }
  );

  return parseJson<{ ok: true }>(response);
}
