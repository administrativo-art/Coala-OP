"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FINANCIAL_DOCUMENT_KINDS } from "@/features/documents/central/financial-naming";
import type { FinancialInboxAttachment } from "./types";

type Naming = NonNullable<FinancialInboxAttachment["documentNaming"]>;
export function DocumentNamingEditor({ messageId, attachment, api, onApplied }: {
  messageId: string; attachment: FinancialInboxAttachment;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  onApplied: (naming: Naming) => void;
}) {
  const [open, setOpen] = useState(false);
  const [documentType, setDocumentType] = useState<string>(attachment.documentNaming?.documentType ?? "");
  const [reference, setReference] = useState(attachment.documentNaming?.reference ?? "");
  const [preview, setPreview] = useState<{ naming: Naming; fingerprint?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [counterparties, setCounterparties] = useState<Array<{ id: string; name: string }> | null>(null);
  const [nextCounterpartyCursor, setNextCounterpartyCursor] = useState<string | null>(null);
  async function loadCounterparties(cursor?: string) {
    setBusy(true); setError("");
    try {
      const result = await api(`/api/financial/document-counterparties${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`) as { options: Array<{ id: string; name: string }>; nextCursor: string | null };
      setCounterparties((current) => cursor ? [...current ?? [], ...result.options] : result.options);
      setNextCounterpartyCursor(result.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar contrapartes."); }
    finally { setBusy(false); }
  }
  async function submit(mode: "preview" | "confirm") {
    setBusy(true); setError("");
    try {
      const result = await api(`/api/financial/inbox/${encodeURIComponent(messageId)}/files/${encodeURIComponent(attachment.id)}/naming`, { method: "POST", body: JSON.stringify({ mode, documentType, reference, counterpartyId: counterpartyId || undefined, ...(mode === "confirm" ? { expectedVersion: preview?.naming.version, expectedFingerprint: preview?.fingerprint } : {}) }) }) as { naming: Naming; fingerprint?: string };
      if (mode === "preview") setPreview(result); else { onApplied(result.naming); setOpen(false); setPreview(null); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao definir o nome."); if (mode === "confirm") setPreview(null); }
    finally { setBusy(false); }
  }
  return <div className="rounded-lg border p-3">
    <p className="break-all text-xs text-ds-ink-muted">{attachment.documentNaming?.downloadName ?? attachment.filename}</p>
    <Button variant="ds-link" size="sm" onClick={() => setOpen(!open)} disabled={busy}>{open ? "Fechar classificação" : "Padronizar nome"}</Button>
    {open ? <div className="mt-2 space-y-3">
      <p className="text-xs text-ds-ink-muted">Usa o fornecedor cadastrado na despesa. Se o legado não tem ID, escolha uma contraparte para este documento; isso não altera a despesa nem o pagamento.</p>
      {counterparties ? <label className="block space-y-1 text-xs"><span>Contraparte do documento</span><select className="h-10 w-full rounded-md border px-3" value={counterpartyId} onChange={(event) => { setCounterpartyId(event.target.value); setPreview(null); }}><option value="">Usar fornecedor vinculado à despesa</option>{counterparties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <Button variant="ds-link" size="sm" disabled={busy} onClick={() => void loadCounterparties()}>Escolher contraparte do legado</Button>}
      {nextCounterpartyCursor ? <Button variant="ds-link" size="sm" disabled={busy} onClick={() => void loadCounterparties(nextCounterpartyCursor)}>Carregar mais contrapartes</Button> : null}
      <label className="block space-y-1 text-xs"><span>Tipo documental</span><select className="h-10 w-full rounded-md border px-3" value={documentType} onChange={(event) => { setDocumentType(event.target.value); setPreview(null); }}>{[<option key="" value="">Selecione o tipo</option>, ...FINANCIAL_DOCUMENT_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("-", " ")}</option>)]}</select></label>
      <label className="block space-y-1 text-xs"><span>Referência do documento — competência, data ou número</span><Input value={reference} maxLength={80} onChange={(event) => { setReference(event.target.value); setPreview(null); }} /></label>
      {preview ? <p className="break-all rounded-lg bg-ds-muted p-2 text-xs">Nome proposto: {preview.naming.downloadName}<br />Destino: {preview.naming.destination}</p> : null}
      {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
      <Button variant="primary-modal" size="sm" disabled={busy || !documentType || !reference.trim()} onClick={() => void submit(preview ? "confirm" : "preview")}>{busy ? "Processando…" : preview ? "Confirmar nome" : "Ver prévia"}</Button>
    </div> : null}
  </div>;
}
