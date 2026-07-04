"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BadgeCheck,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Copy,
  Camera,
  FileText,
  Flag,
  Folder,
  FolderKanban,
  Gauge,
  HeartPulse,
  Home,
  Landmark,
  Layers3,
  Lock,
  MapPin,
  Megaphone,
  Package,
  Pencil,
  Plus,
  Save,
  Shield,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Thermometer,
  Trash2,
  Truck,
  Utensils,
  Users,
  UserCheck,
  WalletCards,
  Warehouse,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";

import type { FormExecution, FormProject, FormTemplate, FormType } from "@/types/forms";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { FormsAnalyticsOverview } from "@/components/forms/analytics-overview";
import { FormsAnalyticsTaxonomyManager } from "@/components/forms/analytics-taxonomy-manager";
import { RetentionPolicyManager } from "@/components/forms/retention-policy-manager";
import {
  anonymizeDueAnalyticsOccurrences,
  backfillAnalyticsRetention,
  createFormModel,
  createFormProject,
  createFormTemplate,
  createFormType,
  deleteFormModel,
  deleteFormProject,
  executeAnalyticsReprocess,
  fetchFormModels,
  fetchFormsBootstrap,
  recomputeAnalyticsAggregates,
  runFormsScheduler,
  simulateAnalyticsReprocess,
  updateFormModel,
  updateFormTemplateApplication,
  updateFormProject,
  type AnalyticsSimulationReport,
} from "@/features/forms/lib/client";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const OCCURRENCE_LABELS: Record<string, string> = {
  manual: "Manual",
  daily: "Diário",
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
  annual: "Anual",
  custom: "Personalizado",
};

const APPLICATION_MODE_LABELS: Record<string, string> = {
  manual: "Manual",
  unit: "Por unidade",
  schedule: "Por escala/turno",
  event: "Evento do sistema",
};

const PROJECT_COLOR_PRESETS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#0ea5e9",
  "#14b8a6",
  "#84cc16",
  "#eab308",
  "#f97316",
  "#ec4899",
  "#d946ef",
  "#06b6d4",
  "#3b82f6",
  "#64748b",
  "#111827",
  "#92400e",
  "#be123c",
];

const PROJECT_ICON_PRESETS = [
  { value: "clipboard", icon: ClipboardList },
  { value: "building", icon: Building2 },
  { value: "store", icon: Store },
  { value: "warehouse", icon: Warehouse },
  { value: "home", icon: Home },
  { value: "shield", icon: Shield },
  { value: "thermometer", icon: Thermometer },
  { value: "zap", icon: Zap },
  { value: "checklist", icon: CheckSquare },
  { value: "flag", icon: Flag },
  { value: "camera", icon: Camera },
  { value: "wallet", icon: WalletCards },
  { value: "users", icon: Users },
  { value: "folder", icon: Folder },
  { value: "package", icon: Package },
  { value: "boxes", icon: Boxes },
  { value: "truck", icon: Truck },
  { value: "wrench", icon: Wrench },
  { value: "sparkles", icon: Sparkles },
  { value: "shirt", icon: Shirt },
  { value: "badge-check", icon: BadgeCheck },
  { value: "landmark", icon: Landmark },
  { value: "workflow", icon: Workflow },
  { value: "shopping-bag", icon: ShoppingBag },
  { value: "shopping-cart", icon: ShoppingCart },
  { value: "utensils", icon: Utensils },
  { value: "gauge", icon: Gauge },
  { value: "heart-pulse", icon: HeartPulse },
  { value: "megaphone", icon: Megaphone },
  { value: "bell", icon: Bell },
  { value: "calendar", icon: CalendarDays },
] as const;

const DEFAULT_FORM_MODELS = [
  {
    id: "opening-checklist",
    name: "Checklist de abertura",
    description: "Perguntas gerais para abertura de loja, quiosque ou operação.",
    sections: [
      {
        id: "opening-structure",
        title: "Preparação da operação",
        items: [
          { id: "opening-clean-area", title: "Área de atendimento limpa e organizada", type: "checkbox" },
          { id: "opening-front-photo", title: "Registrar foto da fachada ou balcão", type: "photo" },
          { id: "opening-cash", title: "Conferir abertura de caixa", type: "yes_no" },
          { id: "opening-equipment", title: "Equipamentos ligados e funcionando", type: "checkbox" },
        ],
      },
      {
        id: "opening-compliance",
        title: "Conformidade inicial",
        items: [
          { id: "opening-temperature", title: "Temperatura inicial dentro do padrão", type: "temperature" },
          { id: "opening-stock", title: "Produtos essenciais disponíveis", type: "yes_no" },
          { id: "opening-uniform", title: "Equipe uniformizada", type: "checkbox" },
        ],
      },
    ],
  },
  {
    id: "temperature-control",
    name: "Controle de temperatura",
    description: "Registro recorrente de temperatura com tolerância e ação corretiva.",
    sections: [
      {
        id: "temperature-records",
        title: "Medições",
        items: [
          { id: "temperature-freezer", title: "Temperatura do freezer", type: "temperature" },
          { id: "temperature-fridge", title: "Temperatura da geladeira", type: "temperature" },
          { id: "temperature-action", title: "Alguma medida corretiva foi necessária?", type: "yes_no" },
        ],
      },
    ],
  },
  {
    id: "cleaning-audit",
    name: "Auditoria de limpeza",
    description: "Verificação de limpeza com evidência fotográfica.",
    sections: [
      {
        id: "cleaning-areas",
        title: "Áreas auditadas",
        items: [
          { id: "cleaning-counter", title: "Balcão limpo", type: "checkbox" },
          { id: "cleaning-floor", title: "Piso limpo e seco", type: "checkbox" },
          { id: "cleaning-photo", title: "Foto da área auditada", type: "photo" },
          { id: "cleaning-notes", title: "Observações da auditoria", type: "text" },
        ],
      },
    ],
  },
] as const;

type UiFormModel = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  context?: "operational" | "recruitment";
  is_active?: boolean;
  sections: Array<{
    id: string;
    title: string;
    order?: number;
    items: Array<{
      id: string;
      title: string;
      type: string;
      required?: boolean;
      weight?: number;
      block_next?: boolean;
      criticality?: "low" | "medium" | "high" | "critical";
      action_required?: boolean;
    }>;
  }>;
};

const FORM_ITEM_TYPE_OPTIONS = [
  { value: "checkbox", label: "Checkbox" },
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "temperature", label: "Temperatura" },
  { value: "yes_no", label: "Sim/não" },
  { value: "select", label: "Seleção" },
  { value: "multi_select", label: "Múltipla seleção" },
  { value: "photo", label: "Foto" },
  { value: "signature", label: "Assinatura" },
  { value: "date", label: "Data" },
  { value: "file_upload", label: "Arquivo" },
  { value: "location", label: "Localização" },
] as const;

type FormItemTypeValue = (typeof FORM_ITEM_TYPE_OPTIONS)[number]["value"];

type ModelFormItemState = {
  id: string;
  title: string;
  type: FormItemTypeValue;
};

type ModelFormSectionState = {
  id: string;
  title: string;
  items: ModelFormItemState[];
};

type ModelFormState = {
  name: string;
  description: string;
  category: string;
  context: "operational" | "recruitment";
  sections: ModelFormSectionState[];
};

type ModelDialogMode = "create" | "edit" | "customize";

const STATUS_META: Record<
  FormExecution["status"],
  { label: string; className: string; tone: "amber" | "blue" | "emerald" | "red" | "slate" }
> = {
  pending: {
    label: "Pendente",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    tone: "amber",
  },
  in_progress: {
    label: "Em andamento",
    className: "border-blue-200 bg-blue-50 text-blue-700",
    tone: "blue",
  },
  completed: {
    label: "Concluída",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    tone: "emerald",
  },
  overdue: {
    label: "Atrasada",
    className: "border-red-200 bg-red-50 text-red-700",
    tone: "red",
  },
  canceled: {
    label: "Cancelada",
    className: "border-slate-200 bg-slate-100 text-slate-600",
    tone: "slate",
  },
};

function getExecutionStatusMeta(status: FormExecution["status"]) {
  return STATUS_META[status] ?? STATUS_META.pending;
}

function getProjectIcon(iconValue?: string) {
  return PROJECT_ICON_PRESETS.find((entry) => entry.value === iconValue)?.icon ?? ClipboardList;
}

function countTemplateItems(template: FormTemplate) {
  return template.sections.reduce((total, section) => total + section.items.length, 0);
}

function formatOccurrence(value?: string) {
  if (!value) return "Manual";
  return OCCURRENCE_LABELS[value] ?? value;
}

function inferApplicationMode(template: FormTemplate) {
  if ((template.shift_definition_ids?.length ?? 0) > 0) return "schedule";
  if ((template.unit_ids?.length ?? 0) > 0) return "unit";
  if (template.occurrence_type === "manual") return "manual";
  return "unit";
}

function formatApplicationMode(template: FormTemplate) {
  return APPLICATION_MODE_LABELS[inferApplicationMode(template)] ?? "Manual";
}

function formatTemplateScope(template: FormTemplate) {
  const units = template.unit_names?.length || template.unit_ids?.length || 0;
  const shifts = template.shift_definition_names?.length || template.shift_definition_ids?.length || 0;
  const roles = template.job_role_names?.length || template.job_role_ids?.length || 0;
  const functions = template.job_function_names?.length || template.job_function_ids?.length || 0;
  const parts = [];

  if (units > 0) parts.push(`${units} unidade(s)`);
  if (shifts > 0) parts.push(`${shifts} período(s)`);
  if (roles + functions > 0) parts.push(`${roles + functions} cargo(s)/função(ões)`);

  return parts.length > 0 ? parts.join(" · ") : "Sem vínculo automático";
}

function formatDateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(start: unknown, end: unknown) {
  if (!start || !end) return "—";
  const startDate = new Date(String(start));
  const endDate = new Date(String(end));
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "—";
  const minutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}min` : `${hours}h`;
}

function formatRelative(value: unknown) {
  if (!value) return "Sem histórico";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(diffMs) / 60000);
  if (absMinutes < 1) return "agora";
  if (absMinutes < 60) return `${absMinutes} min ${diffMs < 0 ? "atrás" : "à frente"}`;
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return `${absHours} h ${diffMs < 0 ? "atrás" : "à frente"}`;
  const absDays = Math.round(absHours / 24);
  return `${absDays} dia(s) ${diffMs < 0 ? "atrás" : "à frente"}`;
}

function makeDraftId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeItemType(value?: string): FormItemTypeValue {
  return FORM_ITEM_TYPE_OPTIONS.some((option) => option.value === value)
    ? (value as FormItemTypeValue)
    : "text";
}

function createDefaultModelItem(): ModelFormItemState {
  return {
    id: makeDraftId("item"),
    title: "Nova pergunta",
    type: "text",
  };
}

function createDefaultModelSection(): ModelFormSectionState {
  return {
    id: makeDraftId("section"),
    title: "Seção principal",
    items: [createDefaultModelItem()],
  };
}

function createEmptyModelForm(): ModelFormState {
  return {
    name: "",
    description: "",
    category: "",
    context: "operational",
    sections: [createDefaultModelSection()],
  };
}

function modelToFormState(model: UiFormModel, mode: ModelDialogMode): ModelFormState {
  return {
    name: mode === "customize" ? `${model.name} personalizado` : model.name,
    description: model.description ?? "",
    category: model.category ?? "",
    context: model.context ?? "operational",
    sections:
      model.sections.length > 0
        ? model.sections.map((section) => ({
            id: section.id || makeDraftId("section"),
            title: section.title,
            items:
              section.items.length > 0
                ? section.items.map((item) => ({
                    id: item.id || makeDraftId("item"),
                    title: item.title,
                    type: normalizeItemType(item.type),
                  }))
                : [createDefaultModelItem()],
          }))
        : [createDefaultModelSection()],
  };
}

function isModelFormInvalid(modelForm: ModelFormState) {
  return (
    modelForm.name.trim().length < 2 ||
    modelForm.sections.length === 0 ||
    modelForm.sections.some(
      (section) =>
        section.title.trim().length === 0 ||
        section.items.length === 0 ||
        section.items.some((item) => item.title.trim().length < 2)
    )
  );
}

function KpiCard({
  label,
  value,
  subtitle,
  tone,
  unit,
}: {
  label: string;
  value: number;
  subtitle: string;
  tone: "amber" | "blue" | "emerald" | "red" | "purple";
  unit?: string;
}) {
  const toneMeta = {
    amber: {
      accent: "bg-amber-500",
      icon: Clock,
      iconWrap: "border-amber-100 bg-amber-50 text-amber-700",
      value: "text-amber-700",
    },
    blue: {
      accent: "bg-blue-500",
      icon: UserCheck,
      iconWrap: "border-blue-100 bg-blue-50 text-blue-700",
      value: "text-blue-700",
    },
    emerald: {
      accent: "bg-emerald-500",
      icon: CheckSquare,
      iconWrap: "border-emerald-100 bg-emerald-50 text-emerald-700",
      value: "text-emerald-700",
    },
    red: {
      accent: "bg-rose-500",
      icon: CalendarClock,
      iconWrap: "border-rose-100 bg-rose-50 text-rose-700",
      value: "text-rose-700",
    },
    purple: {
      accent: "bg-violet-500",
      icon: BarChart3,
      iconWrap: "border-violet-100 bg-violet-50 text-violet-700",
      value: "text-violet-700",
    },
  }[tone];
  const Icon = toneMeta.icon;

  return (
    <Card className="relative overflow-hidden border-slate-200 bg-white shadow-sm">
      <div className={cn("absolute inset-x-0 top-0 h-1", toneMeta.accent)} />
      <CardContent className="flex min-h-[116px] flex-col justify-between gap-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase leading-none tracking-[0.12em] text-muted-foreground">
              {label}
            </p>
            <p className={cn("mt-3 flex items-baseline gap-1 text-3xl font-semibold leading-none tabular-nums", toneMeta.value)}>
              <span>{value}</span>
              {unit ? <span className="text-sm font-medium text-muted-foreground">{unit}</span> : null}
            </p>
          </div>
          <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border", toneMeta.iconWrap)}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function getModelVisual(modelId: string, index: number) {
  if (modelId.includes("temperature")) {
    return { className: "bg-amber-500 text-white", icon: CalendarClock };
  }
  if (modelId.includes("cleaning") || modelId.includes("audit")) {
    return { className: "bg-emerald-500 text-white", icon: ClipboardCheck };
  }
  const fallbacks = [
    { className: "bg-indigo-500 text-white", icon: ClipboardList },
    { className: "bg-sky-500 text-white", icon: Layers3 },
    { className: "bg-rose-500 text-white", icon: FileText },
  ];
  return fallbacks[index % fallbacks.length];
}

type TemplateDialogSource = "blank" | "model" | "duplicate";

type TemplateFormState = {
  source: TemplateDialogSource;
  model_id: string;
  duplicate_template_id: string;
  form_project_id: string;
  form_type_id: string;
  name: string;
  description: string;
  context: string;
  occurrence_type: string;
  application_mode: string;
  unit_ids: string[];
  shift_definition_ids: string[];
  section_title: string;
  item_title: string;
  item_type: string;
  selected_model_item_ids: string[];
};

export function FormsDashboardShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { firebaseUser } = useAuth();
  const { units, shiftDefinitions } = useDPBootstrap();
  const { toast } = useToast();
  const [projects, setProjects] = useState<FormProject[]>([]);
  const [formTypes, setFormTypes] = useState<FormType[]>([]);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [templateOptions, setTemplateOptions] = useState<FormTemplate[]>([]);
  const [executions, setExecutions] = useState<FormExecution[]>([]);
  const [models, setModels] = useState<UiFormModel[]>([]);
  const [canCreateProjects, setCanCreateProjects] = useState(false);
  const [canManageTemplates, setCanManageTemplates] = useState(false);
  const [canViewAnalytics, setCanViewAnalytics] = useState(false);
  const [canReprocessAnalytics, setCanReprocessAnalytics] = useState(false);
  const [canManageTaxonomy, setCanManageTaxonomy] = useState(false);
  const [canResolveOccurrences, setCanResolveOccurrences] = useState(false);
  const [canValidateResolution, setCanValidateResolution] = useState(false);
  const [canManageRetentionPolicy, setCanManageRetentionPolicy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [subprojectDialogOpen, setSubprojectDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [projectDeleteTarget, setProjectDeleteTarget] = useState<FormProject | null>(null);
  const [modelArchiveTarget, setModelArchiveTarget] = useState<UiFormModel | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [projectsInitialized, setProjectsInitialized] = useState(false);
  const [editingProject, setEditingProject] = useState<FormProject | null>(null);
  const [modelDialogMode, setModelDialogMode] = useState<ModelDialogMode>("create");
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [saving, setSaving] = useState<"project" | "template" | "deleteProject" | "scheduler" | "model" | "archiveModel" | null>(null);
  const [analyticsOperation, setAnalyticsOperation] = useState<
    "simulate" | "execute" | "recompute" | "backfill" | "anonymize" | null
  >(null);
  const [analyticsFilters, setAnalyticsFilters] = useState(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      projectId: "all",
      templateId: "all",
      retentionDays: "365",
      batchLimit: "200",
    };
  });
  const [analyticsSimulation, setAnalyticsSimulation] = useState<{
    simulation: AnalyticsSimulationReport;
    simulatedAt: string;
    scope: {
      execution_ids: string[];
      execution_count: number;
      workspace_timezone: string;
      fromLocalDate: string;
      toLocalDate: string;
    };
  } | null>(null);
  const [analyticsLastResult, setAnalyticsLastResult] = useState<string | null>(null);
  const [projectForm, setProjectForm] = useState({
    name: "",
    description: "",
    color: "",
    icon: "clipboard",
  });
  const [modelForm, setModelForm] = useState<ModelFormState>(() => createEmptyModelForm());
  const [subprojectForm, setSubprojectForm] = useState({
    form_project_id: "",
    name: "",
    description: "",
  });
  const [templateForm, setTemplateForm] = useState<TemplateFormState>({
    source: "blank",
    model_id: "",
    duplicate_template_id: "",
    form_project_id: "",
    form_type_id: "",
    name: "",
    description: "",
    context: "operational",
    occurrence_type: "manual",
    application_mode: "manual",
    unit_ids: [],
    shift_definition_ids: [],
    section_title: "Seção principal",
    item_title: "Novo item",
    item_type: "text",
    selected_model_item_ids: [] as string[],
  });
  const defaultTab = searchParams.get("tab") === "models" ? "models" : searchParams.get("tab") === "templates" ? "templates" : "operations";
  const ProjectIcon = getProjectIcon(projectForm.icon);

  const templatesByProject = useMemo(() => {
    return templates.reduce<Record<string, FormTemplate[]>>((accumulator, template) => {
      const key = template.form_project_id;
      accumulator[key] ??= [];
      accumulator[key].push(template);
      return accumulator;
    }, {});
  }, [templates]);

  const subprojectsByProject = useMemo(() => {
    return formTypes.reduce<Record<string, FormType[]>>((accumulator, type) => {
      const key = type.form_project_id;
      accumulator[key] ??= [];
      accumulator[key].push(type);
      return accumulator;
    }, {});
  }, [formTypes]);

  const templatesBySubproject = useMemo(() => {
    return templates.reduce<Record<string, FormTemplate[]>>((accumulator, template) => {
      const key = template.form_type_id || "manual";
      accumulator[key] ??= [];
      accumulator[key].push(template);
      return accumulator;
    }, {});
  }, [templates]);

  const executionsByProject = useMemo(() => {
    return executions.reduce<Record<string, FormExecution[]>>((accumulator, execution) => {
      const key = execution.form_project_id;
      accumulator[key] ??= [];
      accumulator[key].push(execution);
      return accumulator;
    }, {});
  }, [executions]);

  const stats = useMemo(() => {
    const completedDurations = executions
      .filter((execution) => execution.status === "completed" && execution.completed_at)
      .map((execution) => {
        const start = new Date(String(execution.claimed_at ?? execution.created_at));
        const end = new Date(String(execution.completed_at));
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
        return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
      })
      .filter((duration): duration is number => typeof duration === "number");

    return {
      pending: executions.filter((execution) => execution.status === "pending").length,
      inProgress: executions.filter((execution) => execution.status === "in_progress").length,
      completed: executions.filter((execution) => execution.status === "completed").length,
      overdue: executions.filter((execution) => execution.status === "overdue").length,
      averageDuration:
        completedDurations.length === 0
          ? 0
          : Math.round(completedDurations.reduce((sum, duration) => sum + duration, 0) / completedDurations.length),
    };
  }, [executions]);

  const availableModels = useMemo(() => {
    const defaultModels = DEFAULT_FORM_MODELS.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      context: "operational" as const,
      is_active: true,
      sections: model.sections.map((section) => ({
        id: section.id,
        title: section.title,
        items: section.items.map((item) => ({
          id: item.id,
          title: item.title,
          type: item.type,
        })),
      })),
    }));
    const storedModelIds = new Set(models.map((model) => model.id));
    return [
      ...models,
      ...defaultModels.filter((model) => !storedModelIds.has(model.id)),
    ];
  }, [models]);

  const selectedModel = useMemo(() => {
    return availableModels.find((model) => model.id === templateForm.model_id) ?? availableModels[0];
  }, [availableModels, templateForm.model_id]);

  const selectedModelItemIds = useMemo(() => {
    return new Set(templateForm.selected_model_item_ids);
  }, [templateForm.selected_model_item_ids]);

  const selectedModelTotalItems = useMemo(() => {
    return selectedModel?.sections.reduce((total, section) => total + section.items.length, 0) ?? 0;
  }, [selectedModel]);

  const selectedDuplicateTemplate = useMemo(() => {
    return templateOptions.find((template) => template.id === templateForm.duplicate_template_id) ?? null;
  }, [templateForm.duplicate_template_id, templateOptions]);

  const sortedTemplateOptions = useMemo(() => {
    return [...templateOptions].sort((left, right) => {
      if (left.is_active !== right.is_active) return left.is_active ? -1 : 1;
      return String(left.name).localeCompare(String(right.name), "pt-BR");
    });
  }, [templateOptions]);

  const projectSummaries = useMemo(() => {
    return projects.map((project) => {
      const projectTemplates = templatesByProject[project.id] ?? [];
      const projectExecutions = executionsByProject[project.id] ?? [];
      const projectSubprojects = subprojectsByProject[project.id] ?? [];
      return {
        project,
        subprojects: projectSubprojects,
        templates: projectTemplates,
        executions: projectExecutions,
        items: projectTemplates.reduce((total, template) => total + countTemplateItems(template), 0),
        completionRate:
          projectExecutions.length === 0
            ? 0
            : Math.round(
                (projectExecutions.filter((execution) => execution.status === "completed").length /
                  projectExecutions.length) *
                  100
              ),
      };
    });
  }, [executionsByProject, projects, subprojectsByProject, templatesByProject]);

  const dailyCompletionBuckets = useMemo(() => {
    const today = new Date();
    const buckets = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (13 - index));
      return {
        key: date.toISOString().slice(0, 10),
        label: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date),
        total: 0,
      };
    });
    const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    executions.forEach((execution) => {
      if (execution.status !== "completed" || !execution.completed_at) return;
      const key = new Date(String(execution.completed_at)).toISOString().slice(0, 10);
      const bucket = byKey.get(key);
      if (bucket) bucket.total += 1;
    });
    return buckets;
  }, [executions]);

  const unitRankings = useMemo(() => {
    const byUnit = new Map<string, { name: string; total: number; completed: number }>();
    executions.forEach((execution) => {
      const key = execution.unit_id || execution.unit_name || "sem-unidade";
      const current = byUnit.get(key) ?? {
        name: execution.unit_name || execution.unit_id || "Sem unidade",
        total: 0,
        completed: 0,
      };
      current.total += 1;
      if (execution.status === "completed") current.completed += 1;
      byUnit.set(key, current);
    });
    return Array.from(byUnit.values())
      .map((entry) => ({
        ...entry,
        rate: entry.total === 0 ? 0 : Math.round((entry.completed / entry.total) * 100),
      }))
      .sort((left, right) => right.rate - left.rate)
      .slice(0, 5);
  }, [executions]);

  useEffect(() => {
    if (!projectsInitialized && projects.length > 0) {
      setExpandedProjectIds([projects[0].id]);
      setProjectsInitialized(true);
    }
  }, [projects, projectsInitialized]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [data, modelsPayload] = await Promise.all([
          fetchFormsBootstrap(firebaseUser),
          fetchFormModels(firebaseUser).catch(() => ({ models: [] })),
        ]);
        if (!cancelled) {
          setProjects(data.projects);
          setFormTypes(data.types ?? []);
          setTemplates(data.templates);
          setTemplateOptions(data.template_options ?? data.templates);
          setExecutions(data.executions);
          setModels(modelsPayload.models as UiFormModel[]);
          setCanCreateProjects(data.access.can_create_projects);
          setCanManageTemplates(data.access.can_manage_templates);
          setCanViewAnalytics(data.access.can_view_analytics);
          setCanReprocessAnalytics(data.access.can_reprocess_occurrences);
          setCanManageRetentionPolicy(data.access.can_manage_retention_policy);
          setCanManageTaxonomy(data.access.can_manage_analytics_taxonomy);
          setCanResolveOccurrences(data.access.can_resolve_occurrences);
          setCanValidateResolution(data.access.can_validate_occurrence_resolution);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Falha ao carregar formulários."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  function resetProjectForm() {
    setProjectForm({ name: "", description: "", color: "", icon: "clipboard" });
    setEditingProject(null);
  }

  function openCreateProjectDialog() {
    resetProjectForm();
    setProjectDialogOpen(true);
  }

  function openEditProjectDialog(project: FormProject) {
    setEditingProject(project);
    setProjectForm({
      name: project.name,
      description: project.description ?? "",
      color: project.color ?? "",
      icon: project.icon ?? "clipboard",
    });
    setProjectDialogOpen(true);
  }

  function isStoredModel(modelId: string) {
    return models.some((model) => model.id === modelId);
  }

  function openCreateModelDialog() {
    setModelDialogMode("create");
    setEditingModelId(null);
    setModelForm(createEmptyModelForm());
    setModelDialogOpen(true);
  }

  function openEditModelDialog(model: UiFormModel) {
    const stored = isStoredModel(model.id);
    setModelDialogMode(stored ? "edit" : "customize");
    setEditingModelId(stored ? model.id : null);
    setModelForm(modelToFormState(model, stored ? "edit" : "customize"));
    setModelDialogOpen(true);
  }

  function updateModelSection(sectionId: string, patch: Partial<ModelFormSectionState>) {
    setModelForm((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section
      ),
    }));
  }

  function addModelSection() {
    setModelForm((current) => ({
      ...current,
      sections: [...current.sections, createDefaultModelSection()],
    }));
  }

  function removeModelSection(sectionId: string) {
    setModelForm((current) => ({
      ...current,
      sections:
        current.sections.length <= 1
          ? current.sections
          : current.sections.filter((section) => section.id !== sectionId),
    }));
  }

  function updateModelItem(
    sectionId: string,
    itemId: string,
    patch: Partial<ModelFormItemState>
  ) {
    setModelForm((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: section.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item
              ),
            }
          : section
      ),
    }));
  }

  function addModelItem(sectionId: string) {
    setModelForm((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? { ...section, items: [...section.items, createDefaultModelItem()] }
          : section
      ),
    }));
  }

  function removeModelItem(sectionId: string, itemId: string) {
    setModelForm((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items:
                section.items.length <= 1
                  ? section.items
                  : section.items.filter((item) => item.id !== itemId),
            }
          : section
      ),
    }));
  }

  function buildModelPayload() {
    return {
      name: modelForm.name.trim(),
      description: modelForm.description.trim() || undefined,
      category: modelForm.category.trim() || undefined,
      context: modelForm.context,
      is_active: true,
      sections: modelForm.sections.map((section, sectionIndex) => ({
        id: section.id,
        title: section.title.trim(),
        order: sectionIndex,
        items: section.items.map((item, itemIndex) => ({
          id: item.id,
          order: itemIndex,
          title: item.title.trim(),
          type: item.type,
          required: true,
          weight: 1,
          block_next: false,
          criticality: "medium",
          action_required: item.type === "temperature" || item.type === "yes_no",
        })),
      })),
    };
  }

  function toggleProject(projectId: string) {
    setExpandedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  }

  function selectAllModelItems(modelId = templateForm.model_id) {
    const model = availableModels.find((entry) => entry.id === modelId);
    const itemIds = model?.sections.flatMap((section) => section.items.map((item) => item.id)) ?? [];
    setTemplateForm((current) => ({ ...current, selected_model_item_ids: itemIds }));
  }

  function toggleModelSection(sectionId: string, checked: boolean) {
    const section = selectedModel?.sections.find((entry) => entry.id === sectionId);
    if (!section) return;
    const sectionItemIds = section.items.map((item) => item.id);

    setTemplateForm((current) => {
      const next = new Set(current.selected_model_item_ids);
      sectionItemIds.forEach((itemId) => {
        if (checked) next.add(itemId);
        else next.delete(itemId);
      });
      return { ...current, selected_model_item_ids: Array.from(next) };
    });
  }

  function toggleModelItem(itemId: string, checked: boolean) {
    setTemplateForm((current) => {
      const next = new Set(current.selected_model_item_ids);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return { ...current, selected_model_item_ids: Array.from(next) };
    });
  }

  function toggleTemplateArrayField(field: "unit_ids" | "shift_definition_ids", value: string, checked: boolean) {
    setTemplateForm((current) => {
      const next = new Set(current[field]);
      if (checked) next.add(value);
      else next.delete(value);
      return { ...current, [field]: Array.from(next) };
    });
  }

  function buildTemplateSections() {
    if (templateForm.source === "model" && selectedModel) {
      const selectedIds = selectedModelItemIds;
      const sections = selectedModel.sections
        .map((section, sectionIndex) => ({
          id: section.id,
          title: section.title,
          order: sectionIndex,
          items: section.items
            .filter((item) => selectedIds.has(item.id))
            .map((item, itemIndex) => ({
              id: item.id,
              order: itemIndex,
              title: item.title,
              type: item.type,
              required: true,
              weight: 1,
              block_next: false,
              criticality: "medium",
              action_required: item.type === "temperature" || item.type === "yes_no",
            })),
        }))
        .filter((section) => section.items.length > 0);

      return sections.length > 0 ? sections : undefined;
    }

    if (templateForm.source === "duplicate" && selectedDuplicateTemplate) {
      return selectedDuplicateTemplate.sections.map((section, sectionIndex) => ({
        ...section,
        id: `${section.id}-copy-${Date.now()}`,
        order: sectionIndex,
        items: section.items.map((item, itemIndex) => ({
          ...item,
          id: `${item.id}-copy-${itemIndex}`,
          order: itemIndex,
        })),
      }));
    }

    return [
      {
        id: "section-1",
        title: templateForm.section_title,
        order: 0,
        items: [
          {
            id: "item-1",
            order: 0,
            title: templateForm.item_title,
            type: templateForm.item_type,
            required: true,
            weight: 1,
            block_next: false,
            criticality: "medium",
          },
        ],
      },
    ];
  }

  async function reloadBootstrap() {
    if (!firebaseUser) return;
    const data = await fetchFormsBootstrap(firebaseUser);
    const modelsPayload = await fetchFormModels(firebaseUser).catch(() => ({ models: [] }));
    setProjects(data.projects);
    setFormTypes(data.types ?? []);
    setTemplates(data.templates);
    setTemplateOptions(data.template_options ?? data.templates);
    setExecutions(data.executions);
    setModels(modelsPayload.models as UiFormModel[]);
    setCanCreateProjects(data.access.can_create_projects);
    setCanManageTemplates(data.access.can_manage_templates);
    setCanViewAnalytics(data.access.can_view_analytics);
    setCanReprocessAnalytics(data.access.can_reprocess_occurrences);
    setCanManageRetentionPolicy(data.access.can_manage_retention_policy);
    setCanManageTaxonomy(data.access.can_manage_analytics_taxonomy);
    setCanResolveOccurrences(data.access.can_resolve_occurrences);
    setCanValidateResolution(data.access.can_validate_occurrence_resolution);
  }

  async function handleSaveProject() {
    if (!firebaseUser) return;

    try {
      setSaving("project");
      if (editingProject) {
        await updateFormProject(firebaseUser, editingProject.id, {
          name: projectForm.name,
          description: projectForm.description,
          color: projectForm.color,
          icon: projectForm.icon,
          is_active: true,
          members: editingProject.members ?? [],
        });
      } else {
        await createFormProject(firebaseUser, {
          name: projectForm.name,
          description: projectForm.description,
          color: projectForm.color,
          icon: projectForm.icon,
          is_active: true,
          members: [],
        });
      }

      await reloadBootstrap();
      setProjectDialogOpen(false);
      resetProjectForm();
      toast({ title: editingProject ? "Projeto atualizado" : "Projeto criado" });
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: saveError instanceof Error ? saveError.message : "Falha ao salvar projeto.",
      });
    } finally {
      setSaving(null);
    }
  }

  async function handleDeleteProject() {
    if (!firebaseUser || !projectDeleteTarget) return;

    try {
      setSaving("deleteProject");
      await deleteFormProject(firebaseUser, projectDeleteTarget.id);
      setProjects((current) => current.filter((project) => project.id !== projectDeleteTarget.id));
      setExpandedProjectIds((current) => current.filter((projectId) => projectId !== projectDeleteTarget.id));
      setProjectDeleteTarget(null);
      await reloadBootstrap();
      toast({ title: "Projeto excluído" });
    } catch (deleteError) {
      toast({
        variant: "destructive",
        title: deleteError instanceof Error ? deleteError.message : "Falha ao excluir projeto.",
      });
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveModel() {
    if (!firebaseUser) return;

    if (isModelFormInvalid(modelForm)) {
      toast({
        variant: "destructive",
        title: "Preencha o nome, as seções e as perguntas do modelo.",
      });
      return;
    }

    try {
      setSaving("model");
      const payload = buildModelPayload();
      if (modelDialogMode === "edit" && editingModelId) {
        await updateFormModel(firebaseUser, editingModelId, payload);
      } else {
        await createFormModel(firebaseUser, payload);
      }

      await reloadBootstrap();
      setModelDialogOpen(false);
      setEditingModelId(null);
      setModelForm(createEmptyModelForm());
      toast({ title: modelDialogMode === "edit" ? "Modelo atualizado" : "Modelo criado" });
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: saveError instanceof Error ? saveError.message : "Falha ao salvar modelo.",
      });
    } finally {
      setSaving(null);
    }
  }

  async function handleArchiveModel() {
    if (!firebaseUser || !modelArchiveTarget) return;

    try {
      setSaving("archiveModel");
      await deleteFormModel(firebaseUser, modelArchiveTarget.id);
      setModels((current) => current.filter((model) => model.id !== modelArchiveTarget.id));
      setModelArchiveTarget(null);
      await reloadBootstrap();
      toast({ title: "Modelo arquivado" });
    } catch (archiveError) {
      toast({
        variant: "destructive",
        title: archiveError instanceof Error ? archiveError.message : "Falha ao arquivar modelo.",
      });
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveSubproject() {
    if (!firebaseUser) return;

    try {
      setSaving("project");
      const result = await createFormType(firebaseUser, {
        form_project_id: subprojectForm.form_project_id,
        name: subprojectForm.name,
        description: subprojectForm.description,
        requires_subtype: false,
        context: "operational",
        order: (subprojectsByProject[subprojectForm.form_project_id] ?? []).length,
        is_active: true,
      });
      setFormTypes((current) => [...current, result.type]);
      setSubprojectDialogOpen(false);
      setSubprojectForm({ form_project_id: "", name: "", description: "" });
      toast({ title: "Subprojeto criado" });
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: saveError instanceof Error ? saveError.message : "Falha ao criar subprojeto.",
      });
    } finally {
      setSaving(null);
    }
  }

  async function handleCreateTemplate() {
    if (!firebaseUser) return;

    try {
      setSaving("template");
      const sections = buildTemplateSections();
      if (!sections) {
        toast({
          variant: "destructive",
          title: "Selecione ao menos uma pergunta do modelo.",
        });
        return;
      }

      const result = await createFormTemplate(firebaseUser, {
        form_project_id: templateForm.form_project_id,
        form_type_id: templateForm.form_type_id,
        context: templateForm.context,
        name:
          templateForm.name ||
          (templateForm.source === "model" ? selectedModel?.name : undefined) ||
          (templateForm.source === "duplicate" ? selectedDuplicateTemplate?.name : undefined) ||
          "Formulário em branco",
        description:
          templateForm.description ||
          (templateForm.source === "model" ? selectedModel?.description : undefined) ||
          (templateForm.source === "duplicate" ? selectedDuplicateTemplate?.description : undefined) ||
          "",
        occurrence_type: templateForm.occurrence_type,
        application_mode: templateForm.application_mode,
        created_from_model_id: templateForm.source === "model" ? selectedModel?.id : undefined,
        created_from_model_name: templateForm.source === "model" ? selectedModel?.name : undefined,
        due_rule: { type: "none" },
        unit_ids: templateForm.unit_ids,
        unit_names: templateForm.unit_ids
          .map((unitId) => units.find((unit) => unit.id === unitId)?.name)
          .filter(Boolean),
        job_role_ids: [],
        job_function_ids: [],
        shift_definition_ids: templateForm.application_mode === "schedule" ? templateForm.shift_definition_ids : [],
        shift_definition_names:
          templateForm.application_mode === "schedule"
            ? templateForm.shift_definition_ids
                .map((shiftId) => shiftDefinitions.find((shift) => shift.id === shiftId)?.name)
                .filter(Boolean)
            : [],
        is_active: true,
        sections,
      });

      await updateFormTemplateApplication(firebaseUser, result.template.id, {
        application_mode: templateForm.application_mode,
        occurrence_type: templateForm.occurrence_type,
        unit_ids: templateForm.unit_ids,
        unit_names: templateForm.unit_ids
          .map((unitId) => units.find((unit) => unit.id === unitId)?.name)
          .filter(Boolean),
        shift_definition_ids:
          templateForm.application_mode === "schedule" ? templateForm.shift_definition_ids : [],
        shift_definition_names:
          templateForm.application_mode === "schedule"
            ? templateForm.shift_definition_ids
                .map((shiftId) => shiftDefinitions.find((shift) => shift.id === shiftId)?.name)
                .filter(Boolean)
            : [],
        pending_policy: "keep",
        due_rule: { type: "none" },
      });

      setTemplateDialogOpen(false);
      setTemplateForm((current) => ({
        ...current,
        source: "blank",
        model_id: "",
        duplicate_template_id: "",
        form_type_id: "",
        name: "",
        description: "",
        occurrence_type: "manual",
        application_mode: "manual",
        unit_ids: [],
        shift_definition_ids: [],
        section_title: "Seção principal",
        item_title: "Novo item",
        selected_model_item_ids: [],
      }));
      router.push(`/dashboard/forms/${result.template.id}`);
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: saveError instanceof Error ? saveError.message : "Falha ao criar formulário.",
      });
    } finally {
      setSaving(null);
    }
  }

  async function handleRunScheduler() {
    if (!firebaseUser) return;

    try {
      setSaving("scheduler");
      const today = new Date().toISOString().slice(0, 10);
      const result = await runFormsScheduler(firebaseUser, {
        fromDate: today,
        toDate: today,
      });
      await reloadBootstrap();
      toast({
        title: "Pendências geradas",
        description: `${result.created_count} formulário(s) criado(s); ${result.skipped_count} ignorado(s); ${result.overdue_updated} marcado(s) como atrasado(s).`,
      });
    } catch (schedulerError) {
      toast({
        variant: "destructive",
        title: schedulerError instanceof Error ? schedulerError.message : "Falha ao gerar pendências.",
      });
    } finally {
      setSaving(null);
    }
  }

  function buildAnalyticsScopeBody() {
    return {
      from: analyticsFilters.from,
      to: analyticsFilters.to,
      ...(analyticsFilters.projectId !== "all"
        ? { projectId: analyticsFilters.projectId }
        : {}),
      ...(analyticsFilters.templateId !== "all"
        ? { templateId: analyticsFilters.templateId }
        : {}),
    };
  }

  async function handleSimulateReprocess() {
    if (!firebaseUser) return;

    try {
      setAnalyticsOperation("simulate");
      setAnalyticsLastResult(null);
      const result = await simulateAnalyticsReprocess(firebaseUser, buildAnalyticsScopeBody());
      setAnalyticsSimulation({
        simulation: result.simulation,
        simulatedAt: result.simulated_at,
        scope: result.scope,
      });
      toast({
        title: "Simulação concluída",
        description: `${result.simulation.totals.executions_ok} execução(ões) prontas para reprocessar.`,
      });
    } catch (operationError) {
      toast({
        variant: "destructive",
        title:
          operationError instanceof Error
            ? operationError.message
            : "Falha ao simular reprocessamento.",
      });
    } finally {
      setAnalyticsOperation(null);
    }
  }

  async function handleExecuteReprocess() {
    if (!firebaseUser || !analyticsSimulation) return;

    try {
      setAnalyticsOperation("execute");
      const result = await executeAnalyticsReprocess(firebaseUser, {
        ...buildAnalyticsScopeBody(),
        simulation: analyticsSimulation.simulation,
        simulatedAt: analyticsSimulation.simulatedAt,
        recomputeAggregates: true,
      });
      const ok = result.results.filter((entry) => entry.status === "ok").length;
      const errors = result.results.filter((entry) => entry.status === "error").length;
      setAnalyticsLastResult(
        `Reprocessamento: ${ok} ok, ${errors} erro(s). Agregados: ${result.aggregates?.days ?? 0} dia(s).`
      );
      setAnalyticsSimulation(null);
      toast({
        title: "Reprocessamento executado",
        description: `${ok} execução(ões) reprocessadas; ${errors} erro(s).`,
      });
    } catch (operationError) {
      toast({
        variant: "destructive",
        title:
          operationError instanceof Error
            ? operationError.message
            : "Falha ao executar reprocessamento.",
      });
    } finally {
      setAnalyticsOperation(null);
    }
  }

  async function handleRecomputeAggregates() {
    if (!firebaseUser) return;

    try {
      setAnalyticsOperation("recompute");
      const result = await recomputeAnalyticsAggregates(firebaseUser, {
        from: analyticsFilters.from,
        to: analyticsFilters.to,
      });
      setAnalyticsLastResult(
        `Agregados recomputados: ${result.days} dia(s), ${result.rows_read} ocorrência(s) lidas.`
      );
      toast({
        title: "Agregados recomputados",
        description: `${result.days} dia(s), ${result.rows_read} ocorrência(s) lidas.`,
      });
    } catch (operationError) {
      toast({
        variant: "destructive",
        title:
          operationError instanceof Error
            ? operationError.message
            : "Falha ao recomputar agregados.",
      });
    } finally {
      setAnalyticsOperation(null);
    }
  }

  async function handleRetentionBackfill() {
    if (!firebaseUser) return;

    try {
      setAnalyticsOperation("backfill");
      const result = await backfillAnalyticsRetention(firebaseUser, {
        retentionDays: Number(analyticsFilters.retentionDays),
        batchLimit: Number(analyticsFilters.batchLimit),
      });
      setAnalyticsLastResult(
        `Backfill: ${result.stamped} registro(s) carimbados. ${result.has_more ? "Há mais lotes." : "Sem lote restante."}`
      );
      toast({
        title: "Backfill executado",
        description: `${result.stamped} registro(s) carimbados.`,
      });
    } catch (operationError) {
      toast({
        variant: "destructive",
        title:
          operationError instanceof Error
            ? operationError.message
            : "Falha no backfill de retenção.",
      });
    } finally {
      setAnalyticsOperation(null);
    }
  }

  async function handleAnonymizeDue() {
    if (!firebaseUser) return;

    try {
      setAnalyticsOperation("anonymize");
      const result = await anonymizeDueAnalyticsOccurrences(firebaseUser, {
        batchLimit: Number(analyticsFilters.batchLimit),
        keepOriginalInVault: true,
      });
      setAnalyticsLastResult(
        `Anonimização: ${result.anonymized} registro(s), ${result.vaulted} preservado(s) no cofre.`
      );
      toast({
        title: "Anonimização executada",
        description: `${result.anonymized} registro(s) anonimizados.`,
      });
    } catch (operationError) {
      toast({
        variant: "destructive",
        title:
          operationError instanceof Error
            ? operationError.message
            : "Falha ao anonimizar ocorrências.",
      });
    } finally {
      setAnalyticsOperation(null);
    }
  }

  if (loading) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Formulários
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Formulários</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Organize projetos, crie formulários, vincule a aplicação por unidade ou escala e acompanhe os preenchimentos da operação.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageTemplates ? (
            <Button
              variant="outline"
              onClick={() => void handleRunScheduler()}
              disabled={saving === "scheduler"}
            >
              <CalendarClock className="mr-2 h-4 w-4" />
              {saving === "scheduler" ? "Gerando..." : "Gerar pendentes de hoje"}
            </Button>
          ) : null}
          {canCreateProjects ? (
            <Button variant="outline" onClick={openCreateProjectDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Novo projeto
            </Button>
          ) : null}
          {projects.length > 0 && canManageTemplates ? (
            <Button
              variant="outline"
              onClick={() => {
                const firstProject = projects[0];
                const firstSubproject = firstProject ? (subprojectsByProject[firstProject.id] ?? [])[0] : undefined;
                setTemplateForm((current) => ({
                  ...current,
                  source: "blank",
                  model_id: "",
                  duplicate_template_id: "",
                  form_project_id: current.form_project_id || firstProject?.id || "",
                  form_type_id: current.form_type_id || firstSubproject?.id || "",
                  name: "",
                  description: "",
                  selected_model_item_ids: [],
                }));
                setTemplateDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo formulário
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Pendentes" value={stats.pending} subtitle="Preenchimentos aguardando início" tone="amber" />
        <KpiCard label="Em andamento" value={stats.inProgress} subtitle="Preenchimentos já assumidos" tone="blue" />
        <KpiCard label="Concluídas" value={stats.completed} subtitle="Fluxos encerrados" tone="emerald" />
        <KpiCard label="Atrasadas" value={stats.overdue} subtitle="Preenchimentos em atenção" tone="red" />
        <KpiCard label="Tempo médio" value={stats.averageDuration} subtitle="Por preenchimento concluído" tone="purple" unit="min" />
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList className="h-auto rounded-full bg-slate-100/80 p-1">
          <TabsTrigger value="operations">Projetos</TabsTrigger>
          <TabsTrigger value="templates">Formulários</TabsTrigger>
          <TabsTrigger value="models">Modelos</TabsTrigger>
          <TabsTrigger value="analytics" disabled={!canViewAnalytics}>
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="operations" className="space-y-4">
          {projectSummaries.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                Nenhum projeto de formulários visível.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {projectSummaries.map(({ project, subprojects, templates: projectTemplates, executions: projectExecutions, completionRate, items }) => {
              const isExpanded = expandedProjectIds.includes(project.id);
              const pendingExecutions = projectExecutions.filter((execution) => execution.status === "pending").length;
              return (
              <Card
                key={project.id}
                className="overflow-hidden"
              >
                <CardHeader className="p-4">
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => toggleProject(project.id)}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left"
                    >
                      <ChevronDown
                        className={cn(
                          "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                          isExpanded && "rotate-180"
                        )}
                      />
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                        style={{ backgroundColor: project.color || "#5b5cf6" }}
                      >
                        <FolderKanban className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 space-y-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <CardTitle className="line-clamp-1 text-base">{project.name}</CardTitle>
                          {project.source === "unit_auto" ? (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              Unidade
                            </Badge>
                          ) : null}
                        </span>
                        <CardDescription className="line-clamp-1">
                          {project.description?.trim() || "Projeto operacional no domínio de formulários."}
                        </CardDescription>
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="grid grid-cols-4 overflow-hidden rounded-2xl border bg-muted/20 text-center">
                        {[
                          { value: projectTemplates.length, label: "Forms", className: "text-foreground" },
                          { value: projectExecutions.length, label: "Preench.", className: "text-foreground" },
                          { value: pendingExecutions, label: "Pendentes", className: "text-amber-600" },
                          { value: `${completionRate}%`, label: "Concluído", className: "text-emerald-600" },
                        ].map((metric, metricIndex) => (
                          <div
                            key={metric.label}
                            className={cn(
                              "min-w-[58px] px-2 py-1.5",
                              metricIndex > 0 && "border-l"
                            )}
                          >
                            <p className={cn("text-xs font-semibold leading-none", metric.className)}>{metric.value}</p>
                            <p className="mt-1 text-[9px] uppercase leading-none text-muted-foreground">{metric.label}</p>
                          </div>
                        ))}
                      </div>
                      {canCreateProjects ? (
                        <>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => openEditProjectDialog(project)}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Editar projeto
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => {
                              setSubprojectForm({
                                form_project_id: project.id,
                                name: "",
                                description: "",
                              });
                              setSubprojectDialogOpen(true);
                            }}
                          >
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Novo subprojeto
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => setProjectDeleteTarget(project)}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Excluir
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (subprojects.length > 0 || projectExecutions.length > 0) ? (
                <CardContent className="space-y-4 pt-4">
                  {subprojects.length > 0 ? (
                    <div className="space-y-4">
                      {subprojects.map((subproject) => {
                        const subprojectTemplates = templatesBySubproject[subproject.id] ?? [];
                        return (
                          <div key={subproject.id} className="rounded-2xl border bg-muted/10 p-4">
                            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                              <div>
                                <p className="font-semibold">{subproject.name}</p>
                                <p className="text-sm text-muted-foreground">
                                  {subproject.description || "Operação da unidade."}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline">{subprojectTemplates.length} formulário(s)</Badge>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setTemplateForm((current) => ({
                                      ...current,
                                      source: "blank",
                                      model_id: "",
                                      duplicate_template_id: "",
                                      form_project_id: project.id,
                                      form_type_id: subproject.id,
                                      name: "",
                                      description: "",
                                      selected_model_item_ids: [],
                                    }));
                                    setTemplateDialogOpen(true);
                                  }}
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Novo formulário
                                </Button>
                              </div>
                            </div>
                            {subprojectTemplates.length > 0 ? (
                              <div className="grid gap-3">
                                {subprojectTemplates.map((template) => {
                                  const templateExecutions = projectExecutions.filter(
                                    (execution) => execution.template_id === template.id
                                  );
                                  const completed = templateExecutions.filter(
                                    (execution) => execution.status === "completed"
                                  ).length;
                                  const rate =
                                    templateExecutions.length === 0
                                      ? 0
                                      : Math.round((completed / templateExecutions.length) * 100);

                                  return (
                                    <Link key={template.id} href={`/dashboard/forms/${template.id}`}>
                                      <div className="h-full rounded-xl border bg-background p-4 transition-colors hover:bg-muted/30">
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0 space-y-1">
                                            <p className="line-clamp-1 font-semibold">{template.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                              {formatOccurrence(template.occurrence_type)} · {formatApplicationMode(template)}
                                            </p>
                                          </div>
                                          <Badge variant="outline">v{template.version}</Badge>
                                        </div>
                                        <div className="mt-4 space-y-2">
                                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span>{templateExecutions.length} preenchimento(s)</span>
                                            <span>{rate}%</span>
                                          </div>
                                          <Progress value={rate} />
                                        </div>
                                        <p className="mt-3 text-xs text-muted-foreground">
                                          {formatTemplateScope(template)}
                                        </p>
                                      </div>
                                    </Link>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="rounded-xl border border-dashed bg-background px-4 py-6 text-center text-sm text-muted-foreground">
                                Este subprojeto ainda não tem formulários.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {projectExecutions.length > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                          Preenchimentos recentes
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                      <div className="space-y-2">
                        {projectExecutions.slice(0, 4).map((execution) => {
                          const statusMeta = getExecutionStatusMeta(execution.status);
                          return (
                            <Link key={execution.id} href={`/dashboard/forms/${execution.id}/view`}>
                              <div className="rounded-2xl border p-4 transition-colors hover:bg-muted/30">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-semibold">{execution.template_name}</p>
                                      <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                                      <Badge variant="outline">{formatOccurrence(execution.occurrence_type)}</Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                      {execution.unit_name ?? execution.unit_id} · {execution.assigned_username}
                                    </p>
                                  </div>
                                  <div className="text-xs text-muted-foreground lg:text-right">
                                    <p>Atualizado {formatRelative(execution.updated_at)}</p>
                                    <p>{formatDateTime(execution.updated_at)}</p>
                                  </div>
                                </div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
                ) : null}
              </Card>
              );
            })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Formulários operacionais
              </CardTitle>
              <CardDescription>
                Estruturas publicadas, aplicação e última atividade por projeto.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Formulário</TableHead>
                    <TableHead>Projeto</TableHead>
                    <TableHead>Subprojeto</TableHead>
                    <TableHead>Aplicação</TableHead>
                    <TableHead>Escopo</TableHead>
                    <TableHead>Perguntas</TableHead>
                    <TableHead>Versão</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((template) => {
                    const project = projects.find((entry) => entry.id === template.form_project_id);
                    const subproject = formTypes.find((entry) => entry.id === template.form_type_id);
                    return (
                      <TableRow key={template.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{template.name}</span>
                            </div>
                            {template.description ? (
                              <p className="line-clamp-1 text-xs text-muted-foreground">
                                {template.description}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{project?.name ?? template.form_project_id}</TableCell>
                        <TableCell>{subproject?.name ?? "Sem subprojeto"}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant="outline">{formatApplicationMode(template)}</Badge>
                            <p className="text-xs text-muted-foreground">{formatOccurrence(template.occurrence_type)}</p>
                          </div>
                        </TableCell>
                        <TableCell>{formatTemplateScope(template)}</TableCell>
                        <TableCell>{countTemplateItems(template)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">v{template.version}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => router.push(`/dashboard/forms/${template.id}`)}
                          >
                            Editar
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="models" className="space-y-4">
          <div className="flex flex-col gap-2">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Modelos-base</h2>
              <p className="text-sm text-muted-foreground">
                Estruturas reutilizáveis para criar formulários operacionais.
              </p>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {availableModels.map((model, modelIndex) => {
              const itemCount = model.sections.reduce((total, section) => total + section.items.length, 0);
              const visual = getModelVisual(model.id, modelIndex);
              const Icon = visual.icon;
              return (
                <Card key={model.id} className="border-slate-200 shadow-sm">
                  <CardContent className="flex min-h-[180px] flex-col justify-between p-6">
                    <div className="space-y-4">
                      <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", visual.className)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="font-semibold">{model.name}</h3>
                        <p className="line-clamp-2 text-sm text-muted-foreground">{model.description}</p>
                      </div>
                    </div>
                    <div className="mt-5 flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">{itemCount} itens</span>
                      {projects.length > 0 && canManageTemplates ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const firstProject = projects[0];
                            const firstSubproject = firstProject ? (subprojectsByProject[firstProject.id] ?? [])[0] : undefined;
                            setTemplateForm((current) => ({
                              ...current,
                              source: "model",
                              model_id: model.id,
                              form_project_id: current.form_project_id || firstProject?.id || "",
                              form_type_id: current.form_type_id || firstSubproject?.id || "",
                              name: model.name,
                              description: model.description ?? "",
                            }));
                            selectAllModelItems(model.id);
                            setTemplateDialogOpen(true);
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Usar modelo
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <FormsAnalyticsOverview
            canResolve={canResolveOccurrences}
            canValidate={canValidateResolution}
          />

          {canManageTaxonomy ? <FormsAnalyticsTaxonomyManager /> : null}

          {canManageRetentionPolicy ? <RetentionPolicyManager /> : null}

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Preenchimentos · últimos 14 dias
                </CardTitle>
                <CardDescription>
                  Volume diário de execuções concluídas.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex h-56 items-end gap-2 rounded-xl border bg-muted/20 p-4">
                  {dailyCompletionBuckets.map((bucket) => {
                    const max = Math.max(1, ...dailyCompletionBuckets.map((entry) => entry.total));
                    const height = Math.max(12, Math.round((bucket.total / max) * 160));
                    return (
                      <div key={bucket.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                        <div
                          className="w-full rounded-t-md bg-violet-500"
                          style={{ height }}
                          title={`${bucket.label}: ${bucket.total}`}
                        />
                        <span className="text-[10px] text-muted-foreground">{bucket.label.slice(0, 2)}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5" />
                  Ranking por unidade
                </CardTitle>
                <CardDescription>
                  Conformidade média por destino operacional.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(unitRankings.length > 0 ? unitRankings : [{ name: "Sem dados", total: 0, completed: 0, rate: 0 }]).map((entry) => (
                  <div key={entry.name} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{entry.name}</span>
                      <span className="text-muted-foreground">{entry.rate}%</span>
                    </div>
                    <Progress value={entry.rate} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Operação de analytics
              </CardTitle>
              <CardDescription>
                Reprocessamento histórico e recomputação dos agregados derivados.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <Label>De</Label>
                  <Input
                    type="date"
                    value={analyticsFilters.from}
                    onChange={(event) =>
                      setAnalyticsFilters((current) => ({
                        ...current,
                        from: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Até</Label>
                  <Input
                    type="date"
                    value={analyticsFilters.to}
                    onChange={(event) =>
                      setAnalyticsFilters((current) => ({
                        ...current,
                        to: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Projeto</Label>
                  <Select
                    value={analyticsFilters.projectId}
                    onValueChange={(value) =>
                      setAnalyticsFilters((current) => ({
                        ...current,
                        projectId: value,
                        templateId: "all",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Formulário</Label>
                  <Select
                    value={analyticsFilters.templateId}
                    onValueChange={(value) =>
                      setAnalyticsFilters((current) => ({
                        ...current,
                        templateId: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {templates
                        .filter(
                          (template) =>
                            analyticsFilters.projectId === "all" ||
                            template.form_project_id === analyticsFilters.projectId
                        )
                        .map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Reprocessamento</p>
                    <p className="text-xs text-muted-foreground">
                      Simula antes de executar e recomputa os agregados do período.
                    </p>
                  </div>
                  {analyticsSimulation ? (
                    <div className="mt-4 rounded-md bg-muted/40 p-3 text-xs">
                      <p className="font-semibold">
                        {analyticsSimulation.simulation.totals.executions_ok} execução(ões) prontas
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {analyticsSimulation.simulation.totals.evaluations} avaliações ·{" "}
                        {analyticsSimulation.simulation.totals.occurrences} ocorrências ·{" "}
                        {analyticsSimulation.simulation.totals.superseded} atuais substituídas
                      </p>
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canReprocessAnalytics || analyticsOperation !== null}
                      onClick={() => void handleSimulateReprocess()}
                    >
                      {analyticsOperation === "simulate" ? "Simulando..." : "Simular"}
                    </Button>
                    <Button
                      type="button"
                      disabled={
                        !canReprocessAnalytics ||
                        !analyticsSimulation ||
                        analyticsOperation !== null
                      }
                      onClick={() => void handleExecuteReprocess()}
                    >
                      {analyticsOperation === "execute" ? "Executando..." : "Executar"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Agregados diários</p>
                    <p className="text-xs text-muted-foreground">
                      Recalcula os buckets derivados para dashboards de períodos longos.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4"
                    disabled={!canReprocessAnalytics || analyticsOperation !== null}
                    onClick={() => void handleRecomputeAggregates()}
                  >
                    {analyticsOperation === "recompute" ? "Recomputando..." : "Recomputar período"}
                  </Button>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Privacidade</p>
                    <p className="text-xs text-muted-foreground">
                      Carimba retenção e anonimiza ocorrências pessoais vencidas.
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label>Dias</Label>
                      <Input
                        type="number"
                        min={1}
                        value={analyticsFilters.retentionDays}
                        onChange={(event) =>
                          setAnalyticsFilters((current) => ({
                            ...current,
                            retentionDays: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Lote</Label>
                      <Input
                        type="number"
                        min={1}
                        max={500}
                        value={analyticsFilters.batchLimit}
                        onChange={(event) =>
                          setAnalyticsFilters((current) => ({
                            ...current,
                            batchLimit: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canManageRetentionPolicy || analyticsOperation !== null}
                      onClick={() => void handleRetentionBackfill()}
                    >
                      {analyticsOperation === "backfill" ? "Carimbando..." : "Backfill"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canManageRetentionPolicy || analyticsOperation !== null}
                      onClick={() => void handleAnonymizeDue()}
                    >
                      {analyticsOperation === "anonymize" ? "Anonimizando..." : "Anonimizar vencidas"}
                    </Button>
                  </div>
                </div>
              </div>

              {analyticsSimulation ? (
                <div className="rounded-lg border">
                  <div className="flex flex-col gap-2 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold">Impacto da simulação</p>
                      <p className="text-xs text-muted-foreground">
                        {analyticsSimulation.scope.execution_count} execução(ões) no escopo ·{" "}
                        {analyticsSimulation.scope.fromLocalDate} até {analyticsSimulation.scope.toLocalDate}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 overflow-hidden rounded-md border text-center text-xs">
                      <div className="px-3 py-2">
                        <p className="font-semibold">{analyticsSimulation.simulation.totals.evaluations}</p>
                        <p className="text-muted-foreground">Avaliações</p>
                      </div>
                      <div className="border-l px-3 py-2">
                        <p className="font-semibold">{analyticsSimulation.simulation.totals.occurrences}</p>
                        <p className="text-muted-foreground">Ocorrências</p>
                      </div>
                      <div className="border-l px-3 py-2">
                        <p className="font-semibold">{analyticsSimulation.simulation.totals.superseded}</p>
                        <p className="text-muted-foreground">Substituídas</p>
                      </div>
                    </div>
                  </div>
                  <div className="max-h-80 overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Execução</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Avaliações</TableHead>
                          <TableHead className="text-right">Ocorrências</TableHead>
                          <TableHead className="text-right">Substituídas</TableHead>
                          <TableHead>Mensagem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analyticsSimulation.simulation.executions.map((entry) => (
                          <TableRow key={entry.execution_id}>
                            <TableCell className="font-mono text-xs">{entry.execution_id}</TableCell>
                            <TableCell>
                              <Badge
                                variant={entry.status === "ok" ? "default" : "outline"}
                                className={cn(
                                  entry.status === "error" && "border-rose-200 bg-rose-50 text-rose-700",
                                  entry.status === "skipped" && "border-amber-200 bg-amber-50 text-amber-700"
                                )}
                              >
                                {entry.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{entry.will_create_evaluations}</TableCell>
                            <TableCell className="text-right">{entry.will_create_occurrences}</TableCell>
                            <TableCell className="text-right">{entry.will_supersede}</TableCell>
                            <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">
                              {entry.error ?? entry.skip_reason ?? "Pronta"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 xl:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">Jobs agendados</p>
                  <div className="mt-3 space-y-3 text-xs">
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="font-medium">Recomputar agregados</p>
                      <p className="mt-1 break-all font-mono text-muted-foreground">
                        GET /api/forms/analytics/jobs/recompute-daily?workspace_id=&lt;workspace&gt;&days=2
                      </p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="font-medium">Anonimizar vencidas</p>
                      <p className="mt-1 break-all font-mono text-muted-foreground">
                        GET /api/forms/analytics/jobs/anonymize-due?workspace_id=&lt;workspace&gt;&batch_limit=200
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">Configuração operacional</p>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                      <span>CRON_SECRET</span>
                      <Badge variant="outline">obrigatório</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                      <span>FORMS_ANALYTICS_PERSONAL_RETENTION_DAYS</span>
                      <Badge variant="outline">{analyticsFilters.retentionDays} dias</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                      <span>FORMS_ANALYTICS_JOB_WORKSPACE_IDS</span>
                      <Badge variant="outline">opcional</Badge>
                    </div>
                  </div>
                </div>
              </div>

              {analyticsLastResult ? (
                <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  {analyticsLastResult}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="max-w-xl overflow-hidden rounded-2xl p-0">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <DialogTitle>{editingProject ? "Editar projeto" : "Novo projeto"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="flex items-center gap-4">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
                  style={{ backgroundColor: projectForm.color || PROJECT_COLOR_PRESETS[0] }}
                >
                  <ProjectIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{projectForm.name || "Nome do projeto"}</p>
                  <p className="text-sm text-muted-foreground">
                    {projectForm.description || "Prévia do card do projeto"}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Nome do projeto</Label>
              <Input
                value={projectForm.name}
                onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ex.: Operação · Lojas"
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={projectForm.description}
                onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Para que serve este projeto?"
                className="min-h-24"
              />
            </div>
            <div className="space-y-2">
              <Label>Ícone</Label>
              <div className="flex flex-wrap gap-2">
                {PROJECT_ICON_PRESETS.map((entry) => {
                  const Icon = entry.icon;
                  const active = projectForm.icon === entry.value;
                  return (
                    <button
                      key={entry.value}
                      type="button"
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg border transition-colors",
                        active ? "border-primary bg-primary/5 text-primary ring-2 ring-primary/20" : "text-muted-foreground hover:bg-muted"
                      )}
                      onClick={() => setProjectForm((current) => ({ ...current, icon: entry.value }))}
                      aria-label={`Usar ícone ${entry.value}`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-2">
                {PROJECT_COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      "h-9 w-9 rounded-lg border transition-transform hover:scale-105",
                      (projectForm.color || PROJECT_COLOR_PRESETS[0]) === color && "ring-2 ring-primary ring-offset-2"
                    )}
                    style={{ backgroundColor: color }}
                    aria-label={`Usar cor ${color}`}
                    onClick={() => setProjectForm((current) => ({ ...current, color }))}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setProjectDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleSaveProject()} disabled={saving === "project" || !projectForm.name.trim()}>
              {saving === "project" ? "Salvando..." : editingProject ? "Salvar projeto" : "Criar projeto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={subprojectDialogOpen} onOpenChange={setSubprojectDialogOpen}>
        <DialogContent className="max-w-2xl overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm">
                <Layers3 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle>Novo subprojeto</DialogTitle>
                <DialogDescription>
                  Agrupe os formulários por operação, área ou rotina da unidade.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label>Projeto</Label>
              <Select
                value={subprojectForm.form_project_id}
                onValueChange={(value) => setSubprojectForm((current) => ({ ...current, form_project_id: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o projeto" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nome do subprojeto</Label>
              <Input
                value={subprojectForm.name}
                onChange={(event) => setSubprojectForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ex: Operação da loja"
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={subprojectForm.description}
                onChange={(event) => setSubprojectForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Ex: Abertura, fechamento, temperatura e conformidade da unidade."
                className="min-h-24"
              />
            </div>
          </div>
          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setSubprojectDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void handleSaveSubproject()}
              disabled={saving === "project" || !subprojectForm.form_project_id || !subprojectForm.name.trim()}
            >
              {saving === "project" ? "Salvando..." : "Salvar subprojeto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="!w-[min(94vw,1040px)] !max-w-[1040px] overflow-hidden rounded-2xl p-0">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500 text-white">
                <ClipboardList className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>Novo formulário</DialogTitle>
                <DialogDescription>Crie a partir de um modelo, em branco ou duplicando.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            <div className="space-y-3 rounded-2xl border bg-muted/10 p-4">
              <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_1fr]">
                <div className="space-y-2">
                  <Label>Usar estrutura existente</Label>
                  <Select
                    value={templateForm.source}
                    onValueChange={(value) => {
                      const nextSource = value as TemplateDialogSource;
                      const firstModel = availableModels[0];
                      const modelId = nextSource === "model"
                        ? templateForm.model_id || firstModel?.id || ""
                        : "";
                      const selectedModelForSource = availableModels.find((model) => model.id === modelId);
                      const itemIds = selectedModelForSource?.sections.flatMap((section) =>
                        section.items.map((item) => item.id)
                      ) ?? [];
                      setTemplateForm((current) => ({
                        ...current,
                        source: nextSource,
                        model_id: modelId,
                        duplicate_template_id:
                          nextSource === "duplicate" ? current.duplicate_template_id : "",
                        selected_model_item_ids: nextSource === "model" ? itemIds : [],
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blank">Nenhuma, criar em branco</SelectItem>
                      <SelectItem value="model">Modelos</SelectItem>
                      <SelectItem value="duplicate">Formulários publicados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {templateForm.source === "blank" ? (
                  <div className="rounded-xl border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground">
                    Para criar um formulário em branco, deixe “Usar estrutura existente” como “Nenhuma”.
                    O sistema criará uma seção inicial e uma pergunta inicial para você editar na próxima tela.
                  </div>
                ) : null}
                {templateForm.source === "duplicate" && selectedDuplicateTemplate?.is_active === false ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Este formulário não está ativo. A cópia usará apenas a estrutura, sem histórico de preenchimentos.
                  </div>
                ) : null}
              </div>

              {templateForm.source === "model" ? (
                <div className="grid gap-4 md:grid-cols-3">
                  {availableModels.map((model, modelIndex) => {
                    const visual = getModelVisual(model.id, modelIndex);
                    const Icon = visual.icon;
                    const active = templateForm.model_id === model.id;
                    const itemCount = model.sections.reduce((total, section) => total + section.items.length, 0);
                    return (
                      <button
                        key={model.id}
                        type="button"
                        className={cn(
                          "relative min-h-[132px] rounded-xl border p-4 text-left transition-colors",
                          active ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-background hover:bg-muted/40"
                        )}
                        onClick={() => {
                          const itemIds = model.sections.flatMap((section) => section.items.map((item) => item.id));
                          setTemplateForm((current) => ({
                            ...current,
                            model_id: model.id,
                            name: current.name || model.name,
                            description: current.description || model.description || "",
                            selected_model_item_ids: itemIds,
                          }));
                        }}
                      >
                        {active ? (
                          <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <CheckSquare className="h-3 w-3" />
                          </span>
                        ) : null}
                        <span className={cn("mb-3 flex h-9 w-9 items-center justify-center rounded-lg", visual.className)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="block text-sm font-semibold">{model.name}</span>
                        <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{model.description}</span>
                        <span className="mt-3 block text-xs text-muted-foreground">{itemCount} itens</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {templateForm.source === "duplicate" ? (
                <div className="space-y-2">
                  <Label>Formulário publicado</Label>
                  <Select
                    value={templateForm.duplicate_template_id}
                    onValueChange={(value) => {
                      const template = templateOptions.find((entry) => entry.id === value);
                      setTemplateForm((current) => ({
                        ...current,
                        duplicate_template_id: value,
                        name: current.name || (template ? `${template.name} - cópia` : ""),
                        description: current.description || template?.description || "",
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um formulário" />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedTemplateOptions.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name} · {template.is_active ? "Publicado" : "Inativo"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome do formulário</Label>
                <Input
                  value={templateForm.name}
                  onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={
                    templateForm.source === "model"
                      ? selectedModel?.name ?? "Nome do formulário"
                      : templateForm.source === "duplicate"
                        ? selectedDuplicateTemplate?.name ?? "Nome do formulário"
                        : "Ex.: Checklist de abertura"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Projeto</Label>
                <Select
                  value={templateForm.form_project_id}
                  onValueChange={(value) => {
                    const firstSubproject = (subprojectsByProject[value] ?? [])[0];
                    setTemplateForm((current) => ({
                      ...current,
                      form_project_id: value,
                      form_type_id: firstSubproject?.id ?? "",
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o projeto" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subprojeto</Label>
                <Select
                  value={templateForm.form_type_id}
                  onValueChange={(value) => setTemplateForm((current) => ({ ...current, form_type_id: value }))}
                  disabled={!templateForm.form_project_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o subprojeto" />
                  </SelectTrigger>
                  <SelectContent>
                    {(subprojectsByProject[templateForm.form_project_id] ?? []).map((subproject) => (
                      <SelectItem key={subproject.id} value={subproject.id}>
                        {subproject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Recorrência</Label>
                <Select
                  value={templateForm.occurrence_type}
                  onValueChange={(value) => setTemplateForm((current) => ({ ...current, occurrence_type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="daily">Diário</SelectItem>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Aplicação</Label>
                <Select
                  value={templateForm.application_mode}
                  onValueChange={(value) =>
                    setTemplateForm((current) => ({
                      ...current,
                      application_mode: value,
                      occurrence_type: value === "manual" ? "manual" : current.occurrence_type === "manual" ? "daily" : current.occurrence_type,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="unit">Por unidade</SelectItem>
                    <SelectItem value="schedule">Por escala/turno</SelectItem>
                    <SelectItem value="event">Evento do sistema</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {templateForm.source === "model"
                ? `${selectedModelItemIds.size || selectedModelTotalItems} itens serão criados a partir do modelo.`
                : templateForm.source === "duplicate"
                  ? selectedDuplicateTemplate
                    ? `A estrutura de "${selectedDuplicateTemplate.name}" será copiada.`
                    : "Selecione um formulário para duplicar."
                  : "Uma seção e uma pergunta inicial serão criadas."}
            </p>
          </div>
          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void handleCreateTemplate()}
              disabled={
                saving === "template" ||
                !templateForm.form_project_id ||
                !templateForm.form_type_id ||
                (templateForm.source === "model" && selectedModelItemIds.size === 0) ||
                (templateForm.source === "duplicate" && !templateForm.duplicate_template_id)
              }
            >
              <Save className="mr-2 h-4 w-4" />
              {saving === "template" ? "Criando..." : "Criar formulário"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={modelDialogOpen}
        onOpenChange={(open) => {
          setModelDialogOpen(open);
          if (!open) {
            setEditingModelId(null);
          }
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-white shadow-sm">
                <Layers3 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle>
                  {modelDialogMode === "edit"
                    ? "Editar modelo"
                    : modelDialogMode === "customize"
                      ? "Personalizar modelo"
                      : "Novo modelo"}
                </DialogTitle>
                <DialogDescription>
                  Estrutura base para criação de formulários.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[calc(92vh-145px)] space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome do modelo</Label>
                <Input
                  value={modelForm.name}
                  onChange={(event) => setModelForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Ex: Checklist de fechamento"
                />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Input
                  value={modelForm.category}
                  onChange={(event) => setModelForm((current) => ({ ...current, category: event.target.value }))}
                  placeholder="Ex: Operação"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={modelForm.description}
                onChange={(event) => setModelForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Descreva o uso esperado deste modelo."
                className="min-h-20"
              />
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Seções e perguntas</p>
                  <p className="text-xs text-muted-foreground">
                    A ordem abaixo será usada quando um formulário for criado por este modelo.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addModelSection}>
                  <Plus className="mr-2 h-4 w-4" />
                  Nova seção
                </Button>
              </div>

              <div className="space-y-3">
                {modelForm.sections.map((section, sectionIndex) => (
                  <div key={section.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">
                        {sectionIndex + 1}
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <Label>Título da seção</Label>
                        <Input
                          value={section.title}
                          onChange={(event) => updateModelSection(section.id, { title: event.target.value })}
                          placeholder="Título da seção"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="self-end text-muted-foreground hover:text-destructive sm:self-auto"
                        disabled={modelForm.sections.length <= 1}
                        onClick={() => removeModelSection(section.id)}
                        aria-label="Remover seção"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="mt-4 space-y-2">
                      {section.items.map((item) => (
                        <div key={item.id} className="grid gap-2 rounded-lg border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_180px_40px] md:items-end">
                          <div className="space-y-2">
                            <Label>Pergunta</Label>
                            <Input
                              value={item.title}
                              onChange={(event) => updateModelItem(section.id, item.id, { title: event.target.value })}
                              placeholder="Texto da pergunta"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Tipo</Label>
                            <Select
                              value={item.type}
                              onValueChange={(value) =>
                                updateModelItem(section.id, item.id, { type: value as FormItemTypeValue })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FORM_ITEM_TYPE_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={section.items.length <= 1}
                            onClick={() => removeModelItem(section.id, item.id)}
                            aria-label="Remover pergunta"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3"
                      onClick={() => addModelItem(section.id)}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Nova pergunta
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setModelDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveModel()}
              disabled={saving === "model" || isModelFormInvalid(modelForm)}
            >
              {saving === "model"
                ? "Salvando..."
                : modelDialogMode === "edit"
                  ? "Salvar modelo"
                  : "Criar modelo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={projectDeleteTarget !== null} onOpenChange={(open) => !open && setProjectDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
            <AlertDialogDescription>
              O projeto "{projectDeleteTarget?.name}" será removido da lista ativa. Formulários, preenchimentos e histórico já criados permanecem preservados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving === "deleteProject"}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving === "deleteProject"}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteProject();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving === "deleteProject" ? "Excluindo..." : "Excluir projeto"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={modelArchiveTarget !== null} onOpenChange={(open) => !open && setModelArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo "{modelArchiveTarget?.name}" deixará de aparecer na lista. Formulários já criados a partir dele permanecem preservados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving === "archiveModel"}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={saving === "archiveModel"}
              onClick={(event) => {
                event.preventDefault();
                void handleArchiveModel();
              }}
            >
              {saving === "archiveModel" ? "Arquivando..." : "Arquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
