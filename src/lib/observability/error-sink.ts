import type { SystemErrorEvent } from "./system-error-event";

export interface ErrorSink {
  write(event: SystemErrorEvent): void | Promise<void>;
}

type ConsoleLike = Pick<Console, "error" | "log">;
type RuntimeEnvironment = Record<string, string | undefined>;

const REPORTED_ERROR_EVENT_TYPE =
  "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent";

const CLOUD_SEVERITY = {
  low: "INFO",
  medium: "WARNING",
  high: "ERROR",
  critical: "CRITICAL",
} as const;

export class StructuredConsoleSink implements ErrorSink {
  constructor(
    private readonly output: ConsoleLike = console,
    private readonly runtimeEnvironment: RuntimeEnvironment = process.env,
  ) {}

  write(event: SystemErrorEvent) {
    const service =
      this.runtimeEnvironment.K_SERVICE?.trim()
      || this.runtimeEnvironment.FUNCTION_TARGET?.trim()
      || event.source;
    const message = event.stackSanitized?.trim()
      || `${event.errorName}: ${event.messageSanitized}`;
    const payload = JSON.stringify({
      "@type": REPORTED_ERROR_EVENT_TYPE,
      ...event,
      coalaSeverity: event.severity,
      severity: CLOUD_SEVERITY[event.severity],
      eventTime: event.occurredAt,
      message,
      serviceContext: {
        service,
        version: event.release,
      },
      "logging.googleapis.com/labels": {
        errorCode: event.errorCode,
        fingerprint: event.fingerprint,
        release: event.release,
      },
    });
    if (event.severity === "high" || event.severity === "critical") this.output.error(payload);
    else this.output.log(payload);
  }
}

export const defaultErrorSink = new StructuredConsoleSink();
