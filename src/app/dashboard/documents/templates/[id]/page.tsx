"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Download,
  Eye,
  FilePlus2,
  FileStack,
  Loader2,
  Lock,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TemplateVariableWizard } from "@/components/hr/documents/template-variable-wizard";
import { useAuth } from "@/hooks/use-auth";
import { DOCUMENT_VARIABLES, isDocumentVariableKey } from "@/features/hr/integration/document-variables";
import {
  DOCUMENT_OUTPUT_FORMATTERS,
  type DocumentOutputFormatter,
} from "@/features/hr/documents/document-output-formatters";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import {
  LEGACY_LOOP_KEYS,
  MANUAL_FIELD_FORMATS,
  MANUAL_FIELD_FORMAT_LABELS,
  type ManualFieldBinding,
  type ManualFieldFormat,
  type TemplateFieldBinding,
  type TemplateFieldMapping,
} from "@/features/hr/documents/field-mapping";

type TemplateDetail = {
  id: string;
  name: string;
  category: string;
  status: string;
  version: number;
  variables?: string[];
  storagePath?: string;
  fieldMapping?: TemplateFieldMapping;
  templateValidation?: {
    valid: boolean;
    profileId: string;
    issues: Array<{ code: string; message: string }>;
  };
};

type AiMappingPlan = {
  sourceHash: string;
  reviewed: boolean;
  formSchemaProposal?: Record<string, unknown> | null;
  mappings: Array<{
    exactText: string;
    expectedOccurrences: number;
    variableKey: string;
    confidence: number;
    rationale: string;
  }>;
};

type GeneratedDocument = {
  id: string;
  templateId: string;
  templateName?: string;
  employeeId?: string | null;
  employeeName?: string | null;
  onboardingId?: string | null;
  status: string;
  manualValues?: Record<string, string | number | boolean>;
  originalName?: string;
  pdfAvailable?: boolean;
  generatedAt?: string;
  generatedByName?: string;
};

const FORMAT_SAMPLES: Record<ManualFieldFormat, string> = {
  text: "Ex.: São Luís",
  multiline: "Texto com múltiplas linhas",
  date_br: "Sai como 20/07/2026",
  currency_br: "Sai como R$ 220,00",
  number_br: "Sai como 1.412",
  boolean_br: "Sai como Sim/Não",
  select: "Quem gera escolhe uma opção",
};

const SECTION_GROUPS = (() => {
  const groups = new Map<string, { key: string; label: string; sensitive: boolean }[]>();
  DOCUMENT_VARIABLES.filter((entry) => entry.format !== "repeatable").forEach((entry) => {
    const list = groups.get(entry.section) ?? [];
    list.push({ key: entry.key, label: entry.label, sensitive: entry.sensitive });
    groups.set(entry.section, list);
  });
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
})();

const CATALOG_LABELS = new Map(DOCUMENT_VARIABLES.map((entry) => [entry.key, entry.label]));

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

function SystemKeySelect({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <select
      className="h-9 w-full rounded-md border bg-white px-2 text-xs"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Selecione o campo do sistema...</option>
      {SECTION_GROUPS.map(([section, entries]) => (
        <optgroup key={section} label={section}>
          {entries.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}{entry.sensitive ? " (sensível)" : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const OUTPUT_FORMATTER_LABELS: Record<DocumentOutputFormatter, string> = {
  source: "Formato padrão do campo",
  date_br: "Data — 28/07/2026",
  date_long_br: "Data por extenso",
  currency_br: "Moeda — R$ 1.518,00",
  currency_br_with_words: "Moeda e valor por extenso",
  cpf_full: "CPF completo",
  cpf_masked: "CPF parcialmente oculto",
  cnpj: "CNPJ formatado",
  uppercase: "Texto em maiúsculas",
};

function ManualFieldEditor({ binding, onChange }: { binding: ManualFieldBinding; onChange: (next: ManualFieldBinding) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block space-y-1">
        <span className="text-[10px] font-bold uppercase text-slate-500">Label para quem gera</span>
        <Input className="h-9 text-xs" value={binding.label} placeholder="Ex.: Valor do recibo" onChange={(event) => onChange({ ...binding, label: event.target.value })} />
      </label>
      <label className="block space-y-1">
        <span className="text-[10px] font-bold uppercase text-slate-500">Tipo</span>
        <select className="h-9 w-full rounded-md border bg-white px-2 text-xs" value={binding.format} onChange={(event) => onChange({ ...binding, format: event.target.value as ManualFieldFormat })}>
          {MANUAL_FIELD_FORMATS.map((format) => (
            <option key={format} value={format}>{MANUAL_FIELD_FORMAT_LABELS[format]}</option>
          ))}
        </select>
        <span className="block text-[10px] text-slate-400">{FORMAT_SAMPLES[binding.format]}</span>
      </label>
      {binding.format === "select" ? (
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-[10px] font-bold uppercase text-slate-500">Opções (separadas por vírgula)</span>
          <Input className="h-9 text-xs" value={binding.options?.join(", ") ?? ""} placeholder="Ex.: Integral, Meio período" onChange={(event) => onChange({ ...binding, options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
        </label>
      ) : null}
      <label className="block space-y-1">
        <span className="text-[10px] font-bold uppercase text-slate-500">Valor padrão (opcional)</span>
        <Input className="h-9 text-xs" value={binding.defaultValue ?? ""} onChange={(event) => onChange({ ...binding, defaultValue: event.target.value || undefined })} />
      </label>
      <label className="flex items-end gap-2 pb-1 text-xs font-semibold text-slate-700">
        <input type="checkbox" checked={binding.required} onChange={(event) => onChange({ ...binding, required: event.target.checked })} />
        Obrigatório na geração
      </label>
    </div>
  );
}

function ManualValueInput({ binding, value, onChange }: { binding: ManualFieldBinding; value: string; onChange: (next: string) => void }) {
  if (binding.format === "multiline") {
    return <textarea className="min-h-20 w-full rounded-md border bg-white p-2 text-xs" value={value} onChange={(event) => onChange(event.target.value)} />;
  }
  if (binding.format === "boolean_br") {
    return (
      <select className="h-9 w-full rounded-md border bg-white px-2 text-xs" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">—</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    );
  }
  if (binding.format === "select") {
    return (
      <select className="h-9 w-full rounded-md border bg-white px-2 text-xs" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">—</option>
        {(binding.options ?? []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }
  return (
    <Input
      className="h-9 text-xs"
      type={binding.format === "date_br" ? "date" : "text"}
      inputMode={binding.format === "currency_br" || binding.format === "number_br" ? "decimal" : undefined}
      placeholder={binding.format === "currency_br" ? "Ex.: 220,00" : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export default function DocumentTemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { firebaseUser, permissions, activeUsers } = useAuth();
  const canView = hasFormalizationPermission(permissions, "templates.view");
  const canManage = hasFormalizationPermission(permissions, "templates.manage");
  const canPublish = hasFormalizationPermission(permissions, "templates.publish");
  const canGenerate = hasFormalizationPermission(permissions, "documents.generate");
  const canReview = hasFormalizationPermission(permissions, "documents.review");
  const canViewGenerated = hasFormalizationPermission(permissions, "documents.view");

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [mapping, setMapping] = useState<TemplateFieldMapping>({});
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [variableWizardOpen, setVariableWizardOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [aiPlan, setAiPlan] = useState<AiMappingPlan | null>(null);
  const [aiBlocked, setAiBlocked] = useState(false);
  const [aiFindings, setAiFindings] = useState<Array<{ type: string; maskedEvidence: string }>>([]);
  const [selectedAiMappings, setSelectedAiMappings] = useState<Set<number>>(new Set());
  const [aiBusy, setAiBusy] = useState(false);
  const [acceptAiSchema, setAcceptAiSchema] = useState(false);

  const [generated, setGenerated] = useState<GeneratedDocument[]>([]);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [manualForm, setManualForm] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [busyDocument, setBusyDocument] = useState<string | null>(null);

  const token = useCallback(async () => {
    if (!firebaseUser) throw new Error("Sessão expirada.");
    return firebaseUser.getIdToken();
  }, [firebaseUser]);

  const loadTemplate = useCallback(async () => {
    if (!firebaseUser || !canView || !params.id) return;
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${await token()}` };
      const [detailResponse, generatedResponse, aiResponse] = await Promise.all([
        fetch(`/api/documents/templates/${encodeURIComponent(params.id)}`, { headers, cache: "no-store" }),
        fetch(`/api/documents/generated?templateId=${encodeURIComponent(params.id)}`, { headers, cache: "no-store" }),
        fetch(`/api/documents/templates/${encodeURIComponent(params.id)}/ai-plan`, { headers, cache: "no-store" }),
      ]);
      const detailPayload = await detailResponse.json();
      if (!detailResponse.ok) throw new Error(detailPayload.error || "Falha ao carregar o modelo.");
      setTemplate(detailPayload.template);
      setMapping(detailPayload.template.fieldMapping ?? {});
      setSuggestions(detailPayload.suggestions ?? {});
      const generatedPayload = await generatedResponse.json().catch(() => ({}));
      if (generatedResponse.ok) setGenerated(generatedPayload.documents ?? []);
      const aiPayload = await aiResponse.json().catch(() => ({}));
      if (aiResponse.ok) {
        const plan = aiPayload.plan as AiMappingPlan | null;
        setAiPlan(plan);
        setAiBlocked(aiPayload.blocked === true);
        setAiFindings(Array.isArray(aiPayload.findings) ? aiPayload.findings : []);
        setSelectedAiMappings(new Set(plan?.mappings.map((_, index) => index) ?? []));
        setAcceptAiSchema(Boolean(plan?.formSchemaProposal));
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao carregar o modelo.");
    } finally {
      setLoading(false);
    }
  }, [canView, firebaseUser, params.id, token]);

  useEffect(() => { void loadTemplate(); }, [loadTemplate]);

  const variables = useMemo(() => template?.variables ?? [], [template]);
  const mappableVariables = useMemo(
    () => variables.filter((key) => !isDocumentVariableKey(key) && !(LEGACY_LOOP_KEYS as readonly string[]).includes(key)),
    [variables],
  );
  const automaticVariables = useMemo(() => variables.filter((key) => isDocumentVariableKey(key)), [variables]);
  const pendingCount = useMemo(() => mappableVariables.filter((key) => !mapping[key]).length, [mappableVariables, mapping]);
  const manualBindings = useMemo(
    () => Object.entries(mapping).filter((entry): entry is [string, ManualFieldBinding] => entry[1].kind === "manual"),
    [mapping],
  );

  const filteredEmployees = useMemo(() => {
    const term = employeeSearch.trim().toLocaleLowerCase("pt-BR");
    const sorted = [...activeUsers].sort((a, b) => a.username.localeCompare(b.username, "pt-BR"));
    return term ? sorted.filter((user) => user.username.toLocaleLowerCase("pt-BR").includes(term)) : sorted;
  }, [activeUsers, employeeSearch]);

  function setBinding(placeholder: string, binding: TemplateFieldBinding | null) {
    setMapping((current) => {
      const next = { ...current };
      if (binding) next[placeholder] = binding;
      else delete next[placeholder];
      return next;
    });
  }

  async function saveMapping(publish?: boolean) {
    if (!template) return;
    setSaving(true);
    setMessage("");
    setNotice("");
    try {
      const body: Record<string, unknown> = { fieldMapping: mapping };
      if (publish !== undefined) body.status = publish ? "published" : "draft";
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(template.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao salvar.");
      setTemplate(payload.template);
      setMapping(payload.template.fieldMapping ?? {});
      setNotice(publish === undefined ? "Mapeamento salvo." : publish ? "Modelo publicado." : "Modelo despublicado.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadNewVersion(file: File) {
    if (!template) return;
    setUploading(true);
    setMessage("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(template.id)}/file`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}` },
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao enviar o DOCX.");
      setNotice("Nova versão enviada.");
      await loadTemplate();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao enviar o DOCX.");
    } finally {
      setUploading(false);
    }
  }

  async function proposeAiPlan() {
    if (!template) return;
    setAiBusy(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(template.id)}/ai-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao analisar o modelo com IA.");
      const plan = payload.plan as AiMappingPlan;
      setAiPlan(plan);
      setAiBlocked(false);
      setAiFindings([]);
      setSelectedAiMappings(new Set(plan.mappings.map((_, index) => index)));
      setAcceptAiSchema(Boolean(plan.formSchemaProposal));
      setNotice("Plano proposto. Revise cada linha antes de aplicar.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao analisar o modelo.");
    } finally {
      setAiBusy(false);
    }
  }

  async function applyAiPlan() {
    if (!template || !aiPlan) return;
    const mappings = aiPlan.mappings.filter((_, index) => selectedAiMappings.has(index));
    if (!mappings.length) {
      setMessage("Selecione ao menos um mapeamento.");
      return;
    }
    setAiBusy(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(template.id)}/ai-plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ mappings, acceptFormSchema: acceptAiSchema }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao aplicar o plano revisado.");
      setNotice(`Plano aplicado como versão ${payload.template?.version ?? "nova"}. O modelo permanece em rascunho.`);
      await loadTemplate();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao aplicar o plano.");
    } finally {
      setAiBusy(false);
    }
  }

  function openGenerateDialog(prefill?: GeneratedDocument) {
    const defaults: Record<string, string> = {};
    manualBindings.forEach(([placeholder, binding]) => {
      const previous = prefill?.manualValues?.[placeholder];
      defaults[placeholder] = previous !== undefined ? String(previous) : binding.defaultValue ?? "";
    });
    setManualForm(defaults);
    setEmployeeId(prefill?.employeeId ?? "");
    setEmployeeSearch("");
    setGenerateOpen(true);
  }

  async function generatePreview() {
    if (!template || !employeeId) return;
    setGenerating(true);
    setMessage("");
    try {
      const response = await fetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ templateId: template.id, employeeId, manualValues: manualForm, lifecycle: "draft", output: "json" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao gerar documento.");
      setGenerateOpen(false);
      setNotice(payload.document?.pdfAvailable ? "Prévia gerada — abra o PDF para conferir." : "Prévia gerada, mas a finalização está bloqueada porque o PDF oficial não foi produzido.");
      await loadTemplate();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao gerar documento.");
    } finally {
      setGenerating(false);
    }
  }

  async function openGeneratedFile(id: string, format: "pdf" | "docx") {
    setBusyDocument(id);
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
      if (format === "pdf") window.open(url, "_blank", "noopener");
      else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "documento.docx";
        anchor.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao abrir o arquivo.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function changeGeneratedStatus(id: string, status: "approved" | "final") {
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
      setGenerated((current) => current.map((item) => (item.id === id ? { ...item, ...payload.document } : item)));
      setNotice(status === "approved" ? "Documento aprovado para finalização." : "Documento finalizado.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao finalizar.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function discardDocument(id: string) {
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
      setGenerated((current) => current.filter((item) => item.id !== id));
      setNotice("Prévia descartada.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao descartar.");
    } finally {
      setBusyDocument(null);
    }
  }

  if (!canView) return <p className="p-6 text-sm text-slate-500">Sem permissão para acessar modelos.</p>;
  if (loading) return <div className="grid min-h-52 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-teal-700" /></div>;
  if (!template) return <p className="p-6 text-sm text-rose-600">{message || "Modelo não encontrado."}</p>;

  const published = template.status === "published";
  const layoutValid = template.templateValidation?.valid !== false;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <button className="mb-1 inline-flex items-center gap-1 text-xs font-bold text-teal-700" onClick={() => router.push("/dashboard/documents/templates")}>
            <ArrowLeft className="h-3.5 w-3.5" />Modelos
          </button>
          <h1 className="text-xl font-black text-slate-950">{template.name}</h1>
          <p className="text-xs text-slate-500">
            {template.category} · versão {template.version} ·{" "}
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${published ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {published ? "Publicado" : "Rascunho"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage ? <Button size="sm" variant="outline" className="h-9 gap-2 rounded-lg border-violet-200 text-violet-700" disabled={!template.storagePath} onClick={() => setVariableWizardOpen(true)}>
            <Wand2 className="h-4 w-4" />Preparar campos
          </Button> : null}
          {canManage ? <label className="inline-flex">
            <input type="file" accept=".docx" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadNewVersion(file); event.target.value = ""; }} />
            <Button asChild size="sm" variant="outline" className="h-9 cursor-pointer gap-2 rounded-lg">
              <span>{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Nova versão do DOCX</span>
            </Button>
          </label> : null}
          {published ? (
            <>
              {canPublish ? <Button size="sm" variant="outline" className="h-9 rounded-lg" disabled={saving} onClick={() => void saveMapping(false)}>Despublicar</Button> : null}
              {canGenerate ? <Button size="sm" className="h-9 gap-2 rounded-lg" onClick={() => openGenerateDialog()}><FilePlus2 className="h-4 w-4" />Gerar documento</Button> : null}
            </>
          ) : (
            canPublish ? <Button size="sm" className="h-9 gap-2 rounded-lg" disabled={saving || pendingCount > 0 || !template.storagePath || !layoutValid} onClick={() => void saveMapping(true)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Publicar
            </Button> : null
          )}
        </div>
      </div>

      {message ? <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{message}</div> : null}
      {notice ? <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{notice}</div> : null}
      {!layoutValid ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-black text-amber-900">Modelo fora da área segura do papel timbrado</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-amber-800">
            {template.templateValidation?.issues.map((issue) => <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>)}
          </ul>
        </div>
      ) : null}

      {canManage && template.storagePath ? (
        <section className="rounded-lg border border-violet-100 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-black text-slate-900">
                <Sparkles className="h-4 w-4 text-violet-600" />Preparação assistida por IA
              </h2>
              <p className="text-xs text-slate-500">A IA propõe. Somente o plano revisado é aplicado pelo motor determinístico.</p>
            </div>
            <Button size="sm" variant="outline" className="h-8 border-violet-200 text-xs text-violet-700" disabled={aiBusy || aiBlocked} onClick={() => void proposeAiPlan()}>
              {aiBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {aiPlan ? "Gerar novo plano" : "Propor mapeamento"}
            </Button>
          </header>
          {aiBlocked ? (
            <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <p className="font-black">Envio à IA bloqueado: a matriz parece conter dados pessoais reais.</p>
              <ul className="mt-1 list-disc pl-4">
                {aiFindings.map((finding, index) => <li key={`${finding.type}-${index}`}>{finding.type}: {finding.maskedEvidence}</li>)}
              </ul>
            </div>
          ) : aiPlan ? (
            <div className="space-y-3 p-4">
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                    <tr><th className="p-2">Usar</th><th className="p-2">Trecho exato</th><th className="p-2">Variável</th><th className="p-2">Ocorrências</th><th className="p-2">Confiança</th><th className="p-2">Justificativa</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {aiPlan.mappings.map((item, index) => (
                      <tr key={`${item.exactText}-${index}`} className={item.confidence < 0.75 ? "bg-amber-50" : ""}>
                        <td className="p-2"><input type="checkbox" checked={selectedAiMappings.has(index)} onChange={(event) => setSelectedAiMappings((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(index); else next.delete(index);
                          return next;
                        })} /></td>
                        <td className="max-w-64 p-2 font-medium text-slate-800">{item.exactText}</td>
                        <td className="p-2"><code className="rounded bg-slate-100 px-1 py-0.5">{`{{${item.variableKey}}}`}</code></td>
                        <td className="p-2">{item.expectedOccurrences}</td>
                        <td className="p-2 font-bold">{Math.round(item.confidence * 100)}%</td>
                        <td className="max-w-72 p-2 text-slate-500">{item.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {aiPlan.formSchemaProposal ? (
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input type="checkbox" checked={acceptAiSchema} onChange={(event) => setAcceptAiSchema(event.target.checked)} />
                  Aplicar também o schema de formulário proposto, se ele passar na validação
                </label>
              ) : null}
              <div className="flex justify-end">
                <Button size="sm" className="gap-2 bg-violet-700 hover:bg-violet-800" disabled={aiBusy || selectedAiMappings.size === 0} onClick={() => void applyAiPlan()}>
                  {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Aplicar plano revisado
                </Button>
              </div>
            </div>
          ) : (
            <p className="px-4 py-5 text-xs text-slate-500">Nenhum plano solicitado. A fonte não será enviada à IA até esta ação.</p>
          )}
        </section>
      ) : null}

      <section className="rounded-lg border bg-white shadow-sm">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-black text-slate-900">Campos do modelo</h2>
            <p className="text-xs text-slate-500">
              {variables.length} campo(s) no DOCX · {automaticVariables.length} automático(s) ·{" "}
              {pendingCount > 0 ? <span className="font-bold text-amber-700">{pendingCount} a definir</span> : <span className="font-bold text-emerald-700">todos definidos</span>}
            </p>
          </div>
          {canManage ? <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" disabled={saving} onClick={() => void saveMapping()}>
            {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Salvar mapeamento
          </Button> : null}
        </header>
        <div className="divide-y">
          {variables.length === 0 ? <p className="px-4 py-6 text-center text-xs text-slate-500">Envie um DOCX para o sistema analisar os campos.</p> : null}
          {automaticVariables.map((key) => (
            <div key={key} className="flex items-center gap-3 px-4 py-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{`{{${key}}}`}</code>
              <span className="truncate text-xs text-slate-600">{CATALOG_LABELS.get(key) ?? key}</span>
              <span className="ml-auto shrink-0 text-[10px] font-bold uppercase text-emerald-700">Automático</span>
            </div>
          ))}
          {mappableVariables.map((key) => {
            const binding = mapping[key];
            const suggestion = suggestions[key];
            return (
              <div key={key} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  {binding ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" />}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{`{{${key}}}`}</code>
                  <select
                    className="h-8 rounded-md border bg-white px-2 text-xs"
                    value={binding ? binding.kind : ""}
                    onChange={(event) => {
                      const kind = event.target.value;
                      if (kind === "system") setBinding(key, { kind: "system", key: suggestion ?? "" });
                      else if (kind === "manual") setBinding(key, { kind: "manual", label: "", format: "text", required: false });
                      else setBinding(key, null);
                    }}
                  >
                    <option value="">A definir...</option>
                    <option value="system">Campo do sistema</option>
                    <option value="manual">Preencher na geração</option>
                  </select>
                  {!binding && suggestion ? (
                    <button
                      className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700"
                      onClick={() => setBinding(key, { kind: "system", key: suggestion })}
                    >
                      <Sparkles className="h-3 w-3" />Sugestão: {CATALOG_LABELS.get(suggestion) ?? suggestion}
                    </button>
                  ) : null}
                  {binding?.kind === "manual" ? <Pencil className="ml-auto h-3.5 w-3.5 text-slate-400" /> : null}
                </div>
                {binding?.kind === "system" ? (
                  <div className="grid gap-2 pl-7 sm:grid-cols-2">
                    <SystemKeySelect
                      value={binding.key}
                      onChange={(next) => setBinding(key, { ...binding, key: next })}
                    />
                    <select
                      className="h-9 w-full rounded-md border bg-white px-2 text-xs"
                      value={binding.formatter ?? "source"}
                      onChange={(event) => {
                        const formatter = event.target.value as DocumentOutputFormatter;
                        setBinding(key, {
                          ...binding,
                          formatter: formatter === "source" ? undefined : formatter,
                        });
                      }}
                    >
                      {DOCUMENT_OUTPUT_FORMATTERS.map((formatter) => (
                        <option key={formatter} value={formatter}>{OUTPUT_FORMATTER_LABELS[formatter]}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {binding?.kind === "manual" ? (
                  <div className="pl-7"><ManualFieldEditor binding={binding} onChange={(next) => setBinding(key, next)} /></div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border bg-white shadow-sm">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-black text-slate-900">Documentos gerados</h2>
          <p className="text-xs text-slate-500">Prévias ficam em conferência até serem finalizadas.</p>
        </header>
        {generated.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-500">Nenhum documento gerado com este modelo ainda.</p>
        ) : (
          <div className="divide-y">
            {generated.map((item) => {
              const isReview = item.status === "draft" || item.status === "review_pending";
              const isApproved = item.status === "approved";
              const busy = busyDocument === item.id;
              return (
                <div key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <FileStack className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-slate-800">{item.employeeName ?? item.employeeId ?? item.onboardingId ?? "—"}</p>
                    <p className="text-[11px] text-slate-500">{formatDateTime(item.generatedAt)} · por {item.generatedByName ?? "—"}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${isReview ? "bg-amber-50 text-amber-700" : isApproved ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {isReview ? "Em conferência" : isApproved ? "Aprovado" : "Finalizado"}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    {canViewGenerated && item.pdfAvailable ? (
                      <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" disabled={busy} onClick={() => void openGeneratedFile(item.id, "pdf")}><Eye className="h-3.5 w-3.5" />PDF</Button>
                    ) : null}
                    {canViewGenerated ? <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" disabled={busy} onClick={() => void openGeneratedFile(item.id, "docx")}><Download className="h-3.5 w-3.5" />DOCX</Button> : null}
                    {isReview && canReview ? (
                      <>
                        <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" disabled={busy || !published} onClick={() => openGenerateDialog(item)}><Wand2 className="h-3.5 w-3.5" />Corrigir</Button>
                        <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs text-sky-700" disabled={busy || !item.pdfAvailable} onClick={() => void changeGeneratedStatus(item.id, "approved")}><CheckCircle2 className="h-3.5 w-3.5" />Aprovar</Button>
                        <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs text-rose-600" disabled={busy} onClick={() => void discardDocument(item.id)}><Trash2 className="h-3.5 w-3.5" />Descartar</Button>
                      </>
                    ) : null}
                    {isApproved && canReview ? (
                      <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs text-emerald-700" disabled={busy} onClick={() => void changeGeneratedStatus(item.id, "final")}><Lock className="h-3.5 w-3.5" />Finalizar</Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {canGenerate ? <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="max-w-lg rounded-xl p-0">
          <DialogHeader className="border-b px-5 py-4"><DialogTitle>Gerar: {template.name}</DialogTitle></DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-slate-700">Colaborador</span>
              <Input className="h-9 text-xs" placeholder="Buscar colaborador..." value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} />
              <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                <option value="">Selecione...</option>
                {filteredEmployees.map((user) => (
                  <option key={user.id} value={user.id}>{user.username}</option>
                ))}
              </select>
            </div>
            {manualBindings.length ? (
              <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
                <p className="text-xs font-black text-slate-700">Preencha para gerar</p>
                {manualBindings.map(([placeholder, binding]) => (
                  <label key={placeholder} className="block space-y-1">
                    <span className="text-xs font-bold text-slate-700">{binding.label || placeholder}{binding.required ? " *" : ""}</span>
                    {binding.helpText ? <span className="block text-[11px] text-slate-500">{binding.helpText}</span> : null}
                    <ManualValueInput binding={binding} value={manualForm[placeholder] ?? ""} onChange={(next) => setManualForm((current) => ({ ...current, [placeholder]: next }))} />
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Este modelo não possui campos manuais — todos os dados vêm do sistema.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-3">
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancelar</Button>
            <Button disabled={generating || !employeeId} onClick={() => void generatePreview()}>
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-2 h-4 w-4" />}Gerar prévia
            </Button>
          </div>
        </DialogContent>
      </Dialog> : null}

      {canManage ? <TemplateVariableWizard
        open={variableWizardOpen}
        onOpenChange={setVariableWizardOpen}
        templateId={template.id}
        templateName={template.name}
        getToken={token}
        onFinalized={async (nextNotice) => {
          await loadTemplate();
          setNotice(nextNotice);
        }}
      /> : null}
    </div>
  );
}
