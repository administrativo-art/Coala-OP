"use client";

import { useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { EMPLOYEE_DOCUMENT_TYPE_CATALOG } from "@/lib/hr/employee-document-options";

const TYPES = EMPLOYEE_DOCUMENT_TYPE_CATALOG.filter((type) => type.code !== "UNKNOWN_DOCUMENT");

export function LegacyDocumentClassification({ firebaseUser, documentId, onChanged }: {
  firebaseUser: FirebaseUser | null; documentId: string; onChanged: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function classify() {
    if (!code) return;
    setBusy(true); setError(null);
    try {
      await authenticatedApiRequest("/api/hr/employee-documents/classification", {
        method: "POST", json: { id: documentId, documentTypeCode: code },
        getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null), fallbackError: "Não foi possível classificar o documento.",
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível classificar o documento.");
    } finally { setBusy(false); }
  }
  return <div className="w-full rounded-ds-card border border-ds-alert-border bg-ds-warn-bg p-3">
    <p className="text-xs font-black text-ds-warn">Documento antigo sem classificação</p>
    <p className="mt-1 text-xs text-ds-warn">Escolha o tipo antes de decidir se ele será publicado.</p>
    <div className="mt-2 flex flex-col gap-2 sm:flex-row"><span className="relative min-w-0 flex-1">
      <select value={code} onChange={(event) => setCode(event.target.value)} aria-label="Tipo do documento antigo"
        className="h-10 w-full appearance-none rounded-ds-btn border border-ds-border bg-ds-surface px-3 pr-11 text-sm text-ds-ink">
        <option value="">Selecione o tipo…</option>{TYPES.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}
      </select><ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-ds-muted" /></span>
      <Button variant="ds-secondary" disabled={!code || busy} loading={busy} loadingLabel="Classificando…" onClick={() => void classify()}>Classificar documento</Button></div>
    {error ? <p role="alert" className="mt-2 text-xs font-semibold text-ds-danger">{error}</p> : null}
  </div>;
}
