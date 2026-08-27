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
  };
};

type ApiErrorContext = Pick<ReportSystemErrorInput, "source" | "operation" | "routeOrJob" | "sink">;

export function toErrorResponse(error: unknown, requestId: string, correlationId: string | undefined, context: ApiErrorContext) {
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
      },
    }, {
      status: error.httpStatus,
      headers: { "Cache-Control": "no-store", "x-request-id": requestId },
    });
  }

  const reference = reportSystemError({ error, ...context, requestId, correlationId });
  return NextResponse.json<ApiErrorEnvelope>({
    error: {
      code: "UNEXPECTED_ERROR",
      message: "Ocorreu uma falha inesperada. Tente novamente.",
      eventId: reference.eventId,
      requestId,
    },
  }, {
    status: 500,
    headers: { "Cache-Control": "no-store", "x-request-id": requestId },
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
      return response;
    } catch (error) {
      return toErrorResponse(error, requestId, correlationId, context);
    }
  };
}
