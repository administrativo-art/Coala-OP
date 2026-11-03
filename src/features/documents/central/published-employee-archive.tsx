"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

import { useAuth } from "@/hooks/use-auth";
import { canAccessUserByUnit } from "@/lib/unit-access";
import { employeeArchiveIds, employeeArchiveChildFolders, groupPublishedAdmissionReferences } from "@/lib/documents/employee-archive";
import { isPublishedToEmployee, type DocumentPublication } from "@/lib/hr/employee-document-publication";
import { ownDocumentFolderPath } from "@/features/hr/documents/own-document-folders";
import { ArchiveExplorer, type ArchiveEntry } from "./archive-explorer";
import { ArchivePreview } from "./archive-preview";
import { archivePreviewable, archiveTimestamp } from "@/lib/documents/archive-entry-sort";

type PublishedDocument = {
  id: string;
  displayName: string;
  documentType: string | null;
  documentTypeCode: string | null;
  category: string | null;
  destinationTrail: string[];
  mimeType: string | null;
  size?: number | null;
  publishedAt: string | null;
  publication?: DocumentPublication | null;
  deletedAt?: unknown;
  employeeId?: string;
  source?: string;
  contentHash?: string;
  signatureRequestId?: string;
  sourceOnboardingId?: string;
  originalName?: string;
  accessLevel?: string;
  accessPolicyId?: string;
  folderCode?: string;
  status?: string;
  version?: number;
};
type Cursor = { id: string; after: string };
const PAGE_SIZE = 100;

async function readDpPage(id: string, after: string | null, headers: { Authorization: string }): Promise<{ documents: PublishedDocument[]; nextCursor: string | null }> {
  const params = new URLSearchParams({employeeId:id,publishedOnly:"1",limit:String(PAGE_SIZE)});
  if (after) params.set("cursor",after);
  const response = await fetch(`/api/hr/employee-documents?${params}`, {headers,cache:"no-store"});
  if (!response.ok) throw Error("Não foi possível consultar esta pasta com seu acesso atual.");
  const payload = await response.json();
  if (!Array.isArray(payload.documents) || !(payload.nextCursor === null || typeof payload.nextCursor === "string")) throw Error("Resposta documental incompleta.");
  return {documents:payload.documents.filter(isPublishedToEmployee).map((doc:PublishedDocument) => ({...doc,displayName:doc.displayName || doc.documentType || doc.originalName || "Documento",publishedAt:doc.publication?.at ?? null})),nextCursor:payload.nextCursor};
}

function downloadName(response: Response, document: PublishedDocument): string {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const regular = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  let candidate: string | undefined;
  try { candidate = encoded ? decodeURIComponent(encoded) : regular; } catch { candidate = regular; }
  const extension = ({"application/pdf":"pdf","image/png":"png","image/jpeg":"jpg",
    "application/msword":"doc","application/vnd.openxmlformats-officedocument.wordprocessingml.document":"docx"} as Record<string,string>)[document.mimeType ?? ""];
  const fallback = document.originalName || `${document.displayName || "documento"}${extension ? `.${extension}` : ""}`;
  return (candidate || fallback).split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f\x7f]/g, "_") || "documento";
}

function readPath(value: string | null): string[] {
  try {
    const path = JSON.parse(value ?? "[]");
    return Array.isArray(path) && path.length <= 20 && path.every((part) => typeof part === "string" && part.length <= 200) ? path : [];
  } catch { return []; }
}

export function PublishedEmployeeArchive() {
  const router = useRouter();
  const { firebaseUser, user, activeUsers, terminatedUsers, permissions, isDefaultAdmin } = useAuth();
  const canViewTeam = isDefaultAdmin || Boolean(permissions.settings?.manageUsers ||
    permissions.dp?.collaborators?.view && !permissions.dp?.collaborators?.ownProfileOnly);
  const people = useMemo(() => {
    if (!user) return [];
    const permitted = canViewTeam
      ? [user, ...activeUsers, ...terminatedUsers].filter(person => person.id === user.id || canAccessUserByUnit(user, person, { isDefaultAdmin }))
      : [user];
    return [...new Map(permitted.map(person => [person.id, person])).values()]
      .sort((left, right) => left.username.localeCompare(right.username, "pt-BR"));
  }, [user, canViewTeam, activeUsers, terminatedUsers, isDefaultAdmin]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [documents, setDocuments] = useState<PublishedDocument[]>([]);
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ownLimitReached, setOwnLimitReached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{id: string; url: string; mime: string} | null>(null);
  const requestSequence = useRef(0);
  const fileSequence = useRef(0);
  const employee = people.find(person => person.id === employeeId);
  const own = Boolean(employee && user && employee.id === user.id);
  const aliases = employee ? employeeArchiveIds(employee) : [];
  const aliasKey = aliases.join("\u0000");

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      setEmployeeId(params.get("employee")); setPath(readPath(params.get("path")));
      setPreview(null); setSearch(""); fileSequence.current++;
    };
    restore(); window.addEventListener("popstate", restore);
    return () => { requestSequence.current++; fileSequence.current++; window.removeEventListener("popstate", restore); };
  }, []);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setDocuments([]); setCursors([]); setLoadingMore(false); setOwnLimitReached(false); setError(null);
    if (!employee || !firebaseUser || (!own && !canViewTeam)) { setLoading(false); return; }
    setLoading(true);
    try {
      const headers = {Authorization: `Bearer ${await firebaseUser.getIdToken()}`};
      let visible: PublishedDocument[];
      if (own) {
        const response = await fetch("/api/collaborator/documents", {headers, cache:"no-store"});
        if (!response.ok) throw Error("Não foi possível consultar os documentos publicados.");
        const payload = await response.json();
        visible = Array.isArray(payload.documents) ? payload.documents : [];
        if (requestSequence.current === sequence) setOwnLimitReached(payload.limitReached === true);
      } else {
        // Uma página por alias exato da pessoa aberta; a API original revalida unidade e sigilo.
        const ids = aliasKey.split("\u0000").filter(Boolean);
        const pages = await Promise.all(ids.map(id => readDpPage(id,null,headers)));
        visible = [...new Map(pages.flatMap(page => page.documents).map(doc => [doc.id,doc])).values()];
        if (requestSequence.current === sequence) setCursors(pages.flatMap((page,index) => page.nextCursor ? [{id:ids[index],after:page.nextCursor}] : []));
      }
      if (requestSequence.current === sequence) setDocuments(visible);
    } catch (cause) {
      if (requestSequence.current === sequence) setError(cause instanceof Error ? cause.message : "Não foi possível consultar esta pasta.");
    } finally { if (requestSequence.current === sequence) setLoading(false); }
  }, [employee, firebaseUser, own, canViewTeam, aliasKey]);
  useEffect(() => { void load(); return () => { requestSequence.current++; }; }, [load]);

  async function loadMore() {
    if (!firebaseUser || !cursors.length || loadingMore) return;
    const sequence = requestSequence.current;
    setLoadingMore(true); setError(null);
    try {
      const headers = {Authorization:`Bearer ${await firebaseUser.getIdToken()}`};
      const pages = await Promise.all(cursors.map(cursor => readDpPage(cursor.id,cursor.after,headers)));
      if (requestSequence.current !== sequence) return;
      setDocuments(current => [...new Map([...current,...pages.flatMap(page => page.documents)].map(doc => [doc.id,doc])).values()]);
      setCursors(pages.flatMap((page,index) => page.nextCursor ? [{id:cursors[index].id,after:page.nextCursor}] : []));
    } catch (cause) { if (requestSequence.current === sequence) setError(cause instanceof Error ? cause.message : "Não foi possível carregar mais documentos."); }
    finally { if (requestSequence.current === sequence) setLoadingMore(false); }
  }

  function navigate(id: string | null, nextPath: string[] = []) {
    setEmployeeId(id); setPath(nextPath); setSearch(""); setPreview(null); fileSequence.current++;
    const url = new URL(window.location.href);
    url.searchParams.delete("employee"); url.searchParams.delete("path");
    if (id) url.searchParams.set("employee", id);
    if (nextPath.length) url.searchParams.set("path", JSON.stringify(nextPath));
    window.history.pushState(null, "", url);
  }
  async function access(document: PublishedDocument, download = false) {
    if (!firebaseUser || !employee) return;
    const sequence = ++fileSequence.current;
    setError(null);
    try {
      const url = own ? "/api/collaborator/documents/access" : "/api/hr/employee-documents/access";
      const response = await fetch(url, {method:"POST", headers:{Authorization:`Bearer ${await firebaseUser.getIdToken()}`, "Content-Type":"application/json"},
        body:JSON.stringify({id:document.id, action:download ? "download" : "view"}), cache:"no-store"});
      if (!response.ok) throw Error("Não foi possível abrir este documento com seu acesso atual.");
      const blob = await response.blob();
      if (fileSequence.current !== sequence) return;
      const objectUrl = URL.createObjectURL(blob);
      if (download) {
        const link = window.document.createElement("a"); link.href = objectUrl;
        link.download = downloadName(response, document);
        link.click(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } else setPreview({id:document.id, url:objectUrl, mime:blob.type});
    } catch (cause) { if (fileSequence.current === sequence) setError(cause instanceof Error ? cause.message : "Falha ao abrir arquivo."); }
  }

  const term = search.trim().toLocaleLowerCase("pt-BR");
  const visibleDocuments = own ? documents : groupPublishedAdmissionReferences(documents);
  const paths = visibleDocuments.map(ownDocumentFolderPath);
  const childFolders = employeeArchiveChildFolders(paths, path).sort((a,b) => a.localeCompare(b,"pt-BR"));
  const entries: ArchiveEntry[] = !employeeId
    ? people.filter(person => person.username.toLocaleLowerCase("pt-BR").includes(term))
      .map(person => ({id:person.id, name:person.username, kind:"folder", description:person.id === user?.id ? "Minha pasta publicada" : "Documentos publicados", open:() => navigate(person.id)}))
    : !employee ? [] : [
      ...(!term ? childFolders.map((name):ArchiveEntry => ({id:`folder:${name}`,name,kind:"folder",open:() => navigate(employeeId,[...path,name])})) : []),
      ...visibleDocuments.filter(doc => path.every((part,index) => ownDocumentFolderPath(doc)[index] === part))
        .filter(doc => term ? `${doc.displayName} ${doc.documentType ?? ""}`.toLocaleLowerCase("pt-BR").includes(term) : ownDocumentFolderPath(doc).length === path.length)
        .map((doc):ArchiveEntry => ({id:doc.id,name:doc.displayName,kind:"file",description:doc.documentType ?? undefined,
          modified:doc.publishedAt ? new Date(doc.publishedAt).toLocaleDateString("pt-BR") : undefined,
          modifiedAt:archiveTimestamp(doc.publishedAt),
          size:doc.size ? `${Math.ceil(doc.size / 1024)} KB` : undefined, sizeBytes:doc.size,
          open:() => void access(doc,!archivePreviewable(doc.mimeType)),
          loadPreview:archivePreviewable(doc.mimeType) ? () => void access(doc) : undefined,
          actions:[{label:"Baixar",run:() => void access(doc,true)}]})),
    ];
  return <ArchiveExplorer area="published" selectionScope={JSON.stringify([employeeId, path])} hasMorePages={ownLimitReached || cursors.length > 0} entries={entries} search={search} onSearch={setSearch} loading={loading}
    error={employeeId && !employee ? "Pasta indisponível para seu acesso atual." : error}
    breadcrumbs={employee ? [{name:employee.username,open:() => navigate(employeeId)},...path.map((name,index) => ({name,open:() => navigate(employeeId,path.slice(0,index+1))}))] : []}
    folders={employee ? childFolders.map(name => ({id:name,name,open:() => navigate(employeeId,[...path,name])})) : []}
    onRoot={() => navigate(null)} onUp={() => path.length ? navigate(employeeId,path.slice(0,-1)) : employeeId ? navigate(null) : router.push("/dashboard/documents")}
    onRefresh={() => void load()} onSelect={() => {fileSequence.current++;setPreview(null);}}
    footer={employee ? <div className="px-4 pt-3 text-xs text-slate-600">
      {ownLimitReached && <p role="status">Há mais documentos publicados do que esta consulta exibe. Peça ao DP a conferência dos demais.</p>}
      {(ownLimitReached || cursors.length > 0) && <p>Busca e ordenação consideram somente as páginas carregadas.</p>}
      {cursors.length > 0 && <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Carregando…" : "Carregar mais documentos"}</Button>}
    </div> : null}
    preview={entry => preview?.id === entry.id ? <ArchivePreview url={preview.url} mime={preview.mime} title={entry.name} /> : <p className="text-xs text-slate-500">{entry.description}</p>} />;
}
