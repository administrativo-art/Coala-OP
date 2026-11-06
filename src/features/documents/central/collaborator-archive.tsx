"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { LiftRow } from "@/components/patterns/lift-row";
import { Segmented } from "@/components/patterns/segmented";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { canAccessUserByUnit } from "@/lib/unit-access";
import { employeeDocumentDownloadName } from "@/lib/hr/employee-document-planning";
import { employeeArchiveIds, employeeArchiveChildFolders, employeeArchiveDocumentName, groupPublishedAdmissionReferences, groupSignedAdmissionReferences } from "@/lib/documents/employee-archive";
import { archiveLocationLabel, matchesArchiveSearch, matchingArchiveFolders, parseArchiveSearch } from "@/lib/documents/archive-search";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { isPublishedToEmployee, type DocumentPublication } from "@/lib/hr/employee-document-publication";
import type { EmployeeDossierFolder } from "@/lib/hr/employee-document-folder-templates";
import type { OnboardingDocument } from "@/types";
import { EMPLOYEE_DOCUMENT_CATEGORIES, EMPLOYEE_DOCUMENT_VISIBLE_CATEGORIES, normalizeEmployeeDocumentCategory, resolveEmployeeDocumentFolderPath, type EmployeeDocumentCategoryId } from "@/lib/hr/employee-document-options";
import { ownDocumentFolderPath } from "@/features/hr/documents/own-document-folders";
import { archivePreviewable, archiveTimestamp } from "@/lib/documents/archive-entry-sort";
import { ArchiveExplorer, ArchiveShell, COLLABORATOR_SEARCH_EXAMPLES, PEOPLE_SEARCH_EXAMPLES, type ArchiveAction, type ArchiveEntry } from "./archive-explorer";
import { ArchiveSearchInput } from "./archive-search-input";
import { ArchivePreview } from "./archive-preview";
import { ArchiveOriginActionDialog, type ArchiveOriginAction } from "./archive-origin-action-dialog";
import { canRemoveEmployeeArchiveDocument } from "./archive-origin-capabilities";
import { ArchiveDocumentOrganizationDialog, type ArchiveOrganizationRequest, type ArchiveOrganizationTarget } from "./archive-document-organization-dialog";

type ArchiveDocument = {
  id: string; category: string; documentType?: string | null; documentTypeCode?: string | null; originalName: string; storedName?: string; displayName?: string; archiveName?: string | null;
  mimeType?: string | null; size?: number | null; uploadedAt?: string; publishedAt?: string | null; destinationTrail?: string[]; archivePath?: string[] | null;
  source?: "generated" | "onboarding" | "autentique_signature" | string; status?: string; signatureStatus?: string; employeeId?: string; contentHash?: string; signatureRequestId?: string;
  sourceOnboardingId?: string; accessLevel?: string; accessPolicyId?: string; publication?: DocumentPublication | null; archiveReferences?: string[]; archiveSourceNames?: string[];
  sourceId?: string; pdfAvailable?: boolean; originHref?: string; folderCode?: string; version?: number;
};

/** Categorias que ficam só no primeiro nível, sem subpastas, na visão de quem gerencia. */
const ROOT_ONLY = ["personal", "admission", "benefits", "uniforms", "training", "warnings", "termination"];

function categoryOf(document: Pick<ArchiveDocument, "category">) {
  const stored = EMPLOYEE_DOCUMENT_CATEGORIES.some((entry) => entry.id === document.category) ? document.category as EmployeeDocumentCategoryId : "pending_classification";
  return normalizeEmployeeDocumentCategory(stored);
}
/** Caminho na visão de quem gerencia (mesmo da antiga pasta Empresa › Colaboradores). */
function managerFolderPath(document: ArchiveDocument): string[] {
  if (document.source === "generated" || document.source === "onboarding") return document.archivePath ?? [];
  const categoryId = categoryOf(document);
  const category = EMPLOYEE_DOCUMENT_CATEGORIES.find((entry) => entry.id === categoryId)!;
  if (ROOT_ONLY.includes(categoryId)) return [category.label];
  if (document.archivePath) return document.archivePath;
  return [category.label, ...resolveEmployeeDocumentFolderPath({ category: categoryId, documentTypeCode: document.documentTypeCode ?? undefined, documentTypeLabel: document.documentType ?? undefined, destinationTrail: document.destinationTrail })];
}
function templateFolderPath(folder: EmployeeDossierFolder) {
  const categoryId = normalizeEmployeeDocumentCategory(folder.category);
  const label = EMPLOYEE_DOCUMENT_CATEGORIES.find((category) => category.id === categoryId)?.label ?? categoryId;
  return [...ROOT_ONLY, "work_schedule", "vacations", "leaves"].includes(categoryId) ? [label] : [label, ...folder.path];
}
function downloadName(document: ArchiveDocument) {
  return document.source === "generated" && document.pdfAvailable ? document.originalName.replace(/\.[^.]+$/, "") + ".pdf" : employeeDocumentDownloadName(document as Parameters<typeof employeeDocumentDownloadName>[0]);
}
/** Nome canônico enviado pela origem (Content-Disposition); sem ele, o nome montado no cliente. */
function responseFileName(response: Response, fallback: string): string {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const regular = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  let candidate: string | undefined;
  try { candidate = encoded ? decodeURIComponent(encoded) : regular; } catch { candidate = regular; }
  return (candidate || fallback).split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f\x7f]/g, "_") || "documento";
}
function readPath(value: string | null): string[] {
  try { const result = JSON.parse(value ?? "[]"); return Array.isArray(result) && result.length <= 20 && result.every((part) => typeof part === "string" && part.length <= 200) ? result : []; } catch { return []; }
}
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Aba Colaborador do Acervo: a pasta de cada colaborador.
 * - Quem gerencia a equipe vê todos os documentos da pessoa (os publicados levam a marca "Publicado")
 *   e todas as pastas padrão, inclusive vazias.
 * - Sem essa permissão, a pessoa vê só a própria pasta, com o que foi publicado para ela.
 */
export function CollaboratorArchive() {
  const router = useRouter();
  const { firebaseUser, user, activeUsers, terminatedUsers, permissions, isDefaultAdmin } = useAuth();
  const canViewTeam = isDefaultAdmin || Boolean(permissions.settings?.manageUsers || permissions.dp?.collaborators?.view && !permissions.dp?.collaborators?.ownProfileOnly);
  const canManage = isDefaultAdmin || Boolean(permissions.settings?.manageUsers || permissions.dp?.collaborators?.edit);
  const canViewGenerated = hasFormalizationPermission(permissions, "documents.view", isDefaultAdmin);
  const canReviewGenerated = hasFormalizationPermission(permissions, "documents.review", isDefaultAdmin);
  const people = useMemo(() => {
    if (!user) return [];
    const permitted = canViewTeam ? [user, ...activeUsers, ...terminatedUsers].filter((person) => person.id === user.id || canAccessUserByUnit(user, person, { isDefaultAdmin })) : [user];
    return [...new Map(permitted.map((person) => [person.id, person])).values()].sort((left, right) => left.username.localeCompare(right.username, "pt-BR"));
  }, [user, canViewTeam, activeUsers, terminatedUsers, isDefaultAdmin]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  // Sem acesso à equipe, a aba abre direto na própria pasta (não há o que escolher).
  const openedEmployeeId = employeeId ?? (!canViewTeam ? user?.id ?? null : null);
  const employee = people.find((person) => person.id === openedEmployeeId);
  const full = canViewTeam;
  const own = Boolean(employee && user && employee.id === user.id);
  const linkedIds = JSON.stringify(employee ? employeeArchiveIds(employee) : []);
  const onboardingId = employee?.onboardingId;
  const [path, setPath] = useState<string[]>([]);
  const [documents, setDocuments] = useState<ArchiveDocument[]>([]);
  const [templatePaths, setTemplatePaths] = useState<string[][]>([]);
  const [search, setSearch] = useState("");
  /** Filtro rápido da escolha do colaborador. */
  const [status, setStatus] = useState<"active" | "terminated">("active");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [preview, setPreview] = useState<{ id: string; url: string; mime: string } | null>(null);
  const [originAction, setOriginAction] = useState<ArchiveOriginAction | null>(null);
  const [organizationMode, setOrganizationMode] = useState<"rename" | "move" | null>(null);
  const [organizationTarget, setOrganizationTarget] = useState<ArchiveOrganizationTarget | null>(null);
  const sequence = useRef(0);
  const fileSequence = useRef(0);
  const loadedFor = useRef("");

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    const restore = () => { const params = new URLSearchParams(window.location.search); setEmployeeId(params.get("employee")); setPath(readPath(params.get("path"))); setSearch(""); setPreview(null); fileSequence.current++; };
    restore(); window.addEventListener("popstate", restore);
    return () => { sequence.current++; fileSequence.current++; window.removeEventListener("popstate", restore); };
  }, []);

  const employeeKey = employee?.id ?? "";
  const load = useCallback(async (keepVisible = false) => {
    const request = ++sequence.current;
    const loadKey = JSON.stringify([employeeKey, full, linkedIds]);
    const keep = keepVisible && loadedFor.current === loadKey;
    if (!keep) { setDocuments([]); setTemplatePaths([]); setLimitReached(false); }
    setError(null);
    if (!employeeKey || !firebaseUser || (!full && !own)) { setLoading(false); setRefreshing(false); loadedFor.current = ""; return; }
    if (keep) setRefreshing(true); else setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${await firebaseUser.getIdToken()}` };
      const query = async (url: string) => {
        const response = await fetch(url, { headers, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error("Uma origem da pasta não pôde ser consultada. A lista pode estar incompleta.");
        return result;
      };
      if (!full) {
        // Própria pasta: só o que foi publicado para a pessoa, como no portal do colaborador.
        const payload = await query("/api/collaborator/documents");
        if (sequence.current !== request) return;
        setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
        setLimitReached(payload.limitReached === true);
        loadedFor.current = loadKey;
        return;
      }
      const ids = JSON.parse(linkedIds) as string[];
      const [uploads, profiles, generated, onboarding] = await Promise.all([
        Promise.allSettled(ids.map((id) => query(`/api/hr/employee-documents?employeeId=${encodeURIComponent(id)}`))),
        Promise.allSettled(ids.map((id) => query(`/api/hr/employee-document-folder-profile?employeeId=${encodeURIComponent(id)}`))),
        Promise.allSettled(canViewGenerated ? ids.map((id) => query(`/api/documents/generated?employeeId=${encodeURIComponent(id)}`)) : []),
        Promise.allSettled(canViewGenerated && onboardingId ? [query(`/api/hr/onboarding/${encodeURIComponent(onboardingId)}`)] : []),
      ]);
      if (sequence.current !== request) return;
      const rows = new Map<string, ArchiveDocument>();
      for (const source of uploads) if (source.status === "fulfilled") for (const document of source.value.documents ?? []) rows.set(document.id, document);
      for (const source of generated) if (source.status === "fulfilled") for (const document of source.value.documents ?? []) {
        const id = `generated:${document.id}`;
        rows.set(id, { id, source: "generated", sourceId: document.id, status: document.status, category: "generated", displayName: document.templateName || document.originalName || "Documento gerado", originalName: document.originalName || "documento.docx", uploadedAt: document.generatedAt, pdfAvailable: document.pdfAvailable, archivePath: ["Documentos gerados"], originHref: `/dashboard/documents/generated?document=${encodeURIComponent(document.id)}` });
      }
      for (const source of onboarding) if (source.status === "fulfilled") for (const document of (source.value.process?.documents ?? []) as OnboardingDocument[]) {
        if (document.promotedDocumentId || !(document.fileUrl || document.filePath)) continue;
        const id = `onboarding:${document.id}`;
        rows.set(id, { id, source: "onboarding", sourceId: document.id, category: "admission", displayName: document.label, originalName: document.label, uploadedAt: document.receivedAt ?? undefined, archivePath: ["Admissão em andamento"], originHref: `/dashboard/hr/recruitment/integration?process=${encodeURIComponent(onboardingId!)}&document=${encodeURIComponent(document.id)}` });
      }
      setDocuments(groupSignedAdmissionReferences([...rows.values()]));
      setTemplatePaths(profiles.flatMap((source) => source.status === "fulfilled" ? (source.value.folderProfile?.folders ?? []).map(templateFolderPath) : []));
      loadedFor.current = loadKey;
      if ([...uploads, ...profiles, ...generated, ...onboarding].some((result) => result.status === "rejected")) setError("Uma ou mais origens não puderam ser consultadas. Os documentos exibidos podem estar incompletos; tente Atualizar.");
      else if (generated.some((result) => result.status === "fulfilled" && result.value.documents?.length >= 300)) setError("A origem de documentos gerados atingiu o limite da consulta. Consulte a gestão documental para ver os demais.");
    } catch (cause) { if (sequence.current === request) setError(cause instanceof Error ? cause.message : "Falha ao consultar os documentos."); }
    finally { if (sequence.current === request) { setLoading(false); setRefreshing(false); } }
  }, [employeeKey, full, own, linkedIds, onboardingId, canViewGenerated, firebaseUser]);
  useEffect(() => { void load(); }, [load]);

  function navigate(id: string | null, next: string[] = []) {
    setEmployeeId(id); setPath(next); setSearch(""); setPreview(null); fileSequence.current++;
    const url = new URL(window.location.href); url.searchParams.delete("employee"); url.searchParams.delete("path");
    if (id) url.searchParams.set("employee", id);
    if (next.length) url.searchParams.set("path", JSON.stringify(next));
    window.history.pushState(null, "", url);
  }
  async function access(document: ArchiveDocument, download = false) {
    if (!firebaseUser || !employee) return;
    if (document.source === "onboarding") { if (document.originHref) router.push(document.originHref); return; }
    const request = ++fileSequence.current;
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = document.source === "generated"
        ? await fetch(`/api/documents/generated/${encodeURIComponent(document.sourceId!)}/file${document.pdfAvailable ? "?format=pdf" : ""}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
        : await fetch(full ? "/api/hr/employee-documents/access" : "/api/collaborator/documents/access", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: document.id, action: download ? "download" : "view" }), cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível acessar este documento. Confira sua permissão atual.");
      const blob = await response.blob();
      if (request !== fileSequence.current) return;
      const url = URL.createObjectURL(blob);
      if (download) { const link = window.document.createElement("a"); link.href = url; link.download = responseFileName(response, downloadName(document)); link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      else setPreview({ id: document.id, url, mime: blob.type });
    } catch (cause) { if (request === fileSequence.current) setError(cause instanceof Error ? cause.message : "Falha ao abrir arquivo."); }
  }
  function requestRemoval(document: ArchiveDocument) {
    const name = employeeArchiveDocumentName(document);
    const generated = document.source === "generated";
    setOriginAction({
      title: generated ? "Descartar documento em preparação?" : "Remover documento da pasta?",
      description: generated ? `Confira “${name}”. Somente a prévia em rascunho ou conferência pode ser descartada.` : `Confira “${name}”. Se for um PDF assinado compartilhado, o original será preservado na trilha de assinatura.`,
      confirmation: generated ? `Confirma o descarte de “${name}” e dos arquivos temporários desta versão?` : `Confirma a remoção de “${name}” desta pasta? A origem decidirá se os bytes podem ser eliminados.`,
      confirmLabel: generated ? "Descartar definitivamente" : "Remover da pasta",
      execute: async () => {
        if (!firebaseUser) throw new Error("Sessão indisponível.");
        const token = await firebaseUser.getIdToken();
        const url = generated ? `/api/documents/generated/${encodeURIComponent(document.sourceId!)}` : `/api/hr/employee-documents?id=${encodeURIComponent(document.id)}`;
        const response = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "A origem recusou a remoção.");
        setDocuments((current) => current.filter((item) => item.id !== document.id));
        setPreview(null);
      },
    });
  }

  const visible = useMemo(() => full ? documents : groupPublishedAdmissionReferences(documents as Parameters<typeof groupPublishedAdmissionReferences>[0]) as ArchiveDocument[], [documents, full]);
  const pathOf = useCallback((document: ArchiveDocument) => full ? managerFolderPath(document) : ownDocumentFolderPath(document as Parameters<typeof ownDocumentFolderPath>[0]), [full]);
  const allPaths = useMemo(() => {
    const standard = full ? [...EMPLOYEE_DOCUMENT_VISIBLE_CATEGORIES.map((category) => [category.label]), ...templatePaths] : [];
    return [...standard, ...visible.map(pathOf)];
  }, [full, templatePaths, visible, pathOf]);
  const countUnder = (prefix: readonly string[]) => visible.filter((document) => { const folder = pathOf(document); return prefix.every((part, index) => folder[index] === part); }).length;

  function organizationDestinations(document: ArchiveDocument): string[][] {
    const current = pathOf(document);
    const category = current[0];
    const candidates = new Map<string, string[]>();
    for (const candidate of [pathOf({ ...document, archivePath: null }), ...allPaths].filter((folder) => folder[0] === category)) {
      for (let length = 1; length <= candidate.length; length++) {
        const folder = candidate.slice(0, length);
        if (JSON.stringify(folder) !== JSON.stringify(current)) candidates.set(JSON.stringify(folder), folder);
      }
    }
    return [...candidates.values()].sort((left, right) => left.join("/").localeCompare(right.join("/"), "pt-BR"));
  }
  const canOrganizeDocument = (document: ArchiveDocument) => canManage && document.source !== "generated" && document.source !== "onboarding";
  function requestOrganization(mode: "rename" | "move", document: ArchiveDocument) {
    setOrganizationMode(mode);
    setOrganizationTarget({ ids: document.archiveReferences?.length ? document.archiveReferences : [document.id], name: employeeArchiveDocumentName(document), path: pathOf(document), destinations: organizationDestinations(document) });
  }
  async function saveOrganization(request: ArchiveOrganizationRequest) {
    if (!firebaseUser) throw new Error("Sessão indisponível.");
    const response = await fetch("/api/hr/employee-documents/organization", { method: "POST", headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(request), cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "A organização do documento foi recusada.");
    const changed = new Set(request.ids);
    setDocuments((current) => current.map((document) => !changed.has(document.id) ? document : request.action === "rename" ? { ...document, archiveName: request.name, displayName: request.name } : { ...document, archivePath: request.path }));
    setPreview(null);
    if (request.action === "move" && employee) navigate(employee.id, request.path);
  }

  const terms = useMemo(() => parseArchiveSearch(search), [search]);
  const fileEntry = (document: ArchiveDocument, withLocation: boolean): ArchiveEntry => {
    const previewable = document.source === "generated" ? Boolean(document.pdfAvailable) : archivePreviewable(document.mimeType ?? undefined);
    const actions: ArchiveAction[] = [
      ...(document.source !== "onboarding" ? [{ label: "Baixar", run: () => void access(document, true) }] : []),
      ...(canOrganizeDocument(document) ? [{ label: "Renomear", run: () => requestOrganization("rename", document) }] : []),
      ...(canOrganizeDocument(document) && organizationDestinations(document).length ? [{ label: "Mover", run: () => requestOrganization("move", document) }] : []),
      ...(full && document.originHref ? [{ label: document.source === "onboarding" ? "Abrir na admissão" : "Ver origem e assinatura", run: () => router.push(document.originHref!) }] : []),
      ...(full && canRemoveEmployeeArchiveDocument({ source: document.source as "generated" | "onboarding" | "autentique_signature" | undefined, status: document.status, canManageEmployeeDocuments: canManage, canReviewGenerated }) ? [{ label: document.source === "generated" ? "Descartar preparação" : "Remover da pasta", destructive: true, run: () => requestRemoval(document) }] : []),
    ];
    const when = full ? document.uploadedAt : document.publishedAt ?? document.uploadedAt;
    return {
      id: document.id, name: employeeArchiveDocumentName(document), kind: "file", mimeType: document.mimeType,
      description: `${document.source === "generated" ? "Versão gerada · " : document.source === "onboarding" ? "Admissão · " : ""}${document.documentType || downloadName(document)}`,
      badge: full && isPublishedToEmployee(document) ? "Publicado" : undefined,
      location: withLocation ? archiveLocationLabel(pathOf(document)) : undefined,
      size: document.size ? `${Math.ceil(document.size / 1024)} KB` : undefined, sizeBytes: document.size, modified: when ? new Date(when).toLocaleDateString("pt-BR") : undefined, modifiedAt: archiveTimestamp(when ?? undefined),
      open: () => void access(document, !previewable), loadPreview: document.source !== "onboarding" && previewable ? () => void access(document) : undefined, actions,
    };
  };
  const folderEntry = (folder: string[], withLocation: boolean): ArchiveEntry => {
    const count = countUnder(folder);
    return { id: "folder:" + JSON.stringify(folder), name: folder[folder.length - 1], kind: "folder", muted: count === 0, description: count ? plural(count, "documento", "documentos") : "Vazia", location: withLocation && folder.length > 1 ? archiveLocationLabel(folder.slice(0, -1)) : undefined, open: () => navigate(employee!.id, folder) };
  };

  // Sem pessoa aberta (só para quem vê a equipe): lista de colaboradores com filtro Ativos/Desligados.
  if (!employee && canViewTeam) {
    const counts = { active: people.filter((person) => person.isActive !== false).length, terminated: people.filter((person) => person.isActive === false).length };
    const listed = people.filter((person) => (status === "terminated") === (person.isActive === false) && matchesArchiveSearch(terms, [person.username]));
    return <ArchiveShell tab="collaborator">
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div>
          <h2 className="text-lg font-extrabold text-ds-ink">Selecione o colaborador</h2>
          <p className="mt-1 max-w-[68ch] text-[13px] text-ds-ink-muted">Abra a pasta de uma pessoa para ver os documentos dela. Os que levam a marca Publicado são os que ela vê no portal do colaborador.</p>
        </div>
        {employeeId && <p role="alert" className="rounded-ds-md border border-ds-confirm-border bg-ds-confirm-bg p-3 text-sm text-ds-confirm-ink">Pasta indisponível para seu acesso atual.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <ArchiveSearchInput label="Buscar colaborador" prefix="Buscar" examples={PEOPLE_SEARCH_EXAMPLES} value={search} onChange={setSearch} className="sm:w-80" />
          <Segmented aria-label="Situação do colaborador" value={status} onChange={setStatus} options={[{ value: "active", label: `Ativos ${counts.active}` }, { value: "terminated", label: `Desligados ${counts.terminated}` }]} />
        </div>
        <div role="group" aria-label="Colaboradores" className="rounded-ds-card border border-ds-border">
          {listed.map((person) => <LiftRow key={person.id} aria-label={`Abrir pasta de ${person.username}`} onClick={() => navigate(person.id)} className="flex items-center gap-3">
            <PersonAvatar name={person.username} avatarUrl={person.avatarUrl} color={person.color} size={36} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-bold text-ds-ink">{person.username}</span><span className="block text-[11.5px] text-ds-ink-faint">{person.id === user?.id ? "Minha pasta" : person.isActive === false ? "Desligado" : "Colaborador ativo"}</span></span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" />
          </LiftRow>)}
          {listed.length === 0 && <p className="m-3 rounded-ds-md border border-dashed border-ds-border p-4 text-center text-[13px] text-ds-ink-muted">{terms.length ? "Nenhum colaborador encontrado." : status === "terminated" ? "Nenhum colaborador desligado." : "Nenhum colaborador ativo."}</p>}
        </div>
      </div>
    </ArchiveShell>;
  }

  let entries: ArchiveEntry[];
  if (!employee) {
    entries = [];
  } else if (terms.length) {
    entries = [
      ...matchingArchiveFolders(allPaths, terms).map((folder) => folderEntry(folder, true)),
      ...visible.filter((document) => matchesArchiveSearch(terms, [employeeArchiveDocumentName(document), document.originalName, document.documentType, ...(document.archiveSourceNames ?? []), ...pathOf(document)])).map((document) => fileEntry(document, true)),
    ];
  } else {
    entries = [
      ...employeeArchiveChildFolders(allPaths, path).map((name) => folderEntry([...path, name], false)),
      ...visible.filter((document) => { const folder = pathOf(document); return folder.length === path.length && path.every((part, index) => folder[index] === part); }).map((document) => fileEntry(document, false)),
    ];
  }

  const published = full ? visible.filter((document) => isPublishedToEmployee(document)).length : visible.length;
  const header = employee ? <div className="flex flex-wrap items-center gap-4 border-b border-ds-border px-4 py-4 sm:px-6">
    <PersonAvatar name={employee.username} avatarUrl={employee.avatarUrl} color={employee.color} size={48} />
    <div className="min-w-0 flex-1">
      <h2 className="truncate text-lg font-extrabold text-ds-ink">{employee.username}</h2>
      <p className="text-[12.5px] text-ds-ink-muted">{full
        ? `${plural(visible.length, "documento", "documentos")} · ${plural(published, "publicado", "publicados")} para a pessoa`
        : `${own ? "Seus documentos publicados" : "Documentos publicados"} · ${plural(visible.length, "documento", "documentos")}`}{employee.isActive === false ? " · Desligado" : ""}</p>
    </div>
    {canViewTeam && people.length > 1 && <label className="flex items-center gap-2 text-[12px] font-bold text-ds-ink-2">Colaborador
      <select aria-label="Trocar colaborador" value={employee.id} onChange={(event) => navigate(event.target.value || null)} className="h-9 max-w-[220px] rounded-ds-sm border border-ds-border-input bg-ds-surface px-2 text-xs font-semibold text-ds-ink">
        {people.map((person) => <option key={person.id} value={person.id}>{person.username}{person.isActive === false ? " (desligado)" : ""}</option>)}
      </select>
    </label>}
    {full && canManage && <Button asChild size="sm" variant="ds-secondary"><Link href={`/dashboard/dp/collaborators/${encodeURIComponent(employee.id)}/documents`}>Gerenciar pasta</Link></Button>}
  </div> : null;

  const unavailable = employeeId && !employee ? "Pasta indisponível para seu acesso atual." : null;
  return <><ArchiveExplorer area="collaborators" header={header} selectionScope={JSON.stringify([employee?.id ?? null, path, terms])} entries={entries} search={search} onSearch={setSearch} loading={loading} refreshing={refreshing}
    error={unavailable ?? error}
    searchLabel={employee ? `Buscar nos documentos de ${employee.username}` : "Buscar colaborador"} searchPrefix="Buscar" searchExamples={employee ? COLLABORATOR_SEARCH_EXAMPLES : PEOPLE_SEARCH_EXAMPLES}
    breadcrumbs={employee ? [{ name: employee.username, open: () => navigate(employee.id) }, ...path.map((name, index) => ({ name, open: () => navigate(employee.id, path.slice(0, index + 1)) }))] : []}
    onRoot={canViewTeam ? () => navigate(null) : employee ? () => navigate(employee.id) : undefined}
    onUp={() => path.length ? navigate(employee!.id, path.slice(0, -1)) : canViewTeam && employee ? navigate(null) : undefined}
    onRefresh={employee ? () => void load(true) : undefined} onSelect={() => { fileSequence.current++; setPreview(null); }}
    footer={limitReached ? <p role="status" className="px-4 pt-3 text-xs text-ds-ink-muted">Há mais documentos publicados do que esta consulta exibe. Peça ao DP a conferência dos demais.</p> : null}
    preview={(entry) => { const document = visible.find((item) => item.id === entry.id); return <div className="space-y-3 text-xs text-ds-ink-muted">{preview?.id === entry.id && <ArchivePreview url={preview.url} mime={preview.mime} title={entry.name} />}<details className="rounded-ds-sm border border-ds-border bg-ds-surface p-2"><summary className="cursor-pointer font-semibold">Detalhes do arquivo</summary><div className="mt-2 space-y-2"><p className="break-all">Pasta: {document ? archiveLocationLabel(pathOf(document)) || "—" : "—"}</p><p className="break-all">{entry.description}</p>{full && <p>{entry.badge ? "Publicado: a pessoa vê este documento no portal." : "Não publicado: a pessoa não vê este documento."}</p>}{(document?.archiveReferences?.length ?? 0) > 1 && <p>{document?.archiveReferences?.length} referências ao mesmo kit assinado, agrupadas nesta visualização.</p>}</div></details></div>; }} />
    <ArchiveOriginActionDialog action={originAction} onClose={() => setOriginAction(null)} />
    <ArchiveDocumentOrganizationDialog mode={organizationMode} target={organizationTarget} onClose={() => { setOrganizationMode(null); setOrganizationTarget(null); }} onSave={saveOrganization} />
  </>;
}
