"use client";

import { generateEventId } from "./ids";
import { reportSystemError } from "./reporter";
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
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error ?? "");
  return /ResizeObserver loop|chrome-extension:\/\/|moz-extension:\/\//i.test(text);
}

export function buildClientErrorPayload(options: {
  error: unknown;
  source: ClientErrorSource;
  operation: string;
  routeOrJob: string;
  eventId?: string;
  emitLocal?: boolean;
}): ClientErrorPayload | null {
  if (isIgnoredClientError(options.error)) return null;
  if (options.error && typeof options.error === "object") {
    if (reportedErrors.has(options.error)) return null;
    reportedErrors.add(options.error);
  }
  const sanitized = sanitizeError(options.error);
  const eventId = options.eventId ?? generateEventId();
  const routeOrJob = options.routeOrJob.split(/[?#]/)[0].slice(0, 300);
  if (options.emitLocal !== false) {
    reportSystemError({
      error: options.error,
      eventId,
      code: options.source === "render" ? "CLIENT_RENDER_FAILED" : "CLIENT_UNEXPECTED_ERROR",
      kind: "UNEXPECTED_APPLICATION",
      severity: options.source === "background" ? "medium" : "high",
      source: `browser-${options.source}`,
      operation: options.operation,
      routeOrJob,
      isTerminal: options.source !== "background",
    });
  }
  return {
    eventId,
    source: options.source,
    operation: options.operation.slice(0, 160),
    routeOrJob,
    errorName: sanitized.name,
    messageSanitized: sanitized.message,
    stackSanitized: sanitized.stack,
  };
}
