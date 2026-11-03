"use client";

import { ArchivePreview } from "./archive-preview";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { companyArchiveHref } from "@/lib/documents/company-archive-navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import type { FinancialInboxMessage } from "@/features/financial/inbox/types";
import { ArchiveExplorer, type ArchiveEntry } from "./archive-explorer";
import { archivePreviewable, archiveTimestamp } from "@/lib/documents/archive-entry-sort";

type Page = { messages: FinancialInboxMessage[]; nextCursor: string | null };
type Scope = "root" | "identified" | "archived";
export function FinancialDocumentArchive() {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const [scope, setScope] = useState<Scope>("root");
  const [folder, setFolder] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; url: string; mime: string } | null>(null);
  const sequence = useRef(0);
  const fileSequence = useRef(0);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    const restore = () => { const params = new URLSearchParams(window.location.search); const value = params.get("scope"); setScope(value === "identified" || value === "archived" ? value : "root"); setFolder(params.get("folder")); setSearch(""); fileSequence.current++; setPreview(null); };
    restore(); window.addEventListener("popstate", restore);
    return () => { sequence.current++; fileSequence.current++; window.removeEventListener("popstate", restore); };
  }, []);
  const load = useCallback(async (cursor?: string) => {
    const request = ++sequence.current;
    if (scope === "root") { setPage(null); setLoading(false); return; }
    if (!firebaseUser) return;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/financial/inbox?view=identified&limit=25${scope === "archived" ? "&stage=archive" : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || "Não foi possível consultar a pasta financeira.");
      if (sequence.current === request) setPage((previous) => ({ messages: cursor ? [...(previous?.messages ?? []), ...payload.messages] : payload.messages, nextCursor: payload.nextCursor }));
    } catch (cause) { if (sequence.current === request) setError(cause instanceof Error ? cause.message : "Falha na consulta."); }
    finally { if (sequence.current === request) setLoading(false); }
  }, [firebaseUser, scope]);
  useEffect(() => { setPage(null); void load(); return () => { sequence.current++; }; }, [load]);
  function navigate(next: Scope, target: string | null = null) {
    setScope(next); setFolder(target); setSearch(""); setPreview(null); fileSequence.current++;
    const url = new URL(window.location.href); url.searchParams.delete("scope"); url.searchParams.delete("folder");
    if (next !== "root") url.searchParams.set("scope", next);
    if (target) url.searchParams.set("folder", target);
    window.history.pushState(null, "", url);
  }
  const files = (page?.messages ?? []).flatMap((message) => message.attachments.filter((file) => file.storagePath).map((file) => ({ message, file, key: `${message.id}:${file.id}`, folder: file.documentNaming?.counterpartyId ? `Contraparte ${file.documentNaming.counterpartyId}` : "A nomear" })));
  async function access(entry: (typeof files)[number], download = false) {
    if (!firebaseUser) return;
    const request = ++fileSequence.current;
    setError(null);
    try {
      const response = await fetch(`/api/financial/inbox/${encodeURIComponent(entry.message.id)}/files/${encodeURIComponent(entry.file.id)}`, { headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível acessar o arquivo. Confira seu acesso atual.");
      const blob = await response.blob();
      if (request !== fileSequence.current) return;
      const url = URL.createObjectURL(blob);
      if (download) { const anchor = document.createElement("a"); anchor.href = url; anchor.download = entry.file.documentNaming?.downloadName || entry.file.filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      else setPreview({ id: entry.key, url, mime: blob.type });
    } catch (cause) { if (request === fileSequence.current) setError(cause instanceof Error ? cause.message : "Falha ao abrir arquivo."); }
  }
  const folders = [...new Set(files.map((entry) => entry.folder))].sort();
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const entries: ArchiveEntry[] = scope === "root" ? (["identified", "archived"] as const).map((value): ArchiveEntry => ({ id: value, name: value === "identified" ? "Identificados" : "Arquivados", kind: "folder", open: () => navigate(value) })).filter((entry) => entry.name.toLocaleLowerCase("pt-BR").includes(term))
    : !folder && !term ? folders.map((name) => ({ id: name, name, kind: "folder", open: () => navigate(scope, name) }))
    : files.filter((entry) => (!folder || entry.folder === folder) && `${entry.file.documentNaming?.downloadName || ""} ${entry.file.filename}`.toLocaleLowerCase("pt-BR").includes(term)).map((entry) => ({ id: entry.key, name: entry.file.documentNaming?.downloadName || entry.file.filename, kind: "file", description: entry.message.subject, size: `${Math.ceil(entry.file.size / 1024)} KB`, sizeBytes: entry.file.size, modified: entry.message.receivedAt ? new Date(entry.message.receivedAt).toLocaleDateString("pt-BR") : undefined, modifiedAt: archiveTimestamp(entry.message.receivedAt), open: () => void access(entry, !archivePreviewable(entry.file.contentType)), loadPreview: archivePreviewable(entry.file.contentType) ? () => void access(entry) : undefined, actions: [
      { label: "Baixar", run: () => void access(entry, true) },
      { label: "Revisar na origem", run: () => router.push(`/dashboard/financial/inbox?sourceId=${encodeURIComponent(entry.message.id)}`) },
      { label: "Ver histórico", run: () => router.push(`/dashboard/documents/history?source=financial&documentId=${encodeURIComponent(entry.message.id)}`) },
    ] }));
  return <ArchiveExplorer area="financial" selectionScope={JSON.stringify([scope, folder])} hasMorePages={Boolean(page?.nextCursor)} entries={entries} search={search} onSearch={setSearch} loading={loading} error={error} onRefresh={() => void load()}
    breadcrumbs={scope === "root" ? [] : [{ name: scope === "identified" ? "Identificados" : "Arquivados", open: () => navigate(scope) }, ...(folder ? [{ name: folder }] : [])]}
    folders={scope === "root" ? [] : folders.map((name) => ({ id: name, name, active: folder === name, open: () => navigate(scope, name) }))}
    onRoot={() => router.push(companyArchiveHref("Financeiro"))} onUp={() => folder ? navigate(scope) : router.push(companyArchiveHref("Financeiro"))}
    onSelect={() => { fileSequence.current++; setPreview(null); }}
    toolbar={<Button size="sm" variant="outline" onClick={() => router.push("/dashboard/financial/inbox")}>Caixa de cobranças</Button>}
    footer={page?.nextCursor ? <div className="space-y-2 p-3"><p className="text-xs text-slate-500">Há mais documentos. Carregue para ampliar a lista e a busca.</p><Button variant="outline" disabled={loading} onClick={() => void load(page.nextCursor!)}>Carregar mais documentos</Button></div> : null}
    preview={(entry) => { const item = files.find((file) => file.key === entry.id); return <div className="space-y-3 text-xs text-slate-500">{preview?.id === entry.id && <ArchivePreview url={preview.url} mime={preview.mime} title={entry.name} />}<details className="rounded border bg-white p-2"><summary className="cursor-pointer font-semibold">Detalhes do arquivo</summary><div className="mt-2 space-y-2"><p className="break-all">Original: {item?.file.filename || entry.name}</p>{item && <p className="break-all">Pasta: {item.file.documentNaming?.destination || "Destino documental não confirmado"}</p>}</div></details></div>; }} />;
}
