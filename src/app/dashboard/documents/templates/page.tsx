"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileStack, Loader2, Plus, Search, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

const CATEGORIES = ["Admissão", "Contratos", "Declarações", "Políticas internas", "Comunicados", "Outros"];

type DocumentTemplate = {
  id: string;
  name: string;
  category: string;
  status: string;
  version: number;
  createdByName?: string;
  updatedAt?: string;
  variables?: string[];
};

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
            <article key={template.id} className="flex min-h-24 cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 shadow-sm transition hover:border-teal-200 hover:shadow-md" onClick={() => router.push(`/dashboard/documents/templates/${encodeURIComponent(template.id)}`)}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><FileStack className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-slate-900">{template.name}</p><p className="mt-1 text-xs text-slate-500">{template.category} · versão {template.version} · {template.variables?.length ?? 0} variáveis</p><p className="mt-1 truncate font-mono text-[10px] text-slate-400" title={template.id}>ID: {template.id}</p><span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${template.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{template.status === 'published' ? 'Publicado' : 'Rascunho'}</span></div>
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
    </div>
  );
}
