"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Download, Eye, FileStack, Loader2, Lock, RefreshCw, Search, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DocumentGeneratorWorkspace } from "@/components/documents/document-generator-workspace";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import {
  DOCUMENT_STATUS_LABELS,
  type GeneratedDocumentStatus,
} from "@/features/hr/documents/document-lifecycle";

type GeneratedDocument = {
  id: string;
  templateId: string;
  templateName?: string;
  employeeId?: string | null;
  employeeName?: string | null;
  onboardingId?: string | null;
  status: string;
  pdfAvailable?: boolean;
  generatedAt?: string;
  generatedByName?: string;
  signatureScope?: string;
  postAdmissionSignatureScope?: string | null;
  signatureStatus?: string | null;
  signatureRequestId?: string | null;
  protocol?: string | null;
  preSignatureHash?: string | null;
  parties?: Array<{
    partyType?: string;
    role?: string;
    ref?: string | null;
    snapshot?: {
      name?: string;
      documentMasked?: string;
      signatureEmail?: string | null;
      signatureName?: string | null;
    };
  }>;
};

type AuditPayload = {
  document: {
    protocol?: string | null;
    resolvedValuesHash?: string | null;
    retentionUntil?: string | null;
    legalHold?: boolean;
  };
  audit: {
    catalogVersion?: string;
    resolvedAt?: string;
    values?: Record<string, {
      renderedValue?: unknown;
      rawValue?: unknown;
      sourceType?: string;
      sourceReference?: string;
      formatter?: string;
      formatterVersion?: string;
      sensitive?: boolean;
    }>;
  };
};

type SignatureTrailPayload = {
  signature: {
    requestId?: string;
    provider?: string;
    providerDocumentId?: string;
    status?: string | null;
    protocol?: string | null;
    emailStatus?: string | null;
  } | null;
  timeline: Array<{
    id: string;
    label: string;
    occurredAt?: string | null;
    description?: string;
    source?: string;
  }>;
};

type DocumentQueueFilter =
  | "all"
  | "review_pending"
  | "approved"
  | "final"
  | "signature_pending"
  | "partially_signed"
  | "signed"
  | "rejected"
  | "expired"
  | "cancelled"
  | "failed"
  | "superseded";

const DOCUMENT_QUEUE_FILTERS: Array<{
  value: DocumentQueueFilter;
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "review_pending", label: "Em conferência" },
  { value: "approved", label: "Aprovados" },
  { value: "final", label: "Finalizados sem assinatura" },
  { value: "signature_pending", label: "Aguardando assinatura" },
  { value: "partially_signed", label: "Parcialmente assinados" },
  { value: "signed", label: "Assinados" },
  { value: "rejected", label: "Recusados" },
  { value: "expired", label: "Expirados" },
  { value: "cancelled", label: "Cancelados" },
  { value: "failed", label: "Falhas de assinatura" },
  { value: "superseded", label: "Substituídos" },
];

const SIGNATURE_STATUS_LABELS: Record<string, string> = {
  sending: "Preparando envio",
  sent: "Enviado · aguardando",
  viewed: "Visualizado",
  partially_signed: "Parcialmente assinado",
  signed: "Assinado · concluído",
  archived: "Concluído e arquivado",
  rejected: "Recusado",
  expired: "Expirado",
  cancelled: "Cancelado",
  failed: "Falha no envio",
};

const AUDIT_FIELD_LABELS: Record<string, string> = {
  "receipt.city": "Cidade de emissão",
  "receipt.state": "Estado de emissão",
  "receipt.direction": "Direção do recibo",
  "receipt.issueDate": "Data de emissão",
  "receipt.issuer.snapshot.document": "CPF/CNPJ do emitente",
  "receipt.issuer.snapshot.name": "Emitente",
  "receipt.items": "Itens do recibo",
  "receipt.number": "Número do recibo",
  "receipt.payment.account": "Conta",
  "receipt.payment.agency": "Agência",
  "receipt.payment.bank": "Banco",
  "receipt.payment.method": "Forma de pagamento",
  "receipt.payment.methodLabel": "Forma de pagamento exibida",
  "receipt.payment.pixKey": "Chave Pix",
  "receipt.recipient.snapshot.document": "CPF/CNPJ do recebedor",
  "receipt.recipient.snapshot.name": "Recebedor",
  "receipt.total": "Total",
  "receipt.totalWithWords": "Total por extenso",
};

const AUDIT_SOURCE_LABELS: Record<string, string> = {
  schema_form: "Informado na geração",
  mapped_system: "Cadastro do sistema",
  manual: "Preenchimento manual",
  template: "Modelo",
  integration: "Integração",
  employee: "Cadastro do colaborador",
};

function auditValueText(key: string, value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return `${index + 1}. ${String(item)}`;
      }
      const row = item as Record<string, unknown>;
      return `${index + 1}. ${String(row.name ?? "Item")}`
        + `${row.description ? ` — ${String(row.description)}` : ""}`
        + `${row.value ? ` — ${String(row.value)}` : ""}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null && item !== undefined && item !== "")
      .map(([label, item]) => `${label}: ${String(item)}`)
      .join(" · ") || "—";
  }
  if (key.endsWith("issueDate") && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function visibleAuditEntries(audit: AuditPayload | null) {
  return Object.entries(audit?.audit.values ?? {}).filter(([key, value]) => {
    if (["name", "description", "value"].includes(key)) return false;
    return !(
      value.sourceType === "template"
      && value.renderedValue == null
      && value.rawValue == null
    );
  });
}

function documentPartiesLabel(document: GeneratedDocument) {
  const names = (document.parties ?? [])
    .map((party) => party.snapshot?.name?.trim())
    .filter((name): name is string => Boolean(name));
  return names.join(" ↔ ")
    || document.employeeName
    || document.employeeId
    || document.onboardingId
    || "Documento avulso";
}

function signatureContacts(document: GeneratedDocument) {
  return (document.parties ?? []).map((party) => ({
    role: party.role === "issuer" ? "Emitente" : party.role === "recipient" ? "Recebedor" : "Signatário",
    name: party.snapshot?.signatureName?.trim()
      || party.snapshot?.name?.trim()
      || "Parte sem nome",
    email: party.snapshot?.signatureEmail?.trim().toLocaleLowerCase("pt-BR") || null,
  }));
}

function signatureStatusTone(status: string) {
  if (["signed", "archived"].includes(status)) {
    return {
      dot: "bg-emerald-700",
      pill: "border-emerald-100 bg-emerald-50 text-emerald-700",
    };
  }
  if (["rejected", "delivery_failed", "failed"].includes(status)) {
    return {
      dot: "bg-rose-600",
      pill: "border-rose-100 bg-rose-50 text-rose-700",
    };
  }
  if (["expired", "cancelled"].includes(status)) {
    return {
      dot: "bg-slate-500",
      pill: "border-slate-200 bg-slate-50 text-slate-700",
    };
  }
  return {
    dot: "bg-violet-700",
    pill: "border-violet-200 bg-white text-violet-700",
  };
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

export default function GeneratedDocumentsPage() {
  const { firebaseUser, permissions } = useAuth();
  const canView = hasFormalizationPermission(permissions, "documents.view");
  const canReview = hasFormalizationPermission(permissions, "documents.review");
  const canViewAudit = hasFormalizationPermission(permissions, "sensitiveData.view");
  const canSendSignature = hasFormalizationPermission(permissions, "signatures.send");
  const canViewSignature = hasFormalizationPermission(permissions, "signatures.view");
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DocumentQueueFilter>("all");
  const [busyDocument, setBusyDocument] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditPayload | null>(null);
  const [signatureTrail, setSignatureTrail] = useState<SignatureTrailPayload | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detailTab, setDetailTab] = useState<"document" | "audit" | "signature">("document");
  const [viewMode, setViewMode] = useState<"queue" | "generator">("queue");

  const token = useCallback(async () => {
    if (!firebaseUser) throw new Error("Sessão expirada.");
    return firebaseUser.getIdToken();
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser || !canView) return;
    setLoading(true);
    try {
      const response = await fetch("/api/documents/generated", { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar documentos gerados.");
      const loaded = payload.documents ?? [];
      setDocuments(loaded);
      setSelectedId((current) =>
        current && loaded.some((item: GeneratedDocument) => item.id === current)
          ? current
          : loaded[0]?.id ?? ""
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao carregar documentos gerados.");
    } finally {
      setLoading(false);
    }
  }, [canView, firebaseUser, token]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return documents.filter((item) => {
      const normalizedStatus = item.status === "draft" ? "review_pending" : item.status;
      const signatureStatus = String(item.signatureStatus ?? "");
      const matchesStatus =
        statusFilter === "all"
        || (statusFilter === "review_pending" && normalizedStatus === "review_pending")
        || (statusFilter === "approved" && normalizedStatus === "approved")
        || (statusFilter === "final" && normalizedStatus === "final" && !signatureStatus)
        || (
          statusFilter === "signature_pending"
          && ["pending", "sending", "sent", "viewed"].includes(signatureStatus)
        )
        || (statusFilter === "partially_signed" && signatureStatus === "partially_signed")
        || (
          statusFilter === "signed"
          && ["signed", "archived"].includes(signatureStatus)
        )
        || (statusFilter === "rejected" && signatureStatus === "rejected")
        || (statusFilter === "expired" && signatureStatus === "expired")
        || (
          statusFilter === "cancelled"
          && (normalizedStatus === "cancelled" || signatureStatus === "cancelled")
        )
        || (
          statusFilter === "failed"
          && ["delivery_failed", "failed"].includes(signatureStatus)
        )
        || (statusFilter === "superseded" && normalizedStatus === "superseded");
      if (!matchesStatus) return false;
      if (!term) return true;
      return `${item.templateName ?? ""} ${item.employeeName ?? ""} ${item.protocol ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(term);
    });
  }, [documents, search, statusFilter]);
  useEffect(() => {
    if (!filtered.length) return;
    if (!filtered.some((item) => item.id === selectedId)) {
      setSelectedId(filtered[0].id);
      setDetailTab("document");
      setAudit(null);
      setSignatureTrail(null);
    }
  }, [filtered, selectedId]);
  const selectedDocument = useMemo(
    () => documents.find((item) => item.id === selectedId) ?? null,
    [documents, selectedId],
  );
  const selectedSignatureContacts = useMemo(
    () => selectedDocument ? signatureContacts(selectedDocument) : [],
    [selectedDocument],
  );
  const selectedHasSignatureRecipients = Boolean(
    selectedDocument?.employeeId
    || (
      selectedSignatureContacts.length
      && selectedSignatureContacts.every((contact) => Boolean(contact.email))
    )
  );

  async function openFile(id: string, format: "pdf" | "docx") {
    setBusyDocument(id);
    const previewWindow = format === "pdf" ? window.open("about:blank", "_blank") : null;
    if (previewWindow) previewWindow.opener = null;
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(id)}/file${format === "pdf" ? "?format=pdf" : ""}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Falha ao abrir o arquivo.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (format === "pdf") {
        if (previewWindow) previewWindow.location.href = url;
        else {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.target = "_blank";
          anchor.click();
        }
      }
      else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "documento.docx";
        anchor.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      previewWindow?.close();
      setMessage(cause instanceof Error ? cause.message : "Falha ao abrir o arquivo.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function retryPdf(id: string) {
    setBusyDocument(id);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao gerar a prévia em PDF.");
      setDocuments((current) => current.map((item) => (
        item.id === id ? { ...item, ...payload.document, pdfAvailable: true } : item
      )));
      await openFile(id, "pdf");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao gerar a prévia em PDF.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function changeStatus(id: string, status: "approved" | "final") {
    setBusyDocument(id);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao finalizar.");
      setDocuments((current) => current.map((item) => (item.id === id ? { ...item, ...payload.document } : item)));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao atualizar documento.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function openAudit(id: string) {
    setBusyDocument(id);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(id)}/audit`, {
        headers: { Authorization: `Bearer ${await token()}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar auditoria.");
      setAudit(payload);
      setDetailTab("audit");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao carregar auditoria.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function discard(id: string) {
    if (!window.confirm("Descartar esta prévia? O arquivo será excluído.")) return;
    setBusyDocument(id);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao descartar.");
      setDocuments((current) => current.filter((item) => item.id !== id));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao descartar.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function sendForSignature(id: string) {
    if (!window.confirm("Enviar este documento individualmente para assinatura eletrônica?")) return;
    setBusyDocument(id);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(id)}/signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao enviar para assinatura.");
      setDocuments((current) => current.map((item) => item.id === id
        ? { ...item, signatureStatus: String(payload.status ?? "sent"), status: "final" }
        : item));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao enviar para assinatura.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function reconcileSignature(id: string) {
    setBusyDocument(id);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(id)}/signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ action: "reconcile" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao atualizar assinatura.");
      setDocuments((current) => current.map((item) => item.id === id
        ? { ...item, signatureStatus: String(payload.status ?? item.signatureStatus) }
        : item));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao atualizar assinatura.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function openSignatureTrail(id: string) {
    setBusyDocument(id);
    setMessage("");
    try {
      const response = await fetch(
        `/api/documents/generated/${encodeURIComponent(id)}/signature`,
        {
          headers: { Authorization: `Bearer ${await token()}` },
          cache: "no-store",
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar a trilha.");
      setSignatureTrail(payload);
      setDetailTab("signature");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao carregar a trilha.");
    } finally {
      setBusyDocument(null);
    }
  }

  if (!canView) return <p className="p-6 text-sm text-slate-500">Sem permissão para acessar documentos gerados.</p>;

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-teal-700">
            Gestão documental
          </p>
          <h1 className="text-xl font-black text-slate-950">Central de documentos</h1>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2 w-2 rounded-full bg-amber-600" />
            {documents.filter((item) => ["draft", "review_pending"].includes(item.status)).length} em conferência
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2 w-2 rounded-full bg-violet-700" />
            {documents.filter((item) => ["sent", "partially_signed"].includes(String(item.signatureStatus))).length} para assinar
          </span>
          {viewMode === "queue" && hasFormalizationPermission(permissions, "documents.generate") ? (
            <Button
              className="gap-2 bg-rose-500 font-bold hover:bg-rose-600"
              onClick={() => setViewMode("generator")}
            >
                <FileStack className="h-4 w-4" />
                Gerar documento
            </Button>
          ) : viewMode === "generator" ? (
            <Button variant="outline" className="font-bold" onClick={() => setViewMode("queue")}>
              Voltar à fila
            </Button>
          ) : null}
        </div>
      </header>

      {message ? (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">
          {message}
        </div>
      ) : null}

      {viewMode === "generator" ? (
        <DocumentGeneratorWorkspace
          embedded
          onBack={() => setViewMode("queue")}
          onGenerated={() => {
            void load();
          }}
        />
      ) : (
      <div className="grid min-h-[680px] lg:grid-cols-[minmax(360px,1fr)_minmax(390px,0.78fr)]">
        <section className="min-w-0 border-r">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <h2 className="mr-auto text-sm font-black text-slate-900">Fila de documentos</h2>
            <select
              className="h-8 rounded-md border bg-white px-2 text-xs"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as DocumentQueueFilter)}
            >
              {DOCUMENT_QUEUE_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
          </div>
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="h-9 pl-9 text-xs"
                placeholder="Buscar documento, protocolo ou parte..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div className="max-h-[610px] overflow-y-auto">
            {loading ? (
              <div className="grid min-h-40 place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-teal-700" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="grid min-h-52 place-items-center p-8 text-center">
                <div>
                  <FileStack className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-black text-slate-700">Nenhum documento encontrado</p>
                </div>
              </div>
            ) : filtered.map((item) => {
              const isReview = item.status === "draft" || item.status === "review_pending";
              const isApproved = item.status === "approved";
              const status = (item.status === "draft" ? "review_pending" : item.status) as GeneratedDocumentStatus;
              const active = selectedId === item.id;
              const signatureTone = signatureStatusTone(String(item.signatureStatus ?? ""));
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left transition ${
                    active ? "bg-teal-50 shadow-[inset_3px_0_0_#0f766e]" : "hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    setSelectedId(item.id);
                    setDetailTab("document");
                    setAudit(null);
                    setSignatureTrail(null);
                  }}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${
                    isReview ? "bg-amber-600" : isApproved ? "bg-sky-700" : item.signatureStatus ? signatureTone.dot : "bg-emerald-700"
                  }`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-extrabold text-slate-900">
                      {item.templateName ?? "Modelo"} · {documentPartiesLabel(item)}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {formatDateTime(item.generatedAt)} · {item.generatedByName ?? "—"}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-extrabold uppercase ${
                    isReview
                      ? "border-amber-100 bg-amber-50 text-amber-700"
                      : isApproved
                        ? "border-sky-100 bg-sky-50 text-sky-700"
                        : item.signatureStatus
                          ? signatureTone.pill
                          : "border-emerald-100 bg-emerald-50 text-emerald-700"
                  }`}>
                    {item.signatureStatus
                      ? SIGNATURE_STATUS_LABELS[String(item.signatureStatus)]
                        ?? String(item.signatureStatus)
                      : DOCUMENT_STATUS_LABELS[status] ?? item.status}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="min-w-0 bg-[#fbfaf8]">
          {!selectedDocument ? (
            <div className="grid h-full min-h-96 place-items-center p-8 text-center text-xs text-slate-500">
              Selecione um documento na fila.
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b bg-white px-4 py-3">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-violet-700">
                  Detalhe do documento
                </p>
                <h2 className="mt-0.5 truncate text-sm font-black text-slate-950">
                  {selectedDocument.templateName ?? "Documento"} · {documentPartiesLabel(selectedDocument)}
                </h2>
                <nav className="mt-3 flex gap-5 text-xs">
                  <button
                    className={`pb-1 font-bold ${detailTab === "document" ? "border-b-2 border-violet-700 text-violet-700" : "text-slate-500"}`}
                    onClick={() => setDetailTab("document")}
                  >
                    Documento
                  </button>
                  {canViewAudit ? (
                    <button
                      className={`pb-1 font-bold ${detailTab === "audit" ? "border-b-2 border-violet-700 text-violet-700" : "text-slate-500"}`}
                      onClick={() => void openAudit(selectedDocument.id)}
                    >
                      Auditoria
                    </button>
                  ) : null}
                  {canViewSignature ? (
                    <button
                      className={`pb-1 font-bold ${detailTab === "signature" ? "border-b-2 border-violet-700 text-violet-700" : "text-slate-500"}`}
                      onClick={() => void openSignatureTrail(selectedDocument.id)}
                    >
                      Assinatura
                    </button>
                  ) : null}
                </nav>
              </div>

              <div className="max-h-[600px] flex-1 overflow-y-auto p-4">
                {detailTab === "document" ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 rounded-lg border bg-white p-3 text-xs sm:grid-cols-2">
                      <p><span className="block text-[10px] font-bold text-slate-400">Modelo</span><span className="font-extrabold">{selectedDocument.templateName ?? "—"}</span></p>
                      <p><span className="block text-[10px] font-bold text-slate-400">Colaborador / partes</span><span className="font-extrabold">{documentPartiesLabel(selectedDocument)}</span></p>
                      <p><span className="block text-[10px] font-bold text-slate-400">Gerado em</span><span className="font-semibold">{formatDateTime(selectedDocument.generatedAt)}</span></p>
                      <p><span className="block text-[10px] font-bold text-slate-400">Por</span><span className="font-semibold">{selectedDocument.generatedByName ?? "—"}</span></p>
                      <p><span className="block text-[10px] font-bold text-slate-400">Protocolo</span><span className="font-mono font-extrabold">{selectedDocument.protocol ?? "—"}</span></p>
                      <p><span className="block text-[10px] font-bold text-slate-400">Estado</span><span className="font-extrabold">{selectedDocument.signatureStatus ?? DOCUMENT_STATUS_LABELS[(selectedDocument.status === "draft" ? "review_pending" : selectedDocument.status) as GeneratedDocumentStatus] ?? selectedDocument.status}</span></p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedDocument.pdfAvailable ? (
                        <Button variant="outline" disabled={busyDocument === selectedDocument.id} onClick={() => void openFile(selectedDocument.id, "pdf")}>
                          <Eye className="mr-2 h-4 w-4" />Ver PDF
                        </Button>
                      ) : null}
                      <Button variant="outline" disabled={busyDocument === selectedDocument.id} onClick={() => void openFile(selectedDocument.id, "docx")}>
                        <Download className="mr-2 h-4 w-4" />DOCX
                      </Button>
                    </div>
                    {!selectedDocument.pdfAvailable ? (
                      <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        <p>O DOCX foi criado, mas a prévia em PDF não está disponível. A aprovação permanece bloqueada até a conversão ser concluída.</p>
                        {canReview ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 border-amber-300 bg-white text-amber-900"
                            disabled={busyDocument === selectedDocument.id}
                            onClick={() => void retryPdf(selectedDocument.id)}
                          >
                            {busyDocument === selectedDocument.id
                              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                            Gerar PDF agora
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="pt-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Ações</p>
                    <div className="flex flex-wrap gap-2">
                      {["draft", "review_pending"].includes(selectedDocument.status) && canReview ? (
                        <>
                          <Button size="sm" variant="outline" className="text-sky-700" disabled={!selectedDocument.pdfAvailable || busyDocument === selectedDocument.id} onClick={() => void changeStatus(selectedDocument.id, "approved")}><CheckCircle2 className="mr-1.5 h-4 w-4" />Aprovar</Button>
                          <Button size="sm" variant="outline" className="text-rose-600" disabled={busyDocument === selectedDocument.id} onClick={() => void discard(selectedDocument.id)}><Trash2 className="mr-1.5 h-4 w-4" />Descartar</Button>
                        </>
                      ) : null}
                      {selectedDocument.status === "approved" && canReview ? (
                        <Button size="sm" variant="outline" className="text-emerald-700" disabled={busyDocument === selectedDocument.id} onClick={() => void changeStatus(selectedDocument.id, "final")}><Lock className="mr-1.5 h-4 w-4" />Finalizar</Button>
                      ) : null}
                      {canSendSignature
                        && (selectedDocument.signatureScope === "independent" || selectedDocument.postAdmissionSignatureScope === "independent")
                        && ["approved", "final"].includes(selectedDocument.status)
                        && !["sent", "signed"].includes(String(selectedDocument.signatureStatus)) ? (
                          <Button size="sm" className="bg-violet-700 hover:bg-violet-800" disabled={!selectedHasSignatureRecipients || busyDocument === selectedDocument.id} onClick={() => void sendForSignature(selectedDocument.id)}><Send className="mr-1.5 h-4 w-4" />Enviar para assinatura</Button>
                        ) : null}
                      {canViewSignature && ["sent", "partially_signed"].includes(String(selectedDocument.signatureStatus)) ? (
                        <Button size="sm" variant="outline" className="text-violet-700" disabled={busyDocument === selectedDocument.id} onClick={() => void reconcileSignature(selectedDocument.id)}><Clock3 className="mr-1.5 h-4 w-4" />Atualizar estado</Button>
                      ) : null}
                    </div>
                  </div>
                ) : detailTab === "audit" ? (
                  <div className="space-y-3">
                    {busyDocument === selectedDocument.id && !audit ? (
                      <div className="grid min-h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-violet-700" /></div>
                    ) : (
                      <>
                        <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-[11px] text-violet-900">
                          Esta auditoria registra exatamente quais valores foram usados na geração, de onde vieram e o hash do conjunto resolvido. Ela permite explicar e conferir o conteúdo emitido sem depender apenas da leitura do PDF.
                        </div>
                        <div className="grid gap-2 rounded-lg border bg-white p-3 text-xs sm:grid-cols-2">
                          <p><span className="font-bold text-slate-400">Protocolo:</span> {audit?.document.protocol ?? "—"}</p>
                          <p><span className="font-bold text-slate-400">Catálogo:</span> {audit?.audit.catalogVersion ?? "—"}</p>
                          <p className="break-all sm:col-span-2"><span className="font-bold text-slate-400">Hash:</span> {audit?.document.resolvedValuesHash ?? "—"}</p>
                        </div>
                        <div className="overflow-hidden rounded-lg border bg-white">
                          <div className="grid grid-cols-[1.1fr_1.4fr_0.9fr] bg-slate-50 px-3 py-2 text-[9px] font-extrabold uppercase text-slate-400">
                            <span>Campo</span><span>Valor utilizado</span><span>Origem</span>
                          </div>
                          {visibleAuditEntries(audit).map(([key, value]) => (
                            <div key={key} className="grid grid-cols-[1.1fr_1.4fr_0.9fr] gap-2 border-t px-3 py-2 text-[11px]">
                              <span>
                                <span className="block font-semibold text-slate-800">{AUDIT_FIELD_LABELS[key] ?? key}</span>
                                <span className="mt-0.5 block break-all font-mono text-[9px] text-slate-400">{key}</span>
                              </span>
                              <span className="whitespace-pre-line break-words">
                                {value.sensitive && value.renderedValue == null
                                  ? "Dado sensível protegido"
                                  : auditValueText(key, value.renderedValue)}
                              </span>
                              <span className="text-slate-500">{AUDIT_SOURCE_LABELS[value.sourceType ?? ""] ?? value.sourceType ?? "—"}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div>
                    {busyDocument === selectedDocument.id && !signatureTrail ? (
                      <div className="grid min-h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-violet-700" /></div>
                    ) : (
                      <>
                        <div className="mb-4 grid gap-2 rounded-lg border bg-white p-3 text-xs sm:grid-cols-2">
                          <p><span className="block text-[10px] font-bold text-slate-400">Provedor</span><span className="font-extrabold">{signatureTrail?.signature?.provider ?? "Autentique"}</span></p>
                      <p><span className="block text-[10px] font-bold text-slate-400">Estado</span><span className="font-extrabold text-violet-700">{SIGNATURE_STATUS_LABELS[String(signatureTrail?.signature?.status ?? "")] ?? "Ainda não enviado"}</span></p>
                          <p><span className="block text-[10px] font-bold text-slate-400">Protocolo</span><span className="font-mono font-extrabold">{signatureTrail?.signature?.protocol ?? selectedDocument.protocol ?? "—"}</span></p>
                          <p><span className="block text-[10px] font-bold text-slate-400">ID externo</span><span className="break-all font-mono text-[10px] font-bold">{signatureTrail?.signature?.providerDocumentId ?? "—"}</span></p>
                          <p className="sm:col-span-2"><span className="block text-[10px] font-bold text-slate-400">Hash pré-assinatura</span><span className="break-all font-mono text-[10px] text-slate-500">{selectedDocument.preSignatureHash ?? "—"}</span></p>
                        </div>
                        {signatureContacts(selectedDocument).length ? (
                          <div className="mb-4 overflow-hidden rounded-lg border bg-white">
                            <div className="bg-slate-50 px-3 py-2 text-[9px] font-extrabold uppercase text-slate-400">Signatários</div>
                            {signatureContacts(selectedDocument).map((signer, index) => (
                              <div key={`${signer.role}-${index}`} className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs">
                                <div>
                                  <p className="font-bold text-slate-800">{signer.name}</p>
                                  <p className="text-[10px] text-slate-400">{signer.role}</p>
                                </div>
                                <span className={signer.email ? "text-slate-600" : "font-bold text-rose-600"}>
                                  {signer.email ?? "E-mail ausente"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {!selectedHasSignatureRecipients && !selectedDocument.employeeId ? (
                          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                            Informe um e-mail válido para cada signatário durante a geração do documento. Sem um canal de entrega, o envio à Autentique fica bloqueado.
                          </div>
                        ) : null}
                        {signatureTrail?.signature && (signatureTrail.timeline ?? []).length ? (
                          <ol>
                            {(signatureTrail?.timeline ?? []).map((event, index, events) => (
                              <li key={event.id} className="relative flex gap-3 pb-5">
                                {index < events.length - 1 ? <span className="absolute left-[7px] top-4 h-full w-0.5 bg-emerald-600" /> : null}
                                <span className="relative mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-emerald-100 bg-emerald-700" />
                                <div>
                                  <p className="text-xs font-extrabold text-slate-900">{event.label}</p>
                                  <p className="text-[10px] text-slate-400">{formatDateTime(event.occurredAt ?? undefined)}{event.source ? ` · ${event.source}` : ""}</p>
                                  {event.description ? <p className="mt-0.5 text-[11px] text-slate-500">{event.description}</p> : null}
                                </div>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <div className="rounded-xl border border-dashed bg-white px-5 py-8 text-center">
                            <Send className="mx-auto h-8 w-8 text-violet-300" />
                            <p className="mt-3 text-xs font-extrabold text-slate-800">Ainda não enviado para assinatura</p>
                            <p className="mt-1 text-[11px] text-slate-500">A trilha aparecerá aqui após o envio e o primeiro evento.</p>
                            {canSendSignature
                              && (selectedDocument.signatureScope === "independent"
                                || selectedDocument.postAdmissionSignatureScope === "independent")
                              && ["approved", "final"].includes(selectedDocument.status) ? (
                                <Button
                                  size="sm"
                                  className="mt-4 bg-violet-700 hover:bg-violet-800"
                                  disabled={!selectedHasSignatureRecipients || busyDocument === selectedDocument.id}
                                  onClick={() => void sendForSignature(selectedDocument.id)}
                                >
                                  Enviar para assinatura
                                </Button>
                              ) : null}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
      )}
    </div>
  );
}
