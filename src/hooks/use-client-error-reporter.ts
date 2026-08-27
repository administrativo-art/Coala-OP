"use client";

import { useCallback } from "react";

import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import {
  buildClientErrorPayload,
  type ClientErrorPayload,
  type ClientErrorSource,
} from "@/lib/observability/client";

type ClientErrorApi = (
  input: RequestInfo | URL,
  init: { method: "POST"; json: ClientErrorPayload },
) => Promise<unknown>;

export type ClientErrorReportInput = {
  error: unknown;
  eventId?: string;
  source: ClientErrorSource;
  operation: string;
  routeOrJob: string;
};

export function dispatchClientErrorReport(api: ClientErrorApi, input: ClientErrorReportInput) {
  const payload = buildClientErrorPayload(input);
  if (!payload) return null;
  void api("/api/observability/client-errors", { method: "POST", json: payload }).catch(() => undefined);
  return payload;
}

export function useClientErrorReporter() {
  const api = useAuthenticatedApi();
  return useCallback((input: ClientErrorReportInput) => dispatchClientErrorReport(api, input), [api]);
}
