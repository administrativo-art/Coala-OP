"use client";

import { ArchivePreview } from "./archive-preview";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { companyArchiveHref } from "@/lib/documents/company-archive-navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { documentTemplateDisplayStatus } from "@/features/hr/documents/document-template-display-status";
import type { DocumentTemplateWorkflowStatus } from "@/features/hr/documents/document-template-workflow";
import { ArchiveExplorer, type ArchiveEntry } from "./archive-explorer";
import { archiveTimestamp } from "@/lib/documents/archive-entry-sort";

type Model = { id: string; name: string; category: string; status: string; version: number; sourceFormat?: string; previewUrl?: string; downloadUrl?: string; description?: string; generationMode?: string; updatedAt?: string; workflowStatus?: DocumentTemplateWorkflowStatus };

export function ArchiveModels() {
  const router = useRouter();
  const { firebaseUser, permissions, isDefaultAdmin } = useAuth();
  const canView = hasFormalizationPermission(permissions, "templates.view", isDefaultAdmin);
  const [models, setModels] = useState<Model[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const sequence = useRef(0);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const load = useCallback(async () => {
    if (!firebaseUser || !canView) return;
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/documents/templates", { headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Não foi possível carregar os modelos.");
      setModels(payload.templates ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao consultar a biblioteca."); }
    finally { setLoading(false); }
  }, [firebaseUser, canView]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const restore = () => { setCategory(new URLSearchParams(window.location.search).get("category")); setSearch(""); };
    restore(); window.addEventListener("popstate", restore);
    return () => { sequence.current++; window.removeEventListener("popstate", restore); };
  }, []);
  function navigate(value: string | null) {
    setCategory(value); setSearch(""); sequence.current++; setPreview(null);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("category", value); else url.searchParams.delete("category");
    window.history.pushState(null, "", url);
  }
  async function access(model: Model, download = false) {
    if (!firebaseUser) return;
    const path = download ? model.downloadUrl : model.previewUrl;
    if (!path) { router.push(`/dashboard/documents/generator/models/${encodeURIComponent(model.id)}`); return; }
    const version = ++sequence.current;
    setError(null);
    try {
      const target = new URL(path, window.location.origin);
      if (target.origin !== window.location.origin || !target.pathname.startsWith("/api/documents/templates/")) throw new Error("Endereço de modelo inválido.");
      const response = await fetch(target, { headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível abrir o modelo. Confira seu acesso e tente novamente.");
      const blob = await response.blob();
      if (version !== sequence.current) return;
      const url = URL.createObjectURL(blob);
      if (!download && blob.type.includes("pdf")) setPreview({ id: model.id, url });
      else {
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${model.name.replace(/[\\/:*?"<>|]/g, "-")}.${model.sourceFormat || "docx"}`; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (cause) { if (version === sequence.current) setError(cause instanceof Error ? cause.message : "Falha ao abrir modelo."); }
  }
  const categories = [...new Set(models.map((model) => model.category))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const entries: ArchiveEntry[] = !category && !search.trim() ? categories.map((name) => ({ id: "category:" + name, name, kind: "folder", open: () => navigate(name) }))
    : models.filter((model) => (!category || model.category === category) && `${model.name} ${model.description ?? ""}`.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR"))).map((model) => ({
      id: model.id, name: model.name, kind: "model", description: `Versão ${model.version} · ${documentTemplateDisplayStatus(model)}`,
      modified: model.updatedAt ? new Date(model.updatedAt).toLocaleDateString("pt-BR") : undefined, modifiedAt: archiveTimestamp(model.updatedAt), open: () => void access(model), loadPreview: model.previewUrl ? () => void access(model) : undefined, actions: [
        { label: "Baixar modelo", run: () => void access(model, true) },
        ...(hasFormalizationPermission(permissions, "templates.manage", isDefaultAdmin) ? [{ label: "Gerenciar modelo", run: () => router.push(`/dashboard/documents/generator/models/${encodeURIComponent(model.id)}`) }] : []),
        ...(model.status === "published" && !["archived", "superseded"].includes(model.workflowStatus ?? "") && !["contextual", "reference"].includes(model.generationMode ?? "") && hasFormalizationPermission(permissions, "documents.generate", isDefaultAdmin) ? [{ label: "Gerar documento", run: () => router.push(`/dashboard/documents/generator?template=${encodeURIComponent(model.id)}`) }] : []),
      ],
    }));
  return <ArchiveExplorer area="models" selectionScope={category ?? ""} search={search} onSearch={setSearch} loading={canView && loading} error={canView ? error : "Sem permissão para consultar modelos."} entries={canView ? entries : []}
    folders={categories.map((name) => ({ id: name, name, active: name === category, open: () => navigate(name) }))} breadcrumbs={category ? [{ name: category }] : []}
    onRoot={() => navigate(null)} onUp={() => category ? navigate(null) : router.push(companyArchiveHref())} onRefresh={() => void load()} onSelect={() => { sequence.current++; setPreview(null); }}
    toolbar={hasFormalizationPermission(permissions, "templates.manage", isDefaultAdmin) ? <Button size="sm" variant="outline" onClick={() => router.push("/dashboard/documents/generator/models")}>Gerenciar biblioteca</Button> : null}
    preview={(entry) => <div className="space-y-3 text-xs text-slate-500">{preview?.id === entry.id && <ArchivePreview url={preview.url} mime="application/pdf" title={entry.name} />}<details className="rounded border bg-white p-2"><summary className="cursor-pointer font-semibold">Detalhes do modelo</summary><div className="mt-2 space-y-2"><p>{models.find((model) => model.id === entry.id)?.description || entry.description}</p><p>Biblioteca oficial utilizada na geração de documentos do sistema.</p></div></details></div>} />;
}
