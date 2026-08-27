"use client";

import { generateEventId } from "./ids";
import { sanitizeError } from "./sanitize";

export type ClientErrorSource = "render" | "unhandled-rejection" | "background";

export type ClientErrorPayload = {
  eventId: string;
  source: ClientErrorSource;
  operation: string;
  routeOrJob: string;
  errorName: string;
  messageSanitized: string;
  stackSanitized?: string;
};

const reportedErrors = new WeakSet<object>();

export function isIgnoredClientError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  const value = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error ?? "");
  return /ResizeObserver loop|chrome-extension:\/\/|moz-extension:\/\//i.test(value);
}

export function buildClientErrorPayload(options: {
  error: unknown;
  source: ClientErrorSource;
  operation: string;
  routeOrJob: string;
  eventId?: string;
}): ClientErrorPayload | null {
  if (isIgnoredClientError(options.error)) return null;
  if (options.error && typeof options.error === "object") {
    if (reportedErrors.has(options.error)) return null;
    reportedErrors.add(options.error);
  }
  const sanitized = sanitizeError(options.error);
  const routeOrJob = sanitizeError(options.routeOrJob.split(/[?#]/)[0] || "unknown").message.slice(0, 300);
  return {
    eventId: options.eventId ?? generateEventId(),
    source: options.source,
    operation: sanitizeError(options.operation).message.slice(0, 160),
    routeOrJob,
    errorName: sanitized.name,
    messageSanitized: sanitized.message,
    stackSanitized: sanitized.stack,
  };
}
