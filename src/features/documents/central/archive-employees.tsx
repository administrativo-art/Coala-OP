"use client";

import { ArchivePreview } from "./archive-preview";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { canAccessUserByUnit } from "@/lib/unit-access";
import { employeeDocumentDownloadName } from "@/lib/hr/employee-document-planning";
import { EMPLOYEE_DOCUMENT_CATEGORIES, resolveEmployeeDocumentFolderPath } from "@/lib/hr/employee-document-options";
import { ArchiveExplorer, type ArchiveEntry } from "./archive-explorer";

type Document = { id: string; category: string; documentType?: string; documentTypeCode?: string; originalName: string; storedName?: string; displayName?: string; mimeType?: string; size?: number; uploadedAt?: string; destinationTrail?: string[] };
function folderPath(document: Document) {
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
  const [path, setPath] = useState<string[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
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
    setDocuments([]); setError(null);
    if (!allowedEmployeeId || !firebaseUser || !canView) { setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/hr/employee-documents?employeeId=${encodeURIComponent(allowedEmployeeId)}`, { headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Não foi possível consultar esta pasta.");
      if (sequence.current === request) setDocuments(result.documents ?? []);
    } catch (cause) { if (sequence.current === request) setError(cause instanceof Error ? cause.message : "Falha ao consultar os documentos."); }
    finally { if (sequence.current === request) setLoading(false); }
  }, [allowedEmployeeId, firebaseUser, canView]);
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
    const request = ++fileSequence.current;
    try {
      const response = await fetch("/api/hr/employee-documents/access", { method: "POST", headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: document.id, action: download ? "download" : "view" }) });
      if (!response.ok) throw new Error("Não foi possível acessar este documento. Confira sua permissão atual.");
      const blob = await response.blob();
      if (request !== fileSequence.current) return;
      const url = URL.createObjectURL(blob);
      if (download) { const link = window.document.createElement("a"); link.href = url; link.download = employeeDocumentDownloadName(document); link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      else setPreview({ id: document.id, url, mime: blob.type });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao abrir arquivo."); }
  }
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const scoped = documents.filter((document) => path.every((segment, index) => folderPath(document)[index] === segment));
  const childFolders = [...new Set(scoped.map((document) => folderPath(document)[path.length]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const entries: ArchiveEntry[] = !employeeId ? people.filter((person) => person.username.toLocaleLowerCase("pt-BR").includes(term)).map((person) => ({ id: person.id, name: person.username, kind: "folder", description: person.isActive === false ? "Desligado" : "Colaborador", open: () => navigate(person.id) }))
    : !employee ? [] : [
      ...(!term ? childFolders.map((name): ArchiveEntry => ({ id: "folder:" + name, name, kind: "folder", open: () => navigate(employeeId, [...path, name]) })) : []),
      ...scoped.filter((document) => term ? `${document.displayName || document.documentType || ""} ${document.originalName}`.toLocaleLowerCase("pt-BR").includes(term) : folderPath(document).length === path.length).map((document): ArchiveEntry => ({ id: document.id, name: document.displayName || document.documentType || document.originalName, kind: "file", description: employeeDocumentDownloadName(document), size: document.size ? `${Math.ceil(document.size / 1024)} KB` : undefined, modified: document.uploadedAt ? new Date(document.uploadedAt).toLocaleDateString("pt-BR") : undefined, open: () => void access(document), actions: [{ label: "Baixar", run: () => void access(document, true) }] })),
    ];
  return <ArchiveExplorer area="collaborators" entries={canView ? entries : []} search={search} onSearch={setSearch} loading={loading} error={!canView ? "Sem permissão para consultar os dossiês da equipe." : employeeId && !employee ? "Pasta indisponível para seu acesso atual." : error}
    breadcrumbs={employee ? [{ name: employee.username, open: () => navigate(employeeId) }, ...path.map((name, index) => ({ name, open: () => navigate(employeeId, path.slice(0, index + 1)) }))] : []}
    folders={employee ? childFolders.map((name) => ({ id: name, name, open: () => navigate(employeeId, [...path, name]) })) : []}
    onRoot={() => navigate(null)} onUp={() => path.length ? navigate(employeeId, path.slice(0, -1)) : employeeId ? navigate(null) : router.push("/dashboard/documents")}
    onRefresh={() => void load()} onSelect={() => { fileSequence.current++; setPreview(null); }}
    toolbar={employee && (permissions.settings?.manageUsers || permissions.dp?.collaborators?.edit) ? <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/dp/collaborators/${encodeURIComponent(employee.id)}/documents`)}>Gerenciar dossiê</Button> : null}
    preview={(entry) => <div className="space-y-3 text-xs text-slate-500">{preview?.id === entry.id && <ArchivePreview url={preview.url} mime={preview.mime} title={entry.name} />}<p className="break-all">{entry.description}</p></div>} />;
}
