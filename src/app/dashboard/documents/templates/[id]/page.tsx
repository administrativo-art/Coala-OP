"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  Eye,
  FileDown,
  FilePlus2,
  FileStack,
  GitBranch,
  History,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { TemplateVariableWizard } from "@/components/hr/documents/template-variable-wizard";
import { CollectiveAgreementsPanel } from "@/components/hr/documents/collective-agreements-panel";
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
import {
  DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS,
  DOCUMENT_TEMPLATE_WORKFLOW_LABELS,
  type DocumentTemplateWorkflowStatus,
} from "@/features/hr/documents/document-template-workflow";
import { documentTemplateDisplayStatus } from "@/features/hr/documents/document-template-display-status";
import type { DocumentTemplatePreparationStatus } from "@/features/hr/documents/document-template-display-status";
import { isDocumentTemplateContentEditable } from "@/features/hr/documents/document-template-governance";
import type { DocumentTemplateTextBlock } from "@/features/hr/documents/document-template-text";

type TemplateDetail = {
  id: string;
  name: string;
  category: string;
  status: string;
  version: number;
  contentHash?: string;
  updatedAt?: string;
  updatedByName?: string;
  variables?: string[];
  storagePath?: string;
  description?: string;
  isSystem?: boolean;
  sourceFormat?: "pdf" | "docx";
  previewUrl?: string;
  downloadUrl?: string;
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
  workflowNote?: string | null;
  workflowUpdatedAt?: string | null;
  workflowUpdatedByName?: string | null;
  workflowHistory?: Array<{
    from: DocumentTemplateWorkflowStatus;
    to: DocumentTemplateWorkflowStatus;
    note?: string | null;
    actorName?: string | null;
    at?: string | null;
    decision?: "advance" | "return";
    sameActorAsEditor?: boolean;
  }>;
  fieldPreparationTestedAt?: string | null;
  fieldPreparationTestedByName?: string | null;
  contentUpdatedBy?: string | null;
  contentUpdatedByName?: string | null;
  technicalAttestations?: {
    layoutReviewed?: boolean;
    fictionalDataReviewed?: boolean;
    attestedAt?: string | null;
    attestedByName?: string | null;
  } | null;
  sourceIntegrity?: {
    valid?: boolean;
    checkedAt?: string | null;
    actualHash?: string;
    issues?: Array<{ code: string; message: string }>;
  } | null;
  aiMappingPlan?: { reviewed?: boolean } | null;
  preparationStatus?: DocumentTemplatePreparationStatus;
  templateValidation?: {
    valid: boolean;
    profileId: string;
    issues: Array<{ code: string; message: string }>;
  };
  documentStandardValidation?: {
    valid: boolean;
    issues: Array<{ code: string; message: string }>;
  };
  originalContentHash?: string;
  originalStoragePath?: string;
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
  cbo: "Sai como 5134-15",
  cpf: "Sai como 000.000.000-00",
  cnpj: "Sai como 00.000.000/0000-00",
  cep: "Sai como 00000-000",
  time_br: "Sai como 08:00",
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
const CATALOG_ENTRIES = new Map(DOCUMENT_VARIABLES.map((entry) => [entry.key, entry]));

type DetailView = "overview" | "text" | "fields" | "generated" | "history";
type FieldFilter = "all" | "pending" | "manual" | "automatic" | "issues";

function templateFieldGroup(key: string) {
  if (key.startsWith("employee.")) return "Colaborador";
  if (key.startsWith("integration.employer")) return "Empresa responsável";
  if (key.includes("cct") || key.includes("union")) return "Convenção coletiva";
  if (key.includes("salary") || key.includes("remuneration")) return "Remuneração";
  if (key.includes("work_") || key.includes("scale") || key.includes("hours")) return "Jornada e local";
  if (key.startsWith("integration.")) return "Contratação";
  if (key.startsWith("contract_")) return "Contrato";
  return "Outros campos";
}

function templateTokenLabel(key: string, mapping: TemplateFieldMapping) {
  const binding = mapping[key];
  if (binding?.kind === "manual") return binding.label || key;
  if (binding?.kind === "system") return CATALOG_LABELS.get(binding.key) ?? binding.key;
  return CATALOG_LABELS.get(key) ?? key;
}

function highlightedTemplateText(text: string, mapping: TemplateFieldMapping) {
  return text.split(/(\{\{[^{}]+\}\})/g).map((part, index) => {
    const match = part.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (!match) return <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>;
    const key = match[1].replace(/^[#/]\s*/, "").trim();
    const label = templateTokenLabel(key, mapping);
    return (
      <mark
        key={`${index}-${key}`}
        className="mx-0.5 inline rounded border border-amber-300 bg-amber-200 px-1 py-0.5 font-mono text-[0.82em] font-bold text-amber-950 shadow-[inset_0_-1px_0_rgba(180,83,9,0.18)]"
        title={`${label} · ${part}`}
        aria-label={`${label}: ${part}`}
      >
        {part}
      </mark>
    );
  });
}

function TemplateTextBlockView({
  block,
  mapping,
}: {
  block: DocumentTemplateTextBlock;
  mapping: TemplateFieldMapping;
}) {
  const text = highlightedTemplateText(block.text, mapping);
  if (block.kind === "title") {
    return (
      <h2 className="mb-8 border-b border-slate-400 pb-5 text-center text-xl font-bold uppercase leading-snug">
        {text}
      </h2>
    );
  }
  if (block.kind === "section") {
    return <h3 className="mb-3 mt-7 text-sm font-bold uppercase leading-snug first:mt-0">{text}</h3>;
  }
  if (block.kind === "clause" || block.kind === "subclause") {
    return (
      <div className={`mb-3 flex items-start ${block.kind === "subclause" ? "pl-7" : ""}`}>
        <span className={`shrink-0 font-bold ${block.kind === "subclause" ? "w-16" : "w-11"}`}>
          {block.number}
        </span>
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-justify leading-[1.55]">{text}</p>
      </div>
    );
  }
  if (block.kind === "signature") {
    return <p className="whitespace-pre-wrap text-center text-sm leading-relaxed">{text}</p>;
  }
  return <p className="mb-3 whitespace-pre-wrap text-justify leading-[1.55]">{text}</p>;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

function templateUsage(template: TemplateDetail) {
  if (template.officialCandidate) return { label: "Nova versão oficial", path: null, action: null };
  if (!template.isSystem) return { label: "Modelo personalizado", path: null, action: null };
  if (template.sourceModule === "uniforms" || template.id.startsWith("system-uniform-")) {
    return { label: "Módulo de Uniformes", path: null, action: null };
  }
  if (template.id.startsWith("system-admission-")) {
    return { label: "Fluxo admissional", path: null, action: null };
  }
  if (template.generationMode === "reference") return { label: "Somente referência", path: null, action: null };
  if (template.generationMode === "direct") {
    return {
      label: "Central de documentos",
      path: `/dashboard/documents/generator?template=${encodeURIComponent(template.id)}`,
      action: "Abrir Gerador",
    };
  }
  return { label: "Gestão de documentos", path: null, action: null };
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
  cpf_labeled: "CPF com prefixo",
  cnpj_labeled: "CNPJ com prefixo",
  cbo_labeled: "CBO com prefixo",
  registry_number_labeled: "Número de registro com prefixo",
  nonbreaking_range: "Intervalo sem quebra de linha",
  uppercase: "Texto em maiúsculas",
};

function fieldOutputSample(key: string, binding?: TemplateFieldBinding) {
  if (binding?.kind === "manual") return FORMAT_SAMPLES[binding.format];
  if (binding?.kind === "system" && binding.formatter) {
    return OUTPUT_FORMATTER_LABELS[binding.formatter];
  }
  const entry = CATALOG_ENTRIES.get(binding?.kind === "system" ? binding.key : key);
  if (!entry) return "Valor resolvido na geração";
  const samples: Partial<Record<typeof entry.format, string>> = {
    date_br: "Ex.: 28/07/2026",
    currency_br: "Ex.: R$ 1.620,00",
    cpf: "Ex.: 000.000.000-00",
    cnpj: "Ex.: 00.000.000/0000-00",
    boolean_br: "Ex.: Sim",
    phone_br: "Ex.: (98) 99999-9999",
  };
  return samples[entry.format] ?? "Valor vindo do cadastro";
}

function ManualFieldEditor({ binding, onChange }: { binding: ManualFieldBinding; onChange: (next: ManualFieldBinding) => void }) {
  return (
    <div className="grid gap-3 lg:grid-cols-4">
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
      <label className="block space-y-1">
        <span className="text-[10px] font-bold uppercase text-slate-500">Valor padrão</span>
        <Input className="h-9 text-xs" value={binding.defaultValue ?? ""} placeholder="Opcional" onChange={(event) => onChange({ ...binding, defaultValue: event.target.value || undefined })} />
      </label>
      <label className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 text-xs font-semibold text-slate-700">
        <input className="h-4 w-4 accent-violet-700" type="checkbox" checked={binding.required} onChange={(event) => onChange({ ...binding, required: event.target.checked })} />
        Obrigatório na geração
      </label>
      {binding.format === "select" ? (
        <label className="block space-y-1 lg:col-span-4">
          <span className="text-[10px] font-bold uppercase text-slate-500">Opções (separadas por vírgula)</span>
          <Input className="h-9 text-xs" value={binding.options?.join(", ") ?? ""} placeholder="Ex.: Integral, Meio período" onChange={(event) => onChange({ ...binding, options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
        </label>
      ) : null}
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
      type={binding.format === "date_br" ? "date" : binding.format === "time_br" ? "time" : "text"}
      inputMode={binding.format === "currency_br" || binding.format === "number_br" ? "decimal" : undefined}
      placeholder={
        binding.format === "currency_br" ? "Ex.: 220,00"
          : binding.format === "cbo" ? "Ex.: 5134-15"
            : binding.format === "cep" ? "Ex.: 65000-000"
              : undefined
      }
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
  const openedFromPrepareQuery = useRef(false);
  const [workflowNote, setWorkflowNote] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [returningForAdjustments, setReturningForAdjustments] = useState(false);
  const [layoutAttested, setLayoutAttested] = useState(false);
  const [fictionalDataAttested, setFictionalDataAttested] = useState(false);
  const [integrityBusy, setIntegrityBusy] = useState(false);
  const [cloningTemplate, setCloningTemplate] = useState(false);
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
  const [activeView, setActiveView] = useState<DetailView>("overview");
  const [documentText, setDocumentText] = useState<DocumentTemplateTextBlock[] | null>(null);
  const [documentTextOccurrences, setDocumentTextOccurrences] = useState(0);
  const [documentTextLoading, setDocumentTextLoading] = useState(false);
  const [documentTextError, setDocumentTextError] = useState("");
  const [fieldFilter, setFieldFilter] = useState<FieldFilter>("all");
  const [fieldSearch, setFieldSearch] = useState("");
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const uploadInputRef = useRef<HTMLInputElement>(null);

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
  useEffect(() => {
    if (activeView !== "text" || !firebaseUser || !params.id) return;
    const controller = new AbortController();
    setDocumentTextLoading(true);
    setDocumentTextError("");
    void (async () => {
      try {
        const response = await fetch(
          `/api/documents/templates/${encodeURIComponent(params.id)}/text`,
          {
            headers: { Authorization: `Bearer ${await token()}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Falha ao carregar o texto integral.");
        setDocumentText(Array.isArray(payload.blocks) ? payload.blocks : []);
        setDocumentTextOccurrences(Number(payload.variableOccurrences ?? 0));
      } catch (cause) {
        if (controller.signal.aborted) return;
        setDocumentTextError(
          cause instanceof Error ? cause.message : "Falha ao carregar o texto integral.",
        );
      } finally {
        if (!controller.signal.aborted) setDocumentTextLoading(false);
      }
    })();
    return () => controller.abort();
  }, [activeView, firebaseUser, params.id, template?.contentHash, template?.version, token]);
  useEffect(() => {
    if (
      template?.officialCandidate
      && canManage
      && template.storagePath
      && !openedFromPrepareQuery.current
      && new URLSearchParams(window.location.search).get("prepare") === "1"
    ) {
      openedFromPrepareQuery.current = true;
      setActiveView("fields");
      setVariableWizardOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [canManage, template]);
  useEffect(() => {
    setWorkflowNote(template?.workflowNote ?? "");
    setLayoutAttested(template?.technicalAttestations?.layoutReviewed === true);
    setFictionalDataAttested(template?.technicalAttestations?.fictionalDataReviewed === true);
  }, [
    template?.id,
    template?.workflowNote,
    template?.technicalAttestations?.layoutReviewed,
    template?.technicalAttestations?.fictionalDataReviewed,
  ]);
  useEffect(() => {
    if (!variableWizardOpen) return;
    window.requestAnimationFrame(() => {
      document.getElementById("template-fields-phase")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [variableWizardOpen]);

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
  const fieldGroups = useMemo(() => {
    const search = fieldSearch.trim().toLocaleLowerCase("pt-BR");
    const rows = variables.map((key) => {
      const binding = mapping[key];
      const automatic = isDocumentVariableKey(key) || binding?.kind === "system";
      const pending = !isDocumentVariableKey(key)
        && !(LEGACY_LOOP_KEYS as readonly string[]).includes(key)
        && !binding;
      const manual = binding?.kind === "manual";
      const label = binding?.kind === "manual"
        ? binding.label || key
        : binding?.kind === "system"
          ? CATALOG_LABELS.get(binding.key) ?? binding.key
          : CATALOG_LABELS.get(key) ?? key;
      return { key, binding, automatic, pending, manual, label };
    }).filter((row) => {
      if (search && !`${row.key} ${row.label}`.toLocaleLowerCase("pt-BR").includes(search)) return false;
      if (fieldFilter === "pending" || fieldFilter === "issues") return row.pending;
      if (fieldFilter === "manual") return row.manual;
      if (fieldFilter === "automatic") return row.automatic;
      return true;
    });
    const groups = new Map<string, typeof rows>();
    rows.forEach((row) => {
      const group = templateFieldGroup(row.key);
      groups.set(group, [...(groups.get(group) ?? []), row]);
    });
    return Array.from(groups.entries());
  }, [fieldFilter, fieldSearch, mapping, variables]);

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

  function toggleField(placeholder: string) {
    setExpandedFields((current) => {
      const next = new Set(current);
      if (next.has(placeholder)) next.delete(placeholder);
      else next.add(placeholder);
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

  async function advanceOfficialWorkflow() {
    if (!template || (!template.officialCandidate && !template.isSystem) || !template.workflowStatus) return;
    const action = DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS[template.workflowStatus];
    if (!action) return;
    if (!workflowNote.trim()) {
      setMessage("Registre uma observação ou evidência antes de avançar.");
      return;
    }
    if (
      action.next === "rh_approval"
      && (!layoutAttested || !fictionalDataAttested)
    ) {
      setMessage("Confirme a conferência do layout e do preenchimento com dados fictícios.");
      return;
    }
    if (
      action.next === "published"
      && !window.confirm("Homologar e publicar esta versão? A versão oficial anterior será substituída.")
    ) return;
    setWorkflowBusy(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(template.id)}/workflow`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          status: action.next,
          decision: "advance",
          note: workflowNote,
          attestations: {
            layoutReviewed: layoutAttested,
            fictionalDataReviewed: fictionalDataAttested,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao avançar a nova versão.");
      setNotice(
        action.next === "published"
          ? "Nova versão homologada e publicada. A versão oficial anterior foi marcada como substituída."
          : `Modelo avançado para ${DOCUMENT_TEMPLATE_WORKFLOW_LABELS[action.next].toLocaleLowerCase("pt-BR")}.`,
      );
      setWorkflowNote("");
      await loadTemplate();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao avançar a nova versão.");
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function returnForAdjustments() {
    if (!template || !["rh_approval", "legal_review"].includes(String(template.workflowStatus))) return;
    if (!workflowNote.trim()) {
      setMessage("Informe o motivo da devolução para ajustes.");
      return;
    }
    if (!window.confirm("Devolver esta versão para edição manual? As validações técnicas atuais serão invalidadas.")) return;
    setReturningForAdjustments(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(template.id)}/workflow`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          status: "technical_validation",
          decision: "return",
          note: workflowNote,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao devolver a versão.");
      setNotice("Versão devolvida para edição manual. O motivo foi registrado no histórico.");
      setWorkflowNote("");
      setActiveView("fields");
      await loadTemplate();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao devolver a versão.");
    } finally {
      setReturningForAdjustments(false);
    }
  }

  async function recheckDocxIntegrity() {
    if (!template || template.isSystem) return;
    setIntegrityBusy(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(template.id)}/integrity`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao reverificar o DOCX.");
      setNotice(payload.integrity?.valid
        ? "DOCX íntegro: hash, tokens e mapeamento correspondem."
        : "A reverificação encontrou inconsistências no DOCX.");
      await loadTemplate();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao reverificar o DOCX.");
    } finally {
      setIntegrityBusy(false);
    }
  }

  async function createEditableVersion() {
    if (!template) return;
    setCloningTemplate(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch(`/api/documents/templates/${encodeURIComponent(template.id)}/editable-version`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao criar a nova versão.");
      router.push(`/dashboard/documents/templates/${encodeURIComponent(payload.template.id)}?prepare=1`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao criar a nova versão.");
    } finally {
      setCloningTemplate(false);
    }
  }

  async function openTemplateFile(action: "preview" | "pdf-download" | "download") {
    if (!template) return;
    const sourceUrl = action === "download" ? template.downloadUrl : template.previewUrl;
    if (!sourceUrl) return;
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
      let response = await requestPreview(await token());
      if ((response.status === 401 || response.status === 403) && firebaseUser) {
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
      setVariableWizardOpen(true);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao aplicar o plano.");
    } finally {
      setAiBusy(false);
    }
  }

  function startPreparation() {
    setActiveView("fields");
    if (!aiPlan) {
      document.getElementById("ai-preparation-phase")?.scrollIntoView({ behavior: "smooth", block: "start" });
      void proposeAiPlan();
      return;
    }
    if (!aiPlan.reviewed) {
      document.getElementById("ai-preparation-phase")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setVariableWizardOpen(true);
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
  const officialTemplate = Boolean(template.officialCandidate || template.isSystem);
  const contentEditable = canManage
    && !template.isSystem
    && isDocumentTemplateContentEditable(template);
  const layoutValid = template.isSystem || template.templateValidation?.valid === true;
  const documentStandardValid =
    template.isSystem || template.documentStandardValidation?.valid === true;
  const workflowAction = officialTemplate && template.workflowStatus
    && template.workflowStatus !== "published"
    ? DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS[template.workflowStatus]
    : null;
  const workflowCanAdvance = workflowAction?.next === "published" ? canPublish : canManage;
  const preparationStatus = template.preparationStatus;
  const aiMappingComplete = template.isSystem
    || Boolean(aiPlan)
    || preparationStatus === "validation_editing"
    || preparationStatus === "visual_test"
    || preparationStatus === "ready_for_rh_approval"
    || preparationStatus === "ready_for_legal_review"
    || preparationStatus === "available";
  const aiReviewComplete = template.isSystem
    || Boolean(template.fieldPreparationTestedAt)
    || preparationStatus === "visual_test"
    || preparationStatus === "ready_for_rh_approval"
    || preparationStatus === "ready_for_legal_review"
    || preparationStatus === "available";
  const visualTestComplete = template.isSystem
    || Boolean(template.fieldPreparationTestedAt)
    || preparationStatus === "ready_for_rh_approval"
    || preparationStatus === "ready_for_legal_review"
    || preparationStatus === "available";
  const awaitingRhApproval = ["rh_approval", "legal_review"].includes(String(template.workflowStatus));
  const rhApprovalComplete = template.workflowStatus === "published";
  const officialStages = [
    {
      label: "Mapeamento pela IA",
      complete: aiMappingComplete,
      current: !aiMappingComplete,
      meta: aiMappingComplete ? "locais sugeridos" : "aguardando análise",
    },
    {
      label: "Edição manual",
      complete: aiReviewComplete,
      current: aiMappingComplete && !aiReviewComplete,
      meta: aiReviewComplete ? "mapeamento revisado" : aiMappingComplete ? "aguardando validação" : "—",
    },
    {
      label: "Teste visual",
      complete: visualTestComplete,
      current: aiReviewComplete && !visualTestComplete,
      meta: visualTestComplete
        ? `${template.fieldPreparationTestedByName || template.updatedByName || "Validado"} · ${formatDateTime(template.fieldPreparationTestedAt)}`
        : aiReviewComplete ? "aguardando teste" : "—",
    },
    {
      label: "Homologação do RH",
      complete: rhApprovalComplete,
      current: awaitingRhApproval,
      meta: rhApprovalComplete
        ? `${template.workflowUpdatedByName || "RH"} · ${formatDateTime(template.workflowUpdatedAt)}`
        : awaitingRhApproval ? "aguardando decisão" : "—",
    },
    {
      label: "Em uso",
      complete: published,
      current: published,
      meta: published ? "versão publicada" : "—",
    },
  ];
  const officialChecklist = [
    {
      label: "DOCX corresponde ao mapeamento",
      ok: template.isSystem || template.sourceIntegrity?.valid === true,
      kind: "system" as const,
      evidence: template.isSystem
        ? "Fonte oficial verificada por hash"
        : template.sourceIntegrity?.valid
          ? `Hash e tokens verificados · ${formatDateTime(template.sourceIntegrity.checkedAt)}`
          : "Clique em “Reverificar DOCX”",
    },
    {
      label: `${variables.length - pendingCount} de ${variables.length} campos vinculados`,
      ok: pendingCount === 0,
      kind: "system" as const,
      evidence: "Verificação automática",
    },
    {
      label: "Área segura do papel timbrado",
      ok: layoutValid,
      kind: "system" as const,
      evidence: "Verificação automática do DOCX",
    },
    {
      label: "Padrão documental CT Sorvetes",
      ok: documentStandardValid,
      kind: "system" as const,
      evidence: template.isSystem
        ? "Modelo oficial controlado"
        : documentStandardValid
          ? "Estilos, numeração, hifenização e página verificados"
          : "Corrija os itens indicados antes do teste visual",
    },
    {
      label: "Teste visual gerado",
      ok: template.isSystem || Boolean(template.fieldPreparationTestedAt),
      kind: "system" as const,
      evidence: template.isSystem
        ? "Modelo oficial validado"
        : `${template.fieldPreparationTestedByName || "Usuário"} · ${formatDateTime(template.fieldPreparationTestedAt)}`,
    },
    {
      label: "Layout conferido visualmente",
      ok: template.isSystem || layoutAttested,
      kind: "human" as const,
      evidence: template.isSystem
        ? "Modelo oficial validado"
        : layoutAttested
          ? template.technicalAttestations?.attestedAt
            ? `${template.technicalAttestations.attestedByName || "Usuário"} · ${formatDateTime(template.technicalAttestations.attestedAt)}`
            : "Será registrado ao avançar"
          : "Requer confirmação humana",
    },
    {
      label: "Preenchimento fictício conferido",
      ok: template.isSystem || fictionalDataAttested,
      kind: "human" as const,
      evidence: template.isSystem
        ? "Modelo oficial validado"
        : fictionalDataAttested
          ? template.technicalAttestations?.attestedAt
            ? `${template.technicalAttestations.attestedByName || "Usuário"} · ${formatDateTime(template.technicalAttestations.attestedAt)}`
            : "Será registrado ao avançar"
          : "Requer confirmação humana",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="sticky top-2 z-20 flex flex-col gap-4 rounded-2xl border bg-white/95 px-4 py-4 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <button className="mb-1 inline-flex items-center gap-1 text-[11px] font-bold text-teal-700 hover:text-teal-900" onClick={() => router.push("/dashboard/documents/templates")}>
            <ArrowLeft className="h-3.5 w-3.5" />Modelos
          </button>
          <h1 className="truncate text-lg font-black leading-tight text-slate-950">{template.name}</h1>
          <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${
            published ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}>
              {documentTemplateDisplayStatus({ ...template, aiMappingPlan: aiPlan })}
          </span>
          <p className="mt-2 text-xs text-slate-600">
            {template.category} · versão {template.version} · {templateUsage(template).label.toLocaleLowerCase("pt-BR")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-center">
          {!template.isSystem && !template.officialCandidate && published && canGenerate ? (
            <Button size="sm" className="h-9 gap-2 rounded-lg" onClick={() => openGenerateDialog()}>
              <FilePlus2 className="h-4 w-4" />Gerar documento
            </Button>
          ) : null}
          {!template.isSystem && !template.officialCandidate && !published && canPublish ? (
            <Button size="sm" className="h-9 gap-2 rounded-lg" disabled={saving || pendingCount > 0 || !template.storagePath || !layoutValid || !visualTestComplete} onClick={() => void saveMapping(true)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Publicar
            </Button>
          ) : null}
          {template.previewUrl ? (
            <Button size="sm" variant="outline" className="h-9 gap-2 rounded-lg bg-white" onClick={() => void openTemplateFile("preview")}>
              <Eye className="h-4 w-4" />Visualizar prévia
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="outline" className="h-9 w-9 rounded-lg bg-white" aria-label="Mais ações do modelo">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
              {template.previewUrl ? (
                <DropdownMenuItem className="rounded-lg text-xs" onSelect={() => void openTemplateFile("pdf-download")}>
                  <FileDown className="h-4 w-4" />Baixar prévia (PDF)
                </DropdownMenuItem>
              ) : null}
              {template.downloadUrl ? (
                <DropdownMenuItem className="rounded-lg text-xs" onSelect={() => void openTemplateFile("download")}>
                  <Download className="h-4 w-4" />Baixar modelo (DOCX)
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem className="rounded-lg text-xs" onSelect={() => setActiveView("history")}>
                <History className="h-4 w-4" />Histórico de versões
              </DropdownMenuItem>
              {(canManage || canPublish) ? <DropdownMenuSeparator /> : null}
              {contentEditable ? (
                <DropdownMenuItem className="rounded-lg text-xs" disabled={!template.storagePath || aiBusy} onSelect={startPreparation}>
                  <Wand2 className="h-4 w-4" />
                  {aiPlan?.reviewed ? "Continuar edição manual" : aiPlan ? "Revisar sugestões" : "Iniciar preparação"}
                </DropdownMenuItem>
              ) : null}
              {contentEditable ? (
                <DropdownMenuItem className="rounded-lg text-xs" disabled={uploading} onSelect={() => uploadInputRef.current?.click()}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Enviar nova versão do DOCX
                </DropdownMenuItem>
              ) : null}
              {canManage && !template.isSystem && template.storagePath ? (
                <DropdownMenuItem className="rounded-lg text-xs" disabled={integrityBusy} onSelect={() => void recheckDocxIntegrity()}>
                  {integrityBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Reverificar DOCX
                </DropdownMenuItem>
              ) : null}
              {canPublish && !template.isSystem && !template.officialCandidate && published ? (
                <DropdownMenuItem className="rounded-lg text-xs" disabled={saving} onSelect={() => void saveMapping(false)}>
                  <Lock className="h-4 w-4" />Despublicar
                </DropdownMenuItem>
              ) : null}
              {canManage && (
                (template.isSystem && template.sourceFormat === "docx")
                || (template.officialCandidate && !contentEditable)
              ) ? (
                <DropdownMenuItem className="rounded-lg text-xs" disabled={cloningTemplate} onSelect={() => void createEditableVersion()}>
                  {cloningTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
                  Criar versão {template.version + 1} para editar
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadNewVersion(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      {message ? <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{message}</div> : null}
      {notice ? <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{notice}</div> : null}
      <nav className="flex flex-wrap gap-1 rounded-xl border bg-white p-1 shadow-sm" aria-label="Áreas do modelo">
        {([
          ["overview", "Visão geral"],
          ["text", "Texto integral"],
          ["fields", `Texto e variáveis · ${variables.length}`],
          ["generated", `Documentos gerados · ${generated.length}`],
          ["history", `Histórico · ${template.workflowHistory?.length ?? 0}`],
        ] as Array<[DetailView, string]>).map(([view, label]) => (
          <button
            key={view}
            className={`rounded-lg px-4 py-2 text-xs font-extrabold transition ${
              activeView === view ? "bg-violet-700 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            }`}
            onClick={() => setActiveView(view)}
          >
            {label}
          </button>
        ))}
      </nav>
      {template.sourceIntegrity?.valid === false ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-xs font-black text-rose-900">O DOCX não corresponde mais ao mapeamento desta versão</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-rose-800">
            {template.sourceIntegrity.issues?.map((issue) => <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>)}
          </ul>
        </div>
      ) : null}
      {!layoutValid ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-black text-amber-900">Modelo fora da área segura do papel timbrado</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-amber-800">
            {template.templateValidation?.issues.map((issue) => <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>)}
          </ul>
        </div>
      ) : null}
      {!documentStandardValid ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-black text-amber-900">
            A preparação automática precisa de validação manual
          </p>
          <p className="mt-1 text-[11px] text-amber-800">
            O original foi preservado. A versão preparada só poderá ser publicada
            depois que estes pontos forem resolvidos:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-amber-800">
            {template.documentStandardValidation?.issues.map((issue) => (
              <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {officialTemplate && activeView === "overview" ? (
        <section className="overflow-hidden rounded-xl border border-violet-100 bg-white shadow-sm">
          <header className="border-b border-violet-100 bg-gradient-to-b from-violet-50/60 to-white px-5 py-4">
            <h2 className="text-[15px] font-black text-slate-950">
              {visualTestComplete
                ? template.isSystem ? "Modelo oficial" : "Aprovação da nova versão oficial"
                : template.isSystem ? "Preparação do modelo oficial" : "Preparação da nova versão oficial"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {visualTestComplete
                ? "A preparação foi concluída. O modelo entra em uso após a homologação do RH."
                : "Conclua o mapeamento da IA, a validação humana e o teste visual. Cada avanço fica registrado."}
            </p>
          </header>

          <div className="px-5 py-6">
            <div className="grid grid-cols-2 gap-y-5 md:grid-cols-5">
              {officialStages.map((stage, index) => (
                <div key={stage.label} className="relative flex flex-col items-center px-1 text-center">
                  {index < officialStages.length - 1 ? (
                    <span className={`absolute left-[calc(50%+18px)] right-[calc(-50%+18px)] top-4 h-0.5 ${stage.complete ? "bg-emerald-600" : "bg-slate-200"}`} />
                  ) : null}
                  <span className={`relative z-10 grid h-9 w-9 place-items-center rounded-full text-xs font-black ${
                    stage.complete ? "bg-emerald-600 text-white" : stage.current ? "bg-violet-700 text-white shadow-[0_0_0_7px_rgba(109,40,217,.10)]" : "border-2 border-slate-200 bg-white text-slate-400"
                  }`}>
                    {stage.complete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                  </span>
                  <p className={`mt-2 text-xs font-extrabold leading-tight ${stage.current ? "text-violet-700" : stage.complete ? "text-slate-800" : "text-slate-400"}`}>{stage.label}</p>
                  <p className="mt-1 min-h-4 text-[10px] text-slate-400">{stage.meta}</p>
                  {stage.current ? <span className="mt-1 rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-violet-700">Você está aqui</span> : null}
                </div>
              ))}
            </div>
          </div>

          {!visualTestComplete && template.workflowStatus === "technical_validation" ? (
            <div className="flex flex-col gap-3 border-t border-violet-100 bg-violet-50/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black text-slate-900">
                  Continue na etapa {aiMappingComplete ? aiReviewComplete ? "3" : "2" : "1"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {aiMappingComplete
                    ? aiReviewComplete
                      ? "Gere o teste visual, confira o documento e aprove a preparação."
                      : "Revise as sugestões da IA e ajuste textos, variáveis e formatadores."
                    : "Inicie o mapeamento para a IA localizar os possíveis pontos de inserção."}
                </p>
              </div>
              {canManage ? (
                <Button className="shrink-0 gap-2 bg-violet-700 hover:bg-violet-800" disabled={aiBusy} onClick={startPreparation}>
                  {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {aiMappingComplete ? aiReviewComplete ? "Abrir teste visual" : "Revisar sugestões" : "Iniciar mapeamento"}
                </Button>
              ) : null}
            </div>
          ) : workflowAction ? (
            <div className="grid gap-5 border-t border-violet-100 bg-violet-50/40 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-violet-700">
                  Agora · {DOCUMENT_TEMPLATE_WORKFLOW_LABELS[template.workflowStatus ?? "technical_validation"]}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {template.workflowStatus === "technical_validation"
                    ? "A preparação técnica foi aprovada. Registre a evidência e envie esta versão para homologação do RH."
                    : template.workflowStatus === "legal_review"
                      ? "Esta versão veio do fluxo anterior e agora aguarda somente a homologação do RH."
                      : "Última etapa. Ao homologar, esta versão entra em uso e a anterior é substituída."}
                </p>
                <div className="mt-3 space-y-2">
                  {officialChecklist.map((item) => (
                    <div key={item.label} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2">
                      {item.kind === "human" && !template.isSystem ? (
                        <input
                          className="h-4 w-4 shrink-0 accent-violet-700"
                          type="checkbox"
                          checked={item.label.includes("Layout") ? layoutAttested : fictionalDataAttested}
                          onChange={(event) => {
                            if (item.label.includes("Layout")) setLayoutAttested(event.target.checked);
                            else setFictionalDataAttested(event.target.checked);
                          }}
                        />
                      ) : item.ok ? null : (
                        <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-bold text-slate-800">{item.label}</span>
                        <span className="block truncate text-[10px] text-slate-400">{item.evidence}</span>
                      </span>
                      <span className={`text-[10px] font-extrabold ${item.ok ? "text-emerald-700" : "text-amber-700"}`}>{item.ok ? "OK" : "Pendente"}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col border-violet-100 lg:border-l lg:pl-5">
                <label className="text-xs font-extrabold text-slate-800">
                  {awaitingRhApproval ? "Parecer da homologação do RH" : "Evidência da validação técnica"} *
                </label>
                <textarea
                  className="mt-2 min-h-24 flex-1 resize-none rounded-xl border bg-white p-3 text-xs"
                  placeholder={awaitingRhApproval
                    ? "Ex.: Versão homologada pelo RH, sem ressalvas."
                    : "Ex.: Mapeamento conferido e teste visual aprovado com dados fictícios."}
                  value={workflowNote}
                  onChange={(event) => setWorkflowNote(event.target.value)}
                />
                {template.officialCandidate && template.workflowStatus === "technical_validation" ? (
                  <Button
                    variant="outline"
                    className="mt-3 h-10 w-full gap-2 border-violet-200 text-violet-700 hover:bg-violet-50"
                    disabled={workflowBusy}
                    onClick={startPreparation}
                  >
                    <Pencil className="h-4 w-4" />
                    Voltar para edição manual
                  </Button>
                ) : null}
                <Button
                  className="mt-2 h-11 w-full gap-2 bg-violet-700 font-extrabold hover:bg-violet-800"
                  disabled={workflowBusy || !workflowCanAdvance || !workflowNote.trim() || officialChecklist.some((item) => !item.ok)}
                  onClick={() => void advanceOfficialWorkflow()}
                >
                  {workflowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {workflowAction.label}
                </Button>
                {awaitingRhApproval && canManage ? (
                  <Button
                    variant="outline"
                    className="mt-2 h-10 w-full gap-2 border-rose-200 text-rose-700 hover:bg-rose-50"
                    disabled={returningForAdjustments || !workflowNote.trim()}
                    onClick={() => void returnForAdjustments()}
                  >
                    {returningForAdjustments ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4" />}
                    Devolver para ajustes
                  </Button>
                ) : null}
                {template.contentUpdatedBy && firebaseUser?.uid === template.contentUpdatedBy ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-800">
                    Atenção: o homologador atual também participou da última edição. Esta ocorrência será registrada na auditoria.
                  </p>
                ) : null}
                <p className="mt-2 text-center text-[10px] text-slate-400">
                  {workflowAction.next === "published" ? "Publica a versão e substitui a anterior em uso" : `Avança para ${DOCUMENT_TEMPLATE_WORKFLOW_LABELS[workflowAction.next]}`}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-t border-emerald-100 bg-emerald-50 px-5 py-4 text-xs font-extrabold text-emerald-800">
              <CheckCircle2 className="h-5 w-5" />Versão homologada e publicada. A versão oficial anterior foi marcada como substituída.
            </div>
          )}
        </section>
      ) : null}

      {activeView === "history" ? (
        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <header className="border-b px-5 py-4">
            <h2 className="text-sm font-black text-slate-950">Histórico da versão</h2>
            <p className="mt-1 text-xs text-slate-500">Transições, responsáveis, decisões e ressalvas ficam preservados nesta versão.</p>
          </header>
          {(template.workflowHistory ?? []).length ? (
            <div className="divide-y">
              {[...(template.workflowHistory ?? [])].reverse().map((event, index) => (
                <div key={`${event.at ?? "event"}-${index}`} className="grid gap-2 px-5 py-4 md:grid-cols-[150px_minmax(0,1fr)_220px]">
                  <div>
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-extrabold uppercase ${
                      event.decision === "return" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
                    }`}>
                      {event.decision === "return" ? "Devolvido" : "Avançou"}
                    </span>
                    <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(event.at ?? undefined)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-900">{DOCUMENT_TEMPLATE_WORKFLOW_LABELS[event.from]} → {DOCUMENT_TEMPLATE_WORKFLOW_LABELS[event.to]}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{event.note || "Sem observação registrada."}</p>
                  </div>
                  <div className="text-xs text-slate-500">
                    <p className="font-bold text-slate-800">{event.actorName || "Usuário"}</p>
                    <p className="mt-1">{event.sameActorAsEditor ? "Também participou da edição" : "Responsável distinto da edição"}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-5 py-10 text-center text-xs text-slate-500">Nenhuma transição registrada nesta versão.</p>
          )}
        </section>
      ) : null}

      {activeView === "text" ? (
        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-black text-slate-950">
                <BookOpenText className="h-4 w-4 text-violet-700" />
                Texto integral do modelo
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Leia a matriz completa antes da geração. As variáveis aparecem destacadas, mas não são substituídas nesta visualização.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-500">
              <span>{variables.length} variável(is) · {documentTextOccurrences} ocorrência(s)</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-4 w-8 rounded border border-amber-300 bg-amber-200" />
                Variável do sistema
              </span>
            </div>
          </header>
          <div className="bg-[#f1efeb] px-3 py-6 sm:px-6 lg:px-10">
            {documentTextLoading ? (
              <div className="flex min-h-64 items-center justify-center gap-2 text-sm font-semibold text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />Carregando o texto integral...
              </div>
            ) : documentTextError ? (
              <div className="mx-auto max-w-3xl rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {documentTextError}
              </div>
            ) : documentText?.length ? (
              <article
                className="mx-auto min-h-[720px] max-w-4xl rounded-sm border border-slate-200 bg-white px-8 py-10 text-[15px] text-slate-950 shadow-[0_12px_35px_rgba(15,23,42,0.10)] sm:px-14 sm:py-14"
                style={{ fontFamily: "Cambria, Caladea, Georgia, serif" }}
              >
                {documentText.map((block) => (
                  <TemplateTextBlockView key={block.id} block={block} mapping={mapping} />
                ))}
              </article>
            ) : (
              <p className="py-16 text-center text-sm text-slate-500">O modelo não possui texto extraível.</p>
            )}
          </div>
        </section>
      ) : null}

      {contentEditable && activeView === "fields" && template.storagePath ? (
        <section id="ai-preparation-phase" className="rounded-lg border border-violet-100 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-black text-slate-900">
                <Sparkles className="h-4 w-4 text-violet-600" />
                {!aiPlan
                  ? "1. Mapeamento dos locais pela IA"
                  : aiPlan.reviewed
                    ? "Mapeamento da IA concluído"
                    : "2. Edição manual das sugestões da IA"}
              </h2>
              <p className="text-xs text-slate-500">
                {!aiPlan
                  ? "A IA identifica possíveis trechos para variáveis. Nenhuma alteração é aplicada automaticamente."
                  : aiPlan.reviewed
                    ? `${aiPlan.mappings.length} sugestão(ões) analisada(s). Continue para editar o documento ou executar o teste visual.`
                    : "Aceite ou rejeite cada sugestão. Somente a seleção confirmada será aplicada pelo motor determinístico."}
              </p>
            </div>
            {!aiPlan ? (
              <Button size="sm" variant="outline" className="h-8 border-violet-200 text-xs text-violet-700" disabled={aiBusy || aiBlocked} onClick={() => void proposeAiPlan()}>
                {aiBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                Mapear locais com IA
              </Button>
            ) : aiPlan.reviewed ? (
              <Button size="sm" className="h-8 gap-2 bg-violet-700 text-xs hover:bg-violet-800" onClick={() => setVariableWizardOpen(true)}>
                <Pencil className="h-3.5 w-3.5" />Continuar edição manual
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-slate-500" disabled={aiBusy} onClick={() => void proposeAiPlan()}>
                Refazer análise
              </Button>
            )}
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
              {!aiPlan.reviewed ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2">
                    <p className="text-xs font-bold text-violet-900">
                      A IA encontrou {aiPlan.mappings.length} possível(is) local(is); {selectedAiMappings.size} selecionado(s).
                    </p>
                    <span className="text-[10px] font-semibold text-violet-700">Baixa confiança aparece destacada em amarelo</span>
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[760px] text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                        <tr><th className="p-2">Usar</th><th className="p-2">Trecho exato</th><th className="p-2">Variável sugerida</th><th className="p-2">Ocorrências</th><th className="p-2">Confiança</th><th className="p-2">Justificativa</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {aiPlan.mappings.map((item, index) => (
                          <tr key={`${item.exactText}-${index}`} className={item.confidence < 0.75 ? "bg-amber-50" : ""}>
                            <td className="p-2"><input aria-label={`Usar sugestão ${index + 1}`} type="checkbox" checked={selectedAiMappings.has(index)} onChange={(event) => setSelectedAiMappings((current) => {
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
                      Aplicar também o formulário proposto, se ele passar na validação
                    </label>
                  ) : null}
                  <div className="flex justify-end">
                    <Button size="sm" className="gap-2 bg-violet-700 hover:bg-violet-800" disabled={aiBusy || selectedAiMappings.size === 0} onClick={() => void applyAiPlan()}>
                      {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Aplicar selecionados e editar documento
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-xs font-black text-emerald-900">Sugestões revisadas e aplicadas</p>
                    <p className="mt-0.5 text-[11px] text-emerald-700">A fase 1 terminou. Continue na edição para ajustar outros trechos e seguir ao teste visual.</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="px-4 py-5 text-xs text-slate-500">Inicie a análise para a IA indicar os possíveis locais de inserção. A fonte só será enviada após essa ação.</p>
          )}
        </section>
      ) : null}

      {contentEditable && activeView === "fields" && variableWizardOpen ? (
        <TemplateVariableWizard
          open
          onOpenChange={(open) => {
            setVariableWizardOpen(open);
            if (!open) void loadTemplate();
          }}
          templateId={template.id}
          templateName={template.name}
          getToken={token}
          onFinalized={async (nextNotice) => {
            await loadTemplate();
            setNotice(nextNotice);
          }}
        />
      ) : null}

      {activeView === "fields"
        && variables.some((key) => key.startsWith("integration.cct_") || key.startsWith("integration.union_"))
        && !variableWizardOpen ? (
          <CollectiveAgreementsPanel canManage={canManage} />
        ) : null}

      {activeView === "fields" ? <section id="template-fields-phase" className={`rounded-lg border bg-white shadow-sm ${
        variableWizardOpen || (contentEditable && !aiPlan?.reviewed) ? "hidden" : ""
      }`}>
        <header className="border-b px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-slate-900">Campos do modelo</h2>
              <p className="text-xs text-slate-500">
                {variables.length} no DOCX · {automaticVariables.length + mappableVariables.filter((key) => mapping[key]?.kind === "system").length} automáticos ·{" "}
                {manualBindings.length} preenchidos na geração ·{" "}
                {pendingCount > 0 ? <span className="font-bold text-amber-700">{pendingCount} pendente(s)</span> : <span className="font-bold text-emerald-700">todos definidos</span>}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {contentEditable && template.storagePath ? (
                <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg border-violet-200 text-xs text-violet-700" onClick={startPreparation}>
                  <Wand2 className="h-3.5 w-3.5" />Editar texto no documento
                </Button>
              ) : null}
              {contentEditable ? <Button size="sm" className="h-8 rounded-lg bg-violet-700 text-xs hover:bg-violet-800" disabled={saving} onClick={() => void saveMapping()}>
                {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Salvar mapeamento
              </Button> : null}
            </div>
          </div>
          {!contentEditable ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800">
              <Lock className="h-4 w-4" />Versão protegida. Para alterar qualquer campo, devolva para ajustes ou crie uma nova versão.
            </div>
          ) : null}
          <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input className="h-9 pl-9 text-xs" placeholder="Buscar token ou campo..." value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} />
            </div>
            <div className="flex flex-wrap gap-1">
              {([
                ["all", "Todos"],
                ["issues", `Com problema${pendingCount ? ` · ${pendingCount}` : ""}`],
                ["manual", `Manuais · ${manualBindings.length}`],
                ["automatic", "Automáticos"],
              ] as Array<[FieldFilter, string]>).map(([filter, label]) => (
                <button
                  key={filter}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${fieldFilter === filter ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-500"}`}
                  onClick={() => setFieldFilter(filter)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </header>
        <div>
          {variables.length === 0 ? <p className="px-4 py-8 text-center text-xs text-slate-500">Envie um DOCX para o sistema analisar os campos.</p> : null}
          {fieldGroups.map(([group, rows]) => (
            <div key={group} className="border-b last:border-b-0">
              <div className="bg-slate-50 px-4 py-2 text-[10px] font-extrabold uppercase tracking-[0.07em] text-slate-500">
                {group} · {rows.length}
              </div>
              <div className="divide-y">
                {rows.map((row) => {
                  const binding = row.binding;
                  const directAutomatic = isDocumentVariableKey(row.key);
                  const suggestion = suggestions[row.key];
                  const expanded = expandedFields.has(row.key);
                  const sourceKey = binding?.kind === "system" ? binding.key : row.key;
                  const sensitive = CATALOG_ENTRIES.get(sourceKey)?.sensitive === true;
                  const origin = directAutomatic || binding?.kind === "system"
                    ? "Sistema"
                    : binding?.kind === "manual" ? "Na geração" : "Pendente";
                  return (
                    <div key={row.key}>
                      <button
                        className={`grid w-full items-center gap-3 px-4 py-3 text-left md:grid-cols-[minmax(190px,0.8fr)_minmax(180px,1fr)_110px_minmax(180px,0.8fr)_24px] ${
                          row.pending ? "bg-amber-50/50" : "hover:bg-slate-50"
                        }`}
                        disabled={directAutomatic || !contentEditable}
                        onClick={() => toggleField(row.key)}
                      >
                        <code className="truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{`{{${row.key}}}`}</code>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold text-slate-800">{row.label}</span>
                          <span className="block truncate text-[10px] text-slate-400">{fieldOutputSample(row.key, binding)}</span>
                        </span>
                        <span className={`w-fit rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase ${
                          row.pending ? "bg-amber-100 text-amber-800" : row.manual ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"
                        }`}>{origin}</span>
                        <span className="flex items-center gap-1 text-[10px] text-slate-500">
                          {sensitive ? <span className="rounded-full bg-rose-50 px-2 py-0.5 font-extrabold text-rose-700">LGPD</span> : null}
                          {binding?.kind === "manual" && binding.required ? "Obrigatório" : binding?.kind === "system" && binding.required !== false ? "Obrigatório" : ""}
                        </span>
                        {row.pending ? <CircleAlert className="h-4 w-4 text-amber-600" /> : !directAutomatic && contentEditable ? (
                          expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />
                        ) : <Lock className="h-3.5 w-3.5 text-slate-300" />}
                      </button>
                      {expanded && contentEditable && !directAutomatic ? (
                        <div className="border-t bg-[#fbfaf8] px-4 py-4">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <select
                              className="h-8 rounded-md border bg-white px-2 text-xs"
                              value={binding ? binding.kind : ""}
                              onChange={(event) => {
                                const kind = event.target.value;
                                if (kind === "system") setBinding(row.key, { kind: "system", key: suggestion ?? "" });
                                else if (kind === "manual") setBinding(row.key, { kind: "manual", label: row.key, format: "text", required: true });
                                else setBinding(row.key, null);
                              }}
                            >
                              <option value="">A definir...</option>
                              <option value="system">Campo do sistema</option>
                              <option value="manual">Preencher na geração</option>
                            </select>
                            {!binding && suggestion ? (
                              <button className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700" onClick={() => setBinding(row.key, { kind: "system", key: suggestion })}>
                                <Sparkles className="h-3 w-3" />Usar sugestão: {CATALOG_LABELS.get(suggestion) ?? suggestion}
                              </button>
                            ) : null}
                          </div>
                          {binding?.kind === "system" ? (
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_180px]">
                              <SystemKeySelect value={binding.key} onChange={(next) => setBinding(row.key, { ...binding, key: next })} />
                              <select
                                className="h-9 w-full rounded-md border bg-white px-2 text-xs"
                                value={binding.formatter ?? "source"}
                                onChange={(event) => {
                                  const formatter = event.target.value as DocumentOutputFormatter;
                                  setBinding(row.key, { ...binding, formatter: formatter === "source" ? undefined : formatter });
                                }}
                              >
                                {DOCUMENT_OUTPUT_FORMATTERS.map((formatter) => <option key={formatter} value={formatter}>{OUTPUT_FORMATTER_LABELS[formatter]}</option>)}
                              </select>
                              <label className="flex items-center gap-2 rounded-lg border bg-white px-3 text-xs font-semibold text-slate-700">
                                <input className="h-4 w-4 accent-violet-700" type="checkbox" checked={binding.required !== false} onChange={(event) => setBinding(row.key, { ...binding, required: event.target.checked })} />
                                Bloquear se vazio
                              </label>
                            </div>
                          ) : null}
                          {binding?.kind === "manual" ? <ManualFieldEditor binding={binding} onChange={(next) => setBinding(row.key, next)} /> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {variables.length > 0 && fieldGroups.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-slate-500">Nenhum campo corresponde ao filtro selecionado.</p>
          ) : null}
        </div>
      </section> : null}

      {activeView === "generated" ? <section className="rounded-lg border bg-white shadow-sm">
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
      </section> : null}

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

    </div>
  );
}
