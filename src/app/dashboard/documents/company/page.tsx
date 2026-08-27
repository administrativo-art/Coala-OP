"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, ChevronDown, Download, Eye, FileText, Folder, Loader2, Plus, Search, Sparkles, Trash2, Upload, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { COMPANY_DOCUMENT_CATEGORIES } from "@/lib/documents/company-document-categories";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

const CATEGORIES = COMPANY_DOCUMENT_CATEGORIES;
const UNITS_DATALIST_ID = "company-document-units";
const NO_UNIT_FILTER = "__sem_unidade__";

type CompanyDocumentAiAnalysis = {
  category: string;
  categoryConfidence: number;
  documentName: string | null;
  documentDetail: string | null;
  suggestedUnit: string | null;
  warnings: string[];
};

type CompanyDocument = {
  id: string;
  title: string;
  category: string;
  unit?: string | null;
  status: string;
  expiresAt?: string | null;
  originalName: string;
  standardizedName?: string | null;
  mimeType: string;
  size: number;
  uploadedByName?: string;
  uploadedAt?: string;
};

type PendingItem = {
  id: string;
  file: File;
  title: string;
  category: string;
  unit: string;
  analyzing: boolean;
  aiAnalysis: CompanyDocumentAiAnalysis | null;
  uploadError: string | null;
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

function composeTitle(analysis: CompanyDocumentAiAnalysis): string {
  if (!analysis.documentName) return "";
  return analysis.documentDetail ? `${analysis.documentName} - ${analysis.documentDetail}` : analysis.documentName;
}

let pendingItemSeq = 0;
function nextPendingItemId() {
  pendingItemSeq += 1;
  return `pending-${Date.now()}-${pendingItemSeq}`;
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
  const [unitFilter, setUnitFilter] = useState("all");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [knownUnits, setKnownUnits] = useState<string[]>([]);
  const canView = hasFormalizationPermission(permissions, "companyDocuments.view");
  const canManage = hasFormalizationPermission(permissions, "companyDocuments.manage");

  const loadDocuments = useCallback(async () => {
    if (!firebaseUser || !canView) return;
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
  }, [canView, firebaseUser]);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);

  useEffect(() => {
    if (!firebaseUser || !canView) return;
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch("/api/documents/company/units", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json();
        if (response.ok) setKnownUnits(payload.units ?? []);
      } catch {
        // Navegação por unidade e autocomplete são extras; falha aqui não deve travar a tela.
      }
    })();
  }, [canView, firebaseUser]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return documents.filter((document) => {
      if (categoryFilter !== "all" && document.category !== categoryFilter) return false;
      if (unitFilter === NO_UNIT_FILTER && document.unit) return false;
      if (unitFilter !== "all" && unitFilter !== NO_UNIT_FILTER && document.unit !== unitFilter) return false;
      if (!term) return true;
      return [document.title, document.category, document.unit, document.originalName]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(term));
    });
  }, [categoryFilter, documents, search, unitFilter]);

  function resetForm() {
    setPendingItems([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function updatePendingItem(id: string, patch: Partial<PendingItem>) {
    setPendingItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function analyzePendingItem(id: string, file: File) {
    if (!firebaseUser) return;
    try {
      const token = await firebaseUser.getIdToken();
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/documents/company/analyze", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao analisar documento.");
      const analysis = payload.analysis as CompanyDocumentAiAnalysis;
      const suggestedTitle = composeTitle(analysis);
      setPendingItems((current) => current.map((item) => item.id === id ? {
        ...item,
        analyzing: false,
        aiAnalysis: analysis,
        category: analysis.category,
        title: item.title.trim() ? item.title : (suggestedTitle || item.title),
        unit: item.unit.trim() ? item.unit : (analysis.suggestedUnit || item.unit),
      } : item));
    } catch {
      updatePendingItem(id, { analyzing: false });
    }
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const newItems: PendingItem[] = Array.from(fileList).map((file) => ({
      id: nextPendingItemId(),
      file,
      title: "",
      category: CATEGORIES[0],
      unit: "",
      analyzing: true,
      aiAnalysis: null,
      uploadError: null,
    }));
    setPendingItems((current) => [...current, ...newItems]);
    for (const item of newItems) void analyzePendingItem(item.id, item.file);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removePendingItem(id: string) {
    setPendingItems((current) => current.filter((item) => item.id !== id));
  }

  async function uploadOne(item: PendingItem): Promise<{ id: string; document?: CompanyDocument; error?: string }> {
    if (!firebaseUser) return { id: item.id, error: "Sessão expirada." };
    try {
      const token = await firebaseUser.getIdToken();
      const form = new FormData();
      form.set("file", item.file);
      form.set("title", item.title.trim());
      form.set("category", item.category);
      form.set("unit", item.unit.trim());
      const response = await fetch("/api/documents/company", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao anexar documento.");
      return { id: item.id, document: payload.document as CompanyDocument };
    } catch (cause) {
      return { id: item.id, error: cause instanceof Error ? cause.message : "Falha ao anexar documento." };
    }
  }

  async function uploadAllDocuments() {
    const readyItems = pendingItems.filter((item) => item.title.trim() && item.category);
    if (readyItems.length === 0) return;
    setSaving(true);
    setMessage("");
    try {
      const results = await Promise.all(readyItems.map((item) => uploadOne(item)));
      const uploaded = results.filter((result) => result.document).map((result) => result.document!);
      const failedIds = new Set(results.filter((result) => result.error).map((result) => result.id));
      const errorById = new Map(results.filter((result) => result.error).map((result) => [result.id, result.error!]));
      if (uploaded.length > 0) setDocuments((current) => [...uploaded, ...current]);
      setPendingItems((current) => current
        .filter((item) => failedIds.has(item.id))
        .map((item) => ({ ...item, uploadError: errorById.get(item.id) ?? null })));
      if (failedIds.size === 0) {
        setDialogOpen(false);
        resetForm();
      } else {
        setMessage(`${uploaded.length} documento(s) anexado(s). ${failedIds.size} falharam - revise abaixo.`);
      }
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
        link.download = document.standardizedName || document.originalName;
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

  if (!canView) return <p className="p-6 text-sm text-slate-500">Sem permissão para acessar documentos da empresa.</p>;

  const readyToUploadCount = pendingItems.filter((item) => item.title.trim() && item.category).length;

  function selectAllDocuments() {
    setCategoryFilter("all");
    setUnitFilter("all");
    setExpandedCategory(null);
  }

  function selectCategory(item: string) {
    setCategoryFilter(item);
    setUnitFilter("all");
    setExpandedCategory(item);
  }

  function selectUnitWithinCategory(item: string, unitValue: string) {
    setCategoryFilter(item);
    setUnitFilter(unitValue);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Documentos</p>
          <h1 className="text-xl font-black text-slate-950">Documentos da empresa</h1>
        </div>
        {canManage ? <Button size="sm" className="h-9 gap-2 rounded-lg" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> Anexar documento
        </Button> : null}
      </div>

      {message ? <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{message}</div> : null}

      <div className="grid items-start gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border bg-white p-1.5 shadow-sm lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto">
          <button
            type="button"
            onClick={selectAllDocuments}
            aria-current={categoryFilter === "all" ? "page" : undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-black ${categoryFilter === "all" ? "bg-pink-50 text-[#c81f69]" : "text-slate-700 hover:bg-slate-50"}`}
          >
            <Folder className={`h-4 w-4 shrink-0 ${categoryFilter === "all" ? "" : "text-slate-400"}`} />
            <span className="min-w-0 flex-1">Todos os documentos</span>
            <span className="text-[10px] font-bold text-slate-400">{documents.length}</span>
          </button>
          {CATEGORIES.map((item) => {
            const active = categoryFilter === item && unitFilter === "all";
            const count = documents.filter((document) => document.category === item).length;
            const expanded = categoryFilter === item && expandedCategory === item;
            const noUnitCount = documents.filter((document) => document.category === item && !document.unit).length;
            return (
              <div key={item}>
                <div className={`flex items-center gap-1 rounded-lg ${categoryFilter === item ? "bg-pink-50 text-[#c81f69]" : "text-slate-700 hover:bg-slate-50"}`}>
                  <button
                    type="button"
                    onClick={() => selectCategory(item)}
                    aria-current={active ? "page" : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-xs font-black"
                  >
                    <Folder className={`h-4 w-4 shrink-0 ${categoryFilter === item ? "" : "text-slate-400"}`} />
                    <span className="min-w-0 flex-1 truncate">{item}</span>
                    <span className="text-[10px] font-bold text-slate-400">{count}</span>
                  </button>
                  {categoryFilter === item ? (
                    <button
                      type="button"
                      onClick={() => setExpandedCategory((current) => current === item ? null : item)}
                      className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/70"
                      aria-label={expanded ? `Recolher ${item}` : `Expandir ${item}`}
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                  ) : null}
                </div>
                {expanded ? (
                  <div className="ml-4 border-l border-slate-100 py-1 pl-1.5">
                    {knownUnits.map((unitName) => {
                      const unitActive = unitFilter === unitName;
                      const unitCount = documents.filter((document) => document.category === item && document.unit === unitName).length;
                      return (
                        <button
                          key={unitName}
                          type="button"
                          onClick={() => selectUnitWithinCategory(item, unitName)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-bold ${unitActive ? "bg-pink-50 text-[#c81f69]" : "text-slate-600 hover:bg-slate-50"}`}
                        >
                          <Folder className={`h-3.5 w-3.5 shrink-0 ${unitActive ? "" : "text-slate-300"}`} />
                          <span className="min-w-0 flex-1 truncate">{unitName}</span>
                          <span className="text-[10px] font-bold text-slate-400">{unitCount}</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => selectUnitWithinCategory(item, NO_UNIT_FILTER)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-bold ${unitFilter === NO_UNIT_FILTER ? "bg-pink-50 text-[#c81f69]" : "text-slate-600 hover:bg-slate-50"}`}
                    >
                      <Folder className={`h-3.5 w-3.5 shrink-0 ${unitFilter === NO_UNIT_FILTER ? "" : "text-slate-300"}`} />
                      <span className="min-w-0 flex-1 truncate">Sem unidade específica</span>
                      <span className="text-[10px] font-bold text-slate-400">{noUnitCount}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </aside>

        <main className="min-w-0 space-y-3">
          <p className="flex items-center gap-1.5 text-xs font-black text-slate-500">
            <Folder className="h-3.5 w-3.5 text-slate-400" />
            {categoryFilter === "all" ? "Todos os documentos" : categoryFilter}
            {unitFilter !== "all" ? ` › ${unitFilter === NO_UNIT_FILTER ? "Sem unidade específica" : unitFilter}` : ""}
          </p>
          <div className="rounded-lg border bg-white p-2 shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="h-9 pl-9 text-sm" placeholder="Buscar documento, categoria ou unidade..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>

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
                    {document.standardizedName ? <p className="truncate font-mono text-[10px] text-slate-400">{document.standardizedName}</p> : null}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">{formatDate(document.expiresAt)}</span>
                    <Button size="icon" variant="outline" className="h-8 w-8" title="Visualizar" onClick={() => void accessDocument(document, "view")}><Eye className="h-4 w-4" /></Button>
                    <Button size="icon" variant="outline" className="h-8 w-8" title="Baixar" onClick={() => void accessDocument(document, "download")}><Download className="h-4 w-4" /></Button>
                    {canManage ? <Button size="icon" variant="outline" className="h-8 w-8 text-rose-600" title="Excluir" onClick={() => void removeDocument(document)}><Trash2 className="h-4 w-4" /></Button> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <datalist id={UNITS_DATALIST_ID}>
        {knownUnits.map((unitName) => <option key={unitName} value={unitName} />)}
      </datalist>

      {canManage ? <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-2xl rounded-2xl p-0">
          <DialogHeader className="border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#df2f78]" />
              <DialogTitle className="text-base font-black text-slate-900">Anexar documentos</DialogTitle>
            </div>
            <p className="text-sm font-semibold text-slate-500">Selecione os arquivos. Categoria, título e unidade são sugeridos pela análise.</p>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
            <label
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center hover:border-[#df2f78]/50 hover:bg-pink-50/60"
            >
              <Upload className="h-6 w-6 text-[#df2f78]" />
              <div>
                <p className="text-sm font-black text-slate-900">Arraste documentos para cá ou clique para selecionar</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">PDF, JPG ou PNG · até 10 MB por arquivo · pode selecionar vários de uma vez</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png"
                className="sr-only"
                onChange={(event) => addFiles(event.target.files)}
              />
            </label>

            {pendingItems.length > 0 ? (
              <div className="space-y-3">
                {pendingItems.map((item) => (
                  <div key={item.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-black text-slate-900" title={item.file.name}>{item.file.name} <span className="font-semibold text-slate-400">· {formatSize(item.file.size)}</span></p>
                      <button type="button" onClick={() => removePendingItem(item.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-slate-500 hover:bg-slate-50" title="Remover">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {item.analyzing ? (
                      <div className="mt-3 flex items-center gap-2 rounded-xl bg-pink-50 px-3 py-2 text-xs font-bold text-[#c81f69]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analisando documento...
                      </div>
                    ) : item.aiAnalysis ? (
                      <div className="mt-3 flex items-start gap-2 rounded-xl bg-pink-50 px-3 py-2 text-xs text-[#c81f69]">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <div>
                          <p className="font-black">Sugestão da IA: {item.aiAnalysis.category} · Confiança {Math.round(item.aiAnalysis.categoryConfidence * 100)}%</p>
                          {item.aiAnalysis.warnings.length > 0 ? <p className="mt-0.5 font-semibold text-[#c81f69]/80">{item.aiAnalysis.warnings[0]}</p> : null}
                        </div>
                      </div>
                    ) : null}

                    {item.uploadError ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{item.uploadError}</p> : null}

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-black text-slate-700">Título</span><Input value={item.title} onChange={(event) => updatePendingItem(item.id, { title: event.target.value })} placeholder="Ex.: Contrato Social - Quarta alteração" /></label>
                      <label className="space-y-1.5"><span className="text-xs font-black text-slate-700">Categoria</span><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={item.category} onChange={(event) => updatePendingItem(item.id, { category: event.target.value })}>{CATEGORIES.map((option) => <option key={option}>{option}</option>)}</select></label>
                      <label className="space-y-1.5"><span className="text-xs font-black text-slate-700">Unidade ou contraparte</span><Input list={UNITS_DATALIST_ID} value={item.unit} onChange={(event) => updatePendingItem(item.id, { unit: event.target.value })} placeholder="Opcional" /></label>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-3">
            <Button variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)}><X className="mr-2 h-4 w-4" />Cancelar</Button>
            <Button className="rounded-xl bg-[#df2f78] text-white hover:bg-[#c81f69]" disabled={saving || readyToUploadCount === 0} onClick={() => void uploadAllDocuments()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Anexar{readyToUploadCount > 0 ? ` (${readyToUploadCount})` : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog> : null}
    </div>
  );
}
