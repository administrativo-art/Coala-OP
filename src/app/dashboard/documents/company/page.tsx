"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Download, Eye, FileText, Loader2, Plus, Search, Trash2, Upload, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CATEGORIES = [
  "Societário",
  "Fiscal e contábil",
  "Trabalhista e RH",
  "Licenças e autorizações",
  "Contratos",
  "Unidades",
  "Financeiro",
  "Marca e propriedade intelectual",
  "A classificar",
];

type CompanyDocument = {
  id: string;
  title: string;
  category: string;
  unit?: string | null;
  status: string;
  expiresAt?: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedByName?: string;
  uploadedAt?: string;
};

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value?: string | null) {
  if (!value) return "Sem vencimento";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? "Sem vencimento" : date.toLocaleDateString("pt-BR");
}

export default function CompanyDocumentsPage() {
  const { firebaseUser, permissions } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [unit, setUnit] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const canManage = permissions.settings?.manageUsers || permissions.dp?.collaborators?.edit;

  const loadDocuments = useCallback(async () => {
    if (!firebaseUser || !canManage) return;
    setLoading(true);
    setMessage("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/documents/company", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar documentos.");
      setDocuments(payload.documents ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao carregar documentos.");
    } finally {
      setLoading(false);
    }
  }, [canManage, firebaseUser]);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return documents.filter((document) => {
      if (categoryFilter !== "all" && document.category !== categoryFilter) return false;
      if (!term) return true;
      return [document.title, document.category, document.unit, document.originalName]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(term));
    });
  }, [categoryFilter, documents, search]);

  function resetForm() {
    setTitle("");
    setCategory(CATEGORIES[0]);
    setUnit("");
    setExpiresAt("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function uploadDocument() {
    if (!firebaseUser || !file || !title.trim() || !category) return;
    setSaving(true);
    setMessage("");
    try {
      const token = await firebaseUser.getIdToken();
      const form = new FormData();
      form.set("file", file);
      form.set("title", title.trim());
      form.set("category", category);
      form.set("unit", unit.trim());
      form.set("expiresAt", expiresAt);
      const response = await fetch("/api/documents/company", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao anexar documento.");
      setDocuments((current) => [payload.document, ...current]);
      setDialogOpen(false);
      resetForm();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao anexar documento.");
    } finally {
      setSaving(false);
    }
  }

  async function accessDocument(document: CompanyDocument, action: "view" | "download") {
    if (!firebaseUser) return;
    setMessage("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/documents/company/access", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: document.id, action }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Falha ao acessar documento.");
      }
      const url = URL.createObjectURL(await response.blob());
      if (action === "view") window.open(url, "_blank", "noopener,noreferrer");
      else {
        const link = window.document.createElement("a");
        link.href = url;
        link.download = document.originalName;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao acessar documento.");
    }
  }

  async function removeDocument(document: CompanyDocument) {
    if (!firebaseUser || !window.confirm(`Excluir “${document.title}”?`)) return;
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/documents/company?id=${encodeURIComponent(document.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "Falha ao excluir documento.");
      return;
    }
    setDocuments((current) => current.filter((item) => item.id !== document.id));
  }

  if (!canManage) return <p className="p-6 text-sm text-slate-500">Sem permissão para acessar documentos da empresa.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Documentos</p>
          <h1 className="text-xl font-black text-slate-950">Documentos da empresa</h1>
        </div>
        <Button size="sm" className="h-9 gap-2 rounded-lg" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> Anexar documento
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border bg-white p-2 shadow-sm md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="h-9 pl-9 text-sm" placeholder="Buscar documento, categoria ou unidade..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select className="h-9 rounded-md border bg-white px-3 text-sm font-semibold text-slate-700" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="all">Todas as categorias</option>
          {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>

      {message ? <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{message}</div> : null}

      {loading ? (
        <div className="grid min-h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-teal-700" /></div>
      ) : filtered.length === 0 ? (
        <div className="grid min-h-52 place-items-center rounded-lg border border-dashed bg-white p-8 text-center">
          <div><Building2 className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Nenhum documento encontrado</p></div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          {filtered.map((document) => (
            <div key={document.id} className="flex flex-col gap-3 border-b p-3 last:border-b-0 sm:flex-row sm:items-center">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700"><FileText className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-900">{document.title}</p>
                <p className="truncate text-xs text-slate-500">{document.category}{document.unit ? ` · ${document.unit}` : ""} · {formatSize(document.size)} · {document.uploadedByName || "Sistema"}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">{formatDate(document.expiresAt)}</span>
                <Button size="icon" variant="outline" className="h-8 w-8" title="Visualizar" onClick={() => void accessDocument(document, "view")}><Eye className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" className="h-8 w-8" title="Baixar" onClick={() => void accessDocument(document, "download")}><Download className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" className="h-8 w-8 text-rose-600" title="Excluir" onClick={() => void removeDocument(document)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-xl rounded-xl p-0">
          <DialogHeader className="border-b px-5 py-4"><DialogTitle>Anexar documento</DialogTitle></DialogHeader>
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-bold text-slate-700">Título</span><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Alvará de funcionamento 2026" /></label>
            <label className="space-y-1.5"><span className="text-xs font-bold text-slate-700">Categoria</span><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="space-y-1.5"><span className="text-xs font-bold text-slate-700">Validade</span><Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
            <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-bold text-slate-700">Unidade ou contraparte</span><Input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Opcional" /></label>
            <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-bold text-slate-700">Arquivo</span><input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="block w-full rounded-md border p-2 text-xs" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="block text-[11px] text-slate-500">PDF, JPG ou PNG de até 10 MB.</span></label>
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)}><X className="mr-2 h-4 w-4" />Cancelar</Button>
            <Button disabled={saving || !file || !title.trim()} onClick={() => void uploadDocument()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Anexar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
