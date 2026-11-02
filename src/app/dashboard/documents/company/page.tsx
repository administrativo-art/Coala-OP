"use client";

import { ArchivePreview } from "@/features/documents/central/archive-preview";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveExplorer, type ArchiveEntry, type ArchiveFolder } from "@/features/documents/central/archive-explorer";
import { Loader2, Plus, Sparkles, Upload, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { COMPANY_DOCUMENT_CATEGORIES } from "@/lib/documents/company-document-categories";
import { COMPANY_DOCUMENT_TYPES, companyIntakeName } from "@/lib/documents/company-document-intake";
import { TIME_RECORDING_COMPLIANCE_CATEGORY, TIME_RECORDING_COMPLIANCE_FOLDER, TIME_RECORDING_COMPLIANCE_LABEL, TIME_RECORDING_EVIDENCE_SECTIONS, companyDocumentEvidenceSection, companyDocumentFolderCode, companyDocumentNavigationCategory, type CompanyDocumentFolderCode, type TimeRecordingEvidenceSection } from "@/lib/documents/company-document-folders";
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
  version?: number;
  unitId?: string | null;
  id: string;
  title: string;
  category: string;
  folderCode?: CompanyDocumentFolderCode;
  evidenceSection?: TimeRecordingEvidenceSection | null;
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
  unitId: string;
  documentType: string;
  reference: string;
  id: string;
  file: File;
  title: string;
  category: string;
  folderCode: CompanyDocumentFolderCode;
  evidenceSection: TimeRecordingEvidenceSection | null;
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
  const router = useRouter();
  const { firebaseUser, permissions } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [folderFilter, setFolderFilter] = useState<CompanyDocumentFolderCode>(null);
  const [sectionFilter, setSectionFilter] = useState<TimeRecordingEvidenceSection | null>(null);
  const [preview, setPreview] = useState<{ id: string; url: string; mime: string } | null>(null);
  const previewSequence = useRef(0);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [knownUnits, setKnownUnits] = useState<string[]>([]);
  const [unitOptions, setUnitOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [classifyingDocument, setClassifyingDocument] = useState<CompanyDocument | null>(null);
  const [classificationDraft, setClassificationDraft] = useState({ title: "", category: "", unitId: "", documentType: "", reference: "" });
  const [classificationError, setClassificationError] = useState("");
  const [classificationSaving, setClassificationSaving] = useState(false);
  const [movingDocument, setMovingDocument] = useState<CompanyDocument | null>(null);
  const [moveFolderCode, setMoveFolderCode] = useState<CompanyDocumentFolderCode>(null);
  const [moveSection, setMoveSection] = useState<TimeRecordingEvidenceSection | null>(null);
  const [moveReason, setMoveReason] = useState("");
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveError, setMoveError] = useState("");
  const [removeTarget, setRemoveTarget] = useState<CompanyDocument | null>(null);
  const [removing, setRemoving] = useState(false);
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
        if (response.ok) { setKnownUnits(payload.units ?? []); setUnitOptions(payload.options ?? []); }
      } catch {
        // Navegação por unidade e autocomplete são extras; falha aqui não deve travar a tela.
      }
    })();
  }, [canView, firebaseUser]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return documents.filter((document) => {
      if (categoryFilter !== "all" && companyDocumentNavigationCategory(document) !== categoryFilter) return false;
      if (folderFilter && companyDocumentFolderCode(document) !== folderFilter) return false;
      if (sectionFilter && companyDocumentEvidenceSection(document) !== sectionFilter) return false;
      if (unitFilter === NO_UNIT_FILTER && document.unit) return false;
      if (unitFilter !== "all" && unitFilter !== NO_UNIT_FILTER && document.unit !== unitFilter) return false;
      if (!term) return true;
      return [document.title, document.category, document.unit, document.originalName]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(term));
    });
  }, [categoryFilter, documents, folderFilter, sectionFilter, search, unitFilter]);

  function resetForm() {
    setPendingItems([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function updatePendingItem(id: string, patch: Partial<PendingItem>) {
    setPendingItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function analyzePendingItem(id: string, file: File) {
    if (!firebaseUser) return;
    updatePendingItem(id, { analyzing: true, uploadError: null });
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
      const isRepP = [suggestedTitle, file.name].some((value) => /^REP-P\s*[-—–_]/i.test(value));
      setPendingItems((current) => current.map((item) => item.id === id ? {
        ...item,
        analyzing: false,
        aiAnalysis: analysis,
        category: isRepP ? TIME_RECORDING_COMPLIANCE_CATEGORY : analysis.category,
        folderCode: isRepP ? TIME_RECORDING_COMPLIANCE_FOLDER : null,
        evidenceSection: isRepP ? companyDocumentEvidenceSection({ category: "Trabalhista e RH", title: item.title || suggestedTitle }) : null,
        title: item.title.trim() ? item.title : (suggestedTitle || item.title),
        unit: item.unit.trim() ? item.unit : (analysis.suggestedUnit || item.unit),
      } : item));
    } catch {
      updatePendingItem(id, { analyzing: false, uploadError: "Não foi possível obter uma sugestão. Preencha os dados manualmente ou tente novamente." });
    }
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const insideComplianceFolder = folderFilter === TIME_RECORDING_COMPLIANCE_FOLDER;
    const newItems: PendingItem[] = Array.from(fileList).map((file) => ({
      id: nextPendingItemId(),
      file,
      title: insideComplianceFolder ? file.name.replace(/\.[^.]+$/, "").slice(0, 180) : "",
      category: insideComplianceFolder ? TIME_RECORDING_COMPLIANCE_CATEGORY : "A classificar",
      folderCode: insideComplianceFolder ? TIME_RECORDING_COMPLIANCE_FOLDER : null,
      evidenceSection: insideComplianceFolder ? sectionFilter : null,
      unit: "",
      unitId: "",
      documentType: "",
      reference: "",
      analyzing: false,
      aiAnalysis: null,
      uploadError: null,
    }));
    setPendingItems((current) => [...current, ...newItems]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removePendingItem(id: string) {
    setPendingItems((current) => current.filter((item) => item.id !== id));
  }

  async function uploadOne(item: PendingItem): Promise<{ id: string; document?: CompanyDocument; error?: string; warning?: string }> {
    if (!firebaseUser) return { id: item.id, error: "Sessão expirada." };
    try {
      const token = await firebaseUser.getIdToken();
      const form = new FormData();
      form.set("file", item.file);
      form.set("metadata", JSON.stringify({ title: item.title.trim(), category: item.category, unitId: item.unitId === "__general__" ? undefined : item.unitId, documentType: item.documentType || undefined, reference: item.reference }));
      const response = await fetch("/api/documents/company/intake", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao anexar documento.");
      const document = payload.document as CompanyDocument;
      if (payload.duplicate) return { id: item.id, document, warning: `“${item.title}” já existe neste escopo. O arquivo existente foi preservado, sem nova versão ou movimentação.` };
      if (item.folderCode) {
        try {
          const folderResponse = await fetch("/api/documents/company/folder", {
            method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ id: document.id, folderCode: item.folderCode, evidenceSection: item.evidenceSection, reason: "Classificação no upload", expected: { folderCode: companyDocumentFolderCode(document), evidenceSection: companyDocumentEvidenceSection(document) } }),
          });
          if (!folderResponse.ok) throw new Error("A pasta não foi atribuída.");
          document.folderCode = item.folderCode;
          document.evidenceSection = item.evidenceSection;
        } catch {
          return { id: item.id, document, warning: `“${item.title}” foi anexado, mas a pasta de fiscalização não foi atribuída. Use Mover para… no documento.` };
        }
      }
      return { id: item.id, document };
    } catch (cause) {
      return { id: item.id, error: cause instanceof Error ? cause.message : "Falha ao anexar documento." };
    }
  }

  async function uploadAllDocuments() {
    const readyItems = pendingItems.filter((item) => !item.analyzing && item.title.trim() && item.unitId && item.category && (!COMPANY_DOCUMENT_TYPES.find((type) => type.code === item.documentType)?.reference || item.reference.trim()) && (!item.folderCode || item.evidenceSection));
    if (readyItems.length === 0) return;
    setSaving(true);
    setMessage("");
    try {
      const results = await Promise.all(readyItems.map((item) => uploadOne(item)));
      const uploaded = results.filter((result) => result.document).map((result) => result.document!);
      const failedIds = new Set(results.filter((result) => result.error).map((result) => result.id));
      const warnings = results.map((result) => result.warning).filter((value): value is string => Boolean(value));
      const errorById = new Map(results.filter((result) => result.error).map((result) => [result.id, result.error!]));
      if (uploaded.length > 0) setDocuments((current) => [...new Map([...current, ...uploaded].map((document) => [document.id, document])).values()]);
      setPendingItems((current) => current
        .filter((item) => failedIds.has(item.id))
        .map((item) => ({ ...item, uploadError: errorById.get(item.id) ?? null })));
      if (failedIds.size === 0) {
        setDialogOpen(false);
        resetForm();
        if (warnings.length) setMessage(warnings.join(" "));
      } else {
        setMessage(`${uploaded.length} documento(s) anexado(s). ${failedIds.size} falharam - revise abaixo. ${warnings.join(" ")}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function accessDocument(document: CompanyDocument, action: "view" | "download") {
    if (!firebaseUser) return;
    const sequence = action === "view" ? ++previewSequence.current : null;
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
      const blob = await response.blob();
      if (action === "view" && sequence !== previewSequence.current) return;
      const url = URL.createObjectURL(blob);
      if (action === "view") setPreview({ id: document.id, url, mime: document.mimeType });
      else {
        const link = window.document.createElement("a");
        link.href = url;
        link.download = document.standardizedName || document.originalName;
        link.click();
      }
      if (action === "download") window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao acessar documento.");
    }
  }

  async function removeDocument(document: CompanyDocument) {
    if (!firebaseUser || removing) return;
    setRemoving(true);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/documents/company?id=${encodeURIComponent(document.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao excluir documento.");
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setRemoveTarget(null); setPreview(null);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Falha ao excluir documento."); }
    finally { setRemoving(false); }
  }

  function openMove(document: CompanyDocument) {
    setMovingDocument(document);
    setMoveFolderCode(companyDocumentFolderCode(document) === TIME_RECORDING_COMPLIANCE_FOLDER ? null : TIME_RECORDING_COMPLIANCE_FOLDER);
    setMoveSection(null);
    setMoveReason("");
    setMoveError("");
  }

  function openClassification(document: CompanyDocument) {
    setClassifyingDocument(document);
    setClassificationDraft({ title: document.title, category: document.category === "A classificar" ? "" : document.category, unitId: document.unitId ?? "", documentType: "", reference: "" });
    setClassificationError("");
  }

  async function confirmClassification() {
    if (!firebaseUser || !classifyingDocument) return;
    setClassificationSaving(true);
    setClassificationError("");
    try {
      const response = await fetch("/api/documents/company/intake", { method: "PATCH", headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: classifyingDocument.id, expectedVersion: classifyingDocument.version ?? 1, metadata: { ...classificationDraft, unitId: classificationDraft.unitId === "__general__" ? undefined : classificationDraft.unitId } }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível classificar o documento.");
      setDocuments((current) => current.map((document) => document.id === classifyingDocument.id ? payload.document : document));
      setClassifyingDocument(null);
    } catch (error) { setClassificationError(error instanceof Error ? error.message : "Falha ao classificar documento."); }
    finally { setClassificationSaving(false); }
  }

  async function confirmMove() {
    if (!firebaseUser || !movingDocument) return;
    setMoveSaving(true);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/documents/company/folder", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: movingDocument.id, folderCode: moveFolderCode, evidenceSection: moveFolderCode ? moveSection : null, reason: moveReason.trim() || undefined, expected: { folderCode: companyDocumentFolderCode(movingDocument), evidenceSection: companyDocumentEvidenceSection(movingDocument) } }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao mover documento.");
      setDocuments((current) => current.map((item) => item.id === movingDocument.id ? { ...item, folderCode: moveFolderCode, evidenceSection: moveFolderCode ? moveSection : null } : item));
      setMovingDocument(null);
      setMessage("");
      setMoveError("");
    } catch (cause) {
      setMoveError(cause instanceof Error ? cause.message : "Falha ao mover documento.");
    } finally {
      setMoveSaving(false);
    }
  }

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const category = params.get("category");
      setCategoryFilter(CATEGORIES.find((item) => item === category) ?? "all");
      setFolderFilter(params.get("folder") === TIME_RECORDING_COMPLIANCE_FOLDER ? TIME_RECORDING_COMPLIANCE_FOLDER : null);
      setSectionFilter(TIME_RECORDING_EVIDENCE_SECTIONS.find((item) => item.code === params.get("section"))?.code ?? null);
      setUnitFilter(params.get("unit") || "all");
      setSearch(""); previewSequence.current++; setPreview(null);
    };
    restore(); window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  if (!canView) return <p className="p-6 text-sm text-slate-500">Sem permissão para acessar documentos da empresa.</p>;

  const readyToUploadCount = pendingItems.filter((item) => !item.analyzing && item.title.trim() && item.unitId && item.category && (!COMPANY_DOCUMENT_TYPES.find((type) => type.code === item.documentType)?.reference || item.reference.trim()) && (!item.folderCode || item.evidenceSection)).length;

  function navigateFolder(category = "all", folder: CompanyDocumentFolderCode = null, section: TimeRecordingEvidenceSection | null = null, unit = "all") {
    setCategoryFilter(category); setFolderFilter(folder); setSectionFilter(section); setUnitFilter(unit); setSearch("");
    previewSequence.current++; setPreview(null);
    const url = new URL(window.location.href);
    for (const key of ["category", "folder", "section", "unit", "document"]) url.searchParams.delete(key);
    if (category !== "all") url.searchParams.set("category", category);
    if (folder) url.searchParams.set("folder", folder);
    if (section) url.searchParams.set("section", section);
    if (unit !== "all") url.searchParams.set("unit", unit);
    window.history.pushState(null, "", url);
  }
  function selectAllDocuments() { navigateFolder(); }
  function selectCategory(category: string) { navigateFolder(category); }
  function selectUnitWithinCategory(category: string, unit: string) { navigateFolder(category, null, null, unit); }
  function selectTimeRecordingFolder(section: TimeRecordingEvidenceSection | null = null) { navigateFolder(TIME_RECORDING_COMPLIANCE_CATEGORY, TIME_RECORDING_COMPLIANCE_FOLDER, section); }

  const unitFolders = categoryFilter === "all" ? [] : knownUnits.filter((unit) => documents.some((document) => companyDocumentNavigationCategory(document) === categoryFilter && document.unit === unit));
  const folders: ArchiveFolder[] = CATEGORIES.flatMap((category) => [
    { id: category, name: category, active: categoryFilter === category && !folderFilter && unitFilter === "all", open: () => selectCategory(category) },
    ...(categoryFilter === category ? [
      ...(category === TIME_RECORDING_COMPLIANCE_CATEGORY ? [{ id: TIME_RECORDING_COMPLIANCE_FOLDER, name: TIME_RECORDING_COMPLIANCE_LABEL, depth: 1, active: folderFilter === TIME_RECORDING_COMPLIANCE_FOLDER && !sectionFilter, open: () => selectTimeRecordingFolder() },
        ...(folderFilter ? TIME_RECORDING_EVIDENCE_SECTIONS.map((section) => ({ id: section.code, name: section.label, depth: 2, active: sectionFilter === section.code, open: () => selectTimeRecordingFolder(section.code) })) : [])] : []),
      ...unitFolders.map((unit) => ({ id: category + unit, name: unit, depth: 1, active: unitFilter === unit, open: () => selectUnitWithinCategory(category, unit) })),
    ] : []),
  ]);
  const fileEntries = (list: CompanyDocument[]): ArchiveEntry[] => list.map((document) => ({
    id: document.id, name: document.title, kind: "file", description: document.standardizedName || document.originalName,
    size: formatSize(document.size), modified: document.uploadedAt ? formatDate(document.uploadedAt) : undefined,
    open: () => void accessDocument(document, "view"),
    actions: [
      { label: "Baixar", run: () => void accessDocument(document, "download") },
      { label: "Ver histórico", run: () => router.push(`/dashboard/documents/history?source=company&documentId=${encodeURIComponent(document.id)}`) },
      ...(canManage && (document.status === "pending_classification" || document.category === "A classificar") ? [{ label: "Classificar documento", run: () => openClassification(document) }] : []),
      ...(canManage && (document.category === TIME_RECORDING_COMPLIANCE_CATEGORY || companyDocumentFolderCode(document) === TIME_RECORDING_COMPLIANCE_FOLDER) ? [{ label: "Mover para…", run: () => openMove(document) }] : []),
      ...(canManage ? [{ label: "Excluir", destructive: true, run: () => setRemoveTarget(document) }] : []),
    ],
  }));
  let entries: ArchiveEntry[];
  if (search.trim()) entries = fileEntries(filtered);
  else if (categoryFilter === "all") entries = CATEGORIES.map((category) => ({ id: "category:" + category, name: category, kind: "folder", description: `${documents.filter((document) => companyDocumentNavigationCategory(document) === category).length} documentos`, open: () => selectCategory(category) }));
  else if (folderFilter && !sectionFilter) entries = [
    ...TIME_RECORDING_EVIDENCE_SECTIONS.map((section): ArchiveEntry => ({ id: "section:" + section.code, name: section.label, kind: "folder", open: () => selectTimeRecordingFolder(section.code) })),
    ...fileEntries(filtered.filter((document) => !companyDocumentEvidenceSection(document))),
  ];
  else if (!folderFilter && unitFilter === "all") entries = [
    ...(categoryFilter === TIME_RECORDING_COMPLIANCE_CATEGORY ? [{ id: "compliance", name: TIME_RECORDING_COMPLIANCE_LABEL, kind: "folder" as const, open: () => selectTimeRecordingFolder() }] : []),
    ...unitFolders.map((unit): ArchiveEntry => ({ id: "unit:" + unit, name: unit, kind: "folder", open: () => selectUnitWithinCategory(categoryFilter, unit) })),
    ...fileEntries(filtered.filter((document) => !document.unit && companyDocumentFolderCode(document) !== TIME_RECORDING_COMPLIANCE_FOLDER)),
  ];
  else entries = fileEntries(filtered);
  const breadcrumbs = [
    ...(categoryFilter !== "all" ? [{ name: categoryFilter, open: () => selectCategory(categoryFilter) }] : []),
    ...(folderFilter ? [{ name: TIME_RECORDING_COMPLIANCE_LABEL, open: () => selectTimeRecordingFolder() }] : []),
    ...(sectionFilter ? [{ name: TIME_RECORDING_EVIDENCE_SECTIONS.find((section) => section.code === sectionFilter)?.label ?? sectionFilter }] : []),
    ...(unitFilter !== "all" ? [{ name: unitFilter === NO_UNIT_FILTER ? "Sem unidade específica" : unitFilter }] : []),
  ];
  const goUp = () => { if (sectionFilter) selectTimeRecordingFolder(); else if (folderFilter || unitFilter !== "all") selectCategory(categoryFilter); else if (categoryFilter !== "all") selectAllDocuments(); else router.push("/dashboard/documents"); };

  return (
    <>
      <ArchiveExplorer area="company" folders={folders} entries={entries} breadcrumbs={breadcrumbs} search={search} onSearch={setSearch} loading={loading} error={message} onRefresh={() => void loadDocuments()} onUp={goUp} onRoot={selectAllDocuments}
        onSelect={() => { previewSequence.current++; setPreview(null); setRemoveTarget(null); }}
        footer={canManage && removeTarget ? <InlineConfirm className="m-3" message={`Excluir “${removeTarget.title}”?`} confirmLabel="Excluir documento" loading={removing} onCancel={() => setRemoveTarget(null)} onConfirm={() => void removeDocument(removeTarget)} /> : null}
        toolbar={canManage ? <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" />Anexar</Button> : null}
        preview={(entry) => {
          const document = documents.find((item) => item.id === entry.id);
          if (!document) return <p className="text-xs text-slate-500">{entry.description || "Abra a pasta para consultar os arquivos."}</p>;
          return <div className="space-y-3 text-xs text-slate-600">
            {preview?.id === document.id && <ArchivePreview url={preview.url} mime={preview.mime} title={document.title} />}
            <p className="break-all"><strong>Nome do arquivo</strong><br />{document.standardizedName || document.originalName}</p>
            <p className="break-all"><strong>Nome original</strong><br />{document.originalName}</p>
            <p>{formatSize(document.size)} · {document.mimeType}</p><p>Vencimento: {formatDate(document.expiresAt)}</p>
            <p>Adicionado por {document.uploadedByName || "Sistema"}</p>
          </div>;
        }} />

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
                  <div key={item.id} className="rounded-2xl border bg-white p-4 shadow-xs">
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

                    {!item.analyzing ? <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="ds-secondary" size="sm" onClick={() => void analyzePendingItem(item.id, item.file)}>Sugerir com IA</Button><p className="text-xs text-slate-500">Opcional. Você pode preencher a classificação sem usar IA.</p></div> : null}

                    {item.uploadError ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{item.uploadError}</p> : null}

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-black text-slate-700">Título</span><Input value={item.title} onChange={(event) => updatePendingItem(item.id, { title: event.target.value })} placeholder="Ex.: Contrato Social - Quarta alteração" /></label>
                      <label className="space-y-1.5"><span className="text-xs font-black text-slate-700">Categoria</span><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={item.category} onChange={(event) => updatePendingItem(item.id, { category: event.target.value, folderCode: event.target.value === TIME_RECORDING_COMPLIANCE_CATEGORY ? item.folderCode : null, evidenceSection: event.target.value === TIME_RECORDING_COMPLIANCE_CATEGORY ? item.evidenceSection : null })}>{CATEGORIES.map((option) => <option key={option}>{option}</option>)}</select></label>
                      <label className="space-y-1.5"><span className="text-xs font-black text-slate-700">Escopo do documento</span><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={item.unitId} onChange={(event) => updatePendingItem(item.id, { unitId: event.target.value })}><option value="">Selecione o escopo</option><option value="__general__">Empresa inteira</option>{unitOptions.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
                      <label className="space-y-1.5"><span className="text-xs font-black text-slate-700">Tipo documental</span><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={item.documentType} onChange={(event) => updatePendingItem(item.id, { documentType: event.target.value })}><option value="">A classificar — preservar nome original</option>{COMPANY_DOCUMENT_TYPES.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</select></label>
                      <label className="space-y-1.5"><span className="text-xs font-black text-slate-700">Referência {COMPANY_DOCUMENT_TYPES.find((type) => type.code === item.documentType)?.reference ? "(obrigatória)" : "(opcional)"}</span><Input value={item.reference} onChange={(event) => updatePendingItem(item.id, { reference: event.target.value })} placeholder="Competência, validade, data ou versão do instrumento" /></label>
                      <p className="break-all text-xs text-slate-500 sm:col-span-2">{item.documentType && item.unitId ? `Padrão de download: ${companyIntakeName({ documentType: item.documentType, unitId: item.unitId === "__general__" ? undefined : item.unitId, reference: item.reference, version: 1, extension: item.file.type === "application/pdf" ? "pdf" : item.file.type === "image/png" ? "png" : "jpg" }).replace("__v01.", "__vNN.")}. A versão é atribuída ao confirmar.` : "Sem tipo confirmado, o arquivo ficará em A classificar com o nome original."}</p>
                      {item.category === TIME_RECORDING_COMPLIANCE_CATEGORY ? <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-black text-slate-700">Pasta</span><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={item.folderCode ?? ""} onChange={(event) => updatePendingItem(item.id, { folderCode: event.target.value === TIME_RECORDING_COMPLIANCE_FOLDER ? TIME_RECORDING_COMPLIANCE_FOLDER : null, evidenceSection: null })}><option value="">Sistemas e conformidade (geral)</option><option value={TIME_RECORDING_COMPLIANCE_FOLDER}>{TIME_RECORDING_COMPLIANCE_LABEL}</option></select></label> : null}
                      {item.folderCode ? <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-black text-slate-700">Seção da pasta</span><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={item.evidenceSection ?? ""} onChange={(event) => updatePendingItem(item.id, { evidenceSection: event.target.value as TimeRecordingEvidenceSection || null })}><option value="">Escolha uma seção</option>{TIME_RECORDING_EVIDENCE_SECTIONS.map((section) => <option key={section.code} value={section.code}>{section.label}</option>)}</select></label> : null}
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

      {canManage ? <Dialog open={Boolean(classifyingDocument)} onOpenChange={(open) => { if (!open && !classificationSaving) setClassifyingDocument(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Classificar documento</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500">Original: {classifyingDocument?.originalName}. O arquivo será mantido; o servidor confirmará nome e versão.</p>
          <label className="space-y-1"><span className="text-xs font-bold">Título</span><Input value={classificationDraft.title} onChange={(event) => setClassificationDraft((draft) => ({ ...draft, title: event.target.value }))} /></label>
          <label className="space-y-1"><span className="text-xs font-bold">Categoria</span><select className="h-10 w-full rounded-md border px-3" value={classificationDraft.category} onChange={(event) => setClassificationDraft((draft) => ({ ...draft, category: event.target.value }))}><option value="">Selecione a categoria</option>{CATEGORIES.filter((category) => category !== "A classificar").map((category) => <option key={category}>{category}</option>)}</select></label>
          <label className="space-y-1"><span className="text-xs font-bold">Escopo</span><select className="h-10 w-full rounded-md border px-3" value={classificationDraft.unitId} onChange={(event) => setClassificationDraft((draft) => ({ ...draft, unitId: event.target.value }))}><option value="">Selecione o escopo</option><option value="__general__">Empresa inteira</option>{unitOptions.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          <label className="space-y-1"><span className="text-xs font-bold">Tipo documental</span><select className="h-10 w-full rounded-md border px-3" value={classificationDraft.documentType} onChange={(event) => setClassificationDraft((draft) => ({ ...draft, documentType: event.target.value }))}><option value="">Selecione o tipo</option>{COMPANY_DOCUMENT_TYPES.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</select></label>
          <label className="space-y-1"><span className="text-xs font-bold">Referência {COMPANY_DOCUMENT_TYPES.find((type) => type.code === classificationDraft.documentType)?.reference ? "(obrigatória)" : "(opcional)"}</span><Input value={classificationDraft.reference} onChange={(event) => setClassificationDraft((draft) => ({ ...draft, reference: event.target.value }))} /></label>
          {classificationDraft.documentType && classificationDraft.unitId ? <p className="break-all text-xs text-slate-500">Padrão: {companyIntakeName({ ...classificationDraft, unitId: classificationDraft.unitId === "__general__" ? undefined : classificationDraft.unitId, version: 1, extension: classifyingDocument?.mimeType === "application/pdf" ? "pdf" : classifyingDocument?.mimeType === "image/png" ? "png" : "jpg" }).replace("__v01.", "__vNN.")}</p> : null}
          {classificationError ? <p role="alert" className="text-sm text-rose-700">{classificationError}</p> : null}
          <div className="flex justify-end gap-2"><Button variant="ds-ghost" disabled={classificationSaving} onClick={() => setClassifyingDocument(null)}>Cancelar</Button><Button variant="primary-modal" disabled={classificationSaving || !classificationDraft.title.trim() || !classificationDraft.category || !classificationDraft.unitId || !classificationDraft.documentType} onClick={() => void confirmClassification()}>{classificationSaving ? "Salvando…" : "Confirmar classificação"}</Button></div>
        </DialogContent>
      </Dialog> : null}

      {canManage ? <Dialog open={Boolean(movingDocument)} onOpenChange={(open) => { if (!open && !moveSaving) setMovingDocument(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Mover documento para outra pasta</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">{movingDocument?.title}</p>
          <label className="space-y-1.5"><span className="text-xs font-black text-slate-700">Destino</span>
            <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={moveFolderCode ?? ""} onChange={(event) => { setMoveFolderCode(event.target.value === TIME_RECORDING_COMPLIANCE_FOLDER ? TIME_RECORDING_COMPLIANCE_FOLDER : null); setMoveSection(null); }}>
              <option value="">{movingDocument?.category} (geral)</option>
              <option value={TIME_RECORDING_COMPLIANCE_FOLDER}>{TIME_RECORDING_COMPLIANCE_LABEL}</option>
            </select>
          </label>
          {moveFolderCode ? <label className="space-y-1.5"><span className="text-xs font-black text-slate-700">Seção</span><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={moveSection ?? ""} onChange={(event) => setMoveSection(event.target.value as TimeRecordingEvidenceSection || null)}><option value="">Escolha uma seção</option>{TIME_RECORDING_EVIDENCE_SECTIONS.map((section) => <option key={section.code} value={section.code}>{section.label}</option>)}</select></label> : null}
          {moveError ? <p role="alert" className="text-sm text-rose-700">{moveError}</p> : null}
          <label className="space-y-1.5"><span className="text-xs font-black text-slate-700">Motivo da movimentação</span><Input value={moveReason} onChange={(event) => setMoveReason(event.target.value)} maxLength={500} placeholder="Ex.: Documento de regularidade do sistema REP-P" /></label>
          <p className="text-xs text-slate-500">A mudança organiza a pasta exibida. O arquivo original e as permissões de acesso permanecem vinculados ao registro.</p>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={moveSaving} onClick={() => setMovingDocument(null)}>Cancelar</Button><Button disabled={moveSaving || moveReason.trim().length < 3 || (moveFolderCode !== null && moveSection === null) || (companyDocumentFolderCode(movingDocument ?? {}) === moveFolderCode && companyDocumentEvidenceSection(movingDocument ?? {}) === moveSection)} onClick={() => void confirmMove()}>{moveSaving ? "Movendo…" : "Confirmar movimentação"}</Button></div>
        </DialogContent>
      </Dialog> : null}
    </>
  );
}
