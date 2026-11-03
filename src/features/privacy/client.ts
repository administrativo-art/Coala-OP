"use client";

import type { User as FirebaseUser } from "firebase/auth";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import type { PersonInventoryCatalog, PersonInventoryPage, PrivacyRequest, SecurityIncident } from "./types";
import type { SubjectRef } from "./person-subject";

export function fetchPersonInventory(firebaseUser: FirebaseUser, ref: SubjectRef, signal: AbortSignal) {
  const query = new URLSearchParams(ref);
  return authenticatedApiRequest<PersonInventoryCatalog>(`/api/privacy/person-inventory?${query}`, { signal, getIdToken: () => firebaseUser.getIdToken(), fallbackError: "Não foi possível consultar o cadastro ou seu escopo de acesso." });
}

export function fetchPersonInventorySource(firebaseUser: FirebaseUser, ref: SubjectRef, source: string, signal: AbortSignal, cursor?: string) {
  const query = new URLSearchParams({ ...ref, source, limit: "25", ...(cursor ? { cursor } : {}) });
  return authenticatedApiRequest<PersonInventoryPage>(`/api/privacy/person-inventory?${query}`, { signal, getIdToken: () => firebaseUser.getIdToken(), fallbackError: "Falha ao consultar esta origem." });
}

export async function fetchPrivacyRequests(firebaseUser: FirebaseUser) {
  return authenticatedApiRequest<{ requests: PrivacyRequest[] }>("/api/privacy/requests", { getIdToken: () => firebaseUser.getIdToken(), fallbackError: "Falha ao carregar pedidos LGPD." });
}

export async function createPrivacyRequest(firebaseUser: FirebaseUser, input: Record<string, unknown>) {
  return authenticatedApiRequest<{ request: PrivacyRequest }>("/api/privacy/requests", { method: "POST", getIdToken: () => firebaseUser.getIdToken(), json: input, fallbackError: "Falha ao registrar pedido LGPD." });
}

export async function updatePrivacyRequest(firebaseUser: FirebaseUser, id: string, input: Record<string, unknown>) {
  return authenticatedApiRequest<{ request: PrivacyRequest }>(`/api/privacy/requests/${id}`, { method: "PATCH", getIdToken: () => firebaseUser.getIdToken(), json: input, fallbackError: "Falha ao atualizar pedido LGPD." });
}

export async function fetchSecurityIncidents(firebaseUser: FirebaseUser) {
  return authenticatedApiRequest<{ incidents: SecurityIncident[] }>("/api/privacy/incidents", { getIdToken: () => firebaseUser.getIdToken(), fallbackError: "Falha ao carregar incidentes." });
}

export async function createSecurityIncident(firebaseUser: FirebaseUser, input: Record<string, unknown>) {
  return authenticatedApiRequest<{ incident: SecurityIncident }>("/api/privacy/incidents", { method: "POST", getIdToken: () => firebaseUser.getIdToken(), json: input, fallbackError: "Falha ao registrar incidente." });
}

export async function updateSecurityIncident(firebaseUser: FirebaseUser, id: string, input: Record<string, unknown>) {
  return authenticatedApiRequest<{ incident: SecurityIncident }>(`/api/privacy/incidents/${id}`, { method: "PATCH", getIdToken: () => firebaseUser.getIdToken(), json: input, fallbackError: "Falha ao atualizar incidente." });
}
