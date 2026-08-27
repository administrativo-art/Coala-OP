"use client";

import React, { useEffect, useState } from "react";

import { buildClientErrorPayload } from "@/lib/observability/client";
import { generateEventId } from "@/lib/observability/ids";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [eventId] = useState(generateEventId);

  useEffect(() => {
    buildClientErrorPayload({
      error,
      eventId,
      source: "render",
      operation: "global-error-boundary",
      routeOrJob: typeof window === "undefined" ? "unknown" : window.location.pathname,
    });
  }, [error, eventId]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, background: "#f8fafc", color: "#0f172a", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px" }}>
          <section style={{ border: "1px solid #e2e8f0", borderRadius: 20, background: "white", padding: 32 }}>
            <p style={{ color: "#db2777", fontWeight: 700 }}>FALHA INESPERADA</p>
            <h1>O Coala One não conseguiu continuar.</h1>
            <p>Tente novamente. Se o problema continuar, informe a referência abaixo ao suporte.</p>
            <p style={{ fontFamily: "monospace", color: "#64748b" }}>Referência: {eventId}</p>
            <button type="button" onClick={reset} style={{ border: 0, borderRadius: 12, background: "#020617", color: "white", padding: "12px 20px", fontWeight: 700 }}>
              Tentar novamente
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
