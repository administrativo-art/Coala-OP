"use client";

import { useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import type { DocumentPublication } from "@/lib/hr/employee-document-publication";

/**
 * Publicar na pasta do colaborador (macro 02) ou retirar dela, sem copiar o arquivo. O servidor confere o DP autorizado
 * e a política do tipo (restrito, não identificado ou assinatura pendente não publicam); retirar pede motivo.
 */
export function PublicationControl({ firebaseUser, documentId, publication, onChanged }: {
  firebaseUser: FirebaseUser | null; documentId: string; publication?: DocumentPublication | null; onChanged: () => void;
}) {
  const [mode, setMode] = useState<"publish" | "withdraw" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const published = publication?.status === "published";

  async function submit(action: "publish" | "withdraw") {
    setBusy(true);
    setError(null);
    try {
      await authenticatedApiRequest("/api/hr/employee-documents/publication", { method: "POST", json: { id: documentId, action, ...(action === "withdraw" ? { reason } : {}) },
        getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null), fallbackError: "Não foi possível alterar a publicação." });
      setMode(null);
      setReason("");
      onChanged();
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível alterar a publicação."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill variant={published ? "ok" : "neutral"}>{published ? "Na pasta do colaborador" : publication?.status === "withdrawn" ? "Retirado da pasta" : "Só no DP"}</StatusPill>
      {!mode ? (published
        ? <Button variant="ds-ghost" size="sm" onClick={() => setMode("withdraw")}>Retirar</Button>
        : <Button variant="ds-secondary" size="sm" onClick={() => setMode("publish")}>Publicar</Button>) : null}
      {mode === "publish" ? <InlineConfirm message="Publicar na pasta do colaborador? Ele passa a ver e baixar este documento." confirmLabel="Publicar" loadingLabel="Publicando…"
        loading={busy} onConfirm={() => void submit("publish")} onCancel={() => setMode(null)} /> : null}
      {mode === "withdraw" ? (
        <div className="w-full space-y-2">
          <textarea rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Motivo da retirada"
            className="w-full rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-ink" placeholder="Motivo da retirada (mínimo de 10 caracteres)" />
          <div className="flex gap-2">
            <Button variant="ds-secondary" size="sm" loading={busy} loadingLabel="Retirando…" disabled={reason.trim().length < 10} onClick={() => void submit("withdraw")}>Retirar da pasta</Button>
            <Button variant="ds-ghost" size="sm" disabled={busy} onClick={() => setMode(null)}>Cancelar</Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="w-full text-xs font-semibold text-ds-danger">{error}</p> : null}
    </div>
  );
}
