import { AppError, isAppError } from "./app-error";
import { defaultErrorSink, type ErrorSink } from "./error-sink";
import { createErrorFingerprint } from "./fingerprint";
import { generateEventId, normalizeOpaqueId } from "./ids";
import { resolveRuntimeEnvironment, resolveRuntimeRelease } from "./release";
import { sanitizeError, sanitizeMetadata } from "./sanitize";
import {
  SYSTEM_ERROR_EVENT_SCHEMA_VERSION,
  SystemErrorEventSchema,
  type SystemErrorEvent,
} from "./system-error-event";
import { ERROR_KIND_DEFAULTS, type ErrorKind, type ErrorSeverity } from "./taxonomy";

export type ReportSystemErrorInput = {
  error: unknown;
  eventId?: string;
  source: string;
  operation?: string;
  routeOrJob?: string;
  requestId?: string;
  correlationId?: string;
  code?: string;
  kind?: ErrorKind;
  severity?: ErrorSeverity;
  metadata?: Record<string, unknown>;
  retryAttempt?: number;
  isTerminal?: boolean;
  sink?: ErrorSink;
  now?: () => Date;
  environment?: string;
  release?: string;
  fingerprintFactory?: typeof createErrorFingerprint;
  eventIdFactory?: typeof generateEventId;
};

export type SystemErrorReference = Pick<SystemErrorEvent, "eventId" | "fingerprint" | "requestId" | "correlationId">;

const capturedErrors = new WeakMap<object, SystemErrorReference>();

function safeText(value: string | undefined, fallback: string, limit: number) {
  const normalized = value?.trim();
  return sanitizeError(normalized || fallback).message.slice(0, limit);
}

function safeRoute(value: string | undefined, fallback: string, limit: number) {
  return safeText(value?.split(/[?#]/)[0], fallback, limit);
}

function normalizeError(input: ReportSystemErrorInput) {
  const appError = isAppError(input.error) ? input.error : null;
  const kind = input.kind ?? appError?.kind ?? "UNEXPECTED_APPLICATION";
  const defaults = ERROR_KIND_DEFAULTS[kind];
  let metadata: Record<string, unknown> = {};
  try {
    metadata = Object.assign({}, appError?.metadata ?? {}, input.metadata ?? {});
  } catch {
    metadata = {};
  }
  return {
    appError,
    code: input.code ?? appError?.code ?? "UNEXPECTED_ERROR",
    kind,
    severity: input.severity ?? appError?.severity ?? defaults.severity,
    metadata,
  };
}

function writeWithoutAffectingCaller(sink: ErrorSink, event: SystemErrorEvent) {
  try {
    void Promise.resolve(sink.write(event)).catch(() => undefined);
  } catch {
    // O sink é deliberadamente best-effort e nunca substitui a falha original.
  }
}

export function reportSystemError(input: ReportSystemErrorInput): SystemErrorReference {
  const identity = input.error && (typeof input.error === "object" || typeof input.error === "function")
    ? input.error as object
    : null;
  const previous = identity ? capturedErrors.get(identity) : undefined;
  if (previous) return previous;

  try {
    const normalized = normalizeError(input);
    const sanitized = sanitizeError(normalized.appError?.cause ?? input.error);
    const requestId = normalizeOpaqueId(input.requestId);
    const correlationId = normalizeOpaqueId(input.correlationId);
    const fingerprint = (input.fingerprintFactory ?? createErrorFingerprint)({
      errorCode: normalized.code,
      source: input.source,
      routeOrJob: input.routeOrJob,
      operation: input.operation,
      errorName: sanitized.name,
      stack: sanitized.stack,
    });
    const event = SystemErrorEventSchema.parse({
      schemaVersion: SYSTEM_ERROR_EVENT_SCHEMA_VERSION,
      eventId: input.eventId ?? (input.eventIdFactory ?? generateEventId)(),
      occurredAt: (input.now ?? (() => new Date()))().toISOString(),
      errorCode: normalized.code,
      errorKind: normalized.kind,
      severity: normalized.severity,
      source: safeText(input.source, "application", 120),
      operation: input.operation ? safeText(input.operation, "operation", 160) : undefined,
      routeOrJob: input.routeOrJob ? safeRoute(input.routeOrJob, "route", 300) : undefined,
      requestId,
      correlationId,
      environment: safeText(input.environment ?? resolveRuntimeEnvironment(), "unknown", 80),
      release: safeText(input.release ?? resolveRuntimeRelease(), "unknown", 200),
      fingerprint,
      errorName: sanitized.name,
      messageSanitized: sanitized.message,
      stackSanitized: sanitized.stack,
      metadataSanitized: sanitizeMetadata(normalized.metadata),
      retryAttempt: Number.isInteger(input.retryAttempt) && (input.retryAttempt ?? -1) >= 0
        ? input.retryAttempt
        : undefined,
      isTerminal: input.isTerminal ?? true,
    });
    const reference = {
      eventId: event.eventId,
      fingerprint: event.fingerprint,
      requestId: event.requestId,
      correlationId: event.correlationId,
    };
    if (identity) capturedErrors.set(identity, reference);
    writeWithoutAffectingCaller(input.sink ?? defaultErrorSink, event);
    return reference;
  } catch {
    // Até uma falha de normalização precisa preservar a operação original.
    return {
      eventId: generateEventId(),
      fingerprint: createErrorFingerprint({
        errorCode: "OBSERVABILITY_FALLBACK",
        source: "observability",
        operation: "reportSystemError",
      }),
      requestId: normalizeOpaqueId(input.requestId),
      correlationId: normalizeOpaqueId(input.correlationId),
    };
  }
}

export function unexpectedError(options: Omit<ConstructorParameters<typeof AppError>[0], "kind">) {
  return new AppError({ ...options, kind: "UNEXPECTED_APPLICATION" });
}
