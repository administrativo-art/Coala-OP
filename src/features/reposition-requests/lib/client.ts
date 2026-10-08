"use client";

import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { type RepositionRequest } from "@/types";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

type RepositionRequestCreateInput = Pick<
  RepositionRequest,
  "kioskId" | "items" | "notes"
>;

export async function fetchRepositionRequests(firebaseUser: FirebaseUserLike) {
  return authenticatedApiRequest<{ requests: RepositionRequest[] }>(
    "/api/stock/reposition-requests",
    {
      getIdToken: () => firebaseUser.getIdToken(),
      fallbackError: "Falha ao carregar as solicitações de reposição.",
    }
  );
}

export async function createRepositionRequest(
  firebaseUser: FirebaseUserLike,
  input: RepositionRequestCreateInput
) {
  return authenticatedApiRequest<{ request: RepositionRequest }>(
    "/api/stock/reposition-requests",
    {
      method: "POST",
      getIdToken: () => firebaseUser.getIdToken(),
      json: input,
      fallbackError: "Falha ao criar a solicitação de reposição.",
    }
  );
}

export async function updateRepositionRequestRequest(
  firebaseUser: FirebaseUserLike,
  requestId: string,
  updates: { status: "Cancelada" }
) {
  return authenticatedApiRequest<{ request: RepositionRequest }>(
    `/api/stock/reposition-requests/${requestId}`,
    {
      method: "PATCH",
      getIdToken: () => firebaseUser.getIdToken(),
      json: updates,
      fallbackError: "Falha ao cancelar a solicitação de reposição.",
    }
  );
}
