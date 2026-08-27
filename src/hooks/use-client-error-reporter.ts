"use client";

import { useCallback, useContext } from "react";

import { AuthContext } from "@/components/auth-provider";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import {
  buildClientErrorPayload,
  type ClientErrorPayload,
  type ClientErrorSource,
} from "@/lib/observability/client";
import { createInMemoryRateLimiter, type RateLimitResult } from "@/lib/observability/rate-limit";

export type ClientErrorReportInput = {
  error: unknown;
  eventId?: string;
  source: ClientErrorSource;
  operation: string;
  routeOrJob: string;
};

type ClientErrorReporterDependencies = {
  fetcher?: typeof fetchWithTimeout;
  getToken?: () => Promise<string | null | undefined>;
  rateLimiter?: { check(key: string, now?: number): RateLimitResult };
  now?: () => number;
};

const localLimiter = createInMemoryRateLimiter({ limit: 10, windowMs: 60_000, maxKeys: 1 });

async function currentFirebaseToken() {
  const { auth } = await import("@/lib/firebase");
  return auth.currentUser?.getIdToken() ?? null;
}

async function sendClientErrorPayload(
  payload: ClientErrorPayload,
  dependencies: ClientErrorReporterDependencies,
) {
  const now = dependencies.now?.() ?? Date.now();
  const rate = (dependencies.rateLimiter ?? localLimiter).check("browser", now);
  if (!rate.allowed) return;
  const token = await (dependencies.getToken ?? currentFirebaseToken)();
  if (!token) return;
  await (dependencies.fetcher ?? fetchWithTimeout)("/api/observability/client-errors", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    keepalive: true,
  }, 5_000);
}

export function dispatchClientErrorReport(
  input: ClientErrorReportInput,
  dependencies: ClientErrorReporterDependencies = {},
) {
  const payload = buildClientErrorPayload(input);
  if (!payload) return null;
  void sendClientErrorPayload(payload, dependencies).catch(() => undefined);
  return payload;
}

export function useClientErrorReporter() {
  const auth = useContext(AuthContext);
  const firebaseUser = auth?.firebaseUser ?? null;
  return useCallback((input: ClientErrorReportInput) => dispatchClientErrorReport(input, {
    getToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null),
  }), [firebaseUser]);
}
