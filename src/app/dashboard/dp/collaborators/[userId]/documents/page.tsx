"use client";

import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileText,
  Folder,
  FolderTree,
  History,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BackButton } from "@/components/navigation/back-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EMPLOYEE_DOCUMENT_ACCESS_LEVELS,
  EMPLOYEE_DOCUMENT_CATEGORIES,
  EMPLOYEE_DOCUMENT_VISIBLE_CATEGORIES,
  EMPLOYEE_DOCUMENT_STATUSES,
  EMPLOYEE_DOCUMENT_TYPE_CATALOG,
  employeeDocumentProcessPosition,
  getEmployeeDocumentSubfolders,
  resolveEmployeeDocumentFolderPath,
  normalizeEmployeeDocumentCategory,
  type EmployeeDocumentCategoryId,
} from "@/lib/hr/employee-document-options";
import { employeeDocumentSignatureIndicator } from "@/lib/hr/employee-document-signature";
import type { DocumentVisibilityConfig, NormalizedFieldVisibility } from "@/types/rh";

const STATUS: Record<string, string> = Object.fromEntries(EMPLOYEE_DOCUMENT_STATUSES.map((status) => [status.id, status.label]));
const ACCESS: Record<string, string> = Object.fromEntries(EMPLOYEE_DOCUMENT_ACCESS_LEVELS.map((level) => [level.id, level.label]));
const VISIBILITY_LABEL: Record<string, string> = {
  public: "Sem restrição",
  restricted_partial: "Restrito parcial",
  restricted_total: "Restrito total",
  confidential: "Confidencial",
};
const VISIBILITY_OPTIONS: Array<{ id: NormalizedFieldVisibility; label: string; dot: string }> = [
  { id: "public", label: "Sem restrição", dot: "bg-emerald-500" },
  { id: "restricted_partial", label: "Restrito parcial", dot: "bg-sky-500" },
  { id: "restricted_total", label: "Restrito total", dot: "bg-amber-500" },
  { id: "confidential", label: "Confidencial", dot: "bg-rose-500" },
];
const STATUS_PRESENTATION: Record<string, { description: string; dot: string; text: string }> = {
  pending: { description: "Ainda não recebido", dot: "bg-slate-400", text: "text-slate-700" },
  received: { description: "Aguardando validação", dot: "bg-sky-500", text: "text-sky-700" },
  validated: { description: "Conferido e liberado", dot: "bg-emerald-500", text: "text-emerald-700" },
  rejected: { description: "Novo envio necessário", dot: "bg-rose-500", text: "text-rose-700" },
};

type DocumentRow = {
  id: string;
  category: string;
  documentType: string;
  documentTypeCode?: string;
  signatureRequired?: boolean;
  signatureStatus?: string | null;
  signedAt?: string | null;
  source?: string | null;
  status: string;
  accessLevel: string;
  version?: number | null;
  resolvedVisibility?: "public" | "restricted_partial" | "restricted_total" | "confidential";
  originalName: string;
  mimeType?: string;
  destinationTrail?: string[];
  caseId?: string | null;
  subcaseId?: string | null;
  logicalKey?: string | null;
  profileSuggestions?: ProfileSuggestion[];
  uploadedAt: string;
  uploadedBy?: string;
  uploadedByName?: string;
  validatedByName?: string;
  size: number;
  deletedAt?: string | null;
};

type UploadFileItem = {
  id: string;
  file: File;
};

type DocumentFolderNode = {
  label: string;
  path: string[];
  children: DocumentFolderNode[];
};

function buildDocumentFolderTree(category: EmployeeDocumentCategoryId, documents: DocumentRow[]): DocumentFolderNode[] {
  const roots: DocumentFolderNode[] = [];
  const addPath = (segments: string[]) => {
    let level = roots;
    const path: string[] = [];
    for (const label of segments) {
      path.push(label);
      let node = level.find((entry) => entry.label === label);
      if (!node) {
        node = { label, path: [...path], children: [] };
        level.push(node);
      }
      level = node.children;
    }
  };

  const resolvedPaths = documents.map((document) => resolveEmployeeDocumentFolderPath({
    category,
    documentTypeCode: document.documentTypeCode,
    documentTypeLabel: document.documentType,
    destinationTrail: document.destinationTrail,
  })).filter((path) => path.length > 0);
  const processPosition = employeeDocumentProcessPosition(category);
  if (processPosition !== "before" || resolvedPaths.length === 0) {
    for (const definition of getEmployeeDocumentSubfolders(category)) addPath([definition.label]);
  }
  for (const path of resolvedPaths) addPath(path);
  return roots;
}

function pathStartsWith(path: readonly string[], prefix: readonly string[]) {
  return prefix.every((segment, index) => path[index] === segment);
}

function InlineVisibilityMenu({
  value,
  inherited,
  disabled,
  onChange,
}: {
  value: NormalizedFieldVisibility;
  inherited?: boolean;
  disabled?: boolean;
  onChange: (value: NormalizedFieldVisibility | "inherit") => void;
}) {
  const current = VISIBILITY_OPTIONS.find((option) => option.id === value) ?? VISIBILITY_OPTIONS[2];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border bg-white px-2 text-[10px] font-black text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          aria-label={`Definir visibilidade. Atual: ${current.label}`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${current.dot}`} />
          <span className="truncate">{inherited ? `Herdado: ${current.label}` : current.label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        {inherited !== undefined ? (
          <DropdownMenuItem onSelect={() => onChange("inherit")} className="cursor-pointer rounded-lg px-3 py-2.5">
            <span className="min-w-0 flex-1"><span className="block text-sm font-black">Herdar da pasta</span><span className="block text-[11px] font-semibold text-slate-500">Acompanha o padrão da pasta</span></span>
            {inherited ? <Check className="h-4 w-4 text-emerald-600" /> : null}
          </DropdownMenuItem>
        ) : null}
        {VISIBILITY_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => onChange(option.id)} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${option.dot}`} />
            <span className="flex-1 text-sm font-black text-slate-700">{option.label}</span>
            {!inherited && value === option.id ? <Check className="h-4 w-4 text-emerald-600" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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

type PreviewState = {
  url: string;
  title: string;
  mimeType?: string;
} | null;

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

function isEmailLike(value?: string | null) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "CO";
}

export default function EmployeeDocumentsPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { firebaseUser, user: currentUser, users, permissions } = useAuth();
  const employee = users.find((item) => item.id === userId);
  const canManage = permissions.dp?.collaborators?.edit === true || permissions.settings?.manageUsers === true;
  const ownProfileOnly = permissions.dp?.collaborators?.ownProfileOnly === true;
  const canAccessThisProfile = !ownProfileOnly || currentUser?.id === userId;
  const [items, setItems] = useState<DocumentRow[]>([]);
  const [category, setCategory] = useState<EmployeeDocumentCategoryId>("personal");
  const [expandedCategory, setExpandedCategory] = useState<EmployeeDocumentCategoryId | null>("personal");
  const [activeFolderPath, setActiveFolderPath] = useState<string[]>([]);
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Record<string, boolean>>({});
  const [openVersions, setOpenVersions] = useState<Record<string, boolean>>({});
  const [uploadFiles, setUploadFiles] = useState<UploadFileItem[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [message, setMessage] = useState("");
  const [employeeCorrections, setEmployeeCorrections] = useState<Record<string, EmployeeCorrection>>({});
  const [resumableBatches, setResumableBatches] = useState<ResumableBatch[]>([]);
  const [expandedVerificationId, setExpandedVerificationId] = useState<string | null>(null);
  const [documentVisibility, setDocumentVisibility] = useState<DocumentVisibilityConfig | null>(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);

  useEffect(() => () => {
    if (preview?.url.startsWith("blob:")) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    if (!firebaseUser) throw new Error("Sessão não encontrada.");
    const token = await firebaseUser.getIdToken();
    const response = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
    return data;
  }, [firebaseUser]);

  const requestDocument = useCallback(async (id: string, action: "view" | "download") => {
    if (!firebaseUser) throw new Error("Sessão não encontrada.");
    const token = await firebaseUser.getIdToken();
    const response = await fetch("/api/hr/employee-documents/access", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, action }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "Não foi possível abrir o documento.");
    }
    return response.blob();
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    if (!canAccessThisProfile) {
      setLoading(false);
      setItems([]);
      setResumableBatches([]);
      return;
    }
    setLoading(true);
    try {
      const data = await request(`/api/hr/employee-documents?employeeId=${encodeURIComponent(userId)}`);
      setItems(data.documents ?? []);
      if (canManage) {
        const [batches, visibility] = await Promise.all([
          request(`/api/hr/employee-documents/batches?employeeId=${encodeURIComponent(userId)}`),
          request("/api/hr/employee-documents/visibility"),
        ]);
        setResumableBatches(batches.batches ?? []);
        setDocumentVisibility(visibility.documentVisibility ?? null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [canAccessThisProfile, canManage, firebaseUser, request, userId]);

  useEffect(() => { void load(); }, [load]);

  async function updateVisibility(next: DocumentVisibilityConfig) {
    setVisibilitySaving(true);
    setMessage("");
    try {
      const result = await request("/api/hr/employee-documents/visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setDocumentVisibility(result.documentVisibility ?? next);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar visibilidade.");
    } finally {
      setVisibilitySaving(false);
    }
  }

  function updateDocumentVisibility(documentTypeCode: string, visibility: NormalizedFieldVisibility | "inherit") {
    if (!documentVisibility) return;
    const documentTypes = { ...documentVisibility.document_types };
    if (visibility === "inherit") delete documentTypes[documentTypeCode];
    else documentTypes[documentTypeCode] = visibility;
    void updateVisibility({ ...documentVisibility, document_types: documentTypes });
  }

  const categoryItems = useMemo(
    () => items.filter((item) => normalizeEmployeeDocumentCategory(item.category as EmployeeDocumentCategoryId) === category && !item.deletedAt),
    [items, category],
  );
  const folderTree = useMemo(() => buildDocumentFolderTree(category, categoryItems), [category, categoryItems]);
  const rootFolderSummaries = useMemo(() => folderTree.map((folder) => {
    const logicalDocuments = new Set<string>();
    for (const item of categoryItems) {
      const itemFolderPath = resolveEmployeeDocumentFolderPath({
        category,
        documentTypeCode: item.documentTypeCode,
        documentTypeLabel: item.documentType,
        destinationTrail: item.destinationTrail,
      });
      if (!pathStartsWith(itemFolderPath, folder.path)) continue;
      logicalDocuments.add(item.logicalKey || `${itemFolderPath.join("/")}:${item.documentTypeCode || item.documentType || item.id}`);
    }
    return { ...folder, documentCount: logicalDocuments.size };
  }), [category, categoryItems, folderTree]);
  const visible = useMemo(() => {
    if (activeFolderPath.length === 0) return categoryItems;
    return categoryItems.filter((item) => pathStartsWith(resolveEmployeeDocumentFolderPath({
      category,
      documentTypeCode: item.documentTypeCode,
      documentTypeLabel: item.documentType,
      destinationTrail: item.destinationTrail,
    }), activeFolderPath));
  }, [activeFolderPath, category, categoryItems]);
  // Agrupa documentos do mesmo tipo: o de maior versão é o atual; os demais viram histórico expansível.
  const documentGroups = useMemo(() => {
    const map = new Map<string, DocumentRow[]>();
    for (const item of visible) {
      const folderPath = resolveEmployeeDocumentFolderPath({
        category,
        documentTypeCode: item.documentTypeCode,
        documentTypeLabel: item.documentType,
        destinationTrail: item.destinationTrail,
      });
      const folderKey = folderPath.join("/") || category;
      const key = item.logicalKey || `${folderKey}:${item.documentTypeCode || item.documentType || item.id}`;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return Array.from(map.entries()).map(([groupKey, list]) => {
      const sorted = [...list].sort((a, b) => {
        const va = typeof a.version === "number" ? a.version : 1;
        const vb = typeof b.version === "number" ? b.version : 1;
        if (vb !== va) return vb - va;
        return String(b.uploadedAt).localeCompare(String(a.uploadedAt));
      });
      const [current, ...older] = sorted;
      const folderPath = resolveEmployeeDocumentFolderPath({
        category,
        documentTypeCode: current.documentTypeCode,
        documentTypeLabel: current.documentType,
        destinationTrail: current.destinationTrail,
      });
      return { key: groupKey, folderKey: folderPath.join("/") || category, folderPath, current, older };
    }).sort((a, b) => a.folderKey.localeCompare(b.folderKey, "pt-BR") || a.current.documentType.localeCompare(b.current.documentType, "pt-BR"));
  }, [visible, category]);
  const openFolderTrail = ["Documentos do colaborador", categoryLabel(category), ...activeFolderPath];
  const selectedFileCount = uploadFiles.length;
  const selectedTotalBytes = uploadFiles.reduce((total, item) => total + item.file.size, 0);

  function uploaderName(item: DocumentRow) {
    const user = item.uploadedBy ? users.find((entry) => entry.id === item.uploadedBy) : null;
    if (user?.username) return user.username;
    if (item.uploadedByName && !isEmailLike(item.uploadedByName)) return item.uploadedByName;
    if (user?.email) return user.email.split("@")[0];
    return item.uploadedByName ?? "usuário";
  }

  function resetAnalysis() {
    setAnalysis(null);
    setMessage("");
  }

  function selectCategory(nextCategory: EmployeeDocumentCategoryId) {
    setCategory(nextCategory);
    setExpandedCategory(nextCategory);
    setActiveFolderPath([]);
    setMessage("");
  }

  function selectFolder(path: string[]) {
    setActiveFolderPath(path);
    setExpandedFolderPaths((current) => ({ ...current, [path.join("/")]: true }));
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

  async function previewDocument(item: DocumentRow) {
    try {
      const blob = await requestDocument(item.id, "view");
      const url = URL.createObjectURL(blob);
      setPreview({ url, title: item.documentType || item.originalName, mimeType: item.mimeType || blob.type });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao abrir.");
    }
  }

  async function downloadDocument(item: DocumentRow) {
    try {
      const blob = await requestDocument(item.id, "download");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.originalName || "documento";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao baixar.");
    }
  }

  async function setStatus(item: DocumentRow, status: string) {
    setBusy(true);
    try {
      await request("/api/hr/employee-documents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, status }),
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar.");
    } finally {
      setBusy(false);
    }
  }

  async function bulkSetStatus(status: string) {
    const targets = documentGroups.map((group) => group.current).filter((item) => item.status === "received");
    if (targets.length === 0) return;
    setBusy(true);
    try {
      for (const item of targets) {
        await request("/api/hr/employee-documents", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, status }),
        });
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar em lote.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: DocumentRow) {
    if (!confirm(`Excluir definitivamente o arquivo “${item.originalName}”?`)) return;
    setBusy(true);
    try {
      await request(`/api/hr/employee-documents?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao excluir.");
    } finally {
      setBusy(false);
    }
  }

  function renderFolderNodes(nodes: DocumentFolderNode[], depth = 0): ReactNode {
    return nodes.map((node) => {
      const key = node.path.join("/");
      const active = key === activeFolderPath.join("/");
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && (expandedFolderPaths[key] ?? depth === 0);
      return (
        <div key={key}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => selectFolder(node.path)}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-[5px] text-left text-[11px] font-bold transition-colors ${active ? "bg-pink-50 text-[#c81f69]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}
            >
              <Folder className={`h-3.5 w-3.5 shrink-0 ${active ? "" : "text-slate-300"}`} />
              <span className="min-w-0 flex-1">{node.label}</span>
            </button>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => setExpandedFolderPaths((current) => ({ ...current, [key]: !expanded }))}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-50"
                aria-label={expanded ? `Recolher ${node.label}` : `Expandir ${node.label}`}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
            ) : null}
          </div>
          {expanded ? (
            <div className="ml-3.5 border-l border-slate-100 pl-1.5">
              {renderFolderNodes(node.children, depth + 1)}
            </div>
          ) : null}
        </div>
      );
    });
  }

  if (!canAccessThisProfile) {
    return (
      <div className="w-full p-4 md:p-8">
        <div className="rounded-2xl border bg-white p-5 text-sm font-semibold text-slate-600">
          Este perfil permite visualizar apenas os próprios documentos da Gestão do colaborador.
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <BackButton
            fallbackHref={`/dashboard/dp/collaborators/${userId}`}
            ariaLabel="Voltar à página anterior"
            iconOnly
            variant="outline"
            className="h-9 w-9 rounded-lg bg-white p-0"
            iconClassName="h-4 w-4"
          />
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar className="h-9 w-9 shrink-0 rounded-lg">
              <AvatarImage src={employee?.avatarUrl || undefined} alt={employee?.username ?? "Colaborador"} className="rounded-2xl object-cover" />
              <AvatarFallback
                className="rounded-2xl bg-[#8a8a94] text-sm font-black text-white"
                style={{ backgroundColor: employee?.color || "#8a8a94" }}
              >
                {initials(employee?.username ?? "Colaborador")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#df2f78]">Painel do colaborador</p>
              <h1 className="truncate text-lg font-black text-slate-900">{employee?.username ?? "Colaborador"}</h1>
            </div>
          </div>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard/dp/documents?configureVisibility=1"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border bg-white px-3 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <Settings2 className="h-4 w-4" />
              Visibilidade
            </Link>
            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#df2f78] px-4 text-xs font-black text-white shadow-sm hover:bg-[#c81f69]"
            >
              <Upload className="h-4 w-4" />
              Anexar documentos
            </button>
          </div>
        ) : null}
      </div>

      {process.env.NODE_ENV !== "production" ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5" />
          Arquivos privados. Visualização autenticada pelo backend e trilha de auditoria.
        </div>
      ) : null}

      {canManage && resumableBatches.length > 0 && !analysis ? (
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

      <div className="grid items-start gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border bg-white p-1.5 shadow-sm lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto">
          {EMPLOYEE_DOCUMENT_VISIBLE_CATEGORIES.map(({ id, label }) => {
            const catActive = category === id;
            const catSelected = catActive && activeFolderPath.length === 0;
            const expanded = catActive && expandedCategory === id && folderTree.length > 0;
            return (
              <div key={id}>
                <div className={`flex items-center gap-1 rounded-lg ${catSelected ? "bg-pink-50 text-[#c81f69]" : catActive ? "text-[#c81f69]" : "text-slate-700 hover:bg-slate-50"}`}>
                  <button
                    type="button"
                    onClick={() => selectCategory(id)}
                    aria-current={catActive ? "page" : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-xs font-black"
                  >
                    <Folder className={`h-4 w-4 shrink-0 ${catActive ? "" : "text-slate-400"}`} />
                    <span className="min-w-0 flex-1">{label}</span>
                  </button>
                  {catActive && folderTree.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setExpandedCategory((current) => current === id ? null : id)}
                      className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/70"
                      aria-label={expanded ? `Recolher ${label}` : `Expandir ${label}`}
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                  ) : null}
                </div>
                {expanded ? (
                  <div className="ml-4 border-l border-slate-100 py-1 pl-1.5">
                    {renderFolderNodes(folderTree)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </aside>

        <main className="min-w-0 space-y-3">
          {analysis ? (
            <section className="rounded-3xl border border-sky-100 bg-sky-50/60 p-4 shadow-sm">
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
                  <div key={document.clientFileId} className="rounded-2xl bg-white p-4 shadow-sm">
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
                        Esse colaborador tem cadastro no sistema; confirme abaixo para direcionar ao dossiê correto.
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
                            <div key={`${document.itemId}-${suggestion.fieldKey}`} className="rounded-xl bg-white p-3 text-xs shadow-sm">
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

          <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="border-b px-4 py-3">
              <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px] font-black uppercase tracking-wide text-slate-400">
                {openFolderTrail.map((segment, index) => (
                  <span key={`${segment}-${index}`} className="inline-flex items-center gap-1">
                    <span className={index === openFolderTrail.length - 1 ? "text-[#df2f78]" : ""}>{segment}</span>
                    {index < openFolderTrail.length - 1 ? <span className="text-slate-300">›</span> : null}
                  </span>
                ))}
              </div>
              <h2 className="text-sm font-black">{activeFolderPath.at(-1) ?? categoryLabel(category)}</h2>
            </div>
            {canManage && !loading ? (() => {
              const pending = documentGroups.map((group) => group.current).filter((item) => item.status === "received");
              if (pending.length === 0) return null;
              return (
                <div className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                  <span className="inline-flex items-center gap-2 text-sm font-black text-sky-800">
                    <Clock className="h-4 w-4" />
                    {pending.length} documento{pending.length === 1 ? "" : "s"} aguardando validação
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void bulkSetStatus("validated")}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" /> Validar todos
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void bulkSetStatus("rejected")}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3.5 text-sm font-black text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Recusar todos
                    </button>
                  </div>
                </div>
              );
            })() : null}
            {loading ? (
              <div className="grid place-items-center p-12"><Loader2 className="h-6 w-6 animate-spin text-[#df2f78]" /></div>
            ) : activeFolderPath.length === 0 && rootFolderSummaries.length > 0 ? (
              <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {rootFolderSummaries.map((folder) => (
                  <button
                    key={folder.path.join("/")}
                    type="button"
                    onClick={() => selectFolder(folder.path)}
                    className="group flex min-h-24 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-pink-200 hover:bg-pink-50/40 hover:shadow-sm"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pink-50 text-[#df2f78] transition group-hover:bg-white">
                      <Folder className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-black text-slate-800">{folder.label}</span>
                      <span className="mt-1 block text-xs font-semibold text-slate-500">
                        {folder.documentCount} {folder.documentCount === 1 ? "documento" : "documentos"}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#df2f78]" />
                  </button>
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <FileText className="mx-auto mb-1.5 h-6 w-6 text-slate-300" />
                <p className="text-xs font-bold text-slate-500">Nenhum documento nesta pasta.</p>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => setUploadModalOpen(true)}
                    className="mx-auto mt-2.5 inline-flex h-8 items-center gap-2 rounded-lg border border-pink-200 bg-pink-50 px-3 text-xs font-black text-[#c81f69] hover:bg-pink-100"
                  >
                    <Upload className="h-4 w-4" /> Anexar documento
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="divide-y">
                {documentGroups.map((group, groupIndex) => {
                  const item = group.current;
                  const olderVersions = group.older;
                  const versionsOpen = !!openVersions[group.key];
                  const suggestions = item.profileSuggestions ?? [];
                  const pendingSuggestions = suggestions.filter((suggestion) =>
                    suggestion.status === "DIVERGENT" || suggestion.status === "MISSING_IN_PROFILE"
                  );
                  const divergentCount = pendingSuggestions.filter((suggestion) => suggestion.status === "DIVERGENT").length;
                  const pendingCount = pendingSuggestions.length - divergentCount;
                  const signatureIndicator = employeeDocumentSignatureIndicator(item);
                  const isExpanded = expandedVerificationId === item.id;
                  const startsFolder = group.folderPath.length > 0
                    && (groupIndex === 0 || documentGroups[groupIndex - 1]?.folderKey !== group.folderKey);
                  return (
                    <div key={group.key} className="p-4">
                      {startsFolder ? (
                        <div className="-mx-4 -mt-4 mb-4 flex items-center gap-2 border-b bg-slate-50/70 px-4 py-3 text-sm font-black text-slate-700">
                          <Folder className="h-4 w-4 text-slate-400" />
                          <span>{group.folderPath.join(" › ")}</span>
                        </div>
                      ) : null}
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <p className="font-black text-slate-900">{item.documentType}</p>
                          <p className="truncate text-xs text-slate-500">
                            {formatBytes(item.size)} · enviado por {uploaderName(item)}
                            {typeof item.version === "number" ? ` · v${item.version}` : ""}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">{STATUS[item.status] ?? item.status}</span>
                            {signatureIndicator ? <>
                              <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">Exige assinatura</span>
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-black ${signatureIndicator.signed ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                                {signatureIndicator.signed ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                                {signatureIndicator.statusLabel}
                              </span>
                            </> : null}
                            {canManage && documentVisibility && item.documentTypeCode ? (
                              <InlineVisibilityMenu
                                value={item.resolvedVisibility ?? documentVisibility.categories?.[item.category] ?? "restricted_total"}
                                inherited={!documentVisibility.document_types?.[item.documentTypeCode]}
                                disabled={visibilitySaving}
                                onChange={(value) => updateDocumentVisibility(item.documentTypeCode!, value)}
                              />
                            ) : (
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                                {VISIBILITY_LABEL[item.resolvedVisibility ?? ""] ?? ACCESS[item.accessLevel] ?? item.accessLevel}
                              </span>
                            )}
                            {(() => {
                              const folderVis = documentVisibility?.categories?.[item.category] ?? "restricted_total";
                              const docVis = item.resolvedVisibility ?? folderVis;
                              if (docVis === folderVis) return null;
                              const moreOpen = (docVis === "public" || docVis === "restricted_partial")
                                && (folderVis === "restricted_total" || folderVis === "confidential");
                              return (
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-black ${moreOpen ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-700"}`}>
                                  <AlertTriangle className="h-3 w-3" />
                                  Exceção: {VISIBILITY_LABEL[docVis]}
                                </span>
                              );
                            })()}
                            {olderVersions.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setOpenVersions((current) => ({ ...current, [group.key]: !current[group.key] }))}
                                aria-expanded={versionsOpen}
                                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-black text-slate-600 hover:bg-slate-50"
                              >
                                <History className="h-3 w-3" />
                                {olderVersions.length + 1} versões
                                <ChevronDown className={`h-3 w-3 transition-transform ${versionsOpen ? "rotate-180" : ""}`} />
                              </button>
                            ) : null}
                            {pendingSuggestions.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setExpandedVerificationId(isExpanded ? null : item.id)}
                                aria-expanded={isExpanded}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${divergentCount > 0 || pendingCount > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
                              >
                                {divergentCount > 0
                                  ? `${divergentCount} divergência${divergentCount === 1 ? "" : "s"} no cadastro`
                                  : `${pendingCount} campo${pendingCount === 1 ? "" : "s"} aguardando preenchimento`}
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={() => void previewDocument(item)} className="grid h-9 w-9 place-items-center rounded-lg border" title="Pré-visualizar"><Eye className="h-4 w-4" /></button>
                          <button onClick={() => void downloadDocument(item)} className="grid h-9 w-9 place-items-center rounded-lg border" title="Baixar"><Download className="h-4 w-4" /></button>
                          {canManage ? (
                            <>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className={`inline-flex h-9 min-w-[126px] items-center justify-between gap-2 rounded-lg border bg-white px-3 text-xs font-black shadow-sm hover:bg-slate-50 disabled:opacity-50 ${STATUS_PRESENTATION[item.status]?.text ?? "text-slate-700"}`}
                                    aria-label={`Alterar status. Atual: ${STATUS[item.status] ?? item.status}`}
                                  >
                                    <span className="inline-flex items-center gap-2">
                                      <span className={`h-2 w-2 rounded-full ${STATUS_PRESENTATION[item.status]?.dot ?? "bg-slate-400"}`} />
                                      {STATUS[item.status] ?? item.status}
                                    </span>
                                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5 shadow-xl">
                                  {EMPLOYEE_DOCUMENT_STATUSES.map((status) => {
                                    const presentation = STATUS_PRESENTATION[status.id];
                                    const selected = item.status === status.id;
                                    return (
                                      <DropdownMenuItem
                                        key={status.id}
                                        onSelect={() => {
                                          if (!selected) void setStatus(item, status.id);
                                        }}
                                        className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5"
                                      >
                                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${presentation.dot}`} />
                                        <span className="min-w-0 flex-1">
                                          <span className={`block text-sm font-black ${presentation.text}`}>{status.label}</span>
                                          <span className="block text-[11px] font-semibold text-slate-500">{presentation.description}</span>
                                        </span>
                                        {selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
                                      </DropdownMenuItem>
                                    );
                                  })}
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <button onClick={() => void remove(item)} className="grid h-9 w-9 place-items-center rounded-lg border text-rose-600" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="mt-4 border-t pt-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            {pendingSuggestions.map((suggestion) => (
                              <div key={`${item.id}-${suggestion.fieldKey}`} className="rounded-xl border bg-slate-50 p-3 text-xs">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-black text-slate-900">{suggestion.fieldLabel}</p>
                                  <span className={`rounded-full px-2 py-1 font-black ${profileSuggestionStatusClass(suggestion.status)}`}>
                                    {profileSuggestionStatusLabel(suggestion.status)}
                                  </span>
                                </div>
                                <p className="mt-1 font-semibold text-slate-500">{suggestion.section}</p>
                                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                                  <div>
                                    <dt className="font-bold text-slate-400">No documento</dt>
                                    <dd className="mt-0.5 break-words font-bold text-slate-700">{suggestion.extractedValue || "Não identificado"}</dd>
                                  </div>
                                  <div>
                                    <dt className="font-bold text-slate-400">No cadastro</dt>
                                    <dd className="mt-0.5 break-words font-bold text-slate-700">{suggestion.currentValue || "Vazio"}</dd>
                                  </div>
                                </dl>
                                <p className="mt-3 font-bold text-slate-400">Confiança da extração: {(suggestion.confidence * 100).toFixed(0)}%</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {versionsOpen && olderVersions.length > 0 ? (
                        <div className="mt-4 flex flex-col gap-2 border-t border-dashed pt-3">
                          {olderVersions.map((old) => (
                            <div key={old.id} className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 px-3 py-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="rounded-md border bg-white px-2 py-0.5 font-mono text-[11px] font-bold text-slate-600">
                                  v{typeof old.version === "number" ? old.version : 1}
                                </span>
                                <span className="truncate text-xs font-semibold text-slate-500">
                                  enviado por {uploaderName(old)}
                                  {old.uploadedAt ? ` · ${new Date(old.uploadedAt).toLocaleDateString("pt-BR")}` : ""}
                                </span>
                              </div>
                              <div className="flex shrink-0 gap-1.5">
                                <button type="button" onClick={() => void previewDocument(old)} className="grid h-8 w-8 place-items-center rounded-lg border" title="Pré-visualizar"><Eye className="h-3.5 w-3.5" /></button>
                                <button type="button" onClick={() => void downloadDocument(old)} className="grid h-8 w-8 place-items-center rounded-lg border" title="Baixar"><Download className="h-3.5 w-3.5" /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>

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

      {preview ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-4">
          <section className="flex h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-base font-black text-slate-900">{preview.title}</p>
                <p className="text-xs font-bold text-slate-500">Pré-visualização somente leitura · acesso autenticado</p>
              </div>
              <button type="button" onClick={() => setPreview(null)} className="grid h-9 w-9 place-items-center rounded-xl border text-slate-500 hover:bg-slate-50">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 bg-slate-100">
              {preview.mimeType?.startsWith("image/") ? (
                <div className="flex h-full items-center justify-center overflow-auto p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview.url} alt={preview.title} className="max-h-full max-w-full rounded-xl bg-white object-contain shadow" />
                </div>
              ) : (
                <iframe title={preview.title} src={preview.url} className="h-full w-full bg-white" />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
