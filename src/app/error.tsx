"use client";

import React, { useEffect, useState } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { useClientErrorReporter } from "@/hooks/use-client-error-reporter";
import { generateEventId } from "@/lib/observability/ids";

export default function AppErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [eventId] = useState(generateEventId);
  const reportClientError = useClientErrorReporter();

  useEffect(() => {
    reportClientError({
      error,
      eventId,
      source: "render",
      operation: "app-error-boundary",
      routeOrJob: window.location.pathname,
    });
  }, [error, eventId, reportClientError]);

  return (
    <PageContainer variant="compact" className="py-16">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 text-slate-900 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-pink-600">Falha inesperada</p>
        <h1 className="mt-2 text-2xl font-bold">Não foi possível carregar esta área.</h1>
        <p className="mt-3 text-slate-600">Tente novamente. Se o problema continuar, informe a referência abaixo ao suporte.</p>
        <p className="mt-4 font-mono text-sm text-slate-500">Referência: {eventId}</p>
        <button type="button" onClick={reset} className="mt-6 rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white">
          Tentar novamente
        </button>
      </section>
    </PageContainer>
  );
}
