"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { saveFile } from "@/features/dp/rep-p/marking-ui";
import { portalRequest } from "./client";
import type { ProviderClosureContent, ProviderClosureRow } from "./closure-types";
import { ProviderClosureContentView } from "./closure-content";

const statusLabels: Record<ProviderClosureRow['status'], string> = {
  available: 'Disponível', reopened: 'Competência reaberta — aguardando liberação do RH',
  outdated: 'Nova versão em preparação pelo RH', employment_changed: 'Vínculo em conferência pelo RH',
};
export function PortalClosures({ grantId }: { grantId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<ProviderClosureRow[] | null>(null);
  const [content, setContent] = useState<ProviderClosureContent | null>(null);
  const [releaseId, setReleaseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true); setError(""); setContent(null);
    try { setRows(await portalRequest<ProviderClosureRow[]>("/api/service-portal/closures?grantId=" + encodeURIComponent(grantId))); }
    catch (cause) { setRows(null); setError(cause instanceof Error ? cause.message : "Não foi possível consultar os fechamentos."); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    setBusy(true); setError(""); setContent(null);
    try {
      setContent(await portalRequest<ProviderClosureContent>("/api/service-portal/closures", { grantId, releaseId: id, action: "open" }));
      setReleaseId(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível abrir o fechamento."); }
    finally { setBusy(false); }
  }
  async function download() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/service-portal/closures", {
        method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId, releaseId, action: "download_payslip" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "Não foi possível baixar o contracheque.");
      }
      saveFile(new File([await response.blob()], "contracheque-" + content!.competence + ".pdf", { type: "application/pdf" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar o documento."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 pt-2" aria-label="Fechamentos por colaborador">
    <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => { setExpanded(!expanded); if (!expanded) void load(); }}>
      Consultar colaboradores
    </Button>
    {expanded ? <div className="space-y-4">
      {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}
      {busy ? <p role="status" className="text-sm">Consultando fechamento…</p> : null}
      {rows && !rows.length ? <p className="text-sm text-ds-ink-muted">O RH ainda não disponibilizou fechamentos individuais nesta competência.</p> : null}
      {rows ? <div className="divide-y divide-ds-border">{rows.map((row) => <article key={row.releaseId} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div><h4 className="font-semibold">{row.employeeName}</h4>{row.cpfMasked ? <p className="text-sm text-ds-ink-muted">CPF {row.cpfMasked}</p> : null}<p className="text-sm text-ds-ink-muted">Versão {row.closureVersion} · {statusLabels[row.status]}</p>{row.releasedAt ? <p className="text-xs text-ds-ink-muted">Disponibilizado em {new Date(row.releasedAt).toLocaleString("pt-BR")}</p> : null}</div>
        {row.status === "available" ? <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void open(row.releaseId)}>Abrir fechamento</Button> : null}
      </article>)}</div> : null}
      {content ? <section className="space-y-5 rounded-ds-card border border-ds-border p-4">
        <div className="flex justify-end"><Button variant="ds-ghost" size="sm" disabled={busy} onClick={() => setContent(null)}>Fechar consulta</Button></div>
        <ProviderClosureContentView content={content} />
        {content.documents.some((document) => document.kind === "payslip") ? <section className="space-y-2 border-t border-ds-border pt-4">
          <h4 className="font-bold">Documento disponibilizado</h4><Button variant="ds-secondary" disabled={busy} onClick={() => void download()}>Baixar contracheque</Button>
        </section> : null}
      </section> : null}
    </div> : null}
  </section>;
}
