"use client";

import type { User as FirebaseUser } from "firebase/auth";

import type { PrivacyRequest, SecurityIncident } from "./types";

async function authHeaders(firebaseUser: FirebaseUser) {
  const token = await firebaseUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function fetchPrivacyRequests(firebaseUser: FirebaseUser) {
  const response = await fetch("/api/privacy/requests", {
    headers: await authHeaders(firebaseUser),
  });
  if (!response.ok) throw new Error("Falha ao carregar pedidos LGPD.");
  return response.json() as Promise<{ requests: PrivacyRequest[] }>;
}

export async function createPrivacyRequest(firebaseUser: FirebaseUser, input: Record<string, unknown>) {
  const response = await fetch("/api/privacy/requests", {
    method: "POST",
    headers: await authHeaders(firebaseUser),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Falha ao registrar pedido LGPD.");
  }
  return response.json() as Promise<{ request: PrivacyRequest }>;
}

export async function updatePrivacyRequest(firebaseUser: FirebaseUser, id: string, input: Record<string, unknown>) {
  const response = await fetch(`/api/privacy/requests/${id}`, {
    method: "PATCH",
    headers: await authHeaders(firebaseUser),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Falha ao atualizar pedido LGPD.");
  }
  return response.json() as Promise<{ request: PrivacyRequest }>;
}

export async function fetchSecurityIncidents(firebaseUser: FirebaseUser) {
  const response = await fetch("/api/privacy/incidents", {
    headers: await authHeaders(firebaseUser),
  });
  if (!response.ok) throw new Error("Falha ao carregar incidentes.");
  return response.json() as Promise<{ incidents: SecurityIncident[] }>;
}

export async function createSecurityIncident(firebaseUser: FirebaseUser, input: Record<string, unknown>) {
  const response = await fetch("/api/privacy/incidents", {
    method: "POST",
    headers: await authHeaders(firebaseUser),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Falha ao registrar incidente.");
  }
  return response.json() as Promise<{ incident: SecurityIncident }>;
}

export async function updateSecurityIncident(firebaseUser: FirebaseUser, id: string, input: Record<string, unknown>) {
  const response = await fetch(`/api/privacy/incidents/${id}`, {
    method: "PATCH",
    headers: await authHeaders(firebaseUser),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Falha ao atualizar incidente.");
  }
  return response.json() as Promise<{ incident: SecurityIncident }>;
}

