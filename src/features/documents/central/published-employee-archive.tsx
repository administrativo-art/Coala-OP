"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LiftRow } from "@/components/patterns/lift-row";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { PanelField, SidePanel } from "@/components/patterns/side-panel";
import { fichaGroups, fichaPlacement, fichaTabs, resolveFichaTab } from "@/lib/documents/archive-view-mode";

import { useAuth } from "@/hooks/use-auth";
import { canAccessUserByUnit } from "@/lib/unit-access";
import { employeeArchiveIds, employeeArchiveDocumentName, groupPublishedAdmissionReferences } from "@/lib/documents/employee-archive";
import { isPublishedToEmployee, type DocumentPublication } from "@/lib/hr/employee-document-publication";
import { ownDocumentFolderPath } from "@/features/hr/documents/own-document-folders";
import { ArchiveEntryIcon, ArchiveShell } from "./archive-explorer";
import { ArchivePreview } from "./archive-preview";
import { warmPdfjs } from "@/lib/pdf/pdfjs-client";
import { archivePreviewable, archiveTimestamp } from "@/lib/documents/archive-entry-sort";
import {
  ArchiveDocumentOrganizationDialog,
  type ArchiveOrganizationRequest,
  type ArchiveOrganizationTarget,
} from "./archive-document-organization-dialog";

type PublishedDocument = {
  id: string;
  displayName: string;
  archiveName?: string | null;
  archivePath?: string[] | null;
  archiveReferences?: string[];
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
  return {documents:payload.documents.filter(isPublishedToEmployee).map((doc:PublishedDocument) => ({...doc,displayName:employeeArchiveDocumentName(doc),publishedAt:doc.publication?.at ?? null})),nextCursor:payload.nextCursor};
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

function organizationDestinations(document: PublishedDocument, documents: PublishedDocument[]): string[][] {
  const current = ownDocumentFolderPath(document);
  const defaultPath = ownDocumentFolderPath({ ...document, archivePath: null });
  const category = defaultPath[0];
  const candidates = new Map<string, string[]>();
  for (const candidate of [defaultPath, ...documents.filter((item) => ownDocumentFolderPath({ ...item, archivePath: null })[0] === category).map(ownDocumentFolderPath)]) {
    for (let length = 1; length <= candidate.length; length++) {
      const path = candidate.slice(0, length);
      if (path[0] === category && JSON.stringify(path) !== JSON.stringify(current)) candidates.set(JSON.stringify(path), path);
    }
  }
  return [...candidates.values()].sort((left, right) => left.join("/").localeCompare(right.join("/"), "pt-BR"));
}

export function PublishedEmployeeArchive() {
  const { firebaseUser, user, activeUsers, terminatedUsers, permissions, isDefaultAdmin } = useAuth();
  const canViewTeam = isDefaultAdmin || Boolean(permissions.settings?.manageUsers ||
    permissions.dp?.collaborators?.view && !permissions.dp?.collaborators?.ownProfileOnly);
  const canOrganize = isDefaultAdmin || Boolean(permissions.settings?.manageUsers || permissions.dp?.collaborators?.edit);
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
  const hasDocuments = documents.length > 0;
  // Baixa e inicia o leitor de PDF enquanto a pessoa escolhe o arquivo; não lê documento algum.
  useEffect(() => { if (hasDocuments) warmPdfjs(); }, [hasDocuments]);
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ownLimitReached, setOwnLimitReached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{id: string; url: string; mime: string} | null>(null);
  const [organizationMode, setOrganizationMode] = useState<"rename" | "move" | null>(null);
  const [organizationTarget, setOrganizationTarget] = useState<ArchiveOrganizationTarget | null>(null);
  const requestSequence = useRef(0);
  const fileSequence = useRef(0);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  // Sem acesso à equipe, a ficha abre direto na própria pessoa (não há o que escolher).
  const openedEmployeeId = employeeId ?? (!canViewTeam ? user?.id ?? null : null);
  const employee = people.find(person => person.id === openedEmployeeId);
  const selectedEmployeeId = employee?.id ?? "";
  const own = Boolean(employee && user && employee.id === user.id);
  const aliases = employee ? employeeArchiveIds(employee) : [];
  const aliasKey = aliases.join("\u0000");
  const firebaseUserRef = useRef(firebaseUser);
  const loadKey = JSON.stringify([selectedEmployeeId, firebaseUser?.uid ?? "", own, canViewTeam, aliasKey]);
  const loadedKey = useRef("");

  useEffect(() => { firebaseUserRef.current = firebaseUser; }, [firebaseUser]);
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

  const load = useCallback(async (preserveVisible = false) => {
    const sequence = ++requestSequence.current;
    const currentFirebaseUser = firebaseUserRef.current;
    const keepContent = preserveVisible && loadedKey.current === loadKey;
    if (!keepContent) { setDocuments([]); setCursors([]); setOwnLimitReached(false); }
    setLoadingMore(false); setError(null);
    if (!selectedEmployeeId || !currentFirebaseUser || (!own && !canViewTeam)) { setLoading(false); setRefreshing(false); loadedKey.current = ""; return; }
    if (keepContent) setRefreshing(true); else setLoading(true);
    try {
      const headers = {Authorization: `Bearer ${await currentFirebaseUser.getIdToken()}`};
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
      if (requestSequence.current === sequence) { setDocuments(visible); loadedKey.current = loadKey; }
    } catch (cause) {
      if (requestSequence.current === sequence) setError(cause instanceof Error ? cause.message : "Não foi possível consultar esta pasta.");
    } finally { if (requestSequence.current === sequence) { setLoading(false); setRefreshing(false); } }
  }, [selectedEmployeeId, own, canViewTeam, aliasKey, loadKey]);
  useEffect(() => { void load(false); return () => { requestSequence.current++; }; }, [load]);

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
    setSelectedDocId(null); setPanelOpen(false); setExpanded(false);
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

  function requestOrganization(mode: "rename" | "move", document: PublishedDocument) {
    setOrganizationMode(mode);
    setOrganizationTarget({
      ids: document.archiveReferences?.length ? document.archiveReferences : [document.id],
      name: employeeArchiveDocumentName(document),
      path: ownDocumentFolderPath(document),
      destinations: organizationDestinations(document, visibleDocuments),
    });
  }

  async function saveOrganization(request: ArchiveOrganizationRequest) {
    if (!firebaseUser) throw new Error("Sessão indisponível.");
    const response = await fetch("/api/hr/employee-documents/organization", {
      method: "POST",
      headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "A organização do documento foi recusada.");
    const changed = new Set(request.ids);
    setDocuments((current) => current.map((document) => !changed.has(document.id) ? document : request.action === "rename"
      ? { ...document, archiveName: request.name, displayName: request.name }
      : { ...document, archivePath: request.path }));
    setPreview(null);
    if (request.action === "move" && employee) navigate(employee.id, request.path);
  }

  const term = search.trim().toLocaleLowerCase("pt-BR");
  const visibleDocuments = own ? documents : groupPublishedAdmissionReferences(documents);
  const paths = visibleDocuments.map(ownDocumentFolderPath);
  const tabs = fichaTabs(paths);
  const activeTab = resolveFichaTab(tabs, path[0]);
  const groups = activeTab ? fichaGroups(paths, activeTab) : [];
  const activeGroup = path[1] && groups.some((group) => group.name === path[1]) ? path[1] : null;
  const rows = visibleDocuments
    .map((doc) => ({ doc, placement: fichaPlacement(ownDocumentFolderPath(doc)), name: employeeArchiveDocumentName(doc) }))
    .filter(({ doc, placement, name }) => term
      ? `${name} ${doc.documentType ?? ""} ${ownDocumentFolderPath(doc).join(" ")}`.toLocaleLowerCase("pt-BR").includes(term)
      : placement.tab === activeTab && (!activeGroup || placement.group === activeGroup))
    .sort((left, right) => (archiveTimestamp(right.doc.publishedAt) ?? 0) - (archiveTimestamp(left.doc.publishedAt) ?? 0) || left.name.localeCompare(right.name, "pt-BR", { numeric: true }));
  const hasMore = ownLimitReached || cursors.length > 0;
  const selectedDoc = visibleDocuments.find((doc) => doc.id === selectedDocId) ?? null;
  const pickerPeople = people.filter((person) => person.username.toLocaleLowerCase("pt-BR").includes(pickerSearch.trim().toLocaleLowerCase("pt-BR")));

  function openDocument(doc: PublishedDocument) {
    setSelectedDocId(doc.id); setPanelOpen(true); setExpanded(false);
    if (preview?.id === doc.id) return; // reabrir o mesmo documento reaproveita a prévia já carregada
    fileSequence.current++; setPreview(null);
    if (archivePreviewable(doc.mimeType)) void access(doc);
  }
  const chipClass = (active: boolean) => `inline-flex h-8 items-center gap-1.5 rounded-ds-pill border px-3 text-[12.5px] font-bold ${active ? "border-ds-ink bg-ds-dark text-ds-on-dark" : "border-ds-border bg-ds-surface text-ds-ink-muted hover:bg-ds-muted"}`;

  if (!employee) {
    return <ArchiveShell tab="ficha">
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div>
          <h2 className="text-lg font-extrabold text-ds-ink">Selecione o colaborador</h2>
          <p className="mt-1 max-w-[68ch] text-[13px] text-ds-ink-muted">A ficha mostra os documentos publicados ou compartilhados com a pessoa: exatamente o que ela vê no portal do colaborador.</p>
        </div>
        {employeeId && <p role="alert" className="rounded-ds-md border border-ds-confirm-border bg-ds-confirm-bg p-3 text-sm text-ds-confirm-ink">Ficha indisponível para seu acesso atual.</p>}
        <div className="relative w-full sm:w-80"><Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" /><Input aria-label="Buscar colaborador" placeholder="Buscar colaborador…" value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} className="h-9 bg-ds-surface pl-8 text-xs" /></div>
        <div role="group" aria-label="Colaboradores" className="rounded-ds-card border border-ds-border">
          {pickerPeople.map((person) => <LiftRow key={person.id} aria-label={`Abrir ficha de ${person.username}`} onClick={() => navigate(person.id)} className="flex items-center gap-3">
            <PersonAvatar name={person.username} avatarUrl={person.avatarUrl} color={person.color} size={36} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-bold text-ds-ink">{person.username}</span><span className="block text-[11.5px] text-ds-ink-faint">{person.id === user?.id ? "Minha ficha" : "Documentos publicados"}</span></span>
            {person.isActive === false && <span className="rounded-ds-pill bg-ds-neutral-bg px-2 py-0.5 text-[11px] font-bold text-ds-neutral">Desligado</span>}
            <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" />
          </LiftRow>)}
          {pickerPeople.length === 0 && <p className="m-3 rounded-ds-md border border-dashed border-ds-border p-4 text-center text-[13px] text-ds-ink-muted">Nenhum colaborador encontrado.</p>}
        </div>
      </div>
    </ArchiveShell>;
  }

  return <><ArchiveShell tab="ficha">
    <div className="flex flex-wrap items-center gap-4 border-b border-ds-border px-4 py-4 sm:px-6">
      <PersonAvatar name={employee.username} avatarUrl={employee.avatarUrl} color={employee.color} size={48} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-extrabold text-ds-ink">{employee.username}</h2>
        <p className="text-[12.5px] text-ds-ink-muted">{own ? "Seus documentos publicados" : "O que o colaborador vê no portal"} · {visibleDocuments.length} {visibleDocuments.length === 1 ? "documento" : "documentos"}{(ownLimitReached || cursors.length > 0) ? " carregados" : ""}{employee.isActive === false ? " · Desligado" : ""}</p>
      </div>
      {canViewTeam && people.length > 1 && <label className="flex items-center gap-2 text-[12px] font-bold text-ds-ink-2">Colaborador
        <select aria-label="Trocar colaborador" value={employee.id} onChange={(event) => navigate(event.target.value || null)} className="h-9 max-w-[220px] rounded-ds-sm border border-ds-border-input bg-ds-surface px-2 text-xs font-semibold text-ds-ink">
          {people.map((person) => <option key={person.id} value={person.id}>{person.username}{person.isActive === false ? " (desligado)" : ""}</option>)}
        </select>
      </label>}
      <Button size="icon" variant="ds-ghost" aria-label="Atualizar ficha" disabled={loading || refreshing} onClick={() => void load(true)}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /></Button>
    </div>
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ds-border px-4 sm:px-6">
      <nav aria-label="Pastas da ficha" className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => <button key={tab.name} type="button" aria-current={!term && tab.name === activeTab ? "page" : undefined} onClick={() => { setSearch(""); navigate(employee.id, [tab.name]); }}
          className={`inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-bold ${!term && tab.name === activeTab ? "border-ds-accent text-ds-ink" : "border-transparent text-ds-ink-muted hover:text-ds-ink"}`}>
          {tab.name}<span className="font-ds-mono text-[11px] font-semibold text-ds-ink-faint">{tab.count}</span>
        </button>)}
      </nav>
      <div className="relative mb-2 w-full sm:w-60"><Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" /><Input aria-label="Buscar na ficha" placeholder="Buscar na ficha…" value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 bg-ds-surface pl-8 text-xs" /></div>
    </div>
    <main aria-label="Documentos da ficha" className="min-w-0">
      {error && <p role="alert" className="m-3 rounded-ds-md border border-ds-confirm-border bg-ds-confirm-bg p-3 text-sm text-ds-confirm-ink">{error}</p>}
      {!term && groups.length > 0 && <div role="group" aria-label="Subpastas" className="flex flex-wrap gap-2 px-4 pt-3 sm:px-6">
        <button type="button" aria-pressed={!activeGroup} onClick={() => activeTab && navigate(employee.id, [activeTab])} className={chipClass(!activeGroup)}>Todas</button>
        {groups.map((group) => <button key={group.name} type="button" aria-pressed={activeGroup === group.name} onClick={() => activeTab && navigate(employee.id, [activeTab, group.name])} className={chipClass(activeGroup === group.name)}>{group.name}<span className="opacity-70">{group.count}</span></button>)}
      </div>}
      {loading ? <div role="status" className="grid min-h-64 place-items-center"><Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-ds-ink-muted" /><span className="sr-only">Carregando ficha</span></div> : <div className="px-0 pt-3">
        {rows.length > 0 && <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-y border-ds-border bg-ds-muted px-[18px] py-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-ds-ink-faint md:grid-cols-[minmax(0,1fr)_220px_110px_80px]">
          <span>Documento</span><span className="hidden md:block">Pasta</span><span className="hidden md:block">Publicado em</span><span className="hidden md:block">Tamanho</span>
        </div>}
        <div role="group" aria-label="Documentos publicados">
          {rows.map(({ doc, name }) => {
            const folder = ownDocumentFolderPath(doc);
            const where = term ? folder.join(" › ") : folder.slice(1).join(" › ");
            return <LiftRow key={doc.id} id={"ficha-doc-" + encodeURIComponent(doc.id)} aria-label={`Arquivo: ${name}`} table selected={panelOpen && selectedDocId === doc.id} onClick={() => openDocument(doc)}
              className="grid grid-cols-[minmax(0,1fr)] items-center gap-3 md:grid-cols-[minmax(0,1fr)_220px_110px_80px]">
              <span className="flex min-w-0 items-center gap-3"><ArchiveEntryIcon entry={{ kind: "file", name: doc.originalName || name, mimeType: doc.mimeType }} className="h-5 w-5" />
                <span className="min-w-0"><span className="block break-words text-[13px] font-semibold text-ds-ink">{name}</span>{doc.documentType && <span className="mt-0.5 block truncate text-[11.5px] text-ds-ink-faint">{doc.documentType}</span>}</span></span>
              <span className="hidden truncate text-[12px] text-ds-ink-muted md:block">{where || "—"}</span>
              <span className="hidden text-[12px] tabular-nums text-ds-ink-muted md:block">{doc.publishedAt ? new Date(doc.publishedAt).toLocaleDateString("pt-BR") : "—"}</span>
              <span className="hidden text-[12px] tabular-nums text-ds-ink-muted md:block">{doc.size ? `${Math.ceil(doc.size / 1024)} KB` : "—"}</span>
            </LiftRow>;
          })}
        </div>
        {rows.length === 0 && !error && <p className="m-4 rounded-ds-md border border-dashed border-ds-border p-6 text-center text-[13px] text-ds-ink-muted sm:mx-6">{term ? "Nenhum documento encontrado na ficha." : visibleDocuments.length === 0 ? (hasMore ? "Nenhum documento nas páginas carregadas." : "Nenhum documento publicado para este colaborador.") : "Nenhum documento nesta pasta."}</p>}
      </div>}
      <div className="space-y-2 px-4 py-3 text-xs text-ds-ink-muted sm:px-6">
        {ownLimitReached && <p role="status">Há mais documentos publicados do que esta consulta exibe. Peça ao DP a conferência dos demais.</p>}
        {hasMore && <p>Busca e abas consideram somente as páginas carregadas.</p>}
        {cursors.length > 0 && <Button type="button" variant="ds-secondary" size="xs" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Carregando…" : "Carregar mais documentos"}</Button>}
        <p className="text-[11px] text-ds-ink-faint">Clique num documento para ver a prévia e as ações.</p>
      </div>
    </main>
  </ArchiveShell>
    <SidePanel open={panelOpen && Boolean(selectedDoc)} onOpenChange={setPanelOpen} kicker="Documento publicado"
      title={selectedDoc ? employeeArchiveDocumentName(selectedDoc) : "Documento"} subtitle={selectedDoc?.documentType ?? undefined}>
      {selectedDoc && <>
        <div role="region" aria-label="Prévia e detalhes" className="flex flex-col gap-3">
          {preview?.id === selectedDoc.id ? <ArchivePreview url={preview.url} mime={preview.mime} title={employeeArchiveDocumentName(selectedDoc)} />
            : archivePreviewable(selectedDoc.mimeType) ? <p className="text-xs text-ds-ink-muted">Carregando a prévia…</p> : <p className="text-xs text-ds-ink-muted">Este formato não tem prévia. Use Baixar.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PanelField label="Pasta">{ownDocumentFolderPath(selectedDoc).join(" › ") || "—"}</PanelField>
          <PanelField label="Publicado em">{selectedDoc.publishedAt ? new Date(selectedDoc.publishedAt).toLocaleDateString("pt-BR") : "—"}</PanelField>
          {selectedDoc.size ? <PanelField label="Tamanho">{`${Math.ceil(selectedDoc.size / 1024)} KB`}</PanelField> : null}
          <PanelField label="Visível para">{own ? "Você" : employee.username}</PanelField>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {archivePreviewable(selectedDoc.mimeType) && <Button variant="ds-secondary" size="md" disabled={preview?.id !== selectedDoc.id} onClick={() => { setPanelOpen(false); setExpanded(true); }}>Ampliar prévia</Button>}
          <Button variant="ds-secondary" size="md" onClick={() => void access(selectedDoc, true)}>Baixar</Button>
          {canOrganize && <Button variant="ds-secondary" size="md" onClick={() => { setPanelOpen(false); requestOrganization("rename", selectedDoc); }}>Renomear</Button>}
          {canOrganize && organizationDestinations(selectedDoc, visibleDocuments).length > 0 && <Button variant="ds-secondary" size="md" onClick={() => { setPanelOpen(false); requestOrganization("move", selectedDoc); }}>Mover</Button>}
        </div>
      </>}
    </SidePanel>
    <Dialog open={expanded && Boolean(selectedDoc) && preview?.id === selectedDoc?.id} onOpenChange={setExpanded}><DialogContent className="flex max-h-[90vh] max-w-[min(1000px,95vw)] sm:max-w-[min(1000px,95vw)] flex-col overflow-auto"><DialogHeader><DialogTitle className="break-words">{selectedDoc ? employeeArchiveDocumentName(selectedDoc) : "Documento"}</DialogTitle></DialogHeader>{selectedDoc && preview?.id === selectedDoc.id && <ArchivePreview variant="expanded" url={preview.url} mime={preview.mime} title={employeeArchiveDocumentName(selectedDoc)} />}</DialogContent></Dialog>
    <ArchiveDocumentOrganizationDialog mode={organizationMode} target={organizationTarget} onClose={() => { setOrganizationMode(null); setOrganizationTarget(null); }} onSave={saveOrganization} />
  </>;
}
