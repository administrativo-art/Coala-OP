"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { archiveTimestamp } from "@/lib/documents/archive-entry-sort";
import { matchesArchiveSearch, parseArchiveSearch } from "@/lib/documents/archive-search";
import { Button } from "@/components/ui/button";
import { ArchiveExplorer, type ArchiveEntry } from "./archive-explorer";
import { ArchivePreview } from "./archive-preview";
import { ARCHIVE_SOURCE_FOLDERS, archiveSourceHref, canViewArchiveSource, type ArchiveFolderSource } from "./archive-source-folders";
import { isContextArchiveSource } from "./context-archive-access";
import type { CentralWorkPage } from "./types";

type File = {
  id: string; title: string; protocol?: string | null; status?: string | null;
  updatedAt?: string | null; pdfAvailable?: boolean; signed?: boolean; signaturePendingArchive?: boolean;
  href?: string; description?: string;
  fileUrl?: string; mimeType?: string; available?: boolean; folder?: boolean;
};
type Page = { items: File[]; nextCursor: string | null; folderLabel?: string };

/** Folder projections keep each origin's authorization, identity and file access. No polling/copying. */
export function SourceArchive({ source, documentId, mine = false, parentId }: { source: ArchiveFolderSource; documentId?: string; mine?: boolean; parentId?: string }) {
  const router = useRouter();
  const request = useAuthenticatedApi();
  const requestRef = useRef(request);
  useEffect(() => { requestRef.current = request; }, [request]);
  const { permissions, isDefaultAdmin, loading: authLoading, user, viewAs } = useAuth();
  const canViewSigned = hasFormalizationPermission(permissions, "signatures.view", isDefaultAdmin);
  const actorKey = `${user?.id ?? ""}:${viewAs?.id ?? ""}`;
  const permissionKey = JSON.stringify(permissions);
  const canView = canViewArchiveSource(source, permissions, isDefaultAdmin, user ?? {}) && !((source === "receipts" || source === "pilotReceipts" || source === "afd" || source === "aej") && viewAs);
  const unitKey = JSON.stringify([user?.unitAccessScope, user?.unitAccessUnitIds, user?.unitIds, user?.assignedKioskIds, user?.operationalUnitPeriods]);
  const dataKey = JSON.stringify([source, parentId, documentId, mine, actorKey, permissionKey, unitKey, isDefaultAdmin]);
  const [loadedKey, setLoadedKey] = useState("");
  const [folderLabel, setFolderLabel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<{ id: string; url: string; mime: string } | null>(null);
  const version = useRef(0);
  const previewVersion = useRef(0);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const load = useCallback(async (next?: string) => {
    const token = ++version.current;
    if (!next) { previewVersion.current++; setPreview(null); setLoadedKey(""); setFolderLabel(""); setRevision((value) => value + 1); }
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ limit: "25", ...(next ? { cursor: next } : {}) });
      let page: Page;
      if (isContextArchiveSource(source)) {
        if (parentId) query.set("parent", parentId);
        if (mine && source === "uniforms") query.set("mine", "true");
        page = await requestRef.current<Page>(`/api/documents/archive/sources/${source}?${query}`);
      } else if (source === "received") {
        query.set("source", "employee_upload"); query.set("tab", "classify");
        const result = await requestRef.current<CentralWorkPage>(`/api/documents/work-items?${query}`);
        const origin = result.sources.find((item) => item.source === "employee_upload");
        if (result.warnings.some((warning) => warning.includes("Não foi possível"))) throw new Error("Não foi possível carregar os recebidos. Tente atualizar.");
        if (origin && !origin.available) throw new Error("Sem permissão para consultar os recebidos.");
        page = { items: result.items.map((item) => ({ id: item.id, title: item.title, updatedAt: item.updatedAt, description: item.statusLabel, href: item.href })), nextCursor: result.continuations?.find((item) => item.source === "employee_upload")?.cursor ?? null };
      } else if (source === "editor") {
        const result = await requestRef.current<{ items: Array<{ id: string; title: string; status: string; updatedAt: string | null }>; nextCursor: string | null }>(`/api/documents/editor?${query}`);
        page = { ...result, items: result.items.map((item) => ({ ...item, pdfAvailable: item.status === "final", href: `/dashboard/documents/editor/${encodeURIComponent(item.id)}` })) };
      } else {
        if (documentId) query.set("documentId", documentId);
        page = await requestRef.current<Page>(`/api/documents/archive/generated?${query}`);
      }
      if (version.current !== token) return;
      setFiles((current) => next ? [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()] : page.items);
      setCursor(page.nextCursor); setLoadedKey(dataKey); setFolderLabel(page.folderLabel ?? "");
    } catch (cause) {
      if (version.current === token) setError(cause instanceof Error ? cause.message : "Não foi possível carregar a pasta.");
    } finally { if (version.current === token) setLoading(false); }
  }, [source, documentId, mine, parentId, dataKey]);

  useEffect(() => {
    setFiles([]); setCursor(null); setSearch(""); setPreview(null); setError(""); previewVersion.current++;
    if (!authLoading && canView) void load();
    return () => { version.current++; previewVersion.current++; };
  }, [authLoading, canView, load, actorKey, permissionKey, isDefaultAdmin]);

  async function open(file: File, download = false) {
    if (file.folder && file.href) { router.push(file.href); return; }
    if (file.available === false) {
      if (file.href) router.push(file.href);
      else setError("O arquivamento deste documento requer conferência na origem antes da abertura.");
      return;
    }
    if (file.href && (!file.pdfAvailable || source === "received")) { router.push(file.href); return; }
    const token = ++previewVersion.current;
    const fileSource = source === "editor" ? "editor" : "generated";
    const pdf = Boolean(file.pdfAvailable || file.signed);
    if (file.signed && (!canViewSigned || !file.pdfAvailable)) { router.push(`/dashboard/documents/generated/manage?document=${encodeURIComponent(file.id)}`); return; }
    try {
      const blob = await request<Blob>(file.fileUrl ?? `/api/documents/${fileSource}/${encodeURIComponent(file.id)}/file${fileSource === "generated" && pdf ? `?format=${file.signed ? "signed-pdf" : "pdf"}` : ""}`, { responseType: "blob" });
      if (previewVersion.current !== token) return;
      const url = URL.createObjectURL(blob);
      if ((pdf || blob.type.startsWith("image/")) && !download) setPreview({ id: file.id, url, mime: blob.type });
      else {
        const extension = file.mimeType === "application/zip" ? "zip" : blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : pdf ? "pdf" : "docx";
        const link = document.createElement("a"); link.href = url; link.download = `${file.title.replace(/\.(pdf|docx|zip)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_")}${file.signed ? "_assinado" : ""}.${extension}`; link.click(); URL.revokeObjectURL(url);
      }
    } catch (cause) { if (previewVersion.current === token) setError(cause instanceof Error ? cause.message : "Não foi possível abrir o arquivo."); }
  }

  const terms = parseArchiveSearch(search);
  const currentFiles = loadedKey === dataKey ? files : [];
  const currentCursor = loadedKey === dataKey ? cursor : null;
  const previewable = (file: File) => file.available !== false && Boolean(file.pdfAvailable && (!file.signed || canViewSigned) || file.mimeType?.startsWith("image/"));
  const entries: ArchiveEntry[] = currentFiles.filter((file) => matchesArchiveSearch(terms, [file.title, file.protocol, file.description])).map((file) => ({
    id: file.id, name: file.title, kind: file.folder ? "folder" : "file", description: file.protocol ?? file.description ?? (file.status === "draft" || file.status === "review_pending" ? "Em preparação" : undefined),
    badge: file.available === false ? "Conferir arquivamento" : file.signaturePendingArchive ? "Arquivamento pendente" : file.signed ? "Assinado" : undefined,
    modifiedAt: archiveTimestamp(file.updatedAt), modified: file.updatedAt ? new Date(file.updatedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : undefined,
    mimeType: file.pdfAvailable && (!file.signed || canViewSigned && file.pdfAvailable) ? "application/pdf" : file.mimeType,
    location: ARCHIVE_SOURCE_FOLDERS[source].label,
    open: () => void open(file),
    loadPreview: previewable(file) ? () => void open(file) : undefined,
    actions: [
      { label: file.folder ? "Abrir pasta" : file.available === false ? "Conferir origem" : source === "received" ? "Retomar classificação" : file.signed && (!canViewSigned || !file.pdfAvailable) ? "Ver origem" : file.signed ? "Abrir PDF assinado" : "Abrir documento", run: () => void open(file) },
      ...(!file.folder && file.available !== false && source !== "received" && (!file.signed || canViewSigned && file.pdfAvailable) && (source !== "editor" || file.pdfAvailable) ? [{ label: "Baixar arquivo", run: () => void open(file, true) }] : []),
      ...(source === "generated" && (!file.signed || canViewSigned && file.pdfAvailable) ? [{ label: "Ver origem", run: () => router.push(`/dashboard/documents/generated/manage?document=${encodeURIComponent(file.id)}`) }] : []),
    ],
  }));
  const label = mine && source === "uniforms" ? "Meus termos de uniforme" : ARCHIVE_SOURCE_FOLDERS[source].label;
  const personal = source === "receipts" || source === "pilotReceipts" || source === "uniforms" && mine;
  const root = personal ? "/dashboard/documents/collaborators" : "/dashboard/documents";
  return <ArchiveExplorer area={personal ? "collaborators" : "company"} folders={[]} entries={canView ? entries : []} selectionScope={`${source}:${parentId ?? ""}:${actorKey}:${revision}`}
    breadcrumbs={parentId ? [{ name: label, open: () => router.push(archiveSourceHref(source)) }, { name: loadedKey === dataKey && folderLabel ? folderLabel : "Processo de admissão" }] : [{ name: label }]}
    loading={authLoading || loading} error={!authLoading && !canView ? "Sem permissão para acessar esta pasta." : error}
    search={search} onSearch={setSearch} onRoot={() => router.push(root)} onUp={() => router.push(parentId ? archiveSourceHref(source) : root)}
    onSelect={() => { previewVersion.current++; setPreview(null); }} onRefresh={() => { if (canView) void load(); }}
    hasMorePages={Boolean(currentCursor)}
    toolbar={documentId ? <Button variant="ds-secondary" onClick={() => router.push(archiveSourceHref(source))}>Ver todos os arquivos</Button> : currentCursor ? <Button variant="ds-secondary" disabled={loading} onClick={() => void load(currentCursor!)}>Carregar mais</Button> : undefined}
    footer={currentCursor ? <p className="text-xs text-ds-ink-muted">A busca considera os arquivos carregados. Use Carregar mais para continuar.</p> : undefined}
    preview={(entry) => <div className="space-y-3 text-sm text-ds-ink-muted">
      {loadedKey === dataKey && preview?.id === entry.id ? <ArchivePreview url={preview.url} mime={preview.mime} title={entry.name} /> : null}
      <p>{entry.description ?? label}</p>
      {currentCursor ? <p>A busca considera os arquivos carregados. Use Carregar mais para continuar.</p> : null}
    </div>} />;
}
