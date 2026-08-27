import { reportSystemError, type SystemErrorReference } from "./reporter";
import type { ErrorSink } from "./error-sink";
import type { ErrorKind, ErrorSeverity } from "./taxonomy";

export type JobObservation = {
  source: string;
  operation: string;
  routeOrJob: string;
  requestId?: string;
  correlationId?: string;
  result: "success" | "failed";
  durationMs: number;
  retryAttempt: number;
  isTerminal: boolean;
  event?: SystemErrorReference;
};

export type ObservedJobOptions = {
  source: string;
  operation: string;
  routeOrJob: string;
  requestId?: string;
  correlationId?: string;
  retryAttempt?: number;
  isTerminal?: boolean;
  errorCode?: string;
  errorKind?: ErrorKind;
  severity?: ErrorSeverity;
  metadata?: Record<string, unknown>;
  sink?: ErrorSink;
  onObservation?: (observation: JobObservation) => void | Promise<void>;
  now?: () => number;
};

export async function runObservedJob<T>(options: ObservedJobOptions, operation: () => Promise<T>): Promise<T> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const retryAttempt = options.retryAttempt ?? 0;
  const isTerminal = options.isTerminal ?? true;
  try {
    const result = await operation();
    try {
      await options.onObservation?.({
        source: options.source,
        operation: options.operation,
        routeOrJob: options.routeOrJob,
        requestId: options.requestId,
        correlationId: options.correlationId,
        result: "success",
        durationMs: Math.max(0, now() - startedAt),
        retryAttempt,
        isTerminal,
      });
    } catch {
      // Observação operacional também é best-effort.
    }
    return result;
  } catch (error) {
    const durationMs = Math.max(0, now() - startedAt);
    const event = isTerminal
      ? reportSystemError({
        error,
        source: options.source,
        operation: options.operation,
        routeOrJob: options.routeOrJob,
        requestId: options.requestId,
        correlationId: options.correlationId,
        code: options.errorCode,
        kind: options.errorKind,
        severity: options.severity,
        retryAttempt,
        isTerminal,
        metadata: { ...options.metadata, durationMs, retryAttempt, isTerminal },
        sink: options.sink,
      })
      : undefined;
    try {
      await options.onObservation?.({
        source: options.source,
        operation: options.operation,
        routeOrJob: options.routeOrJob,
        requestId: options.requestId,
        correlationId: options.correlationId,
        result: "failed",
        durationMs,
        retryAttempt,
        isTerminal,
        event,
      });
    } catch {
      // Observação operacional também é best-effort.
    }
    throw error;
  }
}

export function writeStructuredJobObservation(observation: JobObservation) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    eventType: "job_observation",
    severity: observation.result === "failed" && observation.isTerminal ? "ERROR" : "INFO",
    ...observation,
  })}\n`);
}
