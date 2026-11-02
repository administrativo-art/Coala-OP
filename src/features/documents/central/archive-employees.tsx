"use client";

import { ArchivePreview } from "./archive-preview";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { canAccessUserByUnit } from "@/lib/unit-access";
import { employeeDocumentDownloadName } from "@/lib/hr/employee-document-planning";
import { companyArchiveHref } from "@/lib/documents/company-archive-navigation";
import { employeeArchiveIds, employeeArchiveChildFolders, groupSignedAdmissionReferences } from "@/lib/documents/employee-archive";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import type { EmployeeDossierFolder } from "@/lib/hr/employee-document-folder-templates";
import type { OnboardingDocument } from "@/types";
import { EMPLOYEE_DOCUMENT_CATEGORIES, resolveEmployeeDocumentFolderPath } from "@/lib/hr/employee-document-options";
import { ArchiveExplorer, type ArchiveEntry } from "./archive-explorer";

type Document = { id: string; category: string; documentType?: string; documentTypeCode?: string; originalName: string; storedName?: string; displayName?: string; mimeType?: string; size?: number; uploadedAt?: string; destinationTrail?: string[]; archivePath?: string[]; source?: "generated" | "onboarding" | "autentique_signature"; employeeId?: string; contentHash?: string; signatureRequestId?: string; sourceOnboardingId?: string; accessLevel?: string; accessPolicyId?: string; publication?: unknown; resolvedVisibility?: unknown; archiveReferences?: string[]; archiveSourceNames?: string[]; sourceId?: string; pdfAvailable?: boolean; originHref?: string };
function downloadName(document: Document) {
  return document.source === "generated" && document.pdfAvailable ? document.originalName.replace(/\.[^.]+$/, "") + ".pdf" : employeeDocumentDownloadName(document);
}
function folderPath(document: Document) {
  if (document.archivePath) return document.archivePath;
  const category = EMPLOYEE_DOCUMENT_CATEGORIES.find((entry) => entry.id === document.category) ?? EMPLOYEE_DOCUMENT_CATEGORIES[EMPLOYEE_DOCUMENT_CATEGORIES.length - 1];
  return [category.label, ...resolveEmployeeDocumentFolderPath({ category: category.id, documentTypeCode: document.documentTypeCode, documentTypeLabel: document.documentType, destinationTrail: document.destinationTrail })];
}
function readPath(value: string | null): string[] {
  try { const result = JSON.parse(value ?? "[]"); return Array.isArray(result) && result.length <= 20 && result.every((part) => typeof part === "string" && part.length <= 200) ? result : []; } catch { return []; }
}

export function ArchiveEmployees() {
  const router = useRouter();
  const { firebaseUser, user, activeUsers, terminatedUsers, permissions, isDefaultAdmin } = useAuth();
  const canView = isDefaultAdmin || Boolean(permissions.settings?.manageUsers || permissions.dp?.collaborators?.view && !permissions.dp?.collaborators?.ownProfileOnly);
  const people = user && canView ? [...new Map([...activeUsers, ...terminatedUsers].filter((candidate) => candidate.id === user.id || canAccessUserByUnit(user, candidate, { isDefaultAdmin })).map((candidate) => [candidate.id, candidate])).values()].sort((a, b) => a.username.localeCompare(b.username, "pt-BR")) : [];
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const employee = people.find((person) => person.id === employeeId);
  const allowedEmployeeId = employee?.id;
  const linkedIds = JSON.stringify(employee ? employeeArchiveIds(employee) : []);
  const onboardingId = employee?.onboardingId;
  const canViewGenerated = hasFormalizationPermission(permissions, "documents.view", isDefaultAdmin);
  const [path, setPath] = useState<string[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [templatePaths, setTemplatePaths] = useState<string[][]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; url: string; mime: string } | null>(null);
  const sequence = useRef(0);
  const fileSequence = useRef(0);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    const restore = () => { const params = new URLSearchParams(window.location.search); setEmployeeId(params.get("employee")); setPath(readPath(params.get("path"))); setSearch(""); setPreview(null); fileSequence.current++; };
    restore(); window.addEventListener("popstate", restore);
    return () => { sequence.current++; fileSequence.current++; window.removeEventListener("popstate", restore); };
  }, []);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setDocuments([]); setTemplatePaths([]); setError(null);
    if (!allowedEmployeeId || !firebaseUser || !canView) { setLoading(false); return; }
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${await firebaseUser.getIdToken()}` };
      const query = async (url: string) => {
        const response = await fetch(url, { headers, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error("Uma origem da pasta não pôde ser consultada. A lista pode estar incompleta.");
        return result;
      };
      const ids = JSON.parse(linkedIds) as string[];
      const [uploads, profiles, generated, onboarding] = await Promise.all([
        Promise.allSettled(ids.map((id) => query(`/api/hr/employee-documents?employeeId=${encodeURIComponent(id)}`))),
        Promise.allSettled(ids.map((id) => query(`/api/hr/employee-document-folder-profile?employeeId=${encodeURIComponent(id)}`))),
        Promise.allSettled(canViewGenerated ? ids.map((id) => query(`/api/documents/generated?employeeId=${encodeURIComponent(id)}`)) : []),
        Promise.allSettled(canViewGenerated && onboardingId ? [query(`/api/hr/onboarding/${encodeURIComponent(onboardingId)}`)] : []),
      ]);
      if (sequence.current !== request) return;
      const rows = new Map<string, Document>();
      for (const source of uploads) if (source.status === "fulfilled") for (const document of source.value.documents ?? []) rows.set(document.id, document);
      for (const source of generated) if (source.status === "fulfilled") for (const document of source.value.documents ?? []) {
        const id = `generated:${document.id}`;
        rows.set(id, { id, source: "generated", sourceId: document.id, category: "generated", displayName: document.templateName || document.originalName || "Documento gerado", originalName: document.originalName || "documento.docx", uploadedAt: document.generatedAt, pdfAvailable: document.pdfAvailable, archivePath: ["Documentos gerados"], originHref: `/dashboard/documents/generated/manage?document=${encodeURIComponent(document.id)}` });
      }
      for (const source of onboarding) if (source.status === "fulfilled") for (const document of (source.value.process?.documents ?? []) as OnboardingDocument[]) {
        if (document.promotedDocumentId || !(document.fileUrl || document.filePath)) continue;
        const id = `onboarding:${document.id}`;
        rows.set(id, { id, source: "onboarding", sourceId: document.id, category: "admission", displayName: document.label, originalName: document.label, uploadedAt: document.receivedAt ?? undefined, archivePath: ["Admissão em andamento"], originHref: `/dashboard/hr/recruitment/integration?process=${encodeURIComponent(onboardingId!)}&document=${encodeURIComponent(document.id)}` });
      }
      setDocuments(groupSignedAdmissionReferences([...rows.values()]));
      setTemplatePaths(profiles.flatMap((source) => source.status === "fulfilled" ? (source.value.folderProfile?.folders ?? []).map((folder: EmployeeDossierFolder) => [EMPLOYEE_DOCUMENT_CATEGORIES.find((category) => category.id === folder.category)?.label ?? folder.category, ...folder.path]) : []));
      if ([...uploads, ...profiles, ...generated, ...onboarding].some((result) => result.status === "rejected")) setError("Uma ou mais origens não puderam ser consultadas. Os documentos exibidos podem estar incompletos; tente Atualizar ou Gerenciar pasta.");
      else if (generated.some((result) => result.status === "fulfilled" && result.value.documents?.length >= 300)) setError("A origem de documentos gerados atingiu o limite da consulta. Consulte a gestão documental para ver os demais.");
    } catch (cause) { if (sequence.current === request) setError(cause instanceof Error ? cause.message : "Falha ao consultar os documentos."); }
    finally { if (sequence.current === request) setLoading(false); }
  }, [allowedEmployeeId, linkedIds, onboardingId, canViewGenerated, firebaseUser, canView]);
  useEffect(() => { void load(); }, [load]);
  function navigate(id: string | null, next: string[] = []) {
    setEmployeeId(id); setPath(next); setSearch(""); setPreview(null); fileSequence.current++;
    const url = new URL(window.location.href); url.searchParams.delete("employee"); url.searchParams.delete("path");
    if (id) url.searchParams.set("employee", id);
    if (next.length) url.searchParams.set("path", JSON.stringify(next));
    window.history.pushState(null, "", url);
  }
  async function access(document: Document, download = false) {
    if (!firebaseUser || !employee) return;
    if (document.source === "onboarding") { if (document.originHref) router.push(document.originHref); return; }
    const request = ++fileSequence.current;
    try {
      const token = await firebaseUser.getIdToken();
      const response = document.source === "generated"
        ? await fetch(`/api/documents/generated/${encodeURIComponent(document.sourceId!)}/file${document.pdfAvailable ? "?format=pdf" : ""}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
        : await fetch("/api/hr/employee-documents/access", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: document.id, action: download ? "download" : "view" }) });
      if (!response.ok) throw new Error("Não foi possível acessar este documento. Confira sua permissão atual.");
      const blob = await response.blob();
      if (request !== fileSequence.current) return;
      const url = URL.createObjectURL(blob);
      if (download) { const link = window.document.createElement("a"); link.href = url; link.download = downloadName(document); link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      else setPreview({ id: document.id, url, mime: blob.type });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao abrir arquivo."); }
  }
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const scoped = documents.filter((document) => path.every((segment, index) => folderPath(document)[index] === segment));
  const childFolders = employeeArchiveChildFolders([...templatePaths, ...documents.map(folderPath)], path).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const entries: ArchiveEntry[] = !employeeId ? people.filter((person) => person.username.toLocaleLowerCase("pt-BR").includes(term)).map((person) => ({ id: person.id, name: person.username, kind: "folder", description: person.isActive === false ? "Desligado" : "Colaborador", open: () => navigate(person.id) }))
    : !employee ? [] : [
      ...(!term ? childFolders.map((name): ArchiveEntry => ({ id: "folder:" + name, name, kind: "folder", open: () => navigate(employeeId, [...path, name]) })) : []),
      ...scoped.filter((document) => term ? `${document.displayName || document.documentType || ""} ${document.originalName} ${(document.archiveSourceNames ?? []).join(" ")}`.toLocaleLowerCase("pt-BR").includes(term) : folderPath(document).length === path.length).map((document): ArchiveEntry => ({ id: document.id, name: document.displayName || document.documentType || document.originalName, kind: "file", description: `${document.source === "generated" ? "Versão gerada · " : document.source === "onboarding" ? "Admissão · " : ""}${downloadName(document)}`, size: document.size ? `${Math.ceil(document.size / 1024)} KB` : undefined, modified: document.uploadedAt ? new Date(document.uploadedAt).toLocaleDateString("pt-BR") : undefined, open: () => void access(document), actions: [...(document.source !== "onboarding" ? [{ label: "Baixar", run: () => void access(document, true) }] : []), ...(document.originHref ? [{ label: document.source === "onboarding" ? "Abrir na admissão" : "Ver origem e assinatura", run: () => router.push(document.originHref!) }] : [])] })),
    ];
  return <ArchiveExplorer area="collaborators" entries={canView ? entries : []} search={search} onSearch={setSearch} loading={loading} error={!canView ? "Sem permissão para consultar as pastas da equipe." : employeeId && !employee ? "Pasta indisponível para seu acesso atual." : error}
    breadcrumbs={employee ? [{ name: employee.username, open: () => navigate(employeeId) }, ...path.map((name, index) => ({ name, open: () => navigate(employeeId, path.slice(0, index + 1)) }))] : []}
    folders={employee ? childFolders.map((name) => ({ id: name, name, open: () => navigate(employeeId, [...path, name]) })) : []}
    onRoot={() => navigate(null)} onUp={() => path.length ? navigate(employeeId, path.slice(0, -1)) : employeeId ? navigate(null) : router.push(companyArchiveHref())}
    onRefresh={() => void load()} onSelect={() => { fileSequence.current++; setPreview(null); }}
    toolbar={employee && (permissions.settings?.manageUsers || permissions.dp?.collaborators?.edit) ? <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/dp/collaborators/${encodeURIComponent(employee.id)}/documents`)}>Gerenciar pasta</Button> : null}
    preview={(entry) => <div className="space-y-3 text-xs text-slate-500">{preview?.id === entry.id && <ArchivePreview url={preview.url} mime={preview.mime} title={entry.name} />}<p className="break-all">{entry.description}</p>{(documents.find((doc) => doc.id === entry.id)?.archiveReferences?.length ?? 0) > 1 && <p>O mesmo Kit admissional possui {documents.find((doc) => doc.id === entry.id)?.archiveReferences?.length} referências de origem. Os registros e os arquivos permanecem preservados.</p>}</div>} />;
}
