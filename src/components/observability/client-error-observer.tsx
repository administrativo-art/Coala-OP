"use client";

import { useEffect } from "react";

import { useClientErrorReporter } from "@/hooks/use-client-error-reporter";

export function ClientErrorObserver() {
  const reportClientError = useClientErrorReporter();

  useEffect(() => {
    const send = (error: unknown, source: "unhandled-rejection" | "background", operation: string) => {
      reportClientError({
        error,
        source,
        operation,
        routeOrJob: window.location.pathname,
      });
    };

    const onError = (event: ErrorEvent) => {
      send(event.error ?? new Error(event.message || "Falha não tratada no navegador."), "background", "window-error");
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      send(event.reason, "unhandled-rejection", "unhandled-rejection");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [reportClientError]);

  return null;
}
