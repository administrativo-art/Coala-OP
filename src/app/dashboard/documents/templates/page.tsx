"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, Eye, FileDown, FileStack, Loader2, LockKeyhole, Plus, Search, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import type { DocumentTemplateWorkflowStatus } from "@/features/hr/documents/document-template-workflow";
import {
  documentTemplateDisplayStatus,
  type DocumentTemplatePreparationStatus,
} from "@/features/hr/documents/document-template-display-status";
import type { TemplateFieldMapping } from "@/features/hr/documents/field-mapping";
import { DOCUMENT_VARIABLES } from "@/features/hr/integration/document-variables";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

const CATEGORIES = ["Base institucional", "Admissão", "Contratos", "Declarações", "Políticas internas", "Comunicados", "Uniformes", "Outros"];

type DocumentTemplate = {
  id: string;
  name: string;
  category: string;
  status: string;
  version: number;
  createdByName?: string;
  updatedAt?: string;
  variables?: string[];
  description?: string;
  templateKind?: "system_pdf" | "reference_docx";
  sourceFormat?: "pdf" | "docx";
  isSystem?: boolean;
  previewUrl?: string;
  downloadUrl?: string;
  letterheadVersion?: string;
  generationMode?: "direct" | "contextual" | "reference";
  sourceModule?: "documents" | "uniforms" | "admission" | "termination";
  sourceModulePath?: string;
  signatureScope?: "none" | "bundle" | "independent";
  fieldMapping?: TemplateFieldMapping;
  officialCandidate?: boolean;
  derivedFromSystemTemplateId?: string;
  derivedFromSystemTemplateVersion?: number;
  derivedFromTemplateId?: string;
  derivedFromTemplateVersion?: number;
  workflowStatus?: DocumentTemplateWorkflowStatus;
  workflowUpdatedAt?: string | null;
  workflowUpdatedByName?: string | null;
  workflowNote?: string | null;
  aiMappingPlan?: { reviewed?: boolean } | null;
  fieldPreparationTestedAt?: string | null;
  preparationStatus?: DocumentTemplatePreparationStatus;
  workflowHistory?: Array<{
    from: DocumentTemplateWorkflowStatus;
    to: DocumentTemplateWorkflowStatus;
    note?: string | null;
    actorName?: string | null;
    at?: string | null;
  }>;
};

const VARIABLE_CATALOG = new Map(DOCUMENT_VARIABLES.map((variable) => [variable.key, variable]));

function templateStatusLabel(template: DocumentTemplate) {
  return documentTemplateDisplayStatus(template);
}

function templateStatusClasses(template: DocumentTemplate) {
  const label = templateStatusLabel(template);
  if (template.workflowStatus === "superseded" || template.workflowStatus === "archived") {
    return "bg-slate-100 text-slate-600";
  }
  if (template.status === "published" || template.workflowStatus === "published") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (label === "Em mapeamento pela IA") return "bg-violet-50 text-violet-700";
  if (label === "Em edição manual") return "bg-amber-50 text-amber-700";
  if (label === "Em teste visual") return "bg-sky-50 text-sky-700";
  if (label === "Pronto para homologação do RH") return "bg-indigo-50 text-indigo-700";
  return "bg-amber-50 text-amber-700";
}

function templateUsage(template: DocumentTemplate) {
  if (template.officialCandidate) {
    if (template.derivedFromSystemTemplateId?.startsWith("system-admission-")) {
      return { label: "Nova versão do fluxo admissional", path: null, action: null };
    }
    return { label: "Nova versão oficial", path: null, action: null };
  }
  if (!template.isSystem) return { label: "Modelo personalizado", path: null, action: null };
  if (template.sourceModule === "uniforms" || template.id.startsWith("system-uniform-")) {
    return { label: "Módulo de Uniformes", path: null, action: null };
  }
  if (template.id.startsWith("system-admission-")) {
    return { label: "Fluxo admissional", path: null, action: null };
  }
  if (template.generationMode === "reference") {
    return { label: "Somente referência", path: null, action: null };
  }
  if (template.generationMode === "direct") {
    return { label: "Central de documentos", path: `/dashboard/documents/generator?template=${encodeURIComponent(template.id)}`, action: "Abrir Gerador" };
  }
  return { label: "Gestão de documentos", path: null, action: null };
}

function signatureLabel(template: DocumentTemplate) {
  if (template.signatureScope === "bundle") return "Pacote";
  if (template.signatureScope === "independent") return "Individual";
  return "Não exige";
}

function variableStats(template: DocumentTemplate) {
  const variables = template.variables ?? [];
  const automatic = variables.filter((placeholder) => {
    const binding = template.fieldMapping?.[placeholder];
    return binding?.kind === "system" || (!binding && VARIABLE_CATALOG.has(placeholder));
  }).length;
  return { total: variables.length, automatic };
}

export default function DocumentTemplatesPage() {
  const router = useRouter();
  const { firebaseUser, permissions } = useAuth();
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [listCategory, setListCategory] = useState("Todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [file, setFile] = useState<File | null>(null);
  const canView = hasFormalizationPermission(permissions, "templates.view");
  const canManage = hasFormalizationPermission(permissions, "templates.manage");

  const loadTemplates = useCallback(async () => {
    if (!firebaseUser || !canView) return;
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/documents/templates", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar modelos.");
      setTemplates(payload.templates ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao carregar modelos.");
    } finally {
      setLoading(false);
    }
  }, [canView, firebaseUser]);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const openTemplateFile = useCallback(async (template: DocumentTemplate, action: "preview" | "pdf-download" | "download") => {
    const sourceUrl = action === "download" ? template.downloadUrl : template.previewUrl;
    if (!firebaseUser || !sourceUrl) return;
    if (action === "preview") {
      const previewWindow = window.open(
        `/document-preview/${encodeURIComponent(template.id)}?name=${encodeURIComponent(template.name)}`,
        "_blank",
      );
      if (previewWindow) previewWindow.opener = null;
      else setMessage("O navegador bloqueou a nova aba. Permita pop-ups para visualizar a prévia.");
      return;
    }
    setMessage("");
    try {
      const requestPreview = (idToken: string) => fetch(sourceUrl, {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
      });
      let response = await requestPreview(await firebaseUser.getIdToken());
      if (response.status === 401 || response.status === 403) {
        response = await requestPreview(await firebaseUser.getIdToken(true));
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || (action === "pdf-download" ? "Falha ao baixar o PDF." : "Falha ao baixar o arquivo Word."));
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = action === "pdf-download" ? `${template.name}.pdf` : `${template.name}.docx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      const errorMessage = cause instanceof Error ? cause.message : "Falha ao abrir o modelo.";
      setMessage(errorMessage);
    }
  }, [firebaseUser]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return templates.filter((item) => (
      (listCategory === "Todos" || item.category === listCategory)
      && (!term || `${item.name} ${item.category}`.toLocaleLowerCase("pt-BR").includes(term))
    ));
  }, [listCategory, search, templates]);

  const listCategories = useMemo(
    () => ["Todos", ...Array.from(new Set(templates.map((template) => template.category))).sort((a, b) => a.localeCompare(b, "pt-BR"))],
    [templates],
  );

  function openTemplateFlow(template: DocumentTemplate) {
    router.push(`/dashboard/documents/templates/${encodeURIComponent(template.id)}`);
  }

  async function createTemplate() {
    if (!firebaseUser || !name.trim() || !file) return;
    setSaving(true);
    setMessage("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/documents/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), category }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao criar modelo.");
      const form = new FormData(); form.set("file", file);
      const uploadResponse = await fetch(`/api/documents/templates/${encodeURIComponent(payload.template.id)}/file`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const uploadPayload = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(uploadPayload.error || "Modelo criado, mas o DOCX não foi enviado.");
      router.push(`/dashboard/documents/templates/${encodeURIComponent(payload.template.id)}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao criar modelo.");
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return <p className="p-6 text-sm text-slate-500">Sem permissão para acessar modelos.</p>;

  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b px-5 py-5 sm:flex-row sm:items-end sm:justify-between lg:px-6">
        <div><p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Documentos</p><h1 className="text-xl font-black text-slate-950">Modelos</h1></div>
        {canManage ? <Button size="sm" className="h-10 gap-2 rounded-xl px-4 shadow-sm" onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4" />Novo modelo</Button> : null}
      </div>
      <div className="space-y-3 px-5 pb-2 pt-4 lg:px-6">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="h-11 rounded-xl pl-10 text-sm" placeholder="Buscar modelo..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {listCategories.map((item) => (
            <button
              key={item}
              type="button"
              className={`h-8 rounded-full border px-3.5 text-xs font-bold transition ${
                listCategory === item
                  ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-violet-700"
              }`}
              onClick={() => setListCategory(item)}
            >
              {item === "Financeiro e recibos" ? "Financeiro" : item}
            </button>
          ))}
        </div>
      </div>
      {message ? <div className="mx-5 mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 lg:mx-6">{message}</div> : null}
      {loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-teal-700" /></div> : filtered.length === 0 ? (
        <div className="m-5 grid min-h-52 place-items-center rounded-xl border border-dashed bg-white p-8 text-center lg:m-6"><div><FileStack className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Nenhum modelo encontrado</p><p className="mt-1 text-xs text-slate-500">Ajuste a busca ou selecione outra categoria.</p></div></div>
      ) : (
        <div className="grid gap-3.5 px-5 pb-6 pt-4 md:grid-cols-2 lg:px-6">
          {filtered.map((template) => {
            const stats = variableStats(template);
            return (
              <article
                key={template.id}
                className="flex flex-col rounded-2xl border bg-white p-4 transition hover:border-teal-200 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><FileStack className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-black leading-5 text-slate-950">{template.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      <span>{template.category} · versão {template.version}</span>
                      {template.isSystem ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700"><LockKeyhole className="h-2.5 w-2.5" />Sistema</span> : null}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide ${templateStatusClasses(template)}`}>
                    {templateStatusLabel(template)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-[1.3fr_1fr_.9fr] gap-2 border-y py-2.5">
                  <div className="min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Utilização</p>
                    <p className="mt-0.5 truncate text-xs font-bold text-slate-800">{templateUsage(template).label}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Assinatura</p>
                    <p className="mt-0.5 text-xs font-bold text-slate-800">{signatureLabel(template)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Variáveis</p>
                    <p className="mt-0.5 text-xs font-bold text-slate-800">{stats.total ? `${stats.total} · ${stats.automatic} auto` : "—"}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    title="Visualizar prévia"
                    aria-label={`Visualizar prévia de ${template.name}`}
                    disabled={!template.previewUrl}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openTemplateFile(template, "preview");
                    }}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Baixar PDF"
                    aria-label={`Baixar PDF de ${template.name}`}
                    disabled={!template.previewUrl}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openTemplateFile(template, "pdf-download");
                    }}
                  >
                    <FileDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Baixar Word"
                    aria-label={`Baixar Word de ${template.name}`}
                    disabled={!template.downloadUrl}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openTemplateFile(template, "download");
                    }}
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <Button
                    size="sm"
                    className="ml-auto h-9 gap-1.5 rounded-xl px-3.5 text-xs"
                    onClick={() => openTemplateFlow(template)}
                  >
                    Abrir fluxo<ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {canManage ? <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md rounded-xl p-0">
          <DialogHeader className="border-b px-5 py-4"><DialogTitle>Novo modelo</DialogTitle></DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <label className="block space-y-1.5"><span className="text-xs font-bold text-slate-700">Nome do modelo</span><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Contrato de experiência" /></label>
            <label className="block space-y-1.5"><span className="text-xs font-bold text-slate-700">Categoria</span><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="block space-y-1.5"><span className="text-xs font-bold text-slate-700">Arquivo Word</span><input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block w-full rounded-md border p-2 text-xs" /><span className="block text-[11px] text-slate-500">O arquivo original e seu hash ficam preservados. O sistema cria uma versão preparada com página, margens, fonte, hifenização e estilos CT; ambiguidades de cláusula ou hierarquia seguem para validação manual. Depois você vincula os marcadores, como {`{{employee.name}}`}.</span></label>
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-3"><Button variant="outline" onClick={() => setDialogOpen(false)}><X className="mr-2 h-4 w-4" />Cancelar</Button><Button disabled={saving || !name.trim() || !file} onClick={() => void createTemplate()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Criar e configurar</Button></div>
        </DialogContent>
      </Dialog> : null}

    </div>
  );
}
