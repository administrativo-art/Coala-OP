"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Brain, CheckCircle2, FolderTree, Loader2, RefreshCw, Trash2, Upload, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { EMPLOYEE_DOCUMENT_ACCESS_LEVELS, EMPLOYEE_DOCUMENT_CATEGORIES, EMPLOYEE_DOCUMENT_TYPE_CATALOG, type EmployeeDocumentCategoryId } from "@/lib/hr/employee-document-options";

const ACCESS: Record<string, string> = Object.fromEntries(EMPLOYEE_DOCUMENT_ACCESS_LEVELS.map((level) => [level.id, level.label]));
type UploadFileItem = {
  id: string;
  file: File;
};

type AnalysisDocument = {
  clientFileId: string;
  itemId: string;
  documentId: string;
  category: EmployeeDocumentCategoryId;
  documentType: string;
  documentTypeCode?: string;
  accessLevel: string;
  originalName: string;
  size: number;
  mimeType: string;
  confidence: number;
  status: "ready" | "review" | "blocked" | "duplicate" | "discarded";
  action?: string;
  employeeMatchStatus?: "MATCH" | "POSSIBLE_MATCH" | "MISMATCH" | "UNKNOWN";
  employeeId?: string;
  employeeMatchReason?: string;
  suggestedEmployeeId?: string | null;
  suggestedEmployeeName?: string | null;
  decisionReason?: string;
  identifiedEmployeeName?: string | null;
  extractedFields: Record<string, unknown>;
  fieldConfidences?: Record<string, number>;
  profileSuggestions?: ProfileSuggestion[];
  structure?: {
    legibility?: string;
    multipleDocumentsDetected?: boolean;
    pageCount?: number | null;
  };
  analysisProvider?: string;
  analysisModel?: string;
  warnings: string[];
  errors: string[];
  categoryLabel: string;
  typeSlug: string;
  fileName: string;
  storageSubfolder: string;
  storagePath: string;
  destinationTrail: string[];
  duplicateResolution?: string;
  duplicateInBatch?: {
    itemId: string;
    originalName: string;
  } | null;
  existingDocument?: {
    id: string;
    documentType?: string | null;
    storedName?: string | null;
    version?: number | null;
    uploadedAt?: string | null;
  } | null;
};

type ProfileSuggestion = {
  fieldKey: string;
  fieldLabel: string;
  section: string;
  extractedField: string;
  extractedValue: string;
  currentValue: string | null;
  confidence: number;
  status: "MISSING_IN_PROFILE" | "FILLED_FROM_DOCUMENT" | "MATCHING_PROFILE" | "DIVERGENT";
};

type AnalysisPayload = {
  batchId?: string;
  batchStatus?: string;
  totalFiles: number;
  readyFiles: number;
  reviewFiles?: number;
  blockedFiles: number;
  totalBytes: number;
  documents: AnalysisDocument[];
};

type ResumableBatch = {
  id: string;
  status: string;
  createdAt?: string;
  items: Array<Record<string, unknown> & { itemId: string; clientFileId: string }>;
};

type EmployeeCorrection = {
  employeeId: string;
  reason: string;
};

function newId(prefix: string) {
  const randomPart = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function categoryLabel(category: EmployeeDocumentCategoryId | string) {
  return EMPLOYEE_DOCUMENT_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

function fieldPreview(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value).slice(0, 120);
  } catch {
    return "—";
  }
}

function profileSuggestionStatusLabel(status: ProfileSuggestion["status"]) {
  if (status === "MISSING_IN_PROFILE") return "Será preenchido";
  if (status === "FILLED_FROM_DOCUMENT") return "Preenchido";
  if (status === "MATCHING_PROFILE") return "Sem divergência";
  return "Revisar divergência";
}

function profileSuggestionStatusClass(status: ProfileSuggestion["status"]) {
  if (status === "DIVERGENT") return "bg-amber-50 text-amber-700";
  if (status === "MATCHING_PROFILE") return "bg-sky-50 text-sky-700";
  return "bg-emerald-50 text-emerald-700";
}

function statusBadgeClass(status: AnalysisDocument["status"]) {
  if (status === "ready") return "bg-emerald-50 text-emerald-700";
  if (status === "review" || status === "duplicate") return "bg-amber-50 text-amber-700";
  if (status === "discarded") return "bg-slate-100 text-slate-500";
  return "bg-rose-50 text-rose-700";
}

function statusLabel(status: AnalysisDocument["status"]) {
  if (status === "ready") return "Pronto";
  if (status === "review") return "Revisão";
  if (status === "duplicate") return "Duplicado";
  if (status === "discarded") return "Descartado";
  return "Bloqueado";
}

function isReadyDocument(document: AnalysisDocument) {
  return document.status === "ready";
}

function isReviewDocument(document: AnalysisDocument) {
  return document.status === "review" || document.status === "duplicate";
}

function isBlockedDocument(document: AnalysisDocument) {
  return document.status === "blocked";
}

function correctionEmployeeId(document: AnalysisDocument, current: Record<string, EmployeeCorrection>, fallbackUserId: string) {
  return current[document.itemId]?.employeeId ?? document.suggestedEmployeeId ?? document.employeeId ?? fallbackUserId;
}

function correctionReason(document: AnalysisDocument, current: Record<string, EmployeeCorrection>) {
  return current[document.itemId]?.reason
    ?? (document.suggestedEmployeeId && document.suggestedEmployeeId !== document.employeeId
      ? "Documento identificado como pertencente a outro colaborador cadastrado."
      : "");
}

export function EmployeeDocumentIntake({ employeeId: userId, employeeName, uploadOpen: uploadModalOpen, onUploadOpenChange: setUploadModalOpen, onArchived }: {
  employeeId: string; employeeName: string; uploadOpen: boolean; onUploadOpenChange: (open: boolean) => void; onArchived: () => void;
}) {
  const { firebaseUser, users } = useAuth();
  const employee = { username: employeeName };
  /** Só quem gerencia a pasta usa este componente; as APIs revalidam a permissão. */
  const canManage = true;
  const [uploadFiles, setUploadFiles] = useState<UploadFileItem[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [employeeCorrections, setEmployeeCorrections] = useState<Record<string, EmployeeCorrection>>({});
  const [resumableBatches, setResumableBatches] = useState<ResumableBatch[]>([]);


  const request = useCallback(async (url: string, init?: RequestInit) => {
    if (!firebaseUser) throw new Error("Sessão não encontrada.");
    const token = await firebaseUser.getIdToken();
    const response = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
    return data;
  }, [firebaseUser]);

  const loadBatches = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const batches = await request(`/api/hr/employee-documents/batches?employeeId=${encodeURIComponent(userId)}`);
      setResumableBatches(batches.batches ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar revisões pendentes.");
    }
  }, [firebaseUser, request, userId]);
  useEffect(() => { void loadBatches(); }, [loadBatches]);
  /** Depois de arquivar: atualiza os lotes pendentes e a pasta. */
  const load = useCallback(async () => { await loadBatches(); onArchived(); }, [loadBatches, onArchived]);
  const selectedFileCount = uploadFiles.length;
  const selectedTotalBytes = uploadFiles.reduce((total, item) => total + item.file.size, 0);

  function resetAnalysis() {
    setAnalysis(null);
    setMessage("");
  }

  function addFiles(fileList: FileList | File[]) {
    const nextFiles = Array.from(fileList).map((file) => ({ id: newId("file"), file }));
    if (nextFiles.length === 0) return;
    setUploadFiles((current) => [...current, ...nextFiles]);
    resetAnalysis();
  }

  function removeFile(fileId: string) {
    setUploadFiles((current) => current.filter((item) => item.id !== fileId));
    resetAnalysis();
  }

  function clearFiles() {
    setUploadFiles([]);
    resetAnalysis();
  }

  function resumeBatch(batch: ResumableBatch) {
    const documents: AnalysisDocument[] = batch.items.map((item) => {
      const documentTypeCode = typeof item.documentTypeCode === "string" ? item.documentTypeCode : "UNKNOWN_DOCUMENT";
      const type = EMPLOYEE_DOCUMENT_TYPE_CATALOG.find((entry) => entry.code === documentTypeCode);
      const destination = item.destination && typeof item.destination === "object" ? item.destination as Record<string, unknown> : {};
      return {
        clientFileId: item.clientFileId,
        itemId: item.itemId,
        documentId: typeof item.documentId === "string" ? item.documentId : item.itemId,
        category: (typeof item.category === "string" ? item.category : "personal") as EmployeeDocumentCategoryId,
        documentType: type?.label ?? documentTypeCode,
        documentTypeCode,
        accessLevel: type?.defaultAccessLevel ?? "restricted",
        originalName: typeof item.originalName === "string" ? item.originalName : "Documento",
        size: typeof item.size === "number" ? item.size : 0,
        mimeType: typeof item.mimeType === "string" ? item.mimeType : "",
        confidence: typeof item.confidence === "number" ? item.confidence : 0,
        status: (typeof item.status === "string" ? item.status : "review") as AnalysisDocument["status"],
        action: typeof item.decisionAction === "string" ? item.decisionAction : undefined,
        employeeId: typeof item.employeeId === "string" ? item.employeeId : userId,
        employeeMatchStatus: item.employeeMatchStatus as AnalysisDocument["employeeMatchStatus"],
        employeeMatchReason: typeof item.employeeMatchReason === "string" ? item.employeeMatchReason : undefined,
        suggestedEmployeeId: typeof item.suggestedEmployeeId === "string" ? item.suggestedEmployeeId : null,
        suggestedEmployeeName: typeof item.suggestedEmployeeName === "string" ? item.suggestedEmployeeName : null,
        decisionReason: typeof item.decisionReason === "string" ? item.decisionReason : undefined,
        identifiedEmployeeName: typeof item.identifiedEmployeeName === "string" ? item.identifiedEmployeeName : null,
        extractedFields: item.extractedFields && typeof item.extractedFields === "object" ? item.extractedFields as Record<string, unknown> : {},
        fieldConfidences: item.fieldConfidences && typeof item.fieldConfidences === "object" ? item.fieldConfidences as Record<string, number> : {},
        profileSuggestions: Array.isArray(item.profileSuggestions) ? item.profileSuggestions as ProfileSuggestion[] : [],
        structure: item.structure && typeof item.structure === "object" ? item.structure as AnalysisDocument["structure"] : undefined,
        analysisModel: typeof item.analysisModel === "string" ? item.analysisModel : undefined,
        warnings: Array.isArray(item.warnings) ? item.warnings.filter((entry): entry is string => typeof entry === "string") : [],
        errors: Array.isArray(item.errors) ? item.errors.filter((entry): entry is string => typeof entry === "string") : [],
        categoryLabel: categoryLabel(typeof item.category === "string" ? item.category : "personal"),
        typeSlug: documentTypeCode.toLowerCase(),
        fileName: typeof destination.downloadName === "string" ? destination.downloadName : "",
        storageSubfolder: typeof item.tempStoragePath === "string" ? item.tempStoragePath : "",
        storagePath: typeof item.tempStoragePath === "string" ? item.tempStoragePath : "",
        destinationTrail: Array.isArray(destination.pathSegments) ? destination.pathSegments.filter((entry): entry is string => typeof entry === "string") : [],
        duplicateResolution: typeof item.duplicateResolution === "string" ? item.duplicateResolution : undefined,
        duplicateInBatch: typeof item.duplicateOfItemId === "string"
          ? {
              itemId: item.duplicateOfItemId,
              originalName: typeof item.duplicateOfName === "string" ? item.duplicateOfName : "arquivo anterior do lote",
            }
          : null,
        existingDocument: item.existingDocument && typeof item.existingDocument === "object"
          ? item.existingDocument as AnalysisDocument["existingDocument"]
          : null,
      };
    });
    setAnalysis({
      batchId: batch.id, batchStatus: batch.status, totalFiles: documents.length,
      readyFiles: documents.filter(isReadyDocument).length,
      reviewFiles: documents.filter(isReviewDocument).length,
      blockedFiles: documents.filter(isBlockedDocument).length,
      totalBytes: documents.reduce((sum, item) => sum + item.size, 0), documents,
    });
    setMessage("");
  }

  async function analyzeBatch() {
    setBusy(true);
    setMessage("");
    try {
      if (uploadFiles.length === 0) throw new Error("Selecione ao menos um arquivo.");

      const form = new FormData();
      form.set("employeeId", userId);
      form.set("employeeName", employee?.username ?? "");
      uploadFiles.forEach((item) => form.append("files", item.file, item.file.name));

      const data = await request("/api/hr/employee-documents/analyze-upload", { method: "POST", body: form });
      setAnalysis(data.analysis);
      setUploadModalOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao analisar anexos.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadBatch() {
    if (!analysis || analysis.readyFiles === 0) return;
    setBusy(true);
    setMessage("");
    try {
      const readyDocuments = analysis.documents.filter(isReadyDocument);
      if (!analysis.batchId) throw new Error("Lote de análise inválido.");
      // Arquiva a partir dos ITENS persistidos no servidor (os arquivos já estão
      // no temporário). O backend recalcula tudo — o cliente só aponta os itens.
      const result = await request("/api/hr/employee-documents/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: analysis.batchId, itemIds: readyDocuments.map((document) => document.itemId) }),
      });
      const filed = Array.isArray(result?.filed) ? result.filed.length : 0;
      const failures = Array.isArray(result?.failures) ? result.failures.length : 0;
      setUploadFiles([]);
      setAnalysis(null);
      await load();
      setMessage(
        failures > 0
          ? `${filed} arquivado(s); ${failures} não puderam ser arquivados (ex.: colaborador divergente ou duplicata).`
          : `${filed} documento(s) arquivado(s). Itens em revisão permanecem no lote.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha no envio.");
    } finally {
      setBusy(false);
    }
  }

  async function correctItemType(document: AnalysisDocument, documentTypeCode: string) {
    if (!document.itemId) return;
    setBusy(true);
    try {
      const updated = await request("/api/hr/employee-documents/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: document.itemId, documentTypeCode }),
      });
      setAnalysis((current) => {
        if (!current) return current;
        const documents = current.documents.map((entry) =>
          entry.itemId === document.itemId
            ? { ...entry, status: updated.status, action: updated.action, documentType: updated.documentType, documentTypeCode: updated.documentTypeCode, destinationTrail: updated.destinationTrail, fileName: updated.fileName, profileSuggestions: updated.profileSuggestions ?? [] }
            : entry,
        );
        const readyFiles = documents.filter(isReadyDocument).length;
        const reviewFiles = documents.filter(isReviewDocument).length;
        const blockedFiles = documents.filter(isBlockedDocument).length;
        return { ...current, documents, readyFiles, reviewFiles, blockedFiles };
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao corrigir o tipo.");
    } finally {
      setBusy(false);
    }
  }

  async function correctItemEmployee(document: AnalysisDocument) {
    const correction = employeeCorrections[document.itemId];
    const targetEmployeeId = correction?.employeeId ?? document.suggestedEmployeeId ?? "";
    const reason = correction?.reason ?? (document.suggestedEmployeeId ? "Documento identificado como pertencente a outro colaborador cadastrado." : "");
    if (!targetEmployeeId || targetEmployeeId === document.employeeId) return;
    if (reason.trim().length < 3) {
      setMessage("Informe uma justificativa de pelo menos 3 caracteres para trocar o colaborador.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const updated = await request("/api/hr/employee-documents/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: document.itemId,
          employeeId: targetEmployeeId,
          reason: reason.trim(),
        }),
      });
      const selectedEmployee = users.find((user) => user.id === updated.employeeId);
      setAnalysis((current) => {
        if (!current) return current;
        const documents = current.documents.map((entry) =>
          entry.itemId === document.itemId
            ? {
                ...entry,
                status: updated.status,
                action: updated.action,
                employeeId: updated.employeeId,
                employeeMatchStatus: updated.employeeMatchStatus,
                employeeMatchReason: updated.employeeMatchReason,
                suggestedEmployeeId: updated.suggestedEmployeeId ?? null,
                suggestedEmployeeName: updated.suggestedEmployeeName ?? null,
                decisionReason: updated.decisionReason,
                identifiedEmployeeName: selectedEmployee?.username ?? entry.identifiedEmployeeName,
                destinationTrail: updated.destinationTrail,
                fileName: updated.fileName,
                profileSuggestions: updated.profileSuggestions ?? [],
              }
            : entry,
        );
        const readyFiles = documents.filter(isReadyDocument).length;
        const reviewFiles = documents.filter(isReviewDocument).length;
        const blockedFiles = documents.filter(isBlockedDocument).length;
        return { ...current, documents, readyFiles, reviewFiles, blockedFiles };
      });
      setEmployeeCorrections((current) => {
        const next = { ...current };
        delete next[document.itemId];
        return next;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao corrigir o colaborador.");
    } finally {
      setBusy(false);
    }
  }

  async function reanalyzeItem(document: AnalysisDocument) {
    setBusy(true);
    setMessage("");
    try {
      const updated = await request("/api/hr/employee-documents/reanalyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: document.itemId }),
      });
      setAnalysis((current) => {
        if (!current) return current;
        const documents = current.documents.map((entry) => entry.itemId === document.itemId ? {
          ...entry, status: updated.status, action: updated.action, documentType: updated.documentType,
          documentTypeCode: updated.documentTypeCode, category: updated.category,
          employeeMatchStatus: updated.employeeMatchStatus, employeeMatchReason: updated.employeeMatchReason,
          suggestedEmployeeId: updated.suggestedEmployeeId ?? null,
          suggestedEmployeeName: updated.suggestedEmployeeName ?? null,
          decisionReason: updated.decisionReason, destinationTrail: updated.destinationTrail,
          fileName: updated.fileName, fieldConfidences: updated.fieldConfidences,
          profileSuggestions: updated.profileSuggestions ?? [],
          extractedFields: updated.extractedFields, warnings: updated.warnings, errors: updated.errors,
          analysisModel: updated.analysisModel,
        } : entry);
        return {
          ...current,
          documents,
          readyFiles: documents.filter(isReadyDocument).length,
          reviewFiles: documents.filter(isReviewDocument).length,
          blockedFiles: documents.filter(isBlockedDocument).length,
        };
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao reanalisar o item.");
    } finally {
      setBusy(false);
    }
  }

  async function itemAction(document: AnalysisDocument, action: "discard" | "accept") {
    if (action === "discard" && !window.confirm(`Descartar “${document.originalName}” desta prévia?`)) return;
    setBusy(true);
    setMessage("");
    try {
      await request("/api/hr/employee-documents/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: document.itemId, action }),
      });
      setAnalysis((current) => {
        if (!current) return current;
        const documents = action === "discard"
          ? current.documents.filter((entry) => entry.itemId !== document.itemId)
          : current.documents.map((entry) => entry.itemId === document.itemId ? { ...entry, status: "ready" as const } : entry);
        return {
          ...current,
          documents,
          readyFiles: documents.filter(isReadyDocument).length,
          reviewFiles: documents.filter(isReviewDocument).length,
          blockedFiles: documents.filter(isBlockedDocument).length,
        };
      });
      setMessage(action === "discard" ? "Documento descartado." : "Documento marcado para arquivar.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {resumableBatches.length > 0 && !analysis ? (
        <section className="flex w-fit max-w-full flex-wrap items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
          <span className="inline-flex items-center gap-1.5 font-black">
            <AlertTriangle className="h-3.5 w-3.5" />
            {resumableBatches.length === 1 ? "1 revisão pendente" : `${resumableBatches.length} revisões pendentes`}
          </span>
          <span className="h-4 w-px bg-amber-200" aria-hidden="true" />
          <div className="flex flex-wrap gap-1.5">
            {resumableBatches.map((batch) => (
              <button key={batch.id} type="button" onClick={() => resumeBatch(batch)} className="rounded-lg border border-amber-200 bg-white px-2.5 py-1 font-black text-amber-800 hover:bg-amber-100/70">
                Revisar {batch.items.length} {batch.items.length === 1 ? "arquivo" : "arquivos"}
              </button>
            ))}
          </div>
        </section>
      ) : null}

          {analysis ? (
            <section className="rounded-3xl border border-sky-100 bg-sky-50/60 p-4 shadow-xs">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-black text-sky-900">Prévia de classificação e arquivamento</p>
                  <p className="text-xs font-semibold text-sky-700">
                    {analysis.readyFiles} pronto(s), {analysis.reviewFiles ?? 0} em revisão e {analysis.blockedFiles} bloqueado(s). O MVP arquiva apenas os prontos após confirmação.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <span className="inline-flex items-center justify-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-black text-slate-700">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    {analysis.totalFiles} analisado(s)
                  </span>
                  {canManage ? (
                    <button type="button" disabled={busy || analysis.readyFiles === 0} onClick={() => void uploadBatch()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#df2f78] px-4 py-2 text-xs font-black text-white disabled:opacity-50">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      Arquivar {analysis.readyFiles} pronto(s)
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {analysis.documents.map((document) => (
                  <div key={document.clientFileId} className="rounded-2xl bg-white p-4 shadow-xs">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-900">{document.originalName}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {categoryLabel(document.category)} · {document.documentType} · {ACCESS[document.accessLevel] ?? document.accessLevel} · Confiança {(document.confidence * 100).toFixed(0)}%
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {canManage && document.status !== "ready" ? (
                          <select
                            value={document.documentTypeCode ?? ""}
                            onChange={(event) => void correctItemType(document, event.target.value)}
                            disabled={busy}
                            className="h-8 max-w-[200px] rounded-lg border px-2 text-xs font-bold"
                            title="Corrigir o tipo (o destino é recalculado)"
                          >
                            <option value="" disabled>Corrigir tipo…</option>
                            {EMPLOYEE_DOCUMENT_TYPE_CATALOG.map((type) => (
                              <option key={type.code} value={type.code}>{type.label}</option>
                            ))}
                          </select>
                        ) : null}
                        {canManage && document.status !== "ready" ? (
                          <button type="button" onClick={() => void reanalyzeItem(document)} disabled={busy} className="grid h-8 w-8 place-items-center rounded-lg border text-sky-700 disabled:opacity-50" title="Reanalisar documento">
                            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                          </button>
                        ) : null}
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => void itemAction(document, "discard")}
                            disabled={busy}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-100 px-2.5 text-xs font-black text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                            title="Descartar este item da prévia"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Descartar
                          </button>
                        ) : null}
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${statusBadgeClass(document.status)}`}>
                          {statusLabel(document.status)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600">
                      <p className="flex items-start gap-2"><FolderTree className="mt-0.5 h-4 w-4 text-sky-600" />Trilha: {document.destinationTrail.join(" › ")}</p>
                      <p className="break-all rounded-xl bg-slate-50 p-2">Subpasta: {document.storageSubfolder}</p>
                      <p className="break-all rounded-xl bg-slate-50 p-2">Nomenclatura: {document.fileName}</p>
                      <p className="rounded-xl bg-slate-50 p-2">
                        Colaborador: {document.identifiedEmployeeName || employee?.username || "não identificado"} · Match: {document.employeeMatchStatus ?? "UNKNOWN"} · Modelo: {document.analysisModel ?? "—"}
                      </p>
                      {document.employeeMatchReason ? <p className="rounded-xl bg-slate-50 p-2">Vínculo: {document.employeeMatchReason}</p> : null}
                      {document.decisionReason ? <p className="rounded-xl bg-slate-50 p-2">Decisão: {document.decisionReason}</p> : null}
                    </div>

                    {document.employeeMatchStatus === "MISMATCH" && document.suggestedEmployeeId ? (
                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                        Documento identificado como pertencente a {document.suggestedEmployeeName ?? "outro colaborador"}.
                        Esse colaborador tem cadastro no sistema; confirme abaixo para direcionar à pasta correta.
                      </div>
                    ) : null}

                    {canManage && document.status !== "ready" ? (
                      <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <select
                          value={correctionEmployeeId(document, employeeCorrections, userId)}
                          onChange={(event) => setEmployeeCorrections((current) => ({
                            ...current,
                            [document.itemId]: {
                              employeeId: event.target.value,
                              reason: current[document.itemId]?.reason ?? correctionReason(document, current),
                            },
                          }))}
                          disabled={busy}
                          className="h-9 min-w-0 rounded-lg border px-2 text-xs font-bold"
                          aria-label="Colaborador responsável pelo documento"
                        >
                          {document.suggestedEmployeeId && !users.some((user) => user.id === document.suggestedEmployeeId) ? (
                            <option value={document.suggestedEmployeeId}>{document.suggestedEmployeeName ?? "Colaborador sugerido"}</option>
                          ) : null}
                          {users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
                        </select>
                        <input
                          value={correctionReason(document, employeeCorrections)}
                          onChange={(event) => setEmployeeCorrections((current) => ({
                            ...current,
                            [document.itemId]: {
                              employeeId: current[document.itemId]?.employeeId ?? correctionEmployeeId(document, current, userId),
                              reason: event.target.value,
                            },
                          }))}
                          disabled={busy}
                          placeholder="Justificativa para a troca"
                          className="h-9 min-w-0 rounded-lg border px-2 text-xs font-bold"
                        />
                        <button
                          type="button"
                          onClick={() => void correctItemEmployee(document)}
                          disabled={busy || !correctionEmployeeId(document, employeeCorrections, userId) || correctionEmployeeId(document, employeeCorrections, userId) === document.employeeId}
                          className="h-9 rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-black text-sky-800 disabled:opacity-50"
                        >
                          {document.suggestedEmployeeId && document.suggestedEmployeeId !== document.employeeId ? "Direcionar colaborador" : "Trocar colaborador"}
                        </button>
                      </div>
                    ) : null}

                    {Object.keys(document.extractedFields ?? {}).length > 0 ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {Object.entries(document.extractedFields).slice(0, 6).map(([key, value]) => (
                          <div key={key} className="rounded-xl bg-slate-50 p-2">
                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{key}</p>
                            <p className="truncate text-xs font-bold text-slate-700">{fieldPreview(value)}</p>
                            {typeof document.fieldConfidences?.[key] === "number" ? <p className="mt-1 text-[10px] font-bold text-slate-400">Confiança {(document.fieldConfidences[key] * 100).toFixed(0)}%</p> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {document.profileSuggestions && document.profileSuggestions.length > 0 ? (
                      <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 p-3">
                        <p className="text-xs font-black text-sky-900">
                          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                          Cadastro do colaborador
                        </p>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {document.profileSuggestions.map((suggestion) => (
                            <div key={`${document.itemId}-${suggestion.fieldKey}`} className="rounded-xl bg-white p-3 text-xs shadow-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-black text-slate-900">{suggestion.fieldLabel}</p>
                                <span className={`rounded-full px-2 py-1 font-black ${profileSuggestionStatusClass(suggestion.status)}`}>
                                  {profileSuggestionStatusLabel(suggestion.status)}
                                </span>
                              </div>
                              <p className="mt-1 font-semibold text-slate-500">{suggestion.section}</p>
                              <p className="mt-2 font-bold text-slate-700">Documento: {suggestion.extractedValue}</p>
                              <p className="mt-1 font-bold text-slate-500">Cadastro atual: {suggestion.currentValue || "vazio"}</p>
                              <p className="mt-1 text-[10px] font-bold text-slate-400">Confiança {(suggestion.confidence * 100).toFixed(0)}%</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {document.existingDocument && document.employeeMatchStatus !== "MISMATCH" ? (
                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs font-black text-amber-800">
                          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                          Este colaborador já tem esse documento
                        </p>
                        <p className="mt-1 text-xs font-semibold text-amber-700">
                          {document.existingDocument.documentType ?? "Documento"}
                          {document.existingDocument.version ? ` · v${String(document.existingDocument.version).padStart(2, "0")}` : ""}
                          {document.existingDocument.uploadedAt ? ` · enviado em ${new Date(document.existingDocument.uploadedAt).toLocaleDateString("pt-BR")}` : ""}
                          {document.duplicateResolution === "EXACT_DUPLICATE"
                            ? " · arquivo idêntico"
                            : document.duplicateResolution === "NEW_VERSION"
                              ? " · seria uma nova versão"
                              : ""}
                        </p>
                        {canManage && document.status !== "ready" && document.duplicateResolution !== "EXACT_DUPLICATE" ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button type="button" onClick={() => void itemAction(document, "accept")} disabled={busy} className="rounded-lg bg-[#df2f78] px-3 py-1.5 text-xs font-black text-white disabled:opacity-50">
                              Arquivar mesmo assim
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {document.errors.length > 0 || document.warnings.length > 0 ? (
                      <div className="mt-3 space-y-1">
                        {[...document.errors, ...document.warnings].map((entry) => (
                          <p key={entry} className={`text-xs font-bold ${document.errors.includes(entry) ? "text-rose-700" : "text-amber-700"}`}>
                            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                            {entry}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {message ? <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">{message}</p> : null}

      {uploadModalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
          <section className="max-h-[86vh] w-full max-w-2xl overflow-auto rounded-xl border bg-white p-3.5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b pb-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-[#df2f78]" />
                  <h2 className="text-base font-black text-slate-900">Anexar documentos</h2>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  Selecione os arquivos. A classificação, pasta, acesso e nome serão definidos pela análise.
                </p>
              </div>
              <button type="button" onClick={() => setUploadModalOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl border text-slate-500 hover:bg-slate-50">
                <X className="h-4 w-4" />
              </button>
            </div>

            <label
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                addFiles(event.dataTransfer.files);
              }}
              className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center hover:border-[#df2f78]/50 hover:bg-pink-50/60"
            >
              <Upload className="h-6 w-6 text-[#df2f78]" />
              <div>
                <p className="text-base font-black text-slate-900">Arraste documentos para cá ou clique para selecionar</p>
                <p className="mt-1 text-sm font-semibold text-slate-500">PDF, DOC, DOCX, JPG ou PNG · até 15 MB por arquivo</p>
              </div>
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                className="sr-only"
                onChange={(event) => {
                  addFiles(event.target.files ?? []);
                  event.target.value = "";
                }}
              />
            </label>

            {uploadFiles.length > 0 ? (
              <div className="mt-3 rounded-xl border bg-white p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-slate-800">{uploadFiles.length} arquivo(s) selecionado(s) · {formatBytes(selectedTotalBytes)}</p>
                  <button type="button" onClick={clearFiles} className="text-xs font-black text-rose-600">Limpar seleção</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {uploadFiles.map((item) => (
                    <span key={item.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                      <span className="truncate">{item.file.name}</span>
                      <span className="text-slate-400">{formatBytes(item.file.size)}</span>
                      <button type="button" onClick={() => removeFile(item.id)} className="text-slate-400 hover:text-rose-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setUploadModalOpen(false)} className="inline-flex items-center justify-center rounded-2xl border bg-white px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button type="button" disabled={busy || selectedFileCount === 0} onClick={() => void analyzeBatch()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#df2f78] px-5 py-3 text-sm font-black text-white disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                Enviar e analisar {selectedFileCount || ""} documento(s)
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
