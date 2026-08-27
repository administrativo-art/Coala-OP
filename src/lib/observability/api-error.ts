import { NextResponse, type NextRequest } from "next/server";

import { isAppError } from "./app-error";
import { resolveCorrelationId, resolveRequestId } from "./ids";
import { reportSystemError, type ReportSystemErrorInput } from "./reporter";

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    eventId?: string;
    requestId: string;
    correlationId?: string;
  };
};

type ApiErrorContext = Pick<ReportSystemErrorInput, "source" | "operation" | "routeOrJob" | "sink">;

export function toErrorResponse(error: unknown, requestId: string, correlationId: string | undefined, context: ApiErrorContext) {
  const responseHeaders: Record<string, string> = {
    "Cache-Control": "no-store",
    "x-request-id": requestId,
  };
  if (correlationId) responseHeaders["x-correlation-id"] = correlationId;
  if (isAppError(error)) {
    const reference = error.reportable
      ? reportSystemError({ error, ...context, requestId, correlationId })
      : undefined;
    return NextResponse.json<ApiErrorEnvelope>({
      error: {
        code: error.code,
        message: error.safeMessage,
        eventId: reference?.eventId,
        requestId,
        correlationId,
      },
    }, {
      status: error.httpStatus,
      headers: responseHeaders,
    });
  }

  const reference = reportSystemError({ error, ...context, requestId, correlationId });
  return NextResponse.json<ApiErrorEnvelope>({
    error: {
      code: "UNEXPECTED_ERROR",
      message: "Ocorreu uma falha inesperada. Tente novamente.",
      eventId: reference.eventId,
      requestId,
      correlationId,
    },
  }, {
    status: 500,
    headers: responseHeaders,
  });
}

export type ApiObservationContext = {
  requestId: string;
  correlationId?: string;
};

type ObservedRouteHandler<Context> = (
  request: NextRequest,
  context: Context,
  observation: ApiObservationContext,
) => Response | Promise<Response>;

type EmptyRouteContext = { params: Promise<Record<string, never>> };

export function withApiErrorHandling<Context = EmptyRouteContext>(context: ApiErrorContext, handler: ObservedRouteHandler<Context>) {
  return async (request: NextRequest, routeContext: Context) => {
    const requestId = resolveRequestId(request);
    const correlationId = resolveCorrelationId(request);
    try {
      const response = await handler(request, routeContext, { requestId, correlationId });
      response.headers.set("x-request-id", requestId);
      if (correlationId) response.headers.set("x-correlation-id", correlationId);
      return response;
    } catch (error) {
      return toErrorResponse(error, requestId, correlationId, context);
    }
  };
}
