"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Braces, Download, ExternalLink, Eye, FileStack, Loader2, LockKeyhole, Plus, Search, Settings2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import {
  DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS,
  DOCUMENT_TEMPLATE_WORKFLOW_LABELS,
  type DocumentTemplateWorkflowStatus,
} from "@/features/hr/documents/document-template-workflow";
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
  workflowStatus?: DocumentTemplateWorkflowStatus;
  workflowUpdatedAt?: string | null;
  workflowUpdatedByName?: string | null;
  workflowNote?: string | null;
  workflowHistory?: Array<{
    from: DocumentTemplateWorkflowStatus;
    to: DocumentTemplateWorkflowStatus;
    note?: string | null;
    actorName?: string | null;
    at?: string | null;
  }>;
};

function templateStatusLabel(template: DocumentTemplate) {
  if (template.workflowStatus) return DOCUMENT_TEMPLATE_WORKFLOW_LABELS[template.workflowStatus];
  if (template.status === "published") return "Publicado";
  return template.isSystem ? "Em preparação" : "Rascunho";
}

function templateUsage(template: DocumentTemplate) {
  if (!template.isSystem) return { label: "Modelo personalizado", path: null, action: null };
  if (template.sourceModule === "uniforms" || template.id.startsWith("system-uniform-")) {
    return { label: "Módulo de Uniformes", path: template.sourceModulePath ?? "/dashboard/stock/uniforms", action: "Abrir Uniformes" };
  }
  if (template.id.startsWith("system-admission-")) {
    return { label: "Fluxo admissional", path: "/dashboard/hr/recruitment/integration", action: "Abrir Admissão" };
  }
  if (template.generationMode === "reference") {
    return { label: "Somente referência", path: null, action: null };
  }
  if (template.generationMode === "direct") {
    return { label: "Central de documentos", path: `/dashboard/documents/generator?template=${encodeURIComponent(template.id)}`, action: "Abrir Gerador" };
  }
  return { label: "Gestão de documentos", path: null, action: null };
}

export default function DocumentTemplatesPage() {
  const router = useRouter();
  const { firebaseUser, permissions } = useAuth();
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [workflowNote, setWorkflowNote] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const canView = hasFormalizationPermission(permissions, "templates.view");
  const canManage = hasFormalizationPermission(permissions, "templates.manage");
  const canPublish = hasFormalizationPermission(permissions, "templates.publish");

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
  useEffect(() => {
    setWorkflowNote(selectedTemplate?.workflowNote ?? "");
  }, [selectedTemplate?.id, selectedTemplate?.workflowNote]);

  const openTemplateFile = useCallback(async (template: DocumentTemplate, action: "preview" | "download") => {
    const sourceUrl = action === "preview" ? template.previewUrl : template.downloadUrl;
    if (!firebaseUser || !sourceUrl) return;
    setMessage("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(sourceUrl, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || (action === "preview" ? "Falha ao abrir a prévia." : "Falha ao baixar o arquivo Word."));
      }
      const url = URL.createObjectURL(await response.blob());
      if (action === "preview") {
        const nextWindow = window.open(url, "_blank", "noopener,noreferrer");
        if (!nextWindow) {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `${template.name}.pdf`;
          anchor.click();
        }
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${template.name}.docx`;
        anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao abrir o modelo.");
    }
  }, [firebaseUser]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return term ? templates.filter((item) => `${item.name} ${item.category}`.toLocaleLowerCase("pt-BR").includes(term)) : templates;
  }, [search, templates]);

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

  async function advanceWorkflow(template: DocumentTemplate) {
    const action = template.workflowStatus ? DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS[template.workflowStatus] : null;
    if (!firebaseUser || !action) return;
    setWorkflowBusy(true);
    setMessage("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(template.id)}/workflow`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: action.next, note: workflowNote }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao avançar o modelo.");
      const updated: DocumentTemplate = {
        ...template,
        status: action.next === "published" ? "published" : "draft",
        workflowStatus: action.next,
        workflowNote: payload.workflow?.note ?? null,
        workflowUpdatedAt: payload.workflow?.updatedAt ?? null,
        workflowUpdatedByName: payload.workflow?.updatedByName ?? null,
        workflowHistory: payload.workflow?.history ?? [],
      };
      setTemplates((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSelectedTemplate(updated);
      setWorkflowNote("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao avançar o modelo.");
    } finally {
      setWorkflowBusy(false);
    }
  }

  if (!canView) return <p className="p-6 text-sm text-slate-500">Sem permissão para acessar modelos.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Documentos</p><h1 className="text-xl font-black text-slate-950">Modelos</h1></div>
        {canManage ? <Button size="sm" className="h-9 gap-2 rounded-lg" onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4" />Novo modelo</Button> : null}
      </div>
      <div className="relative rounded-lg border bg-white p-2 shadow-sm">
        <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="h-9 pl-9 text-sm" placeholder="Buscar modelo..." value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {message ? <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{message}</div> : null}
      {loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-teal-700" /></div> : filtered.length === 0 ? (
        <div className="grid min-h-52 place-items-center rounded-lg border border-dashed bg-white p-8 text-center"><div><FileStack className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Nenhum modelo cadastrado</p></div></div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => (
            <article
              key={template.id}
              className="flex min-h-24 cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 shadow-sm transition hover:border-teal-200 hover:shadow-md"
              onClick={() => setSelectedTemplate(template)}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><FileStack className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-900">{template.name}</p>
                <p className="mt-1 text-xs text-slate-500">{template.category} · versão {template.version} · {template.variables?.length ?? 0} variáveis</p>
                {template.description ? <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{template.description}</p> : null}
                <p className="mt-1 truncate font-mono text-[10px] text-slate-400" title={template.id}>ID: {template.id}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${template.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{templateStatusLabel(template)}</span>
                  {template.isSystem ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700"><LockKeyhole className="h-3 w-3" />Modelo do sistema</span> : null}
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700">
                    {templateUsage(template).label}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {canManage ? <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md rounded-xl p-0">
          <DialogHeader className="border-b px-5 py-4"><DialogTitle>Novo modelo</DialogTitle></DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <label className="block space-y-1.5"><span className="text-xs font-bold text-slate-700">Nome do modelo</span><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Contrato de experiência" /></label>
            <label className="block space-y-1.5"><span className="text-xs font-bold text-slate-700">Categoria</span><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="block space-y-1.5"><span className="text-xs font-bold text-slate-700">Arquivo Word</span><input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block w-full rounded-md border p-2 text-xs" /><span className="block text-[11px] text-slate-500">Use marcadores como {`{{employee.name}}`} ou qualquer nome próprio (ex.: {`{{valor_recibo}}`}) — depois do envio você define a origem de cada campo. A formatação do Word é preservada.</span></label>
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-3"><Button variant="outline" onClick={() => setDialogOpen(false)}><X className="mr-2 h-4 w-4" />Cancelar</Button><Button disabled={saving || !name.trim() || !file} onClick={() => void createTemplate()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Criar e configurar</Button></div>
        </DialogContent>
      </Dialog> : null}

      <Dialog open={Boolean(selectedTemplate)} onOpenChange={(open) => { if (!open) setSelectedTemplate(null); }}>
        <DialogContent className="max-w-2xl rounded-xl p-0">
          {selectedTemplate ? (
            <>
              <DialogHeader className="border-b px-5 py-4">
                <div className="flex items-start gap-3 pr-8">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700">
                    <FileStack className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <DialogTitle className="text-left">{selectedTemplate.name}</DialogTitle>
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedTemplate.category} · versão {selectedTemplate.version} · {templateUsage(selectedTemplate).label}
                    </p>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 px-5 py-4">
                {selectedTemplate.description ? <p className="text-sm leading-6 text-slate-600">{selectedTemplate.description}</p> : null}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Status</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">{templateStatusLabel(selectedTemplate)}</p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Utilização</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">{templateUsage(selectedTemplate).label}</p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Assinatura</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">
                      {selectedTemplate.signatureScope === "bundle" ? "Pacote" : selectedTemplate.signatureScope === "independent" ? "Individual" : "Não exige"}
                    </p>
                  </div>
                </div>

                <section className="rounded-lg border">
                  <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-black text-slate-900"><Braces className="h-4 w-4 text-violet-600" />Variáveis vinculadas</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {selectedTemplate.isSystem
                          ? "A vinculação deste modelo oficial é controlada e versionada pelo sistema."
                          : "Defina de onde vem cada informação utilizada no documento."}
                      </p>
                    </div>
                    {!selectedTemplate.isSystem ? (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => router.push(`/dashboard/documents/templates/${encodeURIComponent(selectedTemplate.id)}`)}>
                        <Settings2 className="h-3.5 w-3.5" />Configurar
                      </Button>
                    ) : null}
                  </div>
                  <div className="max-h-48 overflow-y-auto p-3">
                    {(selectedTemplate.variables ?? []).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(selectedTemplate.variables ?? []).map((variable) => (
                          <span key={variable} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-600">{`{{${variable}}}`}</span>
                        ))}
                      </div>
                    ) : <p className="text-xs text-slate-500">Este modelo não utiliza variáveis.</p>}
                  </div>
                </section>

                {selectedTemplate.isSystem && selectedTemplate.workflowStatus ? (
                  <section className="rounded-lg border">
                    <div className="border-b px-4 py-3">
                      <p className="text-sm font-black text-slate-900">Tratamento e aprovação</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Cada avanço registra responsável, data e observação no histórico do modelo.
                      </p>
                    </div>
                    <div className="space-y-3 p-4">
                      {DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS[selectedTemplate.workflowStatus] ? (
                        <>
                          <label className="block space-y-1.5">
                            <span className="text-xs font-bold text-slate-700">Observação ou evidência da etapa</span>
                            <textarea
                              className="min-h-20 w-full rounded-md border bg-white p-2 text-sm"
                              placeholder="Ex.: Revisado pelo jurídico em 29/07/2026, sem ressalvas."
                              value={workflowNote}
                              onChange={(event) => setWorkflowNote(event.target.value)}
                            />
                          </label>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              className="gap-2"
                              disabled={
                                workflowBusy
                                || (DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS[selectedTemplate.workflowStatus]?.next === "published" ? !canPublish : !canManage)
                              }
                              onClick={() => void advanceWorkflow(selectedTemplate)}
                            >
                              {workflowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
                              {DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS[selectedTemplate.workflowStatus]?.label}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-slate-500">Este modelo não possui uma próxima etapa operacional.</p>
                      )}
                      {(selectedTemplate.workflowHistory ?? []).length ? (
                        <div className="space-y-2 border-t pt-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Histórico</p>
                          {[...(selectedTemplate.workflowHistory ?? [])].reverse().map((event, index) => (
                            <div key={`${event.at ?? "event"}-${index}`} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                              <p className="font-bold text-slate-800">
                                {DOCUMENT_TEMPLATE_WORKFLOW_LABELS[event.from]} → {DOCUMENT_TEMPLATE_WORKFLOW_LABELS[event.to]}
                              </p>
                              <p className="mt-0.5">
                                {event.actorName || "Usuário"}{event.at ? ` · ${new Date(event.at).toLocaleString("pt-BR")}` : ""}
                              </p>
                              {event.note ? <p className="mt-1">{event.note}</p> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
                <Button variant="outline" onClick={() => setSelectedTemplate(null)}>Fechar</Button>
                {selectedTemplate.previewUrl ? (
                  <Button variant="outline" className="gap-2" onClick={() => void openTemplateFile(selectedTemplate, "preview")}>
                    <Eye className="h-4 w-4" />Visualizar prévia
                  </Button>
                ) : null}
                {selectedTemplate.downloadUrl ? (
                  <Button variant="outline" className="gap-2" onClick={() => void openTemplateFile(selectedTemplate, "download")}>
                    <Download className="h-4 w-4" />Baixar Word
                  </Button>
                ) : null}
                {!selectedTemplate.isSystem ? (
                  <Button className="gap-2" onClick={() => router.push(`/dashboard/documents/templates/${encodeURIComponent(selectedTemplate.id)}`)}>
                    <Settings2 className="h-4 w-4" />Configurar variáveis
                  </Button>
                ) : templateUsage(selectedTemplate).path ? (
                  <Button className="gap-2" onClick={() => router.push(templateUsage(selectedTemplate).path!)}>
                    <ExternalLink className="h-4 w-4" />{templateUsage(selectedTemplate).action}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
