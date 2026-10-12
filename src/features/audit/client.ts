"use client";

import type { User as FirebaseUser } from "firebase/auth";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import type { AuditLogEntry, AuditLogInput } from "./types";

export async function createAuditLog(firebaseUser: FirebaseUser, input: AuditLogInput) {
  return authenticatedApiRequest<{ ok: true }>("/api/audit/log", { method: "POST", getIdToken: () => firebaseUser.getIdToken(), json: input, fallbackError: "Falha ao registrar auditoria." });
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

  return authenticatedApiRequest<{ logs: AuditLogEntry[] }>(`/api/audit/logs?${search.toString()}`, { getIdToken: () => firebaseUser.getIdToken(), fallbackError: "Falha ao carregar auditoria." });
}
