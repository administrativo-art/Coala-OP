"use client";

import type { User as FirebaseUser } from "firebase/auth";

import type { AuditLogEntry, AuditLogInput } from "./types";

async function authHeaders(firebaseUser: FirebaseUser) {
  const token = await firebaseUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function createAuditLog(firebaseUser: FirebaseUser, input: AuditLogInput) {
  const response = await fetch("/api/audit/log", {
    method: "POST",
    headers: await authHeaders(firebaseUser),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Falha ao registrar auditoria.");
  }

  return response.json() as Promise<{ ok: true }>;
}

export async function fetchAuditLogs(
  firebaseUser: FirebaseUser,
  params: {
    module?: string;
    action?: string;
    userId?: string;
    search?: string;
    limit?: number;
  } = {}
) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      search.set(key, String(value));
    }
  });

  const response = await fetch(`/api/audit/logs?${search.toString()}`, {
    headers: await authHeaders(firebaseUser),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Falha ao carregar auditoria.");
  }

  return response.json() as Promise<{ logs: AuditLogEntry[] }>;
}

