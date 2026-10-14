import type { User as FirebaseUser } from "firebase/auth";

import type { CollaboratorRequest, CollaboratorRequestSignature } from "@/features/hr/requests/types";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

function token(firebaseUser: FirebaseUser) {
  return () => firebaseUser.getIdToken();
}

export async function fetchCollaboratorRequests(firebaseUser: FirebaseUser, scope: "own" | "team") {
  return authenticatedApiRequest<{ requests: CollaboratorRequest[] }>(
    `/api/collaborator/requests${scope === "team" ? "?scope=team" : ""}`,
    { getIdToken: token(firebaseUser), fallbackError: "Falha ao carregar solicitações." },
  );
}

export async function createCollaboratorRequest(firebaseUser: FirebaseUser, input: {
  action: "activate" | "change" | "suspend" | "reactivate";
  details: string;
}) {
  return authenticatedApiRequest<{ request: CollaboratorRequest }>("/api/collaborator/requests", {
    method: "POST",
    getIdToken: token(firebaseUser),
    json: input,
    fallbackError: "Falha ao enviar solicitação.",
  });
}

export async function updateCollaboratorRequest(
  firebaseUser: FirebaseUser,
  requestId: string,
  input: Record<string, unknown>,
) {
  return authenticatedApiRequest<{ ok?: true; request?: CollaboratorRequest; warnings?: string[]; generatedDocumentId?: string }>(
    `/api/collaborator/requests/${encodeURIComponent(requestId)}`,
    {
      method: "PATCH",
      getIdToken: token(firebaseUser),
      json: input,
      fallbackError: "Falha ao atualizar solicitação.",
    },
  );
}

export async function fetchCollaboratorRequestSignature(firebaseUser: FirebaseUser, requestId: string) {
  return authenticatedApiRequest<{ signature: CollaboratorRequestSignature }>(
    `/api/collaborator/requests/${encodeURIComponent(requestId)}/signature`,
    { getIdToken: token(firebaseUser), fallbackError: "Falha ao carregar a assinatura." },
  );
}

export async function sendCollaboratorRequestForSignature(firebaseUser: FirebaseUser, requestId: string) {
  return authenticatedApiRequest<{ signature: CollaboratorRequestSignature }>(
    `/api/collaborator/requests/${encodeURIComponent(requestId)}/signature`,
    {
      method: "POST",
      getIdToken: token(firebaseUser),
      fallbackError: "Falha ao disponibilizar a assinatura.",
    },
  );
}

export async function openCollaboratorRequestDocument(firebaseUser: FirebaseUser, requestId: string) {
  const blob = await authenticatedApiRequest<Blob>(
    `/api/collaborator/requests/${encodeURIComponent(requestId)}/document?format=pdf`,
    {
      getIdToken: token(firebaseUser),
      responseType: "blob",
      fallbackError: "Falha ao abrir o termo.",
    },
  );
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
