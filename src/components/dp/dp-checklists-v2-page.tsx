"use client";

import React from "react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useRouter, useSearchParams } from "next/navigation";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  GalleryVerticalEnd,
  GripVertical,
  ImagePlus,
  Info,
  List,
  Loader2,
  Pencil,
  PenTool,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import SignatureCanvas from "react-signature-canvas";

import type {
  DPChecklistConditionalOperator,
  DPChecklistConditionalRule,
  DPChecklistCriticality,
  DPChecklistExecution,
  DPChecklistExecutionItem,
  DPChecklistExecutionSection,
  DPChecklistItemConfig,
  DPChecklistItemType,
  CustomSchedule,
  CustomScheduleMode,
  DPChecklistOccurrenceType,
  DPChecklistSection,
  DPChecklistTemplate,
  DPChecklistTemplateItem,
  DPChecklistTemplateType,
  DPChecklistType,
  DPChecklistVersionHistoryEntry,
  DPShiftDefinition,
  DPUnit,
  JobFunction,
  JobRole,
  OperationalTask,
} from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { useToast } from "@/hooks/use-toast";
import {
  buildChecklistExecutionItems,
  buildChecklistExecutionSections,
  buildExecutionAnswerMap,
  calculateExecutionScore,
  countTemplateItems,
  getActiveExecutionItems,
  getChecklistExecutionMetrics,
  isChecklistExecutionItemCompleted,
} from "@/features/dp-checklists/lib/core";
import {
  claimDPChecklistExecution,
  createDPChecklistTemplate,
  createDPChecklistType,
  createManualDPChecklistExecution,
  deleteDPChecklistType,
  fetchDPChecklistBootstrap,
  fetchDPChecklistExecution,
  generateDPChecklistExecutions,
  uploadDPChecklistAsset,
  updateDPChecklistTask,
  updateDPChecklistExecution,
  updateDPChecklistTemplate,
  updateDPChecklistType,
  type DPChecklistBootstrapPayload,
} from "@/features/dp-checklists/lib/client";
import { cn } from "@/lib/utils";
import { DPChecklistsAnalytics } from "@/components/dp/dp-checklists-analytics";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type TemplateDraft = {
  id?: string;
  name: string;
  description: string;
  category: string;
  templateType: DPChecklistTemplateType;
  occurrenceType: DPChecklistOccurrenceType;
  annualSchedule: { month: number; day: number };
  customSchedule: CustomSchedule;
  unitIds: string[];
  jobRoleIds: string[];
  jobFunctionIds: string[];
  shiftDefinitionIds: string[];
  isActive: boolean;
  version: number;
  versionHistory: DPChecklistVersionHistoryEntry[];
  changeNotes: string;
  sections: DPChecklistSection[];
};

type ManualDraft = {
  templateType: "" | DPChecklistTemplateType;
  templateId: string;
  date: string;
  unitId: string;
  assignedUserId: string;
  collaboratorUserIds: string[];
  incidentContext: string;
  supplierName: string;
  invoiceNumber: string;
  scheduledDate: string;
  enableRecurrence: boolean;
  recurrenceType: DPChecklistOccurrenceType;
  annualSchedule: { month: number; day: number };
  customSchedule: CustomSchedule;
  sections: DPChecklistSection[];
};

const CONDITIONAL_OPERATORS: Array<{
  value: DPChecklistConditionalOperator;
  label: string;
}> = [
  { value: "equals", label: "Igual a" },
  { value: "not_equals", label: "Diferente de" },
  { value: "gt", label: "Maior que" },
  { value: "lt", label: "Menor que" },
  { value: "contains", label: "Contém" },
];

const ITEM_TYPE_OPTIONS: Array<{
  value: DPChecklistItemType;
  label: string;
}> = [
  { value: "checkbox", label: "Marcação" },
  { value: "yes_no", label: "Sim ou não" },
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "temperature", label: "Temperatura" },
  { value: "select", label: "Seleção" },
  { value: "multi_select", label: "Múltipla escolha" },
  { value: "date", label: "Data" },
  { value: "photo", label: "Foto" },
  { value: "signature", label: "Assinatura" },
];

const CRITICALITY_OPTIONS: Array<{
  value: DPChecklistCriticality;
  label: string;
}> = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "critical", label: "Crítica" },
];

const DEFAULT_CHECKLIST_TYPES: DPChecklistType[] = [
  {
    id: "routine",
    name: "Rotina",
    emoji: "🔄",
    description: "Para rotinas previsíveis do dia a dia. Entra no scheduler e gera execuções automaticamente conforme recorrência e escala.",
    examples: "Abertura, fechamento, limpeza programada, conferência inicial.",
    behavior: "Uso contínuo e operacional.",
    configBanner: "Rotina manual: será criada fora do ciclo automático do scheduler.",
    isSchedulable: true,
    colorScheme: "emerald",
    isActive: true,
  },
  {
    id: "audit",
    name: "Auditoria",
    emoji: "🔍",
    description: "Para inspeções formais de qualidade e conformidade. Pode ser agendado e aparece separado nas métricas gerenciais.",
    examples: "Padrão de atendimento, limpeza, segurança alimentar.",
    behavior: "Visão gerencial e comparativa.",
    configBanner: "Auditoria manual: registrada com data e responsável definidos por você.",
    isSchedulable: false,
    colorScheme: "indigo",
    isActive: true,
  },
  {
    id: "incident",
    name: "Ocorrência",
    emoji: "⚠️",
    description: "Para registrar um problema inesperado no momento em que ele acontece. Não tem recorrência e não depende de horário.",
    examples: "Quebra de equipamento, acidente, reclamação grave.",
    behavior: "Abertura imediata pelo operador.",
    configBanner: "Ocorrência: descreva o contexto do incidente para rastreamento.",
    isSchedulable: false,
    colorScheme: "amber",
    isActive: true,
  },
  {
    id: "one_time",
    name: "Evento único",
    emoji: "📋",
    description: "Para um evento pontual com data definida. Executa uma vez e não volta a ser gerado automaticamente.",
    examples: "Inauguração, visita de fiscalização, treinamento especial.",
    behavior: "Uso único e planejado.",
    configBanner: "Evento único: defina a data agendada para execução.",
    isSchedulable: false,
    colorScheme: "violet",
    isActive: true,
  },
  {
    id: "receiving",
    name: "Recebimento",
    emoji: "📦",
    description: "Para conferência da carga no momento do recebimento. Criado manualmente quando a mercadoria chega.",
    examples: "Temperatura de chegada, NF, validade, quantidade e fotos da carga.",
    behavior: "Fluxo manual recorrente.",
    configBanner: "Recebimento: informe o fornecedor e o número da nota fiscal.",
    isSchedulable: false,
    colorScheme: "blue",
    isActive: true,
  },
  {
    id: "maintenance",
    name: "Manutenção",
    emoji: "🔧",
    description: "Para manutenção preventiva programada. O scheduler gera execuções em ciclos maiores, como semanal, quinzenal ou mensal.",
    examples: "Freezer, câmara fria, máquina de sorvete, equipamentos críticos.",
    behavior: "Prevenção recorrente.",
    configBanner: "Manutenção manual: será criada fora do ciclo automático do scheduler.",
    isSchedulable: true,
    colorScheme: "orange",
    isActive: true,
  },
];

const TYPE_COLOR_CLASSES: Record<string, { iconBg: string; tagCls: string; badgeCls: string }> = {
  emerald: { iconBg: "bg-emerald-50", tagCls: "bg-emerald-50 text-emerald-700 border border-emerald-200", badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  indigo: { iconBg: "bg-indigo-50", tagCls: "bg-indigo-50 text-indigo-700 border border-indigo-200", badgeCls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  amber: { iconBg: "bg-amber-50", tagCls: "bg-amber-50 text-amber-700 border border-amber-200", badgeCls: "bg-amber-50 text-amber-700 border-amber-200" },
  violet: { iconBg: "bg-violet-50", tagCls: "bg-violet-50 text-violet-700 border border-violet-200", badgeCls: "bg-violet-50 text-violet-700 border-violet-200" },
  blue: { iconBg: "bg-blue-50", tagCls: "bg-blue-50 text-blue-700 border border-blue-200", badgeCls: "bg-blue-50 text-blue-700 border-blue-200" },
  orange: { iconBg: "bg-orange-50", tagCls: "bg-orange-50 text-orange-700 border border-orange-200", badgeCls: "bg-orange-50 text-orange-700 border-orange-200" },
  red: { iconBg: "bg-red-50", tagCls: "bg-red-50 text-red-700 border border-red-200", badgeCls: "bg-red-50 text-red-700 border-red-200" },
  gray: { iconBg: "bg-gray-50", tagCls: "bg-gray-50 text-gray-700 border border-gray-200", badgeCls: "bg-gray-100 text-gray-700 border-gray-200" },
};

function resolveChecklistTypes(bootstrapTypes?: DPChecklistType[]): DPChecklistType[] {
  if (bootstrapTypes && bootstrapTypes.length > 0) return bootstrapTypes;
  return DEFAULT_CHECKLIST_TYPES;
}

function getChecklistTypeById(typeId: string, types: DPChecklistType[]): DPChecklistType | undefined {
  return types.find((t) => t.id === typeId);
}

function getTypeColorClasses(colorScheme?: string) {
  return TYPE_COLOR_CLASSES[colorScheme ?? "gray"] ?? TYPE_COLOR_CLASSES.gray;
}

const CRITICALITY_CLASSES: Record<DPChecklistCriticality, string> = {
  low: "",
  medium: "border-yellow-300 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-950/20",
  high: "border-orange-300 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20",
  critical: "border-red-300 bg-red-50/60 dark:border-red-800 dark:bg-red-950/25",
};

function toDateInputValue(date = new Date()) {
  return format(date, "yyyy-MM-dd");
}

function createLocalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTimestamp(
  value:
    | string
    | Date
    | { toDate?: () => Date }
    | null
    | undefined
) {
  if (!value) return "—";
  try {
    let date: Date;
    if (typeof value === "string") {
      date = parseISO(value);
    } else if (
      typeof value === "object" &&
      value !== null &&
      "toDate" in value &&
      typeof value.toDate === "function"
    ) {
      date = value.toDate();
    } else {
      date = value instanceof Date ? value : new Date(String(value));
    }
    return format(date, "dd/MM/yyyy HH:mm", { locale: ptBR });
  } catch {
    return typeof value === "string" ? value : "—";
  }
}

function formatRelativeTimestamp(
  value:
    | string
    | Date
    | { toDate?: () => Date }
    | null
    | undefined
) {
  if (!value) return "Nunca executado";
  try {
    let date: Date;
    if (typeof value === "string") {
      const parsed = parseISO(value);
      date = Number.isNaN(parsed.getTime()) ? new Date(value) : parsed;
    } else if (
      typeof value === "object" &&
      value !== null &&
      "toDate" in value &&
      typeof value.toDate === "function"
    ) {
      date = value.toDate();
    } else {
      date = value instanceof Date ? value : new Date(String(value));
    }

    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: ptBR,
    });
  } catch {
    return formatTimestamp(value);
  }
}

function getInitials(value?: string | null) {
  if (!value) return "—";
  const words = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return "—";
  return words.map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function buildSparklineBars(values: number[], size = 6) {
  const series = values.slice(-size);
  if (series.length === 0) return Array.from({ length: size }, () => 24);
  const max = Math.max(...series, 1);
  return series.map((value) => Math.max(24, Math.round((value / max) * 100)));
}

function getTemplateStatusMeta(isActive: boolean) {
  if (isActive) {
    return {
      label: "Ativo",
      dotClassName: "bg-emerald-500",
      badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  return {
    label: "Inativo",
    dotClassName: "bg-slate-400",
    badgeClassName: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

function makeConditionRule(): DPChecklistConditionalRule {
  return {
    itemId: "",
    operator: "equals",
    value: "",
  };
}

function makeDefaultItem(order = 0, depth = 1): DPChecklistTemplateItem {
  return {
    id: createLocalId(),
    order,
    title: "",
    description: "",
    type: "checkbox",
    required: true,
    weight: 1,
    blockNext: false,
    criticality: depth >= 4 ? "critical" : "low",
    config: {},
    conditionalBranches: [],
  };
}

function makeDefaultSection(order = 0): DPChecklistSection {
  return {
    id: createLocalId(),
    title: "",
    order,
    items: [makeDefaultItem(0)],
    requirePhoto: false,
    requireSignature: false,
  };
}

function makeDefaultCustomSchedule(): CustomSchedule {
  return { modes: [] };
}

function makeTemplateDraft(): TemplateDraft {
  return {
    name: "",
    description: "",
    category: "",
    templateType: "routine",
    occurrenceType: "daily",
    annualSchedule: { month: 1, day: 1 },
    customSchedule: makeDefaultCustomSchedule(),
    unitIds: [],
    jobRoleIds: [],
    jobFunctionIds: [],
    shiftDefinitionIds: [],
    isActive: true,
    version: 1,
    versionHistory: [],
    changeNotes: "",
    sections: [makeDefaultSection(0)],
  };
}

function templateToDraft(template: DPChecklistTemplate): TemplateDraft {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    category: template.category ?? "",
    templateType: template.templateType,
    occurrenceType: template.occurrenceType ?? "manual",
    annualSchedule: template.annualSchedule ?? { month: 1, day: 1 },
    customSchedule: template.customSchedule ?? makeDefaultCustomSchedule(),
    unitIds: template.unitIds ?? [],
    jobRoleIds: template.jobRoleIds ?? [],
    jobFunctionIds: template.jobFunctionIds ?? [],
    shiftDefinitionIds: template.shiftDefinitionIds ?? [],
    isActive: template.isActive,
    version: template.version ?? 1,
    versionHistory: template.versionHistory ?? [],
    changeNotes: "",
    sections: template.sections,
  };
}

function makeManualDraft(): ManualDraft {
  return {
    templateType: "",
    templateId: "",
    date: toDateInputValue(),
    unitId: "",
    assignedUserId: "",
    collaboratorUserIds: [],
    incidentContext: "",
    supplierName: "",
    invoiceNumber: "",
    scheduledDate: toDateInputValue(),
    enableRecurrence: false,
    recurrenceType: "weekly",
    annualSchedule: { month: 1, day: 1 },
    customSchedule: makeDefaultCustomSchedule(),
    sections: [makeDefaultSection(0)],
  };
}

function setItemOrder(items: DPChecklistTemplateItem[]) {
  return items.map((item, index) => ({ ...item, order: index }));
}

function setSectionOrder(sections: DPChecklistSection[]) {
  return sections.map((section, index) => ({ ...section, order: index }));
}

function collectTemplateItemOptions(
  items: DPChecklistTemplateItem[]
): Array<{ id: string; title: string }> {
  return items.flatMap((item) => [
    { id: item.id, title: item.title },
    ...((item.conditionalBranches ?? []).flatMap((branch) =>
      collectTemplateItemOptions(branch.items)
    ) ?? []),
  ]);
}

function updateItemRecursive(
  items: DPChecklistTemplateItem[],
  itemId: string,
  updater: (item: DPChecklistTemplateItem) => DPChecklistTemplateItem
): DPChecklistTemplateItem[] {
  return items.map((item) => {
    if (item.id === itemId) {
      return updater(item);
    }

    return {
      ...item,
      conditionalBranches: (item.conditionalBranches ?? []).map((branch) => ({
        ...branch,
        items: updateItemRecursive(branch.items, itemId, updater),
      })),
    };
  });
}

function removeItemRecursive(
  items: DPChecklistTemplateItem[],
  itemId: string
): DPChecklistTemplateItem[] {
  return items
    .filter((item) => item.id !== itemId)
    .map((item) => ({
      ...item,
      conditionalBranches: (item.conditionalBranches ?? []).map((branch) => ({
        ...branch,
        items: removeItemRecursive(branch.items, itemId),
      })),
    }));
}

function addBranchItemRecursive(
  items: DPChecklistTemplateItem[],
  parentId: string,
  branchIndex: number,
  item: DPChecklistTemplateItem
): DPChecklistTemplateItem[] {
  return items.map((current) => {
    if (current.id === parentId) {
      return {
        ...current,
        conditionalBranches: (current.conditionalBranches ?? []).map((branch, index) =>
          index === branchIndex
            ? {
                ...branch,
                items: setItemOrder([...(branch.items ?? []), item]),
              }
            : branch
        ),
      };
    }

    return {
      ...current,
      conditionalBranches: (current.conditionalBranches ?? []).map((branch) => ({
        ...branch,
        items: addBranchItemRecursive(branch.items, parentId, branchIndex, item),
      })),
    };
  });
}

function getItemDepth(item: DPChecklistTemplateItem, parentDepth = 1, targetId?: string): number {
  if (!targetId || item.id === targetId) return parentDepth;
  for (const branch of item.conditionalBranches ?? []) {
    for (const child of branch.items) {
      const depth = getItemDepth(child, parentDepth + 1, targetId);
      if (depth > 0) return depth;
    }
  }
  return 0;
}

function formatPercent(value: number | null | undefined) {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [header, payload] = dataUrl.split(",");
  const mimeMatch = /data:(.*?);base64/.exec(header ?? "");
  const mimeType = mimeMatch?.[1] ?? "image/png";
  const binary = atob(payload ?? "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], fileName, { type: mimeType });
}

function getOccurrenceOptions(templateType: DPChecklistTemplateType, types: DPChecklistType[]) {
  const typeDef = getChecklistTypeById(templateType, types);
  const common = [
    { value: "annual", label: "Anual" },
    { value: "custom", label: "Personalizado" },
  ];
  if (typeDef?.isSchedulable) {
    return [
      { value: "daily", label: "Diária" },
      { value: "weekly", label: "Semanal" },
      { value: "biweekly", label: "Quinzenal" },
      { value: "monthly", label: "Mensal" },
      ...common,
    ];
  }
  return [
    { value: "manual", label: "Manual" },
    { value: "weekly", label: "Semanal" },
    { value: "monthly", label: "Mensal" },
    ...common,
  ];
}

const RECURRENCE_OPTIONS: { value: DPChecklistOccurrenceType; label: string }[] = [
  { value: "daily", label: "Diária" },
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "Quinzenal" },
  { value: "monthly", label: "Mensal" },
  { value: "annual", label: "Anual" },
  { value: "custom", label: "Personalizado" },
];

function getExecutionStatusMeta(status: DPChecklistExecution["status"]) {
  if (status === "completed") {
    return { label: "Concluído", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  }
  if (status === "claimed") {
    return { label: "Em andamento", className: "bg-amber-50 text-amber-700 border-amber-200" };
  }
  if (status === "overdue") {
    return { label: "Atrasado", className: "bg-red-50 text-red-700 border-red-200" };
  }
  return { label: "Pendente", className: "bg-slate-50 text-slate-700 border-slate-200" };
}

function getOperationalTaskStatusMeta(status: OperationalTask["status"]) {
  switch (status) {
    case "escalated":
      return { label: "Escalada", className: "bg-red-50 text-red-700 border-red-200" };
    case "in_progress":
      return { label: "Em andamento", className: "bg-amber-50 text-amber-700 border-amber-200" };
    case "resolved":
      return { label: "Resolvida", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "closed":
      return { label: "Fechada", className: "bg-slate-100 text-slate-700 border-slate-200" };
    default:
      return { label: "Aberta", className: "bg-blue-50 text-blue-700 border-blue-200" };
  }
}

function getTemplateTypeBadgeClass(type: DPChecklistTemplateType, types: DPChecklistType[]) {
  const typeDef = getChecklistTypeById(type, types);
  return getTypeColorClasses(typeDef?.colorScheme).badgeCls;
}

function getItemConditionLabel(rule?: DPChecklistConditionalRule) {
  if (!rule?.itemId) return "Sempre visível";
  return `${rule.itemId} ${rule.operator} ${String(rule.value ?? "")}`;
}

function getReferenceLabel(item: Pick<DPChecklistExecutionItem, "referenceValue" | "tolerancePercent" | "config" | "type">) {
  if (
    (item.type === "number" || item.type === "temperature") &&
    typeof item.referenceValue === "number" &&
    typeof item.tolerancePercent === "number"
  ) {
    const margin = Math.abs(item.referenceValue) * (item.tolerancePercent / 100);
    const min = item.referenceValue - margin;
    const max = item.referenceValue + margin;
    return `Referência: ${item.referenceValue}${item.config?.unit ? ` ${item.config.unit}` : ""} ± ${item.tolerancePercent}% (${min.toFixed(1)} – ${max.toFixed(1)})`;
  }

  if (
    (item.type === "number" || item.type === "temperature") &&
    (typeof item.config?.min === "number" || typeof item.config?.max === "number")
  ) {
    return `Faixa: ${item.config?.min ?? "—"} – ${item.config?.max ?? "—"}${item.config?.unit ? ` ${item.config.unit}` : ""}`;
  }

  return null;
}

function TemplateTypeCard({
  type,
  selected,
  onSelect,
  checklistTypes,
}: {
  type: DPChecklistTemplateType;
  selected: boolean;
  onSelect: () => void;
  checklistTypes: DPChecklistType[];
}) {
  const meta = getChecklistTypeById(type, checklistTypes);
  const colors = getTypeColorClasses(meta?.colorScheme);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-xl border p-4 text-left transition hover:border-primary hover:shadow-sm",
        selected ? "border-primary bg-primary/5" : "border-border"
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-foreground">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base", colors.iconBg)}>
            {meta?.emoji ?? "📋"}
          </span>
          <span className="font-semibold">{meta?.name ?? type}</span>
        </div>
        <Badge variant="outline" className="shrink-0">
          {meta?.isSchedulable ? "Automático" : "Manual"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{meta?.description ?? ""}</p>
      <p className="mt-3 text-xs font-medium text-foreground/80">{meta?.behavior ?? ""}</p>
      <p className="mt-2 text-xs text-muted-foreground">{meta?.examples ?? ""}</p>
    </button>
  );
}

function SortableCard({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn("rounded-xl border bg-background", isDragging && "opacity-70")}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm text-muted-foreground">
        <button
          type="button"
          className="cursor-grab rounded p-1 hover:bg-muted"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span>Arraste para reordenar</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function ConditionEditor({
  value,
  items,
  onChange,
}: {
  value?: DPChecklistConditionalRule;
  items: Array<{ id: string; title: string }>;
  onChange: (value?: DPChecklistConditionalRule) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Show if
        </span>
        <Switch
          checked={!!value}
          onCheckedChange={(checked) => onChange(checked ? makeConditionRule() : undefined)}
        />
      </div>
      {value ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Item base</Label>
            <Select
              value={value.itemId}
              onValueChange={(next) => onChange({ ...value, itemId: next })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title || item.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Operador</Label>
            <Select
              value={value.operator}
              onValueChange={(next) =>
                onChange({ ...value, operator: next as DPChecklistConditionalOperator })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITIONAL_OPERATORS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Valor</Label>
            <Input
              value={String(value.value ?? "")}
              onChange={(event) =>
                onChange({
                  ...value,
                  value: event.target.value,
                })
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_LABELS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function AnnualScheduleBuilder({
  value,
  onChange,
}: {
  value: { month: number; day: number };
  onChange: (v: { month: number; day: number }) => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
      <p className="text-xs font-medium text-muted-foreground">Dia e mês de repetição anual</p>
      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Mês</Label>
          <Select
            value={String(value.month)}
            onValueChange={(v) => onChange({ ...value, month: parseInt(v) })}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_LABELS.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-24 space-y-1.5">
          <Label className="text-xs">Dia</Label>
          <Input
            type="number"
            min="1"
            max="31"
            className="h-8 text-sm"
            value={value.day}
            onChange={(e) =>
              onChange({ ...value, day: Math.min(31, Math.max(1, parseInt(e.target.value) || 1)) })
            }
          />
        </div>
      </div>
    </div>
  );
}

function CustomScheduleBuilder({
  value,
  onChange,
}: {
  value: CustomSchedule;
  onChange: (v: CustomSchedule) => void;
}) {
  const modes = value.modes ?? [];
  const hasMode = (m: CustomScheduleMode) => modes.includes(m);

  function toggleMode(m: CustomScheduleMode) {
    const next = hasMode(m) ? modes.filter((x) => x !== m) : [...modes, m];
    onChange({ ...value, modes: next });
  }

  const modeLabels: Record<CustomScheduleMode, string> = {
    weekdays: "Dias da semana",
    monthdays: "Dias do mês",
    interval: "Intervalo (N dias)",
    once: "Data específica",
  };

  return (
    <div className="space-y-3">
      {/* Mode toggles */}
      <div className="flex flex-wrap gap-2">
        {(["weekdays", "monthdays", "interval", "once"] as CustomScheduleMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => toggleMode(m)}
            className={cn(
              "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
              hasMode(m)
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            )}
          >
            {modeLabels[m]}
          </button>
        ))}
      </div>

      {/* Weekdays */}
      {hasMode("weekdays") && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">Dias da semana</p>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, i) => {
              const selected = (value.weekdays ?? []).includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    const next = selected
                      ? (value.weekdays ?? []).filter((d) => d !== i)
                      : [...(value.weekdays ?? []), i].sort((a, b) => a - b);
                    onChange({ ...value, weekdays: next });
                  }}
                  className={cn(
                    "h-8 w-10 rounded-md border text-xs font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Month days */}
      {hasMode("monthdays") && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">Dias do mês</p>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
              const selected = (value.monthdays ?? []).includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    const next = selected
                      ? (value.monthdays ?? []).filter((d) => d !== day)
                      : [...(value.monthdays ?? []), day].sort((a, b) => a - b);
                    onChange({ ...value, monthdays: next });
                  }}
                  className={cn(
                    "h-7 w-7 rounded-md border text-[11px] font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Interval */}
      {hasMode("interval") && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">Intervalo fixo</p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">A cada</span>
            <Input
              type="number"
              min="1"
              max="365"
              className="h-8 w-20 text-sm"
              value={value.intervalDays ?? ""}
              onChange={(e) =>
                onChange({ ...value, intervalDays: parseInt(e.target.value) || undefined })
              }
            />
            <span className="text-sm text-muted-foreground">dias</span>
          </div>
        </div>
      )}

      {/* Specific dates */}
      {hasMode("once") && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">Datas específicas</p>
          <div className="space-y-2">
            {(value.onceDates?.length ? value.onceDates : [""]).map((date, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  type="date"
                  className="h-8 flex-1 text-sm"
                  value={date}
                  onChange={(e) => {
                    const next = [...(value.onceDates ?? [""])];
                    next[idx] = e.target.value;
                    onChange({ ...value, onceDates: next });
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    const next = (value.onceDates ?? []).filter((_, i) => i !== idx);
                    onChange({ ...value, onceDates: next.length ? next : undefined });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                onChange({ ...value, onceDates: [...(value.onceDates ?? []), ""] })
              }
            >
              <Plus className="mr-1 h-3 w-3" /> Adicionar data
            </Button>
          </div>
        </div>
      )}

      {modes.length === 0 && (
        <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
          Selecione ao menos um modo de recorrência acima.
        </p>
      )}
    </div>
  );
}

function ChecklistPhotoField({
  item,
  disabled,
  onChange,
}: {
  item: DPChecklistExecutionItem;
  disabled?: boolean;
  onChange: (patch: Partial<DPChecklistExecutionItem>) => void;
}) {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [uploading, setUploading] = React.useState(false);
  const photoUrls = item.photoUrls ?? [];
  const maxPhotos = item.config?.maxPhotos ?? 5;
  const remainingSlots = Math.max(0, maxPhotos - photoUrls.length);

  async function handleUpload(files: FileList | null) {
    if (!firebaseUser || !files || files.length === 0 || remainingSlots === 0) {
      return;
    }

    setUploading(true);
    try {
      const nextUrls = [...photoUrls];
      for (const file of Array.from(files).slice(0, remainingSlots)) {
        const uploaded = await uploadDPChecklistAsset(firebaseUser, {
          file,
          kind: "photo",
        });
        nextUrls.push(uploaded.assetUrl);
      }
      onChange({ photoUrls: nextUrls });
    } catch (error) {
      toast({
        title: "Falha ao enviar foto",
        description:
          error instanceof Error ? error.message : "Erro inesperado no upload.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label
          htmlFor={`photo-upload-${item.templateItemId}`}
          className={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
            (disabled || uploading || remainingSlots === 0) &&
              "pointer-events-none opacity-60"
          )}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
          {uploading ? "Enviando..." : "Adicionar foto"}
        </Label>
        <Input
          id={`photo-upload-${item.templateItemId}`}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          disabled={disabled || uploading || remainingSlots === 0}
          onChange={(event) => {
            void handleUpload(event.target.files);
            event.target.value = "";
          }}
        />
        <span className="text-xs text-muted-foreground">
          {photoUrls.length}/{maxPhotos} foto(s)
        </span>
      </div>

      {photoUrls.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {photoUrls.map((url, index) => (
            <div key={`${url}-${index}`} className="relative overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Foto ${index + 1}`}
                className="h-40 w-full object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute right-2 top-2 h-7 w-7"
                onClick={() =>
                  onChange({
                    photoUrls: photoUrls.filter((_, photoIndex) => photoIndex !== index),
                  })
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChecklistSignatureField({
  item,
  disabled,
  onChange,
}: {
  item: DPChecklistExecutionItem;
  disabled?: boolean;
  onChange: (patch: Partial<DPChecklistExecutionItem>) => void;
}) {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [uploading, setUploading] = React.useState(false);
  const signatureRef = React.useRef<SignatureCanvas | null>(null);

  async function handleSaveSignature() {
    if (!firebaseUser || !signatureRef.current || signatureRef.current.isEmpty()) {
      toast({
        title: "Assinatura vazia",
        description: "Desenhe a assinatura antes de salvar.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const dataUrl = signatureRef.current
        .getTrimmedCanvas()
        .toDataURL("image/png");
      const file = dataUrlToFile(
        dataUrl,
        `assinatura-${item.templateItemId}.png`
      );
      const uploaded = await uploadDPChecklistAsset(firebaseUser, {
        file,
        kind: "signature",
      });
      onChange({ signatureUrl: uploaded.assetUrl });
      signatureRef.current.clear();
    } catch (error) {
      toast({
        title: "Falha ao salvar assinatura",
        description:
          error instanceof Error ? error.message : "Erro inesperado no upload.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-white p-2">
        <SignatureCanvas
          ref={signatureRef}
          penColor="#111827"
          canvasProps={{
            className: "h-40 w-full rounded-md",
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => signatureRef.current?.clear()}
          disabled={disabled || uploading}
        >
          Limpar
        </Button>
        <Button
          type="button"
          onClick={() => void handleSaveSignature()}
          disabled={disabled || uploading}
        >
          {uploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PenTool className="mr-2 h-4 w-4" />
          )}
          Salvar assinatura
        </Button>
        {item.signatureUrl ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange({ signatureUrl: undefined })}
            disabled={disabled || uploading}
          >
            Remover
          </Button>
        ) : null}
      </div>

      {item.signatureUrl ? (
        <div className="overflow-hidden rounded-lg border bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.signatureUrl}
            alt="Assinatura enviada"
            className="h-28 w-full object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}

const TASK_STATUS_LABELS: Record<string, string> = {
  open: "Aberta",
  in_progress: "Em andamento",
  resolved: "Resolvida",
  escalated: "Escalada",
  closed: "Encerrada",
};

function SectionActionPlan({
  items,
  tasks,
}: {
  items: DPChecklistExecutionItem[];
  tasks: OperationalTask[];
}) {
  const [open, setOpen] = React.useState(false);

  const openTasks = items
    .filter((item) => item.linkedTaskId)
    .map((item) => ({
      item,
      task: tasks.find((t) => t.id === item.linkedTaskId),
    }))
    .filter(
      ({ task }) => task && task.status !== "resolved" && task.status !== "closed"
    ) as { item: DPChecklistExecutionItem; task: OperationalTask }[];

  if (openTasks.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>
              {openTasks.length === 1
                ? "1 tarefa corretiva aberta"
                : `${openTasks.length} tarefas corretivas abertas`}
            </span>
          </div>
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {openTasks.map(({ item, task }) => (
          <div
            key={task.id}
            className="flex items-start justify-between rounded-lg border border-orange-100 bg-white px-4 py-3 text-sm"
          >
            <div className="space-y-0.5">
              <p className="font-medium">{item.title}</p>
              {task.assignedToUserName ? (
                <p className="text-xs text-muted-foreground">
                  Responsável: {task.assignedToUserName}
                </p>
              ) : null}
            </div>
            <Badge
              variant="outline"
              className={cn(
                task.status === "escalated"
                  ? "border-red-400 bg-red-50 text-red-700"
                  : "border-orange-400 bg-orange-50 text-orange-700"
              )}
            >
              {TASK_STATUS_LABELS[task.status] ?? task.status}
            </Badge>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ExecutionItemField({
  item,
  disabled,
  linkedTask,
  onChange,
}: {
  item: DPChecklistExecutionItem;
  disabled?: boolean;
  linkedTask?: OperationalTask;
  onChange: (patch: Partial<DPChecklistExecutionItem>) => void;
}) {
  const referenceLabel = getReferenceLabel(item);
  const [taskPopoverOpen, setTaskPopoverOpen] = React.useState(false);
  const hasOpenTask =
    linkedTask &&
    linkedTask.status !== "resolved" &&
    linkedTask.status !== "closed";

  return (
    <div className={cn("space-y-3 rounded-xl border p-4 transition-all", CRITICALITY_CLASSES[item.criticality], disabled && "pointer-events-none opacity-40")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium">{item.title}</p>
            {item.criticality !== "low" ? (
              <Badge variant="outline">{item.criticality}</Badge>
            ) : null}
            {item.actionRequired ? (
              <Badge variant="destructive">Ação obrigatória</Badge>
            ) : null}
            {hasOpenTask ? (
              <Popover open={taskPopoverOpen} onOpenChange={setTaskPopoverOpen}>
                <PopoverTrigger asChild>
                  <Badge
                    variant="outline"
                    className="cursor-pointer border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100"
                  >
                    <ClipboardList className="mr-1 h-3 w-3" />
                    Tarefa aberta
                  </Badge>
                </PopoverTrigger>
                <PopoverContent className="w-72 space-y-3" align="start">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plano de ação</p>
                    <p className="mt-1 font-medium text-sm">{linkedTask.description || linkedTask.itemTitle}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Status</p>
                      <p className="font-medium">{TASK_STATUS_LABELS[linkedTask.status] ?? linkedTask.status}</p>
                    </div>
                    {linkedTask.assignedToUserName ? (
                      <div>
                        <p className="text-muted-foreground">Responsável</p>
                        <p className="font-medium">{linkedTask.assignedToUserName}</p>
                      </div>
                    ) : null}
                    {linkedTask.slaDeadlineAt ? (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Prazo SLA</p>
                        <p className="font-medium">
                          {format(
                            new Date(
                              typeof linkedTask.slaDeadlineAt === "string"
                                ? linkedTask.slaDeadlineAt
                                : (linkedTask.slaDeadlineAt as { toDate(): Date }).toDate()
                            ),
                            "dd/MM/yyyy HH:mm",
                            { locale: ptBR }
                          )}
                        </p>
                      </div>
                    ) : null}
                    {linkedTask.resolutionNotes ? (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Observação</p>
                        <p className="font-medium">{linkedTask.resolutionNotes}</p>
                      </div>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
          {item.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
          ) : null}
          {referenceLabel ? (
            <p className="mt-2 text-xs text-muted-foreground">{referenceLabel}</p>
          ) : null}
        </div>
        {item.branchPath?.length ? (
          <Badge variant="secondary">{`Nível ${item.branchPath.length + 1}`}</Badge>
        ) : null}
      </div>

      {item.type === "checkbox" ? (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={item.checked === true}
            onCheckedChange={(checked) => onChange({ checked: checked === true })}
          />
          <span className="text-sm text-muted-foreground">Marcar como conforme</span>
        </div>
      ) : null}

      {item.type === "yes_no" ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-16 flex-1 text-base font-semibold transition-all",
              item.yesNoValue === true
                ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600/90 hover:text-white"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            )}
            onClick={() => onChange({ yesNoValue: true })}
          >
            Sim — Conforme
          </Button>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-16 flex-1 text-base font-semibold transition-all",
              item.yesNoValue === false
                ? "border-red-600 bg-red-600 text-white hover:bg-red-600/90 hover:text-white"
                : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            )}
            onClick={() => onChange({ yesNoValue: false })}
          >
            Não — Problema
          </Button>
        </div>
      ) : null}

      {item.type === "text" ? (
        <Input
          value={item.textValue ?? ""}
          onChange={(event) => onChange({ textValue: event.target.value })}
          placeholder="Digite a resposta"
        />
      ) : null}

      {item.type === "select" ? (
        <Select
          value={
            item.textValue && (item.config?.options ?? []).includes(item.textValue)
              ? item.textValue
              : undefined
          }
          onValueChange={(value) => onChange({ textValue: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione uma opção" />
          </SelectTrigger>
          <SelectContent>
            {(item.config?.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {item.type === "multi_select" ? (
        <MultiSelect
          options={(item.config?.options ?? []).map((option) => ({
            value: option,
            label: option,
          }))}
          selected={item.multiValues ?? []}
          onChange={(values) => onChange({ multiValues: values })}
          placeholder="Selecione as opções"
        />
      ) : null}

      {item.type === "date" ? (
        <Input
          type="date"
          value={item.dateValue ?? ""}
          onChange={(event) => onChange({ dateValue: event.target.value })}
        />
      ) : null}

      {(item.type === "number" || item.type === "temperature") ? (
        <div className="space-y-2">
          <Input
            type="number"
            value={item.numberValue ?? ""}
            onChange={(event) =>
              onChange({
                numberValue:
                  event.target.value === "" ? undefined : Number(event.target.value),
              })
            }
          />
          {typeof item.numberValue === "number" ? (
            <Badge variant={item.isOutOfRange ? "destructive" : "secondary"}>
              {item.isOutOfRange ? "Fora da faixa" : "Dentro da faixa"}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {item.type === "photo" ? (
        <ChecklistPhotoField item={item} disabled={disabled} onChange={onChange} />
      ) : null}

      {item.type === "signature" ? (
        <ChecklistSignatureField item={item} disabled={disabled} onChange={onChange} />
      ) : null}
    </div>
  );
}

function ItemEditor({
  item,
  allItems,
  onChange,
  onRemove,
  onAddBranch,
  onAddBranchItem,
}: {
  item: DPChecklistTemplateItem;
  allItems: Array<{ id: string; title: string }>;
  onChange: (next: DPChecklistTemplateItem) => void;
  onRemove: () => void;
  onAddBranch: () => void;
  onAddBranchItem: (branchIndex: number) => void;
}) {
  const depth = item.conditionalBranches?.length
    ? Math.max(1, ...item.conditionalBranches.flatMap((branch) =>
        branch.items.map((child) => getItemDepth(child, 2))
      ))
    : 1;

  return (
    <div className={cn("space-y-4 rounded-xl border p-4", CRITICALITY_CLASSES[item.criticality])}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{`Nível ${Math.max(1, depth)}`}</Badge>
          <span className="text-sm text-muted-foreground">{item.id}</span>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Título</Label>
          <Input value={item.title} onChange={(event) => onChange({ ...item, title: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select value={item.type} onValueChange={(value) => onChange({ ...item, type: value as DPChecklistItemType })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITEM_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Descrição</Label>
        <Textarea value={item.description ?? ""} onChange={(event) => onChange({ ...item, description: event.target.value })} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-2">
          <Label>Peso</Label>
          <Input
            type="number"
            min={0}
            max={10}
            value={item.weight}
            onChange={(event) =>
              onChange({ ...item, weight: Number(event.target.value || 0) })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>Criticidade</Label>
          <Select
            value={item.criticality}
            onValueChange={(value) =>
              onChange({ ...item, criticality: value as DPChecklistCriticality })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CRITICALITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <div>
            <p className="text-sm font-medium">Obrigatório</p>
            <p className="text-xs text-muted-foreground">Exige resposta válida</p>
          </div>
          <Switch
            checked={item.required}
            onCheckedChange={(checked) => onChange({ ...item, required: checked })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <div>
            <p className="text-sm font-medium">Bloqueia próximos</p>
            <p className="text-xs text-muted-foreground">Sequência obrigatória</p>
          </div>
          <Switch
            checked={item.blockNext}
            onCheckedChange={(checked) => onChange({ ...item, blockNext: checked })}
          />
        </div>
      </div>

      {(item.type === "select" || item.type === "multi_select") ? (
        <div className="space-y-2">
          <Label>Opções</Label>
          <Textarea
            value={(item.config?.options ?? []).join("\n")}
            onChange={(event) =>
              onChange({
                ...item,
                config: {
                  ...(item.config ?? {}),
                  options: event.target.value
                    .split("\n")
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                },
              })
            }
            placeholder="Uma opção por linha"
          />
        </div>
      ) : null}

      {(item.type === "number" || item.type === "temperature") ? (
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Referência</Label>
            <Input
              type="number"
              value={item.referenceValue ?? ""}
              onChange={(event) =>
                onChange({
                  ...item,
                  referenceValue:
                    event.target.value === "" ? undefined : Number(event.target.value),
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Tolerância (%)</Label>
            <Input
              type="number"
              value={item.tolerancePercent ?? ""}
              onChange={(event) =>
                onChange({
                  ...item,
                  tolerancePercent:
                    event.target.value === "" ? undefined : Number(event.target.value),
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Mínimo</Label>
            <Input
              type="number"
              value={item.config?.min ?? ""}
              onChange={(event) =>
                onChange({
                  ...item,
                  config: {
                    ...(item.config ?? {}),
                    min:
                      event.target.value === "" ? undefined : Number(event.target.value),
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Máximo</Label>
            <Input
              type="number"
              value={item.config?.max ?? ""}
              onChange={(event) =>
                onChange({
                  ...item,
                  config: {
                    ...(item.config ?? {}),
                    max:
                      event.target.value === "" ? undefined : Number(event.target.value),
                  },
                })
              }
            />
          </div>
        </div>
      ) : null}

      <ConditionEditor
        value={item.showIf}
        items={allItems}
        onChange={(showIf) => onChange({ ...item, showIf })}
      />

      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Ação obrigatória</p>
            <p className="text-xs text-muted-foreground">
              Cria tarefa operacional quando o item falhar
            </p>
          </div>
          <Switch
            checked={item.actionRequired ?? false}
            onCheckedChange={(checked) =>
              onChange({ ...item, actionRequired: checked })
            }
          />
        </div>

        {item.actionRequired ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Role IDs notificados</Label>
              <Input
                value={(item.notifyRoleIds ?? []).join(",")}
                onChange={(event) =>
                  onChange({
                    ...item,
                    notifyRoleIds: event.target.value
                      .split(",")
                      .map((entry) => entry.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="role-a, role-b"
              />
            </div>
            <div className="space-y-2">
              <Label>SLA (minutos)</Label>
              <Input
                type="number"
                value={item.escalationMinutes ?? ""}
                onChange={(event) =>
                  onChange({
                    ...item,
                    escalationMinutes:
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                  })
                }
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border border-dashed p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Branches condicionais</p>
            <p className="text-xs text-muted-foreground">
              Até 4 níveis de profundidade
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onAddBranch}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar branch
          </Button>
        </div>

        {(item.conditionalBranches ?? []).map((branch, branchIndex) => (
          <div key={`${item.id}-${branchIndex}`} className="space-y-3 rounded-lg border p-3">
            <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <Label>Valor gatilho</Label>
                <Input
                  value={String(branch.value ?? "")}
                  onChange={(event) =>
                    onChange({
                      ...item,
                      conditionalBranches: (item.conditionalBranches ?? []).map((current, index) =>
                        index === branchIndex
                          ? { ...current, value: event.target.value }
                          : current
                      ),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Rótulo</Label>
                <Input
                  value={branch.label}
                  onChange={(event) =>
                    onChange({
                      ...item,
                      conditionalBranches: (item.conditionalBranches ?? []).map((current, index) =>
                        index === branchIndex
                          ? { ...current, label: event.target.value }
                          : current
                      ),
                    })
                  }
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onAddBranchItem(branchIndex)}
                  disabled={getItemDepth(item) >= 4}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Subitem
                </Button>
              </div>
            </div>

            <div className="space-y-3 border-l pl-3">
              {branch.items.map((child) => (
                <ItemEditor
                  key={child.id}
                  item={child}
                  allItems={allItems}
                  onChange={(next) =>
                    onChange({
                      ...item,
                      conditionalBranches: (item.conditionalBranches ?? []).map((current, index) =>
                        index === branchIndex
                          ? {
                              ...current,
                              items: updateItemRecursive(current.items, child.id, () => next),
                            }
                          : current
                      ),
                    })
                  }
                  onRemove={() =>
                    onChange({
                      ...item,
                      conditionalBranches: (item.conditionalBranches ?? []).map((current, index) =>
                        index === branchIndex
                          ? {
                              ...current,
                              items: setItemOrder(removeItemRecursive(current.items, child.id)),
                            }
                          : current
                      ),
                    })
                  }
                  onAddBranch={() =>
                    onChange({
                      ...item,
                      conditionalBranches: (item.conditionalBranches ?? []).map((current, index) =>
                        index === branchIndex
                          ? {
                              ...current,
                              items: updateItemRecursive(current.items, child.id, (currentItem) => ({
                                ...currentItem,
                                conditionalBranches: [
                                  ...(currentItem.conditionalBranches ?? []),
                                  {
                                    value: "",
                                    label: "",
                                    items: [],
                                  },
                                ],
                              })),
                            }
                          : current
                      ),
                    })
                  }
                  onAddBranchItem={(nestedBranchIndex) =>
                    onChange({
                      ...item,
                      conditionalBranches: (item.conditionalBranches ?? []).map((current, index) =>
                        index === branchIndex
                          ? {
                              ...current,
                              items: addBranchItemRecursive(
                                current.items,
                                child.id,
                                nestedBranchIndex,
                                makeDefaultItem(0, 4)
                              ),
                            }
                          : current
                      ),
                    })
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewMetricCard({
  label,
  value,
  subtitle,
  tone,
  bars,
}: {
  label: string;
  value: string;
  subtitle: string;
  tone: "emerald" | "amber" | "red" | "blue";
  bars: number[];
}) {
  const toneClasses = {
    emerald: {
      value: "text-emerald-700",
      surface: "bg-emerald-50",
      border: "border-emerald-200",
      bar: "bg-emerald-500/90",
      footer: "bg-emerald-500",
    },
    amber: {
      value: "text-amber-700",
      surface: "bg-amber-50",
      border: "border-amber-200",
      bar: "bg-amber-500/90",
      footer: "bg-amber-500",
    },
    red: {
      value: "text-red-700",
      surface: "bg-red-50",
      border: "border-red-200",
      bar: "bg-red-500/90",
      footer: "bg-red-500",
    },
    blue: {
      value: "text-blue-700",
      surface: "bg-blue-50",
      border: "border-blue-200",
      bar: "bg-blue-500/90",
      footer: "bg-blue-500",
    },
  } as const;

  const palette = toneClasses[tone];

  return (
    <Card className={cn("overflow-hidden border", palette.border)}>
      <CardContent className={cn("relative p-5", palette.surface)}>
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={cn("text-3xl font-semibold tracking-tight", palette.value)}>{value}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="mt-5 flex h-7 items-end gap-1">
          {bars.map((height, index) => (
            <div
              key={`${label}-${index}`}
              className={cn("flex-1 rounded-t-sm", palette.bar)}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </CardContent>
      <div className={cn("h-1 w-full", palette.footer)} />
    </Card>
  );
}

function ChecklistKpiCard({
  icon, label, value, tone,
}: { icon: string; label: string; value: number; tone: 'amber' | 'blue' | 'emerald' | 'red' }) {
  const bg = { amber: 'bg-amber-50', blue: 'bg-blue-50', emerald: 'bg-emerald-50', red: 'bg-red-50' }[tone];
  return (
    <div className="rounded-xl border bg-card px-4 py-3 flex items-center gap-3">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg', bg)}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function ExecutionOverviewCard({
  execution,
  onOpen,
  disabled,
}: {
  execution: DPChecklistExecution;
  onOpen: (execution: DPChecklistExecution) => void | Promise<void>;
  disabled?: boolean;
}) {
  const metrics = getChecklistExecutionMetrics({ execution });
  const statusMeta = getExecutionStatusMeta(execution.status);
  const isUrgent = metrics.isOverdue || metrics.criticalAlerts > 0;
  const progressLabel = `${metrics.completedItems} de ${metrics.activeItems} respondidos`;
  const requiredPending = Math.max(
    metrics.requiredItems - metrics.completedRequiredItems,
    0
  );

  const totalItems = execution.items?.length ?? 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-background shadow-sm transition hover:shadow-md flex",
        isUrgent ? "border-red-200 border-l-[3px] border-l-red-500" : "border-border"
      )}
    >
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center flex-1 min-w-0">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg",
              isUrgent ? "bg-red-50" : execution.status === "completed" ? "bg-emerald-50" : "bg-slate-50"
            )}
          >
            {execution.status === "completed" ? "✓" : execution.status === "claimed" ? "▶" : "🗒️"}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="space-y-0.5">
              <p className="truncate font-semibold text-sm" title={execution.templateName}>
                {execution.templateName}
              </p>
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {execution.shiftStartTime && execution.shiftEndTime
                    ? `${execution.shiftStartTime}–${execution.shiftEndTime}`
                    : "Fluxo manual"}
                </span>
                {metrics.requiredItems > 0 && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>Obrigatório</span>
                  </>
                )}
                {totalItems > 0 && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>{totalItems} itens</span>
                  </>
                )}
              </p>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  metrics.isOverdue ? "bg-red-500" : "bg-blue-500"
                )}
                style={{ width: `${Math.max(metrics.completionPercent, 4)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 lg:shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary shrink-0">
              {getInitials(execution.claimedByUsername ?? execution.assignedUsername)}
            </div>
            {execution.status === "claimed" && metrics.completionPercent > 0 && (
              <Badge variant="outline" className="text-[10px] font-semibold text-blue-600 border-blue-200 bg-blue-50">
                ▶ {metrics.completedItems}/{metrics.activeItems}
              </Badge>
            )}
            {execution.status === "completed" && (
              <Badge variant="outline" className="text-[10px] font-semibold text-emerald-600 border-emerald-200 bg-emerald-50">
                ✓ Concluído
              </Badge>
            )}
            {isUrgent && execution.status !== "completed" && (
              <Badge variant="outline" className="text-[10px] font-semibold text-amber-600 border-amber-200 bg-amber-50">
                ⚠ Atrasado
              </Badge>
            )}
          </div>

          <Button
            type="button"
            size="sm"
            variant={execution.status === "completed" ? "outline" : "default"}
            onClick={() => void onOpen(execution)}
            disabled={disabled}
          >
            {execution.status === "claimed"
              ? "Continuar"
              : execution.status === "completed"
                ? "Ver"
                : "Iniciar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const COLOR_SCHEME_OPTIONS: { value: DPChecklistType["colorScheme"]; label: string }[] = [
  { value: "emerald", label: "Verde" },
  { value: "indigo", label: "Índigo" },
  { value: "amber", label: "Âmbar" },
  { value: "violet", label: "Violeta" },
  { value: "blue", label: "Azul" },
  { value: "orange", label: "Laranja" },
  { value: "red", label: "Vermelho" },
  { value: "gray", label: "Cinza" },
];

type TypeDraft = {
  name: string;
  emoji: string;
  description: string;
  examples: string;
  behavior: string;
  configBanner: string;
  isSchedulable: boolean;
  colorScheme: DPChecklistType["colorScheme"];
};

function makeTypeDraft(): TypeDraft {
  return {
    name: "",
    emoji: "📋",
    description: "",
    examples: "",
    behavior: "",
    configBanner: "",
    isSchedulable: false,
    colorScheme: "gray",
  };
}

function ChecklistTypesManager({
  checklistTypes,
  firebaseUser,
  onRefresh,
}: {
  checklistTypes: DPChecklistType[];
  firebaseUser: { getIdToken: (forceRefresh?: boolean) => Promise<string> } | null;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [editingType, setEditingType] = React.useState<DPChecklistType | null>(null);
  const [draft, setDraft] = React.useState<TypeDraft>(makeTypeDraft());
  const [saving, setSaving] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  function openCreate() {
    setEditingType(null);
    setDraft(makeTypeDraft());
    setOpen(true);
  }

  function openEdit(typeDef: DPChecklistType) {
    setEditingType(typeDef);
    setDraft({
      name: typeDef.name,
      emoji: typeDef.emoji,
      description: typeDef.description,
      examples: typeDef.examples,
      behavior: typeDef.behavior,
      configBanner: typeDef.configBanner,
      isSchedulable: typeDef.isSchedulable,
      colorScheme: typeDef.colorScheme,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!firebaseUser || !draft.name.trim() || !draft.emoji.trim()) {
      toast({ title: "Preencha nome e emoji.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editingType) {
        await updateDPChecklistType(firebaseUser, editingType.id, draft);
        toast({ title: "Tipo atualizado." });
      } else {
        await createDPChecklistType(firebaseUser, { ...draft, isActive: true });
        toast({ title: "Tipo criado." });
      }
      setOpen(false);
      onRefresh();
    } catch (e) {
      toast({
        title: "Erro ao salvar",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(typeDef: DPChecklistType) {
    if (!firebaseUser) return;
    setDeletingId(typeDef.id);
    try {
      await deleteDPChecklistType(firebaseUser, typeDef.id);
      toast({ title: `Tipo "${typeDef.name}" excluído.` });
      onRefresh();
    } catch (e) {
      toast({
        title: "Não foi possível excluir",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Tipos de checklist</CardTitle>
            <CardDescription>
              Configure os tipos disponíveis para templates e execuções manuais.
            </CardDescription>
          </div>
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Novo tipo
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {checklistTypes.map((typeDef) => {
            const colors = getTypeColorClasses(typeDef.colorScheme);
            return (
              <div
                key={typeDef.id}
                className="flex items-start gap-3 rounded-xl border bg-card p-4"
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg",
                    colors.iconBg
                  )}
                >
                  {typeDef.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{typeDef.name}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {typeDef.description || "Sem descrição."}
                  </p>
                  <Badge
                    variant="outline"
                    className={cn("mt-1.5 text-[10px]", colors.tagCls)}
                  >
                    {typeDef.isSchedulable ? "Automático" : "Manual"}
                  </Badge>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(typeDef)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    disabled={deletingId === typeDef.id}
                    onClick={() => void handleDelete(typeDef)}
                  >
                    {deletingId === typeDef.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingType ? "Editar tipo" : "Novo tipo de checklist"}</DialogTitle>
            <DialogDescription>
              Defina como esse tipo vai aparecer nas seleções de template e execução manual.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-[64px_1fr] gap-3">
              <div className="space-y-1">
                <Label>Emoji</Label>
                <Input
                  value={draft.emoji}
                  onChange={(e) => setDraft((d) => ({ ...d, emoji: e.target.value }))}
                  className="text-center text-xl"
                  maxLength={4}
                />
              </div>
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Ex: Temperatura, Abertura, Higienização"
                  maxLength={60}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Descrição</Label>
              <Input
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Para que serve esse tipo de checklist?"
                maxLength={300}
              />
            </div>

            <div className="space-y-1">
              <Label>Exemplos de uso</Label>
              <Input
                value={draft.examples}
                onChange={(e) => setDraft((d) => ({ ...d, examples: e.target.value }))}
                placeholder="Ex: Câmara fria, abertura do dia, controle de validade"
                maxLength={200}
              />
            </div>

            <div className="space-y-1">
              <Label>Como funciona</Label>
              <Input
                value={draft.behavior}
                onChange={(e) => setDraft((d) => ({ ...d, behavior: e.target.value }))}
                placeholder="Ex: Preenchido pelo operador no início do turno."
                maxLength={200}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Cor</Label>
                <Select
                  value={draft.colorScheme}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, colorScheme: v as DPChecklistType["colorScheme"] }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLOR_SCHEME_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Geração</Label>
                <Select
                  value={draft.isSchedulable ? "auto" : "manual"}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, isSchedulable: v === "auto" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="auto">Automático (scheduler)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingType ? "Salvar alterações" : "Criar tipo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function DPChecklistsV2Page() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { firebaseUser, activeUsers } = useAuth();
  const { units, shiftDefinitions } = useDPBootstrap();
  const { toast } = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [selectedDate, setSelectedDate] = React.useState(toDateInputValue());
  const [payload, setPayload] = React.useState<DPChecklistBootstrapPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [statusFilter, setStatusFilter] = React.useState<'all' | 'pending' | 'claimed' | 'completed' | 'overdue'>('all');

  const [templateDialogOpen, setTemplateDialogOpen] = React.useState(false);
  const [templateStep, setTemplateStep] = React.useState<"type" | "config" | "builder">("type");
  const [templateDraft, setTemplateDraft] = React.useState<TemplateDraft>(makeTemplateDraft());

  const [manualDialogOpen, setManualDialogOpen] = React.useState(false);
  const [manualStep, setManualStep] = React.useState<"type" | "config" | "builder">("type");
  const [manualDraft, setManualDraft] = React.useState<ManualDraft>(makeManualDraft());

  const [selectedExecution, setSelectedExecution] = React.useState<DPChecklistExecution | null>(null);
  const [executionDraft, setExecutionDraft] = React.useState<DPChecklistExecution | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [sectionsMode, setSectionsMode] = React.useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('checklist-sections-mode') === 'true'
  );
  const [sectionIdx, setSectionIdx] = React.useState(0);
  const toggleSectionsMode = React.useCallback(() => {
    setSectionsMode(prev => {
      localStorage.setItem('checklist-sections-mode', String(!prev));
      return !prev;
    });
    setSectionIdx(0);
  }, []);
  const requestedTab =
    searchParams.get("tab") === "templates"
      ? "templates"
      : searchParams.get("tab") === "analytics"
        ? "analytics"
        : "operations";
  const executionQueryId = searchParams.get("executionId");
  const [activeTab, setActiveTab] = React.useState<"operations" | "templates" | "analytics">(
    requestedTab
  );
  const openedExecutionIdRef = React.useRef<string | null>(null);

  const syncChecklistRoute = React.useCallback(
    (
      nextTab: "operations" | "templates" | "analytics",
      nextExecutionId?: string | null
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", nextTab);
      if (nextExecutionId) {
        params.set("executionId", nextExecutionId);
      } else {
        params.delete("executionId");
      }
      const query = params.toString();
      router.replace(query ? `/dashboard/dp/checklists?${query}` : "/dashboard/dp/checklists");
    },
    [router, searchParams]
  );

  React.useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab]);

  React.useEffect(() => {
    if (!executionQueryId) {
      openedExecutionIdRef.current = null;
    }
  }, [executionQueryId]);

  const load = React.useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const nextPayload = await fetchDPChecklistBootstrap(firebaseUser, {
        date: selectedDate,
      });
      setPayload(nextPayload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Falha ao carregar o módulo de checklists."
      );
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, selectedDate]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const templateOptions = React.useMemo(
    () => payload?.templates ?? [],
    [payload?.templates]
  );

  const checklistTypes = React.useMemo(
    () => resolveChecklistTypes(payload?.checklistTypes),
    [payload?.checklistTypes]
  );

  const allTemplateItems = React.useMemo(() => {
    return templateDraft.sections.flatMap((section) =>
      collectTemplateItemOptions(section.items)
    );
  }, [templateDraft.sections]);

  const executionActiveItems = React.useMemo(() => {
    if (!executionDraft) return [] as DPChecklistExecutionItem[];
    return getActiveExecutionItems(
      executionDraft.items,
      buildExecutionAnswerMap(executionDraft.items)
    );
  }, [executionDraft]);
  const executionMetrics = React.useMemo(
    () =>
      executionDraft
        ? getChecklistExecutionMetrics({
            execution: executionDraft,
          })
        : null,
    [executionDraft]
  );

  const sectionBlockedAt = React.useMemo(() => {
    if (!executionDraft) return 0;
    const answers = buildExecutionAnswerMap(executionDraft.items);
    for (let s = 0; s < executionDraft.sections.length; s++) {
      const section = executionDraft.sections[s];
      const items = getActiveExecutionItems(
        executionDraft.items.filter(item => item.sectionId === section.id),
        answers
      );
      for (const item of items) {
        if (item.blockNext && !isChecklistExecutionItemCompleted(item)) return s;
      }
    }
    return executionDraft.sections.length;
  }, [executionDraft]);

  React.useEffect(() => {
    if (sectionsMode && executionDraft) {
      setSectionIdx(i => Math.min(i, Math.max(0, executionDraft.sections.length - 1)));
    }
  }, [executionDraft?.sections.length, sectionsMode]);

  const previewExecution = React.useMemo(() => {
    const sections = buildChecklistExecutionSections(templateDraft.sections);
    const items = buildChecklistExecutionItems(templateDraft.sections);
    return {
      id: "preview",
      checklistDate: selectedDate,
      templateId: templateDraft.id ?? "draft",
      templateName: templateDraft.name || "Preview",
      templateType: templateDraft.templateType,
      templateVersion: 1,
      occurrenceType: templateDraft.occurrenceType,
      scheduleId: "preview",
      shiftId: "preview",
      unitId: templateDraft.unitIds[0] ?? "",
      unitName:
        units.find((unit) => unit.id === templateDraft.unitIds[0])?.name ?? "—",
      shiftDefinitionId: templateDraft.shiftDefinitionIds[0] ?? null,
      shiftDefinitionName:
        shiftDefinitions.find((shift) => shift.id === templateDraft.shiftDefinitionIds[0])?.name ??
        undefined,
      assignedUserId: "preview",
      assignedUsername: "Operador",
      sections,
      shiftStartTime: "",
      shiftEndTime: "",
      shiftEndDate: selectedDate,
      status: "pending" as const,
      score: undefined,
      items,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies DPChecklistExecution;
  }, [selectedDate, shiftDefinitions, templateDraft, units]);
  const [previewItems, setPreviewItems] = React.useState<DPChecklistExecutionItem[]>(previewExecution.items);

  React.useEffect(() => {
    setPreviewItems(previewExecution.items);
  }, [previewExecution]);

  async function handleGenerateExecutions() {
    if (!firebaseUser) return;
    setBusy("generate");
    try {
      await generateDPChecklistExecutions(firebaseUser, { date: selectedDate });
      toast({ title: "Checklists gerados." });
      await load();
    } catch (requestError) {
      toast({
        title: "Falha ao gerar checklists",
        description:
          requestError instanceof Error ? requestError.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveTemplate() {
    if (!firebaseUser) return;

    const effectiveOccurrence =
      templateDraft.templateType === "incident" ||
      templateDraft.templateType === "one_time" ||
      templateDraft.templateType === "receiving"
        ? "manual"
        : templateDraft.occurrenceType;

    const body = {
      name: templateDraft.name,
      description: templateDraft.description || undefined,
      category: templateDraft.category || undefined,
      templateType: templateDraft.templateType,
      occurrenceType: effectiveOccurrence,
      annualSchedule:
        effectiveOccurrence === "annual" ? templateDraft.annualSchedule : undefined,
      customSchedule:
        effectiveOccurrence === "custom" ? templateDraft.customSchedule : undefined,
      unitIds: templateDraft.unitIds,
      jobRoleIds: templateDraft.jobRoleIds,
      jobFunctionIds: templateDraft.jobFunctionIds,
      shiftDefinitionIds: templateDraft.shiftDefinitionIds,
      isActive: templateDraft.isActive,
      changeNotes: templateDraft.changeNotes || undefined,
      sections: setSectionOrder(templateDraft.sections).map((section, sectionIndex) => ({
        ...section,
        order: sectionIndex,
        items: setItemOrder(section.items),
      })),
    };

    setBusy("template");
    try {
      if (templateDraft.id) {
        await updateDPChecklistTemplate(firebaseUser, templateDraft.id, body);
      } else {
        await createDPChecklistTemplate(firebaseUser, body);
      }
      toast({ title: "Template salvo." });
      setTemplateDialogOpen(false);
      setTemplateDraft(makeTemplateDraft());
      await load();
    } catch (requestError) {
      toast({
        title: "Falha ao salvar template",
        description:
          requestError instanceof Error ? requestError.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateManualExecution() {
    if (!firebaseUser) return;
    setBusy("manual");
    try {
      const template = templateOptions.find((item) => item.id === manualDraft.templateId);
      const manualType =
        template?.templateType ??
        (manualDraft.templateType || undefined);
      if (!template && !manualType) {
        throw new Error("Selecione um tipo manual ou um template.");
      }

      const result = await createManualDPChecklistExecution(firebaseUser, {
        templateId: manualDraft.templateId || undefined,
        templateType: template ? undefined : manualType,
        date: manualDraft.date || undefined,
        unitId: manualDraft.unitId || undefined,
        assignedUserId: manualDraft.assignedUserId || undefined,
        collaboratorUserIds: manualDraft.collaboratorUserIds.length > 0
          ? manualDraft.collaboratorUserIds
          : undefined,
        incidentContext:
          manualType === "incident" ? manualDraft.incidentContext : undefined,
        supplierName:
          manualType === "receiving" ? manualDraft.supplierName : undefined,
        invoiceNumber:
          manualType === "receiving" ? manualDraft.invoiceNumber : undefined,
        scheduledDate:
          manualType === "one_time" ? manualDraft.scheduledDate : undefined,
        sections:
          !manualDraft.templateId && manualDraft.sections.length > 0
            ? manualDraft.sections
            : undefined,
        recurrence: manualDraft.enableRecurrence
          ? {
              type: manualDraft.recurrenceType,
              annualSchedule:
                manualDraft.recurrenceType === "annual"
                  ? manualDraft.annualSchedule
                  : undefined,
              customSchedule:
                manualDraft.recurrenceType === "custom"
                  ? manualDraft.customSchedule
                  : undefined,
            }
          : undefined,
      });
      toast({ title: "Checklist manual criado." });
      setManualDialogOpen(false);
      setManualStep("type");
      setManualDraft(makeManualDraft());
      await handleOpenExecution(result.execution);
      await load();
    } catch (requestError) {
      toast({
        title: "Falha ao criar checklist manual",
        description:
          requestError instanceof Error ? requestError.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  const handleOpenExecution = React.useCallback(
    (execution: DPChecklistExecution) => {
      router.push(`/dashboard/dp/checklists/executions/${execution.id}`);
    },
    [router]
  );

  React.useEffect(() => {
    if (!executionQueryId || !payload?.executions.length) return;
    if (openedExecutionIdRef.current === executionQueryId) return;

    const execution = payload.executions.find((entry) => entry.id === executionQueryId);
    if (!execution) return;

    openedExecutionIdRef.current = executionQueryId;
    void handleOpenExecution(execution);
  }, [executionQueryId, handleOpenExecution, payload?.executions]);

  async function handlePersistExecution(action: "save" | "complete") {
    if (!firebaseUser || !executionDraft) return;
    setBusy(`execution:${action}`);
    try {
      const result = await updateDPChecklistExecution(firebaseUser, executionDraft.id, {
        action,
        items: executionDraft.items.map((item) => ({
          templateItemId: item.templateItemId,
          sectionId: item.sectionId,
          checked: item.checked ?? undefined,
          yesNoValue: item.yesNoValue ?? undefined,
          textValue: item.textValue ?? undefined,
          numberValue: item.numberValue,
          multiValues: item.multiValues ?? undefined,
          dateValue: item.dateValue ?? undefined,
          photoUrls: item.photoUrls ?? undefined,
          signatureUrl: item.signatureUrl ?? undefined,
        })),
      });
      setSelectedExecution(result.execution);
      setExecutionDraft(result.execution);
      toast({
        title: action === "complete" ? "Checklist concluído." : "Checklist salvo.",
      });
      await load();
    } catch (requestError) {
      toast({
        title: action === "complete" ? "Falha ao concluir" : "Falha ao salvar",
        description:
          requestError instanceof Error ? requestError.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleUpdateTask(
    task: OperationalTask,
    status: OperationalTask["status"]
  ) {
    if (!firebaseUser) return;

    setBusy(`task:${task.id}:${status}`);
    try {
      const resolutionNotes =
        status === "resolved" || status === "closed"
          ? window.prompt("Observação da resolução (opcional):") ?? undefined
          : undefined;

      await updateDPChecklistTask(firebaseUser, task.id, {
        status,
        resolutionNotes:
          resolutionNotes && resolutionNotes.trim()
            ? resolutionNotes.trim()
            : undefined,
      });

      toast({
        title:
          status === "in_progress"
            ? "Tarefa iniciada."
            : status === "resolved"
              ? "Tarefa resolvida."
              : "Tarefa atualizada.",
      });
      await load();
    } catch (requestError) {
      toast({
        title: "Falha ao atualizar tarefa",
        description:
          requestError instanceof Error ? requestError.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  function updateTemplateSections(nextSections: DPChecklistSection[]) {
    setTemplateDraft((current) => ({
      ...current,
      sections: setSectionOrder(nextSections),
    }));
  }

  function handleSectionDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = templateDraft.sections.findIndex((section) => section.id === event.active.id);
    const newIndex = templateDraft.sections.findIndex((section) => section.id === event.over?.id);
    if (oldIndex === -1 || newIndex === -1) return;
    updateTemplateSections(arrayMove(templateDraft.sections, oldIndex, newIndex));
  }

  function handleItemDragEnd(sectionId: string, event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const section = templateDraft.sections.find((entry) => entry.id === sectionId);
    if (!section) return;
    const oldIndex = section.items.findIndex((item) => item.id === event.active.id);
    const newIndex = section.items.findIndex((item) => item.id === event.over?.id);
    if (oldIndex === -1 || newIndex === -1) return;
    updateTemplateSections(
      templateDraft.sections.map((current) =>
        current.id === sectionId
          ? { ...current, items: setItemOrder(arrayMove(current.items, oldIndex, newIndex)) }
          : current
      )
    );
  }

  const manualTemplates = templateOptions.filter((template) => {
    const typeDef = getChecklistTypeById(template.templateType, checklistTypes);
    return typeDef ? !typeDef.isSchedulable : true;
  });

  const activeTasks = React.useMemo(() => payload?.tasks ?? [], [payload?.tasks]);
  const executionMetricsById = React.useMemo(
    () =>
      new Map(
        (payload?.executions ?? []).map((execution) => [
          execution.id,
          getChecklistExecutionMetrics({ execution }),
        ])
      ),
    [payload?.executions]
  );
  const groupedExecutions = React.useMemo(() => {
    const executions = payload?.executions ?? [];
    return {
      urgent: executions.filter((execution) => {
        const metrics = executionMetricsById.get(execution.id);
        return Boolean(metrics?.isOverdue || (metrics?.criticalAlerts ?? 0) > 0);
      }),
      active: executions.filter((execution) => execution.status === "claimed"),
      queue: executions.filter((execution) => execution.status === "pending"),
      completed: executions.filter((execution) => execution.status === "completed"),
    };
  }, [executionMetricsById, payload?.executions]);
  const overviewStats = React.useMemo(() => {
    const executions = payload?.executions ?? [];
    const metricsSeries = executions.map((execution) => executionMetricsById.get(execution.id));
    const statusCounts = {
      pending: executions.filter((execution) => execution.status === "pending").length,
      claimed: executions.filter((execution) => execution.status === "claimed").length,
      completed: executions.filter((execution) => execution.status === "completed").length,
      overdue: executions.filter((execution) => execution.status === "overdue").length,
    };

    return [
      {
        label: "Pendentes",
        value: String(statusCounts.pending),
        subtitle: `${groupedExecutions.queue.length} aguardando início`,
        tone: "amber" as const,
        bars: buildSparklineBars([
          statusCounts.pending,
          statusCounts.pending + statusCounts.claimed,
          executions.length || 1,
          groupedExecutions.queue.length || 1,
        ]),
      },
      {
        label: "Em andamento",
        value: String(statusCounts.claimed),
        subtitle: `${activeTasks.filter((task) => task.status === "in_progress").length} tarefa(s) em ação`,
        tone: "blue" as const,
        bars: buildSparklineBars(
          metricsSeries.map((metric) => metric?.completionPercent ?? 0)
        ),
      },
      {
        label: "Concluídos",
        value: String(statusCounts.completed),
        subtitle: `${formatPercent(
          executions.length
            ? (statusCounts.completed / executions.length) * 100
            : 0
        )} de conclusão no dia`,
        tone: "emerald" as const,
        bars: buildSparklineBars(
          metricsSeries.map((metric) => metric?.score ?? 0)
        ),
      },
      {
        label: "Atenção",
        value: String(
          groupedExecutions.urgent.length +
            activeTasks.filter((task) => task.status === "escalated").length
        ),
        subtitle: `${groupedExecutions.urgent.length} checklist(s) + ${
          activeTasks.filter((task) => task.status === "escalated").length
        } tarefa(s) escalada(s)`,
        tone: "red" as const,
        bars: buildSparklineBars(
          metricsSeries.map((metric) => metric?.criticalAlerts ?? 0)
        ),
      },
    ];
  }, [activeTasks, executionMetricsById, groupedExecutions, payload?.executions]);

  const executions = payload?.executions ?? [];
  const statusCounts = {
    all: executions.length,
    pending: executions.filter(e => e.status === 'pending').length,
    claimed: executions.filter(e => e.status === 'claimed').length,
    completed: executions.filter(e => e.status === 'completed').length,
    overdue: executions.filter(e => e.status === 'overdue').length,
  };
  const filteredExecutions = statusFilter === 'all'
    ? executions
    : executions.filter(e => e.status === statusFilter);
  const byShift = React.useMemo(() => {
    const map = new Map<string, typeof filteredExecutions>();
    filteredExecutions.forEach(e => {
      const key = e.shiftStartTime && e.shiftEndTime
        ? `${e.shiftStartTime}–${e.shiftEndTime}`
        : 'Manual';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredExecutions]);

  // first unit/shift for subtitle
  const firstExecution = executions[0];
  const pageSubtitle = [
    firstExecution?.unitName,
    firstExecution?.shiftStartTime && firstExecution?.shiftEndTime
      ? `${firstExecution.shiftStartTime}–${firstExecution.shiftEndTime}`
      : null,
    selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR') : null,
  ].filter(Boolean).join(' · ');

  const filterTabs: { key: typeof statusFilter; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'pending', label: 'Pendentes' },
    { key: 'claimed', label: 'Em andamento' },
    { key: 'completed', label: 'Concluídos' },
    { key: 'overdue', label: 'Atrasados' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Meus Checklists</h1>
          {pageSubtitle && (
            <p className="text-sm text-muted-foreground mt-0.5">{pageSubtitle}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="w-[160px] h-8 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push("/dashboard/dp/checklists/manual/new")}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Manual
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setActiveTab("templates")}
          >
            <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
            Templates
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setActiveTab("analytics")}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Performance
          </Button>
          <Button type="button" size="sm" onClick={handleGenerateExecutions} disabled={busy === "generate"}>
            <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
            Gerar do dia
          </Button>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <ChecklistKpiCard icon="⏳" label="Pendentes" value={statusCounts.pending} tone="amber" />
        <ChecklistKpiCard icon="▶" label="Em andamento" value={statusCounts.claimed} tone="blue" />
        <ChecklistKpiCard icon="✓" label="Concluídos" value={statusCounts.completed} tone="emerald" />
        <ChecklistKpiCard icon="⚠" label="Atrasados" value={statusCounts.overdue} tone="red" />
      </div>

      {loading && !payload ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar checklists</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const nextTab = value as "operations" | "templates" | "analytics";
          setActiveTab(nextTab);
          syncChecklistRoute(
            nextTab,
            nextTab === "operations" && selectedExecution ? selectedExecution.id : undefined
          );
        }}
        className="space-y-4"
      >
        <TabsList className="h-auto rounded-full bg-slate-100/80 p-1">
          <TabsTrigger value="operations">Operação</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="operations" className="space-y-4">
          {/* Filter tabs */}
          <div className="flex items-center gap-0 border-b">
            {filterTabs.map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
                  statusFilter === tab.key
                    ? "border-emerald-500 text-emerald-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
                <span className={cn(
                  "text-[9px] font-bold px-1 py-px rounded-full",
                  statusFilter === tab.key
                    ? "bg-emerald-500 text-white"
                    : "bg-slate-200 text-slate-500"
                )}>
                  {statusCounts[tab.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Checklist cards grouped by shift */}
          <div className="space-y-6">
            {byShift.length === 0 ? (
              <div className="rounded-xl border border-dashed px-4 py-10 text-sm text-center text-muted-foreground">
                Nenhum checklist encontrado.
              </div>
            ) : (
              byShift.map(([shiftKey, items]) => (
                <div key={shiftKey} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                      Turno · {shiftKey}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="space-y-2">
                    {items.map((execution) => (
                      <ExecutionOverviewCard
                        key={execution.id}
                        execution={execution}
                        onOpen={handleOpenExecution}
                        disabled={busy === `claim:${execution.id}`}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tarefas operacionais</CardTitle>
              <CardDescription>
                Ações abertas ou escaladas disparadas automaticamente pelos itens com criticidade operacional.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeTasks.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Nenhuma tarefa operacional pendente.
                </div>
              ) : (
                activeTasks.map((task) => {
                  const statusMeta = getOperationalTaskStatusMeta(task.status);
                  const linkedExecution = payload?.executions.find(
                    (execution) => execution.id === task.executionId
                  );

                  return (
                    <div
                      key={task.id}
                      className={cn(
                        "rounded-2xl border p-4 shadow-sm",
                        task.status === "escalated"
                          ? "border-red-200 bg-red-50/60"
                          : "border-border bg-background"
                      )}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">{task.itemTitle}</p>
                            <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                          </div>
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            {task.description}
                          </p>
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span>{task.unitName}</span>
                            <span>•</span>
                            <span>Prazo {formatTimestamp(task.slaDeadlineAt)}</span>
                            <span>•</span>
                            <span>{task.assignedToUserName ?? "Cargo/pendente"}</span>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                          {(task.status === "open" || task.status === "escalated") ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void handleUpdateTask(task, "in_progress")}
                              disabled={busy === `task:${task.id}:in_progress`}
                            >
                              Iniciar
                            </Button>
                          ) : null}
                          {task.status !== "resolved" && task.status !== "closed" ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleUpdateTask(task, "resolved")}
                              disabled={busy === `task:${task.id}:resolved`}
                            >
                              Resolver
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              linkedExecution
                                ? void handleOpenExecution(linkedExecution)
                                : undefined
                            }
                            disabled={!linkedExecution}
                          >
                            Abrir checklist
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => router.push("/dashboard/dp/checklists/templates/new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo template
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Catálogo de templates</CardTitle>
              <CardDescription>
                Versionados no mesmo template lógico, com status visual e última execução.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[28%]">Nome</TableHead>
                    <TableHead>Unidades</TableHead>
                    <TableHead>Recorrência</TableHead>
                    <TableHead>Itens</TableHead>
                    <TableHead>Última execução</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templateOptions.map((template) => {
                    const statusMeta = getTemplateStatusMeta(template.isActive);

                    return (
                      <TableRow key={template.id}>
                        <TableCell>
                          <div className="min-w-0 space-y-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate font-semibold" title={template.name}>
                                {template.name}
                              </p>
                              <Badge className={getTemplateTypeBadgeClass(template.templateType, checklistTypes)}>
                                {getChecklistTypeById(template.templateType, checklistTypes)?.name ?? template.templateType}
                              </Badge>
                              <Badge variant="outline">v{template.version}</Badge>
                            </div>
                            {template.description ? (
                              <p
                                className="line-clamp-1 text-xs text-muted-foreground"
                                title={template.description}
                              >
                                {template.description}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {template.unitNames?.join(", ") || "Todas"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {template.occurrenceType ?? "manual"}
                        </TableCell>
                        <TableCell>{countTemplateItems(template)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatRelativeTimestamp(template.lastExecutionAt)}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusMeta.badgeClassName}>
                            <span className={cn("mr-1.5 h-2 w-2 rounded-full", statusMeta.dotClassName)} />
                            {statusMeta.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
                              onClick={() =>
                                router.push(`/dashboard/dp/checklists/templates/${template.id}`)
                              }
                            >
                              Editar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {payload?.access.canManageTemplates ? (
            <ChecklistTypesManager
              checklistTypes={checklistTypes}
              firebaseUser={firebaseUser}
              onRefresh={load}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <DPChecklistsAnalytics units={units as DPUnit[]} templates={templateOptions} checklistTypes={checklistTypes} />
        </TabsContent>
      </Tabs>

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {templateDraft.id ? "Editar template" : "Novo template"}
            </DialogTitle>
            <DialogDescription>
              Builder guiado por tipo, configuração geral e árvore condicional.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={templateStep} onValueChange={(value) => setTemplateStep(value as typeof templateStep)}>
            <TabsList>
              <TabsTrigger value="type">1. Tipo</TabsTrigger>
              <TabsTrigger value="config">2. Configuração</TabsTrigger>
              <TabsTrigger value="builder">3. Builder</TabsTrigger>
            </TabsList>

            <TabsContent value="type" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {checklistTypes.map((typeDef) => (
                <TemplateTypeCard
                  key={typeDef.id}
                  type={typeDef.id}
                  selected={templateDraft.templateType === typeDef.id}
                  checklistTypes={checklistTypes}
                  onSelect={() =>
                    setTemplateDraft((current) => ({
                      ...current,
                      templateType: typeDef.id,
                      occurrenceType: getOccurrenceOptions(typeDef.id, checklistTypes)[0].value as DPChecklistOccurrenceType,
                    }))
                  }
                />
              ))}
            </TabsContent>

            <TabsContent value="config" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    value={templateDraft.name}
                    onChange={(event) =>
                      setTemplateDraft((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Input
                    value={templateDraft.category}
                    onChange={(event) =>
                      setTemplateDraft((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={templateDraft.description}
                  onChange={(event) =>
                    setTemplateDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <Label>Recorrência</Label>
                  <Select
                    value={templateDraft.occurrenceType}
                    onValueChange={(value) =>
                      setTemplateDraft((current) => ({
                        ...current,
                        occurrenceType: value as DPChecklistOccurrenceType,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getOccurrenceOptions(templateDraft.templateType, checklistTypes).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Unidades</Label>
                  <MultiSelect
                    options={units.map((unit) => ({ value: unit.id, label: unit.name }))}
                    selected={templateDraft.unitIds}
                    onChange={(unitIds) =>
                      setTemplateDraft((current) => ({ ...current, unitIds }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label>Cargos</Label>
                  <MultiSelect
                    options={(payload?.roles ?? []).map((role: JobRole) => ({
                      value: role.id,
                      label: role.name,
                    }))}
                    selected={templateDraft.jobRoleIds}
                    onChange={(jobRoleIds) =>
                      setTemplateDraft((current) => ({ ...current, jobRoleIds }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label>Funções</Label>
                  <MultiSelect
                    options={(payload?.functions ?? []).map((item: JobFunction) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                    selected={templateDraft.jobFunctionIds}
                    onChange={(jobFunctionIds) =>
                      setTemplateDraft((current) => ({ ...current, jobFunctionIds }))
                    }
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Turnos</Label>
                  <MultiSelect
                    options={shiftDefinitions.map((shift: DPShiftDefinition) => ({
                      value: shift.id,
                      label: shift.name,
                    }))}
                    selected={templateDraft.shiftDefinitionIds}
                    onChange={(shiftDefinitionIds) =>
                      setTemplateDraft((current) => ({
                        ...current,
                        shiftDefinitionIds,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-xl border px-4 py-3">
                  <div>
                    <p className="font-medium">Template ativo</p>
                    <p className="text-sm text-muted-foreground">
                      Desative para impedir novas execuções.
                    </p>
                  </div>
                  <Switch
                    checked={templateDraft.isActive}
                    onCheckedChange={(isActive) =>
                      setTemplateDraft((current) => ({ ...current, isActive }))
                    }
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="builder" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">Seções e itens</h3>
                      <p className="text-sm text-muted-foreground">
                        Use branches, criticidade, ações obrigatórias e preview da árvore condicional.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        updateTemplateSections([
                          ...templateDraft.sections,
                          makeDefaultSection(templateDraft.sections.length),
                        ])
                      }
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Seção
                    </Button>
                  </div>

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
                    <SortableContext
                      items={templateDraft.sections.map((section) => section.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-4">
                        {templateDraft.sections.map((section) => (
                          <SortableCard key={section.id} id={section.id}>
                            <div className="space-y-4 p-4">
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label>Título da seção</Label>
                                  <Input
                                    value={section.title}
                                    onChange={(event) =>
                                      updateTemplateSections(
                                        templateDraft.sections.map((current) =>
                                          current.id === section.id
                                            ? { ...current, title: event.target.value }
                                            : current
                                        )
                                      )
                                    }
                                  />
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                                    <span className="text-sm">Exigir foto</span>
                                    <Switch
                                      checked={section.requirePhoto ?? false}
                                      onCheckedChange={(checked) =>
                                        updateTemplateSections(
                                          templateDraft.sections.map((current) =>
                                            current.id === section.id
                                              ? { ...current, requirePhoto: checked }
                                              : current
                                          )
                                        )
                                      }
                                    />
                                  </div>
                                  <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                                    <span className="text-sm">Exigir assinatura</span>
                                    <Switch
                                      checked={section.requireSignature ?? false}
                                      onCheckedChange={(checked) =>
                                        updateTemplateSections(
                                          templateDraft.sections.map((current) =>
                                            current.id === section.id
                                              ? { ...current, requireSignature: checked }
                                              : current
                                          )
                                        )
                                      }
                                    />
                                  </div>
                                </div>
                              </div>

                              <ConditionEditor
                                value={section.showIf}
                                items={allTemplateItems}
                                onChange={(showIf) =>
                                  updateTemplateSections(
                                    templateDraft.sections.map((current) =>
                                      current.id === section.id ? { ...current, showIf } : current
                                    )
                                  )
                                }
                              />

                              <div className="flex items-center justify-between">
                                <h4 className="font-medium">Itens da seção</h4>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    updateTemplateSections(
                                      templateDraft.sections.map((current) =>
                                        current.id === section.id
                                          ? {
                                              ...current,
                                              items: setItemOrder([
                                                ...current.items,
                                                makeDefaultItem(current.items.length),
                                              ]),
                                            }
                                          : current
                                      )
                                    )
                                  }
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Item
                                </Button>
                              </div>

                              <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={(event) => handleItemDragEnd(section.id, event)}
                              >
                                <SortableContext
                                  items={section.items.map((item) => item.id)}
                                  strategy={verticalListSortingStrategy}
                                >
                                  <div className="space-y-3">
                                    {section.items.map((item) => (
                                      <SortableCard key={item.id} id={item.id}>
                                        <div className="p-4">
                                          <ItemEditor
                                            item={item}
                                            allItems={allTemplateItems}
                                            onChange={(next) =>
                                              updateTemplateSections(
                                                templateDraft.sections.map((current) =>
                                                  current.id === section.id
                                                    ? {
                                                        ...current,
                                                        items: setItemOrder(
                                                          updateItemRecursive(
                                                            current.items,
                                                            item.id,
                                                            () => next
                                                          )
                                                        ),
                                                      }
                                                    : current
                                                )
                                              )
                                            }
                                            onRemove={() =>
                                              updateTemplateSections(
                                                templateDraft.sections.map((current) =>
                                                  current.id === section.id
                                                    ? {
                                                        ...current,
                                                        items: setItemOrder(
                                                          removeItemRecursive(current.items, item.id)
                                                        ),
                                                      }
                                                    : current
                                                )
                                              )
                                            }
                                            onAddBranch={() =>
                                              updateTemplateSections(
                                                templateDraft.sections.map((current) =>
                                                  current.id === section.id
                                                    ? {
                                                        ...current,
                                                        items: updateItemRecursive(
                                                          current.items,
                                                          item.id,
                                                          (currentItem) => ({
                                                            ...currentItem,
                                                            conditionalBranches: [
                                                              ...(currentItem.conditionalBranches ?? []),
                                                              { value: "", label: "", items: [] },
                                                            ],
                                                          })
                                                        ),
                                                      }
                                                    : current
                                                )
                                              )
                                            }
                                            onAddBranchItem={(branchIndex) =>
                                              updateTemplateSections(
                                                templateDraft.sections.map((current) =>
                                                  current.id === section.id
                                                    ? {
                                                        ...current,
                                                        items: addBranchItemRecursive(
                                                          current.items,
                                                          item.id,
                                                          branchIndex,
                                                          makeDefaultItem(0, 2)
                                                        ),
                                                      }
                                                    : current
                                                )
                                              )
                                            }
                                          />
                                        </div>
                                      </SortableCard>
                                    ))}
                                  </div>
                                </SortableContext>
                              </DndContext>
                            </div>
                          </SortableCard>
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>

                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Preview do operador</CardTitle>
                      <CardDescription>
                        Simula a visibilidade real com branches e `showIf`.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {previewExecution.sections.map((section) => {
                        const answers = buildExecutionAnswerMap(previewItems);
                        const visibleItems = getActiveExecutionItems(
                          previewItems.filter((item) => item.sectionId === section.id),
                          answers
                        );
                        if (!visibleItems.length) return null;
                        return (
                          <div key={section.id} className="space-y-3 rounded-xl border p-4">
                            <div>
                              <h4 className="font-medium">{section.title}</h4>
                              <p className="text-xs text-muted-foreground">
                                {getItemConditionLabel(section.showIf)}
                              </p>
                            </div>
                            {visibleItems.map((item) => (
                              <ExecutionItemField
                                key={item.templateItemId}
                                item={item}
                                onChange={(patch) =>
                                  setPreviewItems((current) =>
                                    current.map((entry) =>
                                      entry.templateItemId === item.templateItemId
                                        ? { ...entry, ...patch }
                                        : entry
                                    )
                                  )
                                }
                              />
                            ))}
                          </div>
                        );
                      })}
                      <Alert>
                        <AlertTitle>Score previsto</AlertTitle>
                        <AlertDescription>
                          {formatPercent(calculateExecutionScore(previewItems))}
                        </AlertDescription>
                      </Alert>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleSaveTemplate()} disabled={busy === "template"}>
              Salvar template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={manualDialogOpen}
        onOpenChange={(open) => {
          setManualDialogOpen(open);
          if (!open) {
            setManualStep("type");
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Novo checklist manual</DialogTitle>
            <DialogDescription>
              Escolha o tipo do checklist manual e depois configure os dados base.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Tabs value={manualStep} onValueChange={(value) => setManualStep(value as typeof manualStep)}>
              <TabsList className={cn("grid w-full", !manualDraft.templateId ? "grid-cols-3" : "grid-cols-2")}>
                <TabsTrigger value="type">1. Tipo</TabsTrigger>
                <TabsTrigger value="config" disabled={!manualDraft.templateType}>
                  2. Configuração
                </TabsTrigger>
                {!manualDraft.templateId ? (
                  <TabsTrigger value="builder" disabled={!manualDraft.templateType}>
                    3. Itens
                  </TabsTrigger>
                ) : null}
              </TabsList>

              <TabsContent value="type" className="space-y-4 pt-2">
                <div className="space-y-3">
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <p className="font-medium">Escolha como esse checklist nasce na operação</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Depois você decide se quer criar em branco ou aproveitar um template desse tipo.
                    </p>
                  </div>
                  {checklistTypes.map((typeDef) => {
                    const selected = manualDraft.templateType === typeDef.id;
                    const colors = getTypeColorClasses(typeDef.colorScheme);
                    return (
                      <button
                        key={typeDef.id}
                        type="button"
                        onClick={() => {
                          setManualDraft((current) => ({
                            ...current,
                            templateType: typeDef.id,
                            templateId: "",
                          }));
                        }}
                        className={cn(
                          "w-full rounded-2xl border p-5 text-left transition hover:border-primary hover:shadow-sm",
                          selected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border"
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-3">
                              <div
                                className={cn(
                                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg",
                                  selected ? "bg-primary/10" : colors.iconBg
                                )}
                              >
                                {typeDef.emoji}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-base font-semibold">{typeDef.name}</span>
                                  {selected ? (
                                    <Badge className="bg-primary text-primary-foreground">
                                      Selecionado
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {typeDef.description}
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div className="rounded-xl bg-muted/30 p-3">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Como funciona
                                </p>
                                <p className="mt-1 text-sm text-foreground/85">
                                  {typeDef.behavior}
                                </p>
                              </div>
                              <div className="rounded-xl bg-muted/30 p-3">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Exemplos
                                </p>
                                <p className="mt-1 text-sm text-foreground/85">
                                  {typeDef.examples}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <Badge variant="outline" className="max-w-[140px] text-center">
                              {typeDef.isSchedulable ? "Automático" : "Manual"}
                            </Badge>
                            <div
                              className={cn(
                                "flex h-7 w-7 items-center justify-center rounded-full border",
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background text-muted-foreground"
                              )}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="config" className="space-y-4 pt-2">
                <div className="rounded-xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">Tipo selecionado</p>
                    {manualDraft.templateType ? (
                      <Badge className={getTemplateTypeBadgeClass(manualDraft.templateType, checklistTypes)}>
                        {getChecklistTypeById(manualDraft.templateType, checklistTypes)?.name ?? manualDraft.templateType}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Você pode criar em branco ou aproveitar um template manual existente desse tipo.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Template manual (opcional)</Label>
                  <Select
                    value={manualDraft.templateId}
                    onValueChange={(templateId) => {
                      const selectedTemplate = manualTemplates.find((template) => template.id === templateId);
                      const inferredType = selectedTemplate?.templateType as ManualDraft["templateType"] | undefined;
                      setManualDraft((current) => ({
                        ...current,
                        templateId,
                        templateType: inferredType ?? current.templateType,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Criar em branco ou escolher um template" />
                    </SelectTrigger>
                    <SelectContent>
                      {manualTemplates
                        .filter((template) => template.templateType === manualDraft.templateType)
                        .map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Data base</Label>
                    <Input
                      type="date"
                      value={manualDraft.date}
                      onChange={(event) =>
                        setManualDraft((current) => ({ ...current, date: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Unidade</Label>
                    <Select
                      value={manualDraft.unitId}
                      onValueChange={(unitId) =>
                        setManualDraft((current) => ({ ...current, unitId }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map((unit) => (
                          <SelectItem key={unit.id} value={unit.id}>
                            {unit.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Responsável</Label>
                    <Select
                      value={manualDraft.assignedUserId}
                      onValueChange={(assignedUserId) =>
                        setManualDraft((current) => ({ ...current, assignedUserId }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.username}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {(() => {
                  const selectedTemplate = manualTemplates.find(
                    (template) => template.id === manualDraft.templateId
                  );
                  const manualType =
                    selectedTemplate?.templateType ??
                    (manualDraft.templateType || null);
                  if (!manualType) return null;

                  if (manualType === "incident") {
                    return (
                      <div className="space-y-2">
                        <Label>Contexto da ocorrência</Label>
                        <Textarea
                          value={manualDraft.incidentContext}
                          onChange={(event) =>
                            setManualDraft((current) => ({
                              ...current,
                              incidentContext: event.target.value,
                            }))
                          }
                        />
                      </div>
                    );
                  }

                  if (manualType === "receiving") {
                    return (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Fornecedor</Label>
                          <Input
                            value={manualDraft.supplierName}
                            onChange={(event) =>
                              setManualDraft((current) => ({
                                ...current,
                                supplierName: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Número da NF</Label>
                          <Input
                            value={manualDraft.invoiceNumber}
                            onChange={(event) =>
                              setManualDraft((current) => ({
                                ...current,
                                invoiceNumber: event.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    );
                  }

                  if (manualType === "one_time") {
                    return (
                      <div className="space-y-2">
                        <Label>Data agendada</Label>
                        <Input
                          type="date"
                          value={manualDraft.scheduledDate}
                          onChange={(event) =>
                            setManualDraft((current) => ({
                              ...current,
                              scheduledDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                    );
                  }

                  return null;
                })()}

                {/* Recorrência */}
                <div className="space-y-3 border-t pt-4 mt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Repetir automaticamente</p>
                      <p className="text-xs text-muted-foreground">
                        Defina uma frequência para gerar novas execuções deste checklist.
                      </p>
                    </div>
                    <Switch
                      checked={manualDraft.enableRecurrence}
                      onCheckedChange={(enableRecurrence) =>
                        setManualDraft((current) => ({ ...current, enableRecurrence }))
                      }
                    />
                  </div>

                  {manualDraft.enableRecurrence && (
                    <div className="space-y-3">
                      <Select
                        value={manualDraft.recurrenceType}
                        onValueChange={(v) =>
                          setManualDraft((current) => ({
                            ...current,
                            recurrenceType: v as DPChecklistOccurrenceType,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECURRENCE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {manualDraft.recurrenceType === "annual" && (
                        <AnnualScheduleBuilder
                          value={manualDraft.annualSchedule}
                          onChange={(annualSchedule) =>
                            setManualDraft((current) => ({ ...current, annualSchedule }))
                          }
                        />
                      )}

                      {manualDraft.recurrenceType === "custom" && (
                        <CustomScheduleBuilder
                          value={manualDraft.customSchedule}
                          onChange={(customSchedule) =>
                            setManualDraft((current) => ({ ...current, customSchedule }))
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="builder" className="space-y-3 pt-2">
                <p className="text-sm text-muted-foreground">
                  Adicione seções e itens ao checklist. Sem template, esses itens definem o que será preenchido.
                </p>
                <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                  {manualDraft.sections.map((section, sectionIndex) => (
                    <div key={section.id} className="rounded-xl border bg-card p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 space-y-1">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Seção {sectionIndex + 1}
                          </Label>
                          <Input
                            placeholder="Título da seção…"
                            value={section.title}
                            onChange={(e) =>
                              setManualDraft((prev) => ({
                                ...prev,
                                sections: prev.sections.map((s) =>
                                  s.id === section.id ? { ...s, title: e.target.value } : s
                                ),
                              }))
                            }
                          />
                        </div>
                        {manualDraft.sections.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="mt-4 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setManualDraft((prev) => ({
                                ...prev,
                                sections: setSectionOrder(
                                  prev.sections.filter((s) => s.id !== section.id)
                                ),
                              }))
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                      <div className="space-y-1.5 pl-3 border-l-2 border-border">
                        {section.items.map((item, itemIndex) => (
                          <div key={item.id} className="flex items-center gap-2">
                            <div className="flex-1 grid grid-cols-[1fr_120px] gap-2">
                              <Input
                                placeholder={`Item ${itemIndex + 1}…`}
                                value={item.title}
                                onChange={(e) =>
                                  setManualDraft((prev) => ({
                                    ...prev,
                                    sections: prev.sections.map((s) =>
                                      s.id === section.id
                                        ? {
                                            ...s,
                                            items: s.items.map((it) =>
                                              it.id === item.id ? { ...it, title: e.target.value } : it
                                            ),
                                          }
                                        : s
                                    ),
                                  }))
                                }
                              />
                              <Select
                                value={item.type}
                                onValueChange={(type) =>
                                  setManualDraft((prev) => ({
                                    ...prev,
                                    sections: prev.sections.map((s) =>
                                      s.id === section.id
                                        ? {
                                            ...s,
                                            items: s.items.map((it) =>
                                              it.id === item.id ? { ...it, type: type as DPChecklistItemType } : it
                                            ),
                                          }
                                        : s
                                    ),
                                  }))
                                }
                              >
                                <SelectTrigger className="text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ITEM_TYPE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {section.items.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() =>
                                  setManualDraft((prev) => ({
                                    ...prev,
                                    sections: prev.sections.map((s) =>
                                      s.id === section.id
                                        ? {
                                            ...s,
                                            items: setItemOrder(s.items.filter((it) => it.id !== item.id)),
                                          }
                                        : s
                                    ),
                                  }))
                                }
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground h-7"
                          onClick={() =>
                            setManualDraft((prev) => ({
                              ...prev,
                              sections: prev.sections.map((s) =>
                                s.id === section.id
                                  ? { ...s, items: setItemOrder([...s.items, makeDefaultItem(s.items.length)]) }
                                  : s
                              ),
                            }))
                          }
                        >
                          <Plus className="mr-1 h-3 w-3" />
                          Item
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    setManualDraft((prev) => ({
                      ...prev,
                      sections: [...prev.sections, makeDefaultSection(prev.sections.length)],
                    }))
                  }
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Adicionar seção
                </Button>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter>
            {manualStep === "type" ? (
              <>
                <Button type="button" variant="outline" onClick={() => setManualDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => setManualStep("config")}
                  disabled={!manualDraft.templateType}
                >
                  Continuar
                </Button>
              </>
            ) : manualStep === "config" ? (
              <>
                <Button type="button" variant="outline" onClick={() => setManualStep("type")}>
                  Voltar
                </Button>
                {!manualDraft.templateId ? (
                  <Button
                    type="button"
                    onClick={() => setManualStep("builder")}
                    disabled={!manualDraft.templateType}
                  >
                    Próximo: Itens →
                  </Button>
                ) : (
                  <Button type="button" onClick={() => void handleCreateManualExecution()} disabled={busy === "manual"}>
                    {busy === "manual" ? "Criando..." : "Criar checklist"}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setManualStep("config")}>
                  Voltar
                </Button>
                <Button type="button" onClick={() => void handleCreateManualExecution()} disabled={busy === "manual"}>
                  {busy === "manual" ? "Criando..." : "Criar checklist"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedExecution && !!executionDraft}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedExecution(null);
            setExecutionDraft(null);
            syncChecklistRoute(activeTab, undefined);
          }
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-auto p-0">
          <DialogHeader>
            <div className="border-b px-6 pb-4 pt-6">
              <DialogTitle>{selectedExecution?.templateName}</DialogTitle>
              <DialogDescription>
                {selectedExecution?.unitName} • {selectedExecution?.assignedUsername}
              </DialogDescription>
            </div>
          </DialogHeader>

          {executionDraft ? (
            <div className="space-y-4 px-6 pb-24 pt-4">
              <div className="overflow-hidden rounded-2xl border">
                <div className="flex flex-col gap-3 border-b bg-slate-50 px-5 py-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={getExecutionStatusMeta(executionDraft.status).className}>
                        {getExecutionStatusMeta(executionDraft.status).label}
                      </Badge>
                      <Badge variant="outline">
                        {getChecklistTypeById(executionDraft.templateType, checklistTypes)?.name ?? executionDraft.templateType}
                      </Badge>
                      {executionDraft.occurrenceType && executionDraft.occurrenceType !== "manual" ? (
                        <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                          Recorrente · {{
                            daily: "diário",
                            weekly: "semanal",
                            biweekly: "quinzenal",
                            monthly: "mensal",
                            annual: "anual",
                            custom: "personalizado",
                            manual: "manual",
                          }[executionDraft.occurrenceType] ?? executionDraft.occurrenceType}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                          Manual
                        </Badge>
                      )}
                      {executionMetrics?.criticalAlerts ? (
                        <Badge variant="destructive">
                          {executionMetrics.criticalAlerts} alerta(s) crítico(s)
                        </Badge>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Execução
                      </p>
                      <p className="text-base font-semibold">
                        {executionDraft.unitName ?? "Sem unidade"} •{" "}
                        {executionDraft.shiftStartTime && executionDraft.shiftEndTime
                          ? `${executionDraft.shiftStartTime}–${executionDraft.shiftEndTime}`
                          : "Fluxo manual"}
                      </p>
                    </div>
                    {/* Responsável e executor */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                          Responsável:{" "}
                          <span className="font-medium text-foreground">
                            {executionDraft.assignedUsername}
                          </span>
                        </span>
                      {executionDraft.collaboratorUsernames && executionDraft.collaboratorUsernames.length > 0 ? (
                        <span>
                          Colaboradores:{" "}
                          <span className="font-medium text-foreground">
                            {executionDraft.collaboratorUsernames.join(", ")}
                          </span>
                        </span>
                      ) : null}
                      {executionDraft.occurrenceType && executionDraft.occurrenceType !== "manual" ? (
                        <span>Gerado pelo sistema</span>
                      ) : executionDraft.createdByUsername ? (
                        <span>
                          Criado por{" "}
                          <span className="font-medium text-foreground">
                            {executionDraft.createdByUsername}
                          </span>
                        </span>
                      ) : (
                        <span>Criado manualmente</span>
                      )}
                      {executionDraft.claimedByUsername ? (
                        <span>
                          Assumido por{" "}
                          <span className="font-medium text-foreground">
                            {executionDraft.claimedByUsername}
                          </span>
                        </span>
                      ) : null}
                      {executionDraft.claimedByUsername ? (
                        <span className="text-amber-600">
                          Somente <strong>{executionDraft.claimedByUsername}</strong> pode concluir.
                        </span>
                      ) : null}
                    </div>
                    <p className="flex items-center gap-2 text-xs text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Salvo automaticamente em {formatTimestamp(executionDraft.updatedAt as string)}
                    </p>
                  </div>

                  <div className="min-w-[180px] space-y-1 text-right">
                    <div className="flex justify-end mb-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={toggleSectionsMode}
                      >
                        {sectionsMode
                          ? <><List className="h-3.5 w-3.5" /> Lista</>
                          : <><GalleryVerticalEnd className="h-3.5 w-3.5" /> Seções</>}
                      </Button>
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Progresso
                    </p>
                    <p className="text-2xl font-semibold tracking-tight">
                      {executionMetrics?.completedItems ?? 0}
                      <span className="text-sm font-medium text-muted-foreground">
                        {" "}
                        / {executionMetrics?.activeItems ?? 0}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {executionMetrics?.completionPercent ?? 0}% respondido
                    </p>
                  </div>
                </div>

                <div className="space-y-3 px-5 py-4">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">Progresso atual</span>
                    <span className="font-semibold text-emerald-700">
                      {executionMetrics?.completionPercent ?? 0}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        executionMetrics?.isOverdue ? "bg-red-500" : "bg-emerald-500"
                      )}
                      style={{
                        width: `${Math.max(executionMetrics?.completionPercent ?? 0, 4)}%`,
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-6 gap-2 md:grid-cols-10">
                    {Array.from({
                      length: Math.min(executionMetrics?.activeItems ?? 0, 10),
                    }).map((_, index) => {
                      const threshold =
                        executionMetrics && executionMetrics.activeItems > 0
                          ? Math.floor(
                              ((index + 1) / Math.min(executionMetrics.activeItems, 10)) *
                                executionMetrics.activeItems
                            )
                          : 0;
                      const isDone = (executionMetrics?.completedItems ?? 0) >= threshold;

                      return (
                        <div
                          key={`dot-${index}`}
                          className={cn(
                            "h-2.5 rounded-full",
                            isDone ? "bg-emerald-500" : "bg-slate-200"
                          )}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              {(executionDraft.incidentContext ||
                executionDraft.supplierName ||
                executionDraft.invoiceNumber ||
                executionDraft.scheduledDate) ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Contexto manual</CardTitle>
                    <CardDescription>
                      Dados informados na criação manual deste checklist.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    {executionDraft.incidentContext ? (
                      <div className="space-y-1 md:col-span-2">
                        <p className="text-sm font-medium">Ocorrência</p>
                        <p className="text-sm text-muted-foreground">
                          {executionDraft.incidentContext}
                        </p>
                      </div>
                    ) : null}
                    {executionDraft.supplierName ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Fornecedor</p>
                        <p className="text-sm text-muted-foreground">
                          {executionDraft.supplierName}
                        </p>
                      </div>
                    ) : null}
                    {executionDraft.invoiceNumber ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Nota fiscal</p>
                        <p className="text-sm text-muted-foreground">
                          {executionDraft.invoiceNumber}
                        </p>
                      </div>
                    ) : null}
                    {executionDraft.scheduledDate ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Data agendada</p>
                        <p className="text-sm text-muted-foreground">
                          {executionDraft.scheduledDate}
                        </p>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              {sectionsMode && executionDraft.sections.length > 0 ? (
                // ─── Modo Seções: uma seção por vez ───────────────────────────
                (() => {
                  const section = executionDraft.sections[sectionIdx];
                  if (!section) return null;
                  const answers = buildExecutionAnswerMap(executionDraft.items);
                  const visibleItems = getActiveExecutionItems(
                    executionDraft.items.filter(item => item.sectionId === section.id),
                    answers
                  );
                  let blockReached = false;
                  return (
                    <div className="space-y-3 rounded-2xl border p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            Seção {sectionIdx + 1} de {executionDraft.sections.length}
                          </p>
                          <h3 className="font-semibold">{section.title}</h3>
                        </div>
                        <div className="flex gap-2">
                          {section.requirePhoto ? <Badge variant="outline">Foto obrigatória</Badge> : null}
                          {section.requireSignature ? <Badge variant="outline">Assinatura obrigatória</Badge> : null}
                        </div>
                      </div>
                      <div className="space-y-3">
                        {visibleItems.map(item => {
                          const disabled = blockReached;
                          if (item.blockNext && !isChecklistExecutionItemCompleted(item)) blockReached = true;
                          return (
                            <div
                              key={item.templateItemId}
                              style={{ marginLeft: `${(item.branchPath?.length ?? 0) * 16}px` }}
                            >
                              <ExecutionItemField
                                item={item}
                                disabled={disabled}
                                linkedTask={activeTasks.find(t => t.id === item.linkedTaskId)}
                                onChange={(patch) =>
                                  setExecutionDraft(current =>
                                    current
                                      ? {
                                          ...current,
                                          items: current.items.map(entry =>
                                            entry.templateItemId === item.templateItemId
                                              ? { ...entry, ...patch }
                                              : entry
                                          ),
                                        }
                                      : current
                                  )
                                }
                              />
                            </div>
                          );
                        })}
                        {visibleItems.length === 0 && (
                          <p className="py-4 text-center text-sm text-muted-foreground">
                            Nenhum item visível nesta seção.
                          </p>
                        )}
                      </div>
                      <SectionActionPlan items={visibleItems} tasks={activeTasks} />
                    </div>
                  );
                })()
              ) : (
                // ─── Modo Lista: todos os itens por seção (padrão) ────────────
                executionDraft.sections.map((section, sectionIndex) => {
                  const answers = buildExecutionAnswerMap(executionDraft.items);
                  const visibleItems = getActiveExecutionItems(
                    executionDraft.items.filter((item) => item.sectionId === section.id),
                    answers
                  );

                  if (!visibleItems.length) return null;

                  let blockReached = false;

                  return (
                    <div key={section.id} className="space-y-3 rounded-2xl border p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            Seção {sectionIndex + 1}
                          </p>
                          <h3 className="font-semibold">{section.title}</h3>
                          <p className="text-xs text-muted-foreground">
                            {getItemConditionLabel(section.showIf)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {section.requirePhoto ? <Badge variant="outline">Foto obrigatória</Badge> : null}
                          {section.requireSignature ? <Badge variant="outline">Assinatura obrigatória</Badge> : null}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {visibleItems.map((item) => {
                          const disabled = blockReached;
                          const isComplete = isChecklistExecutionItemCompleted(item);
                          if (item.blockNext && !isComplete) {
                            blockReached = true;
                          }
                          return (
                            <div
                              key={item.templateItemId}
                              className="transition-all duration-200"
                              style={{ marginLeft: `${(item.branchPath?.length ?? 0) * 16}px` }}
                            >
                              <ExecutionItemField
                                item={item}
                                disabled={disabled}
                                linkedTask={activeTasks.find(t => t.id === item.linkedTaskId)}
                                onChange={(patch) =>
                                  setExecutionDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          items: current.items.map((entry) =>
                                            entry.templateItemId === item.templateItemId
                                              ? { ...entry, ...patch }
                                              : entry
                                          ),
                                        }
                                      : current
                                  )
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                      <SectionActionPlan items={visibleItems} tasks={activeTasks} />
                    </div>
                  );
                })
              )}
            </div>
          ) : null}

          <DialogFooter className="sticky bottom-0 border-t bg-background/95 px-6 py-4 backdrop-blur">
            {sectionsMode && executionDraft && executionDraft.sections.length > 0 && (
              <div className="flex w-full items-center justify-between gap-2 mb-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sectionIdx === 0}
                  onClick={() => setSectionIdx(i => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  Seção {sectionIdx + 1} / {executionDraft.sections.length}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sectionIdx >= executionDraft.sections.length - 1 || sectionIdx >= sectionBlockedAt}
                  onClick={() => setSectionIdx(i => Math.min(executionDraft.sections.length - 1, i + 1))}
                >
                  Próxima
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
            <div className="mr-auto text-sm text-muted-foreground">
              {executionMetrics
                ? Math.max(
                    executionMetrics.requiredItems -
                      executionMetrics.completedRequiredItems,
                    0
                  ) > 0
                  ? `Faltam ${
                      executionMetrics.requiredItems -
                      executionMetrics.completedRequiredItems
                    } item(ns) obrigatório(s) para concluir.`
                  : `${executionMetrics.completedItems} de ${executionMetrics.activeItems} item(ns) respondidos.`
                : "Preencha os itens para concluir o checklist."}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handlePersistExecution("save")}
              disabled={busy === "execution:save"}
            >
              Salvar progresso
            </Button>
            <Button
              type="button"
              onClick={() => void handlePersistExecution("complete")}
              disabled={
                busy === "execution:complete" ||
                Math.max(
                  (executionMetrics?.requiredItems ?? 0) -
                    (executionMetrics?.completedRequiredItems ?? 0),
                  0
                ) > 0
              }
            >
              {Math.max(
                (executionMetrics?.requiredItems ?? 0) -
                  (executionMetrics?.completedRequiredItems ?? 0),
                0
              ) > 0
                ? `Faltam ${Math.max(
                    (executionMetrics?.requiredItems ?? 0) -
                      (executionMetrics?.completedRequiredItems ?? 0),
                    0
                  )} itens`
                : "Concluir checklist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


export function DPChecklistManualCreatePage() {
  const router = useRouter();
  const { firebaseUser, activeUsers } = useAuth();
  const { units } = useDPBootstrap();
  const { toast } = useToast();

  const [payload, setPayload] = React.useState<DPChecklistBootstrapPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [manualStep, setManualStep] = React.useState<"type" | "config" | "builder">("type");
  const [manualDraft, setManualDraft] = React.useState<ManualDraft>(makeManualDraft());
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const nextPayload = await fetchDPChecklistBootstrap(firebaseUser, {
        date: toDateInputValue(),
      });
      setPayload(nextPayload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Falha ao carregar os dados da criação manual."
      );
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const checklistTypes = React.useMemo(
    () => resolveChecklistTypes(payload?.checklistTypes),
    [payload?.checklistTypes]
  );

  const manualTemplates = React.useMemo(() => {
    if (!manualDraft.templateType) return [] as DPChecklistTemplate[];
    return (payload?.templates ?? []).filter(
      (template) => template.templateType === manualDraft.templateType
    );
  }, [manualDraft.templateType, payload?.templates]);

  async function handleCreateManualExecution() {
    if (!firebaseUser) return;

    const template = payload?.templates.find((item) => item.id === manualDraft.templateId);
    const manualType = template?.templateType ?? (manualDraft.templateType || undefined);
    if (!manualType) {
      toast({
        title: "Tipo obrigatório",
        description: "Escolha o tipo do checklist manual antes de continuar.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const result = await createManualDPChecklistExecution(firebaseUser, {
        templateId: manualDraft.templateId || undefined,
        templateType: template ? undefined : manualType,
        date: manualDraft.date || undefined,
        unitId: manualDraft.unitId || undefined,
        assignedUserId: manualDraft.assignedUserId || undefined,
        collaboratorUserIds: manualDraft.collaboratorUserIds.length > 0
          ? manualDraft.collaboratorUserIds
          : undefined,
        incidentContext:
          manualType === "incident" ? manualDraft.incidentContext : undefined,
        supplierName:
          manualType === "receiving" ? manualDraft.supplierName : undefined,
        invoiceNumber:
          manualType === "receiving" ? manualDraft.invoiceNumber : undefined,
        scheduledDate:
          manualType === "one_time" ? manualDraft.scheduledDate : undefined,
        sections:
          !manualDraft.templateId && manualDraft.sections.length > 0
            ? manualDraft.sections
            : undefined,
        recurrence: manualDraft.enableRecurrence
          ? {
              type: manualDraft.recurrenceType,
              annualSchedule:
                manualDraft.recurrenceType === "annual"
                  ? manualDraft.annualSchedule
                  : undefined,
              customSchedule:
                manualDraft.recurrenceType === "custom"
                  ? manualDraft.customSchedule
                  : undefined,
            }
          : undefined,
      });

      toast({ title: "Checklist manual criado." });
      router.push(`/dashboard/dp/checklists/executions/${result.execution.id}`);
    } catch (requestError) {
      toast({
        title: "Falha ao criar checklist manual",
        description:
          requestError instanceof Error ? requestError.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const selectedTypeDef = manualDraft.templateType
    ? getChecklistTypeById(manualDraft.templateType, checklistTypes)
    : null;

  return (
    <div className="-m-4 flex flex-col md:-m-8">
      {/* Topbar */}
      <div className="sticky top-0 z-10 flex h-[52px] shrink-0 items-center gap-3 border-b bg-background px-5">
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <button
            type="button"
            className="transition-colors hover:text-foreground"
            onClick={() => router.push("/dashboard/dp/checklists?tab=operations")}
          >
            Operações
          </button>
          <span className="text-border">›</span>
          <button
            type="button"
            className="transition-colors hover:text-foreground"
            onClick={() => router.push("/dashboard/dp/checklists?tab=operations")}
          >
            Checklists
          </button>
          <span className="text-border">›</span>
          <span className="font-medium text-foreground">Novo checklist manual</span>
        </nav>
        <div className="flex-1" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => router.push("/dashboard/dp/checklists?tab=operations")}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleCreateManualExecution()}
          disabled={saving || loading || !manualDraft.templateType}
        >
          {saving ? "Criando..." : "Criar checklist"}
        </Button>
      </div>

      {error ? (
        <div className="px-5 py-4">
          <Alert variant="destructive">
            <AlertTitle>Falha ao carregar a criação manual</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {loading && !payload ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        /* 3-column body */
        <div className="flex min-h-[calc(100vh-8rem)]">

          {/* Left — step sidebar */}
          <aside className="sticky top-[52px] h-[calc(100vh-8rem)] w-[180px] shrink-0 overflow-y-auto border-r bg-muted/20 px-4 py-6">
            <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Etapas
            </p>

            {/* Step 1 */}
            <button
              type="button"
              className="flex w-full items-start gap-2.5 text-left"
              onClick={() => setManualStep("type")}
            >
              <div
                className={cn(
                  "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-all",
                  manualStep === "type"
                    ? "border-rose-500 bg-rose-500 text-white"
                    : manualStep === "config"
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-border bg-background text-muted-foreground"
                )}
              >
                {manualStep === "config" ? "✓" : "1"}
              </div>
              <div className="pt-0.5">
                <p
                  className={cn(
                    "text-[12px] font-bold",
                    manualStep === "type" ? "text-foreground" : manualStep === "config" ? "text-emerald-600" : "text-muted-foreground"
                  )}
                >
                  Tipo
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/70">
                  Define a natureza do checklist
                </p>
              </div>
            </button>

            {/* Connector */}
            <div className="ml-[11px] my-1 h-4 w-0.5 rounded-full bg-border" />

            {/* Step 2 */}
            <button
              type="button"
              className={cn("flex w-full items-start gap-2.5 text-left", !manualDraft.templateType && "cursor-not-allowed")}
              onClick={() => {
                if (manualDraft.templateType) setManualStep("config");
              }}
            >
              <div
                className={cn(
                  "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-all",
                  manualStep === "config"
                    ? "border-rose-500 bg-rose-500 text-white"
                    : manualStep === "builder"
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-border bg-background text-muted-foreground"
                )}
              >
                {manualStep === "builder" ? "✓" : "2"}
              </div>
              <div className="pt-0.5">
                <p
                  className={cn(
                    "text-[12px] font-bold",
                    manualStep === "config"
                      ? "text-foreground"
                      : manualStep === "builder"
                        ? "text-emerald-600"
                        : "text-muted-foreground"
                  )}
                >
                  Configuração
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/70">
                  Dados base: template e contexto
                </p>
              </div>
            </button>

            {!manualDraft.templateId ? (
              <>
                {/* Connector */}
                <div className="ml-[11px] my-1 h-4 w-0.5 rounded-full bg-border" />

                {/* Step 3 */}
                <button
                  type="button"
                  className={cn("flex w-full items-start gap-2.5 text-left", manualStep === "type" && "cursor-not-allowed")}
                  onClick={() => {
                    if (manualDraft.templateType) setManualStep("builder");
                  }}
                >
                  <div
                    className={cn(
                      "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-all",
                      manualStep === "builder"
                        ? "border-rose-500 bg-rose-500 text-white"
                        : "border-border bg-background text-muted-foreground"
                    )}
                  >
                    3
                  </div>
                  <div className="pt-0.5">
                    <p
                      className={cn(
                        "text-[12px] font-bold",
                        manualStep === "builder" ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      Itens
                    </p>
                    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/70">
                      Seções e perguntas do checklist
                    </p>
                  </div>
                </button>
              </>
            ) : null}
          </aside>

          {/* Center — main content */}
          <div className="flex-1 overflow-y-auto p-7">
            {manualStep === "type" ? (
              <div>
                <h2 className="text-lg font-bold tracking-tight">Escolha o tipo do checklist</h2>
                <p className="mb-6 mt-1 text-xs text-muted-foreground">
                  Escolha só o tipo. A explicação detalhada fica no painel à direita.
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  {checklistTypes.map((typeDef) => {
                    const selected = manualDraft.templateType === typeDef.id;
                    const colors = getTypeColorClasses(typeDef.colorScheme);

                    return (
                      <button
                        key={typeDef.id}
                        type="button"
                        onClick={() =>
                          setManualDraft((current) => ({
                            ...current,
                            templateType: typeDef.id,
                            templateId: "",
                          }))
                        }
                        className={cn(
                          "flex flex-col gap-2 rounded-xl border-2 p-4 text-left transition-all",
                          selected
                            ? "border-rose-400 bg-rose-50/60 shadow-sm"
                            : "border-border bg-card hover:border-rose-300 hover:shadow-sm"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg text-lg",
                              colors.iconBg
                            )}
                          >
                            {typeDef.emoji}
                          </div>
                          <div>
                            <p className="text-[13px] font-bold text-foreground">{typeDef.name}</p>
                            <span
                              className={cn(
                                "mt-0.5 inline-block rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide",
                                colors.tagCls
                              )}
                            >
                              {typeDef.isSchedulable ? "Automático" : "Manual"}
                            </span>
                          </div>
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {typeDef.description}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!manualDraft.templateType}
                    onClick={() => setManualStep("config")}
                  >
                    Próximo: Configuração →
                  </Button>
                </div>
              </div>
            ) : null}

            {manualStep === "config" && manualDraft.templateType ? (
              <div className="max-w-[540px]">
                <h2 className="text-lg font-bold tracking-tight">Configuração</h2>
                <p className="mb-4 mt-1 text-xs text-muted-foreground">
                  Preencha os dados base do checklist manual.
                </p>

                {/* Info banner */}
                <div className="mb-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] text-rose-700">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{getChecklistTypeById(manualDraft.templateType, checklistTypes)?.configBanner ?? ""}</span>
                </div>

                {/* Section: Informações gerais */}
                <div className="mb-4 flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Informações gerais
                  </p>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Unidade <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={manualDraft.unitId}
                      onValueChange={(unitId) =>
                        setManualDraft((current) => ({ ...current, unitId }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar…" />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map((unit) => (
                          <SelectItem key={unit.id} value={unit.id}>
                            {unit.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Data <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="date"
                      value={manualDraft.date}
                      onChange={(event) =>
                        setManualDraft((current) => ({
                          ...current,
                          date: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Responsável pela execução
                  </Label>
                  <Select
                    value={manualDraft.assignedUserId}
                    onValueChange={(assignedUserId) =>
                      setManualDraft((current) => ({
                        ...current,
                        assignedUserId,
                        collaboratorUserIds: current.collaboratorUserIds.filter(
                          (id) => id !== assignedUserId
                        ),
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Atribuir a…" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Pessoa principal responsável por preencher.
                  </p>
                </div>

                <div className="mt-4 space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Colaboradores (opcional)
                  </Label>
                  <MultiSelect
                    options={activeUsers
                      .filter((user) => user.id !== manualDraft.assignedUserId)
                      .map((user) => ({ value: user.id, label: user.username }))}
                    selected={manualDraft.collaboratorUserIds}
                    onChange={(collaboratorUserIds) =>
                      setManualDraft((current) => ({
                        ...current,
                        collaboratorUserIds,
                      }))
                    }
                    placeholder="Adicionar colaboradores…"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Outras pessoas autorizadas a preencher esse checklist além do responsável.
                  </p>
                </div>

                {/* Conditional: incident */}
                {manualDraft.templateType === "incident" ? (
                  <>
                    <div className="mb-4 mt-6 flex items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                        Contexto da Ocorrência
                      </p>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Descreva o incidente <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        placeholder="Descreva o problema inesperado, horário e local…"
                        value={manualDraft.incidentContext}
                        onChange={(event) =>
                          setManualDraft((current) => ({
                            ...current,
                            incidentContext: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </>
                ) : null}

                {/* Conditional: receiving */}
                {manualDraft.templateType === "receiving" ? (
                  <>
                    <div className="mb-4 mt-6 flex items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                        Dados do Recebimento
                      </p>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Fornecedor <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          placeholder="Nome do fornecedor"
                          value={manualDraft.supplierName}
                          onChange={(event) =>
                            setManualDraft((current) => ({
                              ...current,
                              supplierName: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Nº Nota Fiscal
                        </Label>
                        <Input
                          placeholder="Ex: NF-00421"
                          value={manualDraft.invoiceNumber}
                          onChange={(event) =>
                            setManualDraft((current) => ({
                              ...current,
                              invoiceNumber: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                  </>
                ) : null}

                {/* Conditional: one_time */}
                {manualDraft.templateType === "one_time" ? (
                  <>
                    <div className="mb-4 mt-6 flex items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                        Agendamento
                      </p>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Data agendada para execução
                      </Label>
                      <Input
                        type="date"
                        value={manualDraft.scheduledDate}
                        onChange={(event) =>
                          setManualDraft((current) => ({
                            ...current,
                            scheduledDate: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </>
                ) : null}

                {/* Section: Recorrência */}
                <div className="mb-4 mt-6 flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Recorrência
                  </p>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Repetir automaticamente</p>
                    <p className="text-xs text-muted-foreground">
                      Defina uma frequência para gerar novas execuções deste checklist.
                    </p>
                  </div>
                  <Switch
                    checked={manualDraft.enableRecurrence}
                    onCheckedChange={(enableRecurrence) =>
                      setManualDraft((current) => ({ ...current, enableRecurrence }))
                    }
                  />
                </div>

                {manualDraft.enableRecurrence && (
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Frequência
                      </Label>
                      <Select
                        value={manualDraft.recurrenceType}
                        onValueChange={(v) =>
                          setManualDraft((current) => ({
                            ...current,
                            recurrenceType: v as DPChecklistOccurrenceType,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECURRENCE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {manualDraft.recurrenceType === "annual" && (
                      <AnnualScheduleBuilder
                        value={manualDraft.annualSchedule}
                        onChange={(annualSchedule) =>
                          setManualDraft((current) => ({ ...current, annualSchedule }))
                        }
                      />
                    )}

                    {manualDraft.recurrenceType === "custom" && (
                      <CustomScheduleBuilder
                        value={manualDraft.customSchedule}
                        onChange={(customSchedule) =>
                          setManualDraft((current) => ({ ...current, customSchedule }))
                        }
                      />
                    )}
                  </div>
                )}

                {/* Section: Template base */}
                <div className="mb-4 mt-6 flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Template base
                  </p>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Usar template existente
                  </Label>
                  <Select
                    value={manualDraft.templateId}
                    onValueChange={(templateId) =>
                      setManualDraft((current) => ({ ...current, templateId }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sem template — criar em branco" />
                    </SelectTrigger>
                    <SelectContent>
                      {manualTemplates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManualStep("type")}
                  >
                    ← Voltar
                  </Button>
                  {!manualDraft.templateId ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={!manualDraft.templateType}
                      onClick={() => setManualStep("builder")}
                    >
                      Próximo: Itens →
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {manualStep === "builder" && !manualDraft.templateId ? (
              <div className="max-w-[620px]">
                <h2 className="text-lg font-bold tracking-tight">Construção do checklist</h2>
                <p className="mb-6 mt-1 text-xs text-muted-foreground">
                  Adicione seções e itens. Itens obrigatórios devem ser preenchidos para concluir.
                </p>

                <div className="space-y-4">
                  {manualDraft.sections.map((section, sectionIndex) => (
                    <div
                      key={section.id}
                      className="rounded-xl border bg-card p-4 space-y-3"
                    >
                      {/* Section header */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 space-y-1">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Seção {sectionIndex + 1}
                          </Label>
                          <Input
                            placeholder="Título da seção…"
                            value={section.title}
                            onChange={(e) =>
                              setManualDraft((prev) => ({
                                ...prev,
                                sections: prev.sections.map((s) =>
                                  s.id === section.id
                                    ? { ...s, title: e.target.value }
                                    : s
                                ),
                              }))
                            }
                          />
                        </div>
                        {manualDraft.sections.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="mt-4 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setManualDraft((prev) => ({
                                ...prev,
                                sections: setSectionOrder(
                                  prev.sections.filter((s) => s.id !== section.id)
                                ),
                              }))
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>

                      {/* Items */}
                      <div className="space-y-2 pl-3 border-l-2 border-border">
                        {section.items.map((item, itemIndex) => (
                          <div key={item.id} className="flex items-start gap-2">
                            <div className="flex-1 grid grid-cols-[1fr_140px] gap-2">
                              <Input
                                placeholder={`Item ${itemIndex + 1}…`}
                                value={item.title}
                                onChange={(e) =>
                                  setManualDraft((prev) => ({
                                    ...prev,
                                    sections: prev.sections.map((s) =>
                                      s.id === section.id
                                        ? {
                                            ...s,
                                            items: s.items.map((it) =>
                                              it.id === item.id
                                                ? { ...it, title: e.target.value }
                                                : it
                                            ),
                                          }
                                        : s
                                    ),
                                  }))
                                }
                              />
                              <Select
                                value={item.type}
                                onValueChange={(type) =>
                                  setManualDraft((prev) => ({
                                    ...prev,
                                    sections: prev.sections.map((s) =>
                                      s.id === section.id
                                        ? {
                                            ...s,
                                            items: s.items.map((it) =>
                                              it.id === item.id
                                                ? { ...it, type: type as DPChecklistItemType }
                                                : it
                                            ),
                                          }
                                        : s
                                    ),
                                  }))
                                }
                              >
                                <SelectTrigger className="text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ITEM_TYPE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {section.items.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() =>
                                  setManualDraft((prev) => ({
                                    ...prev,
                                    sections: prev.sections.map((s) =>
                                      s.id === section.id
                                        ? {
                                            ...s,
                                            items: setItemOrder(
                                              s.items.filter((it) => it.id !== item.id)
                                            ),
                                          }
                                        : s
                                    ),
                                  }))
                                }
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground"
                          onClick={() =>
                            setManualDraft((prev) => ({
                              ...prev,
                              sections: prev.sections.map((s) =>
                                s.id === section.id
                                  ? {
                                      ...s,
                                      items: setItemOrder([
                                        ...s.items,
                                        makeDefaultItem(s.items.length),
                                      ]),
                                    }
                                  : s
                              ),
                            }))
                          }
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          Adicionar item
                        </Button>
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setManualDraft((prev) => ({
                        ...prev,
                        sections: [
                          ...prev.sections,
                          makeDefaultSection(prev.sections.length),
                        ],
                      }))
                    }
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Adicionar seção
                  </Button>
                </div>

                <div className="mt-6 flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManualStep("config")}
                  >
                    ← Voltar
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Right — Leitura rápida */}
          <aside className="sticky top-[52px] h-[calc(100vh-8rem)] w-[200px] shrink-0 overflow-y-auto border-l bg-muted/20 px-4 py-6">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Leitura rápida
            </p>

            {selectedTypeDef ? (
              <div className="rounded-xl border bg-card p-3.5">
                <div className="mb-2 text-[28px]">{selectedTypeDef.emoji}</div>
                <p className="mb-1.5 text-[13px] font-bold">{selectedTypeDef.name}</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {selectedTypeDef.description}
                </p>
                <ul className="mt-2.5 space-y-1">
                  {selectedTypeDef.examples.split(/[,;]+/).map((example) => (
                    <li key={example} className="flex gap-1.5 text-[11px] text-muted-foreground">
                      <span className="shrink-0 font-bold text-rose-500">›</span>
                      {example.trim()}
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[11px] italic text-muted-foreground/70">
                  {selectedTypeDef.behavior}
                </p>
              </div>
            ) : (
              <p className="px-2 py-5 text-center text-[12px] leading-relaxed text-muted-foreground/60">
                Selecione um tipo para ver a explicação operacional.
              </p>
            )}
          </aside>

        </div>
      )}
    </div>
  );
}

export function DPChecklistTemplateBuilderPage({
  templateId,
}: {
  templateId?: string | null;
}) {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { units, shiftDefinitions } = useDPBootstrap();
  const { toast } = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const isEditing = !!templateId && templateId !== "new";
  const [payload, setPayload] = React.useState<DPChecklistBootstrapPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [templateStep, setTemplateStep] = React.useState<"type" | "config" | "builder">(
    isEditing ? "config" : "type"
  );
  const [templateDraft, setTemplateDraft] = React.useState<TemplateDraft>(makeTemplateDraft());
  const [saving, setSaving] = React.useState(false);
  const [initializedForTemplate, setInitializedForTemplate] = React.useState<string | null>(null);
  const [versionHistoryOpen, setVersionHistoryOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const nextPayload = await fetchDPChecklistBootstrap(firebaseUser, {
        date: toDateInputValue(),
      });
      setPayload(nextPayload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Falha ao carregar os dados do builder."
      );
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!payload) return;
    const currentKey = templateId ?? "new";
    if (initializedForTemplate === currentKey) return;

    if (isEditing) {
      const template = payload.templates.find((entry) => entry.id === templateId);
      if (!template) {
        setError("Template não encontrado para edição.");
        return;
      }
      setTemplateDraft(templateToDraft(template));
      setTemplateStep("config");
    } else {
      setTemplateDraft(makeTemplateDraft());
      setTemplateStep("type");
    }

    setInitializedForTemplate(currentKey);
  }, [payload, templateId, isEditing, initializedForTemplate]);

  const allTemplateItems = React.useMemo(
    () =>
      templateDraft.sections.flatMap((section) =>
        collectTemplateItemOptions(section.items)
      ),
    [templateDraft.sections]
  );

  const previewExecution = React.useMemo(() => {
    const sections = buildChecklistExecutionSections(templateDraft.sections);
    const items = buildChecklistExecutionItems(templateDraft.sections);
    return {
      id: "preview",
      checklistDate: toDateInputValue(),
      templateId: templateDraft.id ?? "draft",
      templateName: templateDraft.name || "Preview",
      templateType: templateDraft.templateType,
      templateVersion: 1,
      occurrenceType: templateDraft.occurrenceType,
      scheduleId: "preview",
      shiftId: "preview",
      unitId: templateDraft.unitIds[0] ?? "",
      unitName:
        units.find((unit) => unit.id === templateDraft.unitIds[0])?.name ?? "—",
      shiftDefinitionId: templateDraft.shiftDefinitionIds[0] ?? null,
      shiftDefinitionName:
        shiftDefinitions.find((shift) => shift.id === templateDraft.shiftDefinitionIds[0])?.name ??
        undefined,
      assignedUserId: "preview",
      assignedUsername: "Operador",
      sections,
      shiftStartTime: "",
      shiftEndTime: "",
      shiftEndDate: toDateInputValue(),
      status: "pending" as const,
      score: undefined,
      items,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies DPChecklistExecution;
  }, [shiftDefinitions, templateDraft, units]);

  const [previewItems, setPreviewItems] = React.useState<DPChecklistExecutionItem[]>(previewExecution.items);
  const versionHistory = React.useMemo(
    () =>
      [...templateDraft.versionHistory].sort(
        (left, right) => Number(right.version) - Number(left.version)
      ),
    [templateDraft.versionHistory]
  );

  React.useEffect(() => {
    setPreviewItems(previewExecution.items);
  }, [previewExecution]);

  function updateTemplateSections(nextSections: DPChecklistSection[]) {
    setTemplateDraft((current) => ({
      ...current,
      sections: setSectionOrder(nextSections),
    }));
  }

  function handleSectionDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = templateDraft.sections.findIndex((section) => section.id === event.active.id);
    const newIndex = templateDraft.sections.findIndex((section) => section.id === event.over?.id);
    if (oldIndex === -1 || newIndex === -1) return;
    updateTemplateSections(arrayMove(templateDraft.sections, oldIndex, newIndex));
  }

  function handleItemDragEnd(sectionId: string, event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const section = templateDraft.sections.find((entry) => entry.id === sectionId);
    if (!section) return;
    const oldIndex = section.items.findIndex((item) => item.id === event.active.id);
    const newIndex = section.items.findIndex((item) => item.id === event.over?.id);
    if (oldIndex === -1 || newIndex === -1) return;
    updateTemplateSections(
      templateDraft.sections.map((current) =>
        current.id === sectionId
          ? { ...current, items: setItemOrder(arrayMove(current.items, oldIndex, newIndex)) }
          : current
      )
    );
  }

  async function handleSaveTemplate() {
    if (!firebaseUser) return;

    const effectiveOccurrence =
      templateDraft.templateType === "incident" ||
      templateDraft.templateType === "one_time" ||
      templateDraft.templateType === "receiving"
        ? "manual"
        : templateDraft.occurrenceType;

    const body = {
      name: templateDraft.name,
      description: templateDraft.description || undefined,
      category: templateDraft.category || undefined,
      templateType: templateDraft.templateType,
      occurrenceType: effectiveOccurrence,
      annualSchedule:
        effectiveOccurrence === "annual" ? templateDraft.annualSchedule : undefined,
      customSchedule:
        effectiveOccurrence === "custom" ? templateDraft.customSchedule : undefined,
      unitIds: templateDraft.unitIds,
      jobRoleIds: templateDraft.jobRoleIds,
      jobFunctionIds: templateDraft.jobFunctionIds,
      shiftDefinitionIds: templateDraft.shiftDefinitionIds,
      isActive: templateDraft.isActive,
      changeNotes: templateDraft.changeNotes || undefined,
      sections: setSectionOrder(templateDraft.sections).map((section, sectionIndex) => ({
        ...section,
        order: sectionIndex,
        items: setItemOrder(section.items),
      })),
    };

    setSaving(true);
    try {
      if (templateDraft.id) {
        await updateDPChecklistTemplate(firebaseUser, templateDraft.id, body);
      } else {
        await createDPChecklistTemplate(firebaseUser, body);
      }
      toast({ title: "Template salvo." });
      router.push("/dashboard/dp/checklists?tab=templates");
    } catch (requestError) {
      toast({
        title: "Falha ao salvar template",
        description:
          requestError instanceof Error ? requestError.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const checklistTypes = React.useMemo(
    () => resolveChecklistTypes(payload?.checklistTypes),
    [payload?.checklistTypes]
  );
  const previewActiveItems = getActiveExecutionItems(
    previewItems,
    buildExecutionAnswerMap(previewItems)
  );

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-6 lg:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <Button
            type="button"
            variant="ghost"
            className="w-fit px-0 text-muted-foreground"
            onClick={() => router.push("/dashboard/dp/checklists?tab=templates")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para templates
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                {isEditing ? "Editar template" : "Novo template"}
              </h1>
              <Badge className={getTemplateTypeBadgeClass(templateDraft.templateType, checklistTypes)}>
                {getChecklistTypeById(templateDraft.templateType, checklistTypes)?.name ?? templateDraft.templateType}
              </Badge>
              <Badge variant="outline">v{templateDraft.version}</Badge>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Monte o formulário em página exclusiva, com configuração lateral, canvas de seções e preview fixo do operador.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isEditing ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setVersionHistoryOpen(true)}
            >
              Histórico de versões
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/dashboard/dp/checklists?tab=templates")}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleSaveTemplate()} disabled={saving || loading}>
            {saving ? "Salvando..." : "Salvar template"}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar o builder</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && !payload ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-[720px] w-full" />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
            <Card>
              <CardHeader>
                <CardTitle>Etapas</CardTitle>
                <CardDescription>
                  Configure tipo, escopo e depois desenhe a estrutura do formulário.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { key: "type" as const, label: "1. Tipo", hint: "Escolha o modelo base" },
                  { key: "config" as const, label: "2. Configuração", hint: "Escopo, filtros e recorrência" },
                  { key: "builder" as const, label: "3. Builder", hint: "Seções, itens e preview" },
                ].map((step) => (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => setTemplateStep(step.key)}
                    className={cn(
                      "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                      templateStep === step.key
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/40"
                    )}
                  >
                    <p className="font-medium">{step.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{step.hint}</p>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Resumo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Nome:</span>{" "}
                  {templateDraft.name || "Não definido"}
                </p>
                <p>
                  <span className="font-medium text-foreground">Itens:</span>{" "}
                  {templateDraft.sections.reduce(
                    (total, section) => total + collectTemplateItemOptions(section.items).length,
                    0
                  )}
                </p>
                <p>
                  <span className="font-medium text-foreground">Unidades:</span>{" "}
                  {templateDraft.unitIds.length || "Todas"}
                </p>
                <p>
                  <span className="font-medium text-foreground">Funções:</span>{" "}
                  {templateDraft.jobFunctionIds.length || "Todas"}
                </p>
                <p>
                  <span className="font-medium text-foreground">Versão atual:</span>{" "}
                  v{templateDraft.version}
                </p>
                <p>
                  <span className="font-medium text-foreground">Histórico:</span>{" "}
                  {templateDraft.versionHistory.length
                    ? `${templateDraft.versionHistory.length} versões anteriores`
                    : "Sem revisões anteriores"}
                </p>
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-6">
            {templateStep === "type" ? (
              <Card>
                <CardHeader>
                  <CardTitle>Escolha o tipo do template</CardTitle>
                  <CardDescription>
                    O tipo define a forma de criação, recorrência e leitura gerencial do checklist.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                  {checklistTypes.map((typeDef) => (
                    <TemplateTypeCard
                      key={typeDef.id}
                      type={typeDef.id}
                      selected={templateDraft.templateType === typeDef.id}
                      checklistTypes={checklistTypes}
                      onSelect={() =>
                        setTemplateDraft((current) => ({
                          ...current,
                          templateType: typeDef.id,
                          occurrenceType: getOccurrenceOptions(typeDef.id, checklistTypes)[0].value as DPChecklistOccurrenceType,
                        }))
                      }
                    />
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {templateStep === "config" ? (
              <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>Identidade do template</CardTitle>
                    <CardDescription>
                      Defina nome, categoria e descrição do formulário.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Nome</Label>
                        <Input
                          value={templateDraft.name}
                          onChange={(event) =>
                            setTemplateDraft((current) => ({ ...current, name: event.target.value }))
                          }
                          placeholder="Ex: Auditoria de abertura"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Categoria</Label>
                        <Input
                          value={templateDraft.category}
                          onChange={(event) =>
                            setTemplateDraft((current) => ({ ...current, category: event.target.value }))
                          }
                          placeholder="Ex: Qualidade"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Descrição</Label>
                      <Textarea
                        value={templateDraft.description}
                        onChange={(event) =>
                          setTemplateDraft((current) => ({ ...current, description: event.target.value }))
                        }
                        placeholder="Explique quando esse checklist deve ser usado e qual o objetivo."
                        className="min-h-[140px]"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Escopo e distribuição</CardTitle>
                    <CardDescription>
                      Controle onde o template aparece e para quem ele pode ser gerado.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Recorrência</Label>
                      <Select
                        value={templateDraft.occurrenceType}
                        onValueChange={(value) =>
                          setTemplateDraft((current) => ({
                            ...current,
                            occurrenceType: value as DPChecklistOccurrenceType,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getOccurrenceOptions(templateDraft.templateType, checklistTypes).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {templateDraft.occurrenceType === "annual" && (
                        <AnnualScheduleBuilder
                          value={templateDraft.annualSchedule}
                          onChange={(annualSchedule) =>
                            setTemplateDraft((current) => ({ ...current, annualSchedule }))
                          }
                        />
                      )}
                      {templateDraft.occurrenceType === "custom" && (
                        <CustomScheduleBuilder
                          value={templateDraft.customSchedule}
                          onChange={(customSchedule) =>
                            setTemplateDraft((current) => ({ ...current, customSchedule }))
                          }
                        />
                      )}
                    </div>

                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <Label>Unidades</Label>
                        <MultiSelect
                          options={units.map((unit) => ({ value: unit.id, label: unit.name }))}
                          selected={templateDraft.unitIds}
                          onChange={(unitIds) =>
                            setTemplateDraft((current) => ({ ...current, unitIds }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Cargos</Label>
                        <MultiSelect
                          options={(payload?.roles ?? []).map((role: JobRole) => ({
                            value: role.id,
                            label: role.name,
                          }))}
                          selected={templateDraft.jobRoleIds}
                          onChange={(jobRoleIds) =>
                            setTemplateDraft((current) => ({ ...current, jobRoleIds }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Funções</Label>
                        <MultiSelect
                          options={(payload?.functions ?? []).map((item: JobFunction) => ({
                            value: item.id,
                            label: item.name,
                          }))}
                          selected={templateDraft.jobFunctionIds}
                          onChange={(jobFunctionIds) =>
                            setTemplateDraft((current) => ({ ...current, jobFunctionIds }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Turnos</Label>
                        <MultiSelect
                          options={shiftDefinitions.map((shift: DPShiftDefinition) => ({
                            value: shift.id,
                            label: shift.name,
                          }))}
                          selected={templateDraft.shiftDefinitionIds}
                          onChange={(shiftDefinitionIds) =>
                            setTemplateDraft((current) => ({
                              ...current,
                              shiftDefinitionIds,
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border px-4 py-4">
                      <div>
                        <p className="font-medium">Template ativo</p>
                        <p className="text-sm text-muted-foreground">
                          Desative para impedir novas execuções.
                        </p>
                      </div>
                      <Switch
                        checked={templateDraft.isActive}
                        onCheckedChange={(isActive) =>
                          setTemplateDraft((current) => ({ ...current, isActive }))
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {templateStep === "builder" ? (
              <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                      <div>
                        <CardTitle>Canvas do formulário</CardTitle>
                        <CardDescription>
                          Monte seções, itens, branches, criticidade e regras de obrigatoriedade.
                        </CardDescription>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updateTemplateSections([
                            ...templateDraft.sections,
                            makeDefaultSection(templateDraft.sections.length),
                          ])
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Nova seção
                      </Button>
                    </CardHeader>
                  </Card>

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
                    <SortableContext
                      items={templateDraft.sections.map((section) => section.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-4">
                        {templateDraft.sections.map((section, sectionIndex) => (
                          <SortableCard key={section.id} id={section.id}>
                            <div className="space-y-4 p-5">
                              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                                  <div className="space-y-2">
                                    <Label>Título da seção</Label>
                                    <Input
                                      value={section.title}
                                      onChange={(event) =>
                                        updateTemplateSections(
                                          templateDraft.sections.map((current) =>
                                            current.id === section.id
                                              ? { ...current, title: event.target.value }
                                              : current
                                          )
                                        )
                                      }
                                      placeholder={`Ex: Seção ${sectionIndex + 1}`}
                                    />
                                  </div>

                                  <div className="space-y-2">
                                    <Label>Regras da seção</Label>
                                    <div className="grid gap-2">
                                      <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                                        <span className="text-sm">Exigir foto</span>
                                        <Switch
                                          checked={section.requirePhoto ?? false}
                                          onCheckedChange={(checked) =>
                                            updateTemplateSections(
                                              templateDraft.sections.map((current) =>
                                                current.id === section.id
                                                  ? { ...current, requirePhoto: checked }
                                                  : current
                                              )
                                            )
                                          }
                                        />
                                      </div>
                                      <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                                        <span className="text-sm">Exigir assinatura</span>
                                        <Switch
                                          checked={section.requireSignature ?? false}
                                          onCheckedChange={(checked) =>
                                            updateTemplateSections(
                                              templateDraft.sections.map((current) =>
                                                current.id === section.id
                                                  ? { ...current, requireSignature: checked }
                                                  : current
                                              )
                                            )
                                          }
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive"
                                  onClick={() =>
                                    updateTemplateSections(
                                      templateDraft.sections.filter((current) => current.id !== section.id)
                                    )
                                  }
                                  disabled={templateDraft.sections.length === 1}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Remover seção
                                </Button>
                              </div>

                              <ConditionEditor
                                value={section.showIf}
                                items={allTemplateItems}
                                onChange={(showIf) =>
                                  updateTemplateSections(
                                    templateDraft.sections.map((current) =>
                                      current.id === section.id ? { ...current, showIf } : current
                                    )
                                  )
                                }
                              />

                              <div className="flex items-center justify-between">
                                <h4 className="font-medium">Itens da seção</h4>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    updateTemplateSections(
                                      templateDraft.sections.map((current) =>
                                        current.id === section.id
                                          ? {
                                              ...current,
                                              items: setItemOrder([
                                                ...current.items,
                                                makeDefaultItem(current.items.length),
                                              ]),
                                            }
                                          : current
                                      )
                                    )
                                  }
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Novo item
                                </Button>
                              </div>

                              <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={(event) => handleItemDragEnd(section.id, event)}
                              >
                                <SortableContext
                                  items={section.items.map((item) => item.id)}
                                  strategy={verticalListSortingStrategy}
                                >
                                  <div className="space-y-3">
                                    {section.items.map((item) => (
                                      <SortableCard key={item.id} id={item.id}>
                                        <div className="p-4">
                                          <ItemEditor
                                            item={item}
                                            allItems={allTemplateItems}
                                            onChange={(next) =>
                                              updateTemplateSections(
                                                templateDraft.sections.map((current) =>
                                                  current.id === section.id
                                                    ? {
                                                        ...current,
                                                        items: setItemOrder(
                                                          updateItemRecursive(
                                                            current.items,
                                                            item.id,
                                                            () => next
                                                          )
                                                        ),
                                                      }
                                                    : current
                                                )
                                              )
                                            }
                                            onRemove={() =>
                                              updateTemplateSections(
                                                templateDraft.sections.map((current) =>
                                                  current.id === section.id
                                                    ? {
                                                        ...current,
                                                        items: setItemOrder(
                                                          removeItemRecursive(current.items, item.id)
                                                        ),
                                                      }
                                                    : current
                                                )
                                              )
                                            }
                                            onAddBranch={() =>
                                              updateTemplateSections(
                                                templateDraft.sections.map((current) =>
                                                  current.id === section.id
                                                    ? {
                                                        ...current,
                                                        items: updateItemRecursive(
                                                          current.items,
                                                          item.id,
                                                          (currentItem) => ({
                                                            ...currentItem,
                                                            conditionalBranches: [
                                                              ...(currentItem.conditionalBranches ?? []),
                                                              { value: "", label: "", items: [] },
                                                            ],
                                                          })
                                                        ),
                                                      }
                                                    : current
                                                )
                                              )
                                            }
                                            onAddBranchItem={(branchIndex) =>
                                              updateTemplateSections(
                                                templateDraft.sections.map((current) =>
                                                  current.id === section.id
                                                    ? {
                                                        ...current,
                                                        items: addBranchItemRecursive(
                                                          current.items,
                                                          item.id,
                                                          branchIndex,
                                                          makeDefaultItem(0, 2)
                                                        ),
                                                      }
                                                    : current
                                                )
                                              )
                                            }
                                          />
                                        </div>
                                      </SortableCard>
                                    ))}
                                  </div>
                                </SortableContext>
                              </DndContext>
                            </div>
                          </SortableCard>
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>

                <div className="space-y-4 2xl:sticky 2xl:top-20 2xl:self-start">
                  <Card>
                    <CardHeader>
                      <CardTitle>Preview do operador</CardTitle>
                      <CardDescription>
                        Veja como o formulário aparece sem sair da página de montagem.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {(previewExecution.sections ?? []).map((section) => {
                        const visibleItems = previewActiveItems.filter(
                          (item) => item.sectionId === section.id
                        );
                        if (
                          section.showIf &&
                          !visibleItems.length &&
                          getItemConditionLabel(section.showIf) !== "Sempre visível"
                        ) {
                          return null;
                        }
                        return (
                          <div key={section.id} className="rounded-xl border p-4">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="font-medium">{section.title || "Seção sem título"}</p>
                                <p className="text-xs text-muted-foreground">
                                  {getItemConditionLabel(section.showIf)}
                                </p>
                              </div>
                              <div className="flex gap-2">
                                {section.requirePhoto ? <Badge variant="outline">Foto</Badge> : null}
                                {section.requireSignature ? (
                                  <Badge variant="outline">Assinatura</Badge>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-3 space-y-3">
                              {visibleItems.length === 0 ? (
                                <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                                  Nenhum item visível nesta seção ainda.
                                </div>
                              ) : (
                                visibleItems.map((item) => (
                                  <div
                                    key={item.templateItemId}
                                    className="space-y-2 rounded-lg border p-3"
                                    style={{ marginLeft: `${(item.branchPath?.length ?? 0) * 12}px` }}
                                  >
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium">{item.title || "Item sem título"}</p>
                                      {item.criticality !== "low" ? (
                                        <Badge variant="outline">{item.criticality}</Badge>
                                      ) : null}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {item.description || "Sem descrição"}
                                    </p>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <div className="rounded-xl border bg-muted/20 p-4">
                        <p className="text-sm font-medium">Score previsto</p>
                        <p className="mt-2 text-2xl font-semibold">
                          {formatPercent(calculateExecutionScore(previewItems))}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Notas da versão</CardTitle>
                <CardDescription>
                  {isEditing
                    ? "Resuma o que mudou nesta revisão para manter o histórico legível."
                    : "Opcional na criação inicial. Use este campo para registrar contexto do primeiro template."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={templateDraft.changeNotes}
                  onChange={(event) =>
                    setTemplateDraft((current) => ({
                      ...current,
                      changeNotes: event.target.value,
                    }))
                  }
                  placeholder={
                    isEditing
                      ? "Ex: reorganizei a seção de recebimento e adicionei branch para equipamento com defeito."
                      : "Ex: template inicial de auditoria de abertura."
                  }
                  className="min-h-[110px]"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <Sheet open={versionHistoryOpen} onOpenChange={setVersionHistoryOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Histórico de versões</SheetTitle>
            <SheetDescription>
              A versão atual é v{templateDraft.version}. As execuções antigas continuam ligadas à
              versão em que foram geradas.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Versão atual</CardTitle>
                <CardDescription>Template ativo para novas execuções.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">v{templateDraft.version}</span>
                  <Badge className={getTemplateTypeBadgeClass(templateDraft.templateType, checklistTypes)}>
                    {getChecklistTypeById(templateDraft.templateType, checklistTypes)?.name ?? templateDraft.templateType}
                  </Badge>
                </div>
                <p>{templateDraft.name || "Template sem nome definido."}</p>
                <p>{templateDraft.description || "Sem descrição cadastrada."}</p>
              </CardContent>
            </Card>

            {versionHistory.length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                Nenhuma revisão anterior registrada ainda.
              </div>
            ) : (
              versionHistory.map((entry) => (
                <Card key={`${entry.version}-${String(entry.updatedAt)}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">v{entry.version}</CardTitle>
                      <Badge variant="outline">{formatTimestamp(entry.updatedAt)}</Badge>
                    </div>
                    <CardDescription>
                      Atualizado por {entry.updatedBy || "usuário não informado"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {entry.changeNotes?.trim()
                      ? entry.changeNotes
                      : "Sem notas registradas para esta revisão."}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Página dedicada de execução ─────────────────────────────────────────────

export function DPChecklistExecutionPage({ executionId }: { executionId: string }) {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { toast } = useToast();

  const [execution, setExecution] = React.useState<DPChecklistExecution | null>(null);
  const [executionDraft, setExecutionDraft] = React.useState<DPChecklistExecution | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [sectionsMode, setSectionsMode] = React.useState(() =>
    typeof window !== "undefined" && localStorage.getItem("checklist-sections-mode") === "true"
  );
  const [sectionIdx, setSectionIdx] = React.useState(0);

  React.useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const { execution: loaded } = await fetchDPChecklistExecution(firebaseUser, executionId);
        const final =
          loaded.claimedByUserId && loaded.claimedByUserId !== null
            ? loaded
            : (await claimDPChecklistExecution(firebaseUser, executionId)).execution;
        if (!cancelled) {
          setExecution(final);
          setExecutionDraft(final);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar o checklist.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [firebaseUser, executionId]);

  const executionActiveItems = React.useMemo(() => {
    if (!executionDraft) return [] as DPChecklistExecutionItem[];
    return getActiveExecutionItems(executionDraft.items, buildExecutionAnswerMap(executionDraft.items));
  }, [executionDraft]);

  const executionMetrics = React.useMemo(() =>
    executionDraft ? getChecklistExecutionMetrics({ execution: executionDraft }) : null,
    [executionDraft]
  );

  const sectionBlockedAt = React.useMemo(() => {
    if (!executionDraft) return 0;
    const answers = buildExecutionAnswerMap(executionDraft.items);
    for (let s = 0; s < executionDraft.sections.length; s++) {
      const section = executionDraft.sections[s];
      const items = getActiveExecutionItems(
        executionDraft.items.filter(item => item.sectionId === section.id),
        answers
      );
      for (const item of items) {
        if (item.blockNext && !isChecklistExecutionItemCompleted(item)) return s;
      }
    }
    return executionDraft.sections.length;
  }, [executionDraft]);

  React.useEffect(() => {
    if (sectionsMode && executionDraft) {
      setSectionIdx(i => Math.min(i, Math.max(0, executionDraft.sections.length - 1)));
    }
  }, [executionDraft?.sections.length, sectionsMode]);

  async function handlePersist(action: "save" | "complete") {
    if (!firebaseUser || !executionDraft) return;
    setBusy(action);
    try {
      const result = await updateDPChecklistExecution(firebaseUser, executionDraft.id, {
        action,
        items: executionDraft.items.map(item => ({
          templateItemId: item.templateItemId,
          sectionId: item.sectionId,
          checked: item.checked ?? undefined,
          yesNoValue: item.yesNoValue ?? undefined,
          textValue: item.textValue ?? undefined,
          numberValue: item.numberValue,
          multiValues: item.multiValues ?? undefined,
          dateValue: item.dateValue ?? undefined,
          photoUrls: item.photoUrls ?? undefined,
          signatureUrl: item.signatureUrl ?? undefined,
        })),
      });
      setExecution(result.execution);
      setExecutionDraft(result.execution);
      toast({ title: action === "complete" ? "Checklist concluído." : "Progresso salvo." });
      if (action === "complete") {
        router.push("/dashboard/dp/checklists?tab=operations");
      }
    } catch (e) {
      toast({
        title: action === "complete" ? "Falha ao concluir" : "Falha ao salvar",
        description: e instanceof Error ? e.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  function patchItem(templateItemId: string, patch: Partial<DPChecklistExecutionItem>) {
    setExecutionDraft(current =>
      current
        ? { ...current, items: current.items.map(item => item.templateItemId === templateItemId ? { ...item, ...patch } : item) }
        : current
    );
  }

  const completedItems = executionMetrics?.completedItems ?? 0;
  const activeItems = executionMetrics?.activeItems ?? 0;
  const progressPct = activeItems > 0 ? Math.round((completedItems / activeItems) * 100) : 100;
  const isCompleted = executionDraft?.status === "completed";
  const isBusySave = busy === "save";
  const isBusyComplete = busy === "complete";

  return (
    <div className="-m-4 flex min-h-screen flex-col md:-m-8">
      {/* Topbar */}
      <div className="sticky top-0 z-10 flex h-[52px] shrink-0 items-center gap-3 border-b bg-background px-5">
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <button type="button" className="transition-colors hover:text-foreground"
            onClick={() => router.push("/dashboard/dp/checklists?tab=operations")}>
            Checklists
          </button>
          <span className="text-border">›</span>
          <span className="font-medium text-foreground">
            {executionDraft?.templateName ?? "Execução"}
          </span>
        </nav>
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm"
          onClick={() => router.push("/dashboard/dp/checklists?tab=operations")}>
          Voltar à lista
        </Button>
        {!isCompleted && (
          <>
            <Button type="button" variant="outline" size="sm"
              disabled={isBusySave || isBusyComplete}
              onClick={() => void handlePersist("save")}>
              {isBusySave ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar progresso"}
            </Button>
            <Button type="button" size="sm"
              disabled={isBusySave || isBusyComplete || activeItems === 0}
              onClick={() => void handlePersist("complete")}>
              {isBusyComplete ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Concluir checklist"}
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>Erro ao carregar o checklist</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : executionDraft ? (
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 pb-24 lg:px-6">
          {/* Header card */}
          <div className="overflow-hidden rounded-2xl border">
            <div className="flex flex-col gap-3 border-b bg-slate-50 px-5 py-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={getExecutionStatusMeta(executionDraft.status).className}>
                    {getExecutionStatusMeta(executionDraft.status).label}
                  </Badge>
                  <Badge variant="outline">
                    {getChecklistTypeById(executionDraft.templateType, DEFAULT_CHECKLIST_TYPES)?.name ?? executionDraft.templateType}
                  </Badge>
                  {executionDraft.occurrenceType && executionDraft.occurrenceType !== "manual" ? (
                    <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                      Recorrente · {{ daily: "diário", weekly: "semanal", biweekly: "quinzenal", monthly: "mensal", annual: "anual", custom: "personalizado", manual: "manual" }[executionDraft.occurrenceType] ?? executionDraft.occurrenceType}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                      Manual
                    </Badge>
                  )}
                  {executionMetrics?.criticalAlerts ? (
                    <Badge variant="destructive">{executionMetrics.criticalAlerts} alerta(s) crítico(s)</Badge>
                  ) : null}
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Execução</p>
                  <p className="text-base font-semibold">
                    {executionDraft.unitName ?? "Sem unidade"} •{" "}
                    {executionDraft.shiftStartTime && executionDraft.shiftEndTime
                      ? `${executionDraft.shiftStartTime}–${executionDraft.shiftEndTime}`
                      : "Fluxo manual"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Responsável:{" "}
                    <span className="font-medium text-foreground">{executionDraft.assignedUsername}</span>
                  </span>
                  {executionDraft.collaboratorUsernames && executionDraft.collaboratorUsernames.length > 0 ? (
                    <span>
                      Colaboradores:{" "}
                      <span className="font-medium text-foreground">
                        {executionDraft.collaboratorUsernames.join(", ")}
                      </span>
                    </span>
                  ) : null}
                  {executionDraft.occurrenceType && executionDraft.occurrenceType !== "manual" ? (
                    <span>Gerado pelo sistema</span>
                  ) : executionDraft.createdByUsername ? (
                    <span>Criado por <span className="font-medium text-foreground">{executionDraft.createdByUsername}</span></span>
                  ) : (
                    <span>Criado manualmente</span>
                  )}
                  {executionDraft.claimedByUsername ? (
                    <span>Assumido por <span className="font-medium text-foreground">{executionDraft.claimedByUsername}</span></span>
                  ) : null}
                  {executionDraft.claimedByUsername && !isCompleted ? (
                    <span className="text-amber-600">Somente <strong>{executionDraft.claimedByUsername}</strong> pode concluir.</span>
                  ) : null}
                </div>
                <p className="flex items-center gap-2 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Salvo em {formatTimestamp(executionDraft.updatedAt as string)}
                </p>
              </div>
              <div className="shrink-0 space-y-1 text-right">
                <div className="flex justify-end mb-1">
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                    onClick={() => setSectionsMode(prev => { localStorage.setItem("checklist-sections-mode", String(!prev)); return !prev; })}>
                    {sectionsMode ? <><List className="h-3.5 w-3.5" /> Lista</> : <><GalleryVerticalEnd className="h-3.5 w-3.5" /> Seções</>}
                  </Button>
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Progresso</p>
                <p className="text-2xl font-semibold tracking-tight">
                  {completedItems}<span className="text-sm font-medium text-muted-foreground"> / {activeItems}</span>
                </p>
                <p className="text-sm text-muted-foreground">{progressPct}% respondido</p>
              </div>
            </div>
            <div className="px-5 py-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Progresso atual</span>
                <span className={progressPct === 100 ? "text-emerald-600" : ""}>{progressPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          </div>

          {/* Conditional fields (incident/receiving/one_time) */}
          {(executionDraft.incidentContext || executionDraft.supplierName || executionDraft.invoiceNumber || executionDraft.scheduledDate) ? (
            <div className="rounded-2xl border p-4 text-sm">
              {executionDraft.incidentContext ? (
                <p><span className="font-semibold">Contexto do incidente:</span> {executionDraft.incidentContext}</p>
              ) : null}
              {executionDraft.supplierName ? (
                <p><span className="font-semibold">Fornecedor:</span> {executionDraft.supplierName}</p>
              ) : null}
              {executionDraft.invoiceNumber ? (
                <p><span className="font-semibold">NF:</span> {executionDraft.invoiceNumber}</p>
              ) : null}
              {executionDraft.scheduledDate ? (
                <p><span className="font-semibold">Data agendada:</span> {executionDraft.scheduledDate}</p>
              ) : null}
            </div>
          ) : null}

          {/* Items — sections mode */}
          {sectionsMode && executionDraft.sections.length > 0 ? (() => {
            const section = executionDraft.sections[sectionIdx];
            if (!section) return null;
            const answers = buildExecutionAnswerMap(executionDraft.items);
            const visibleItems = getActiveExecutionItems(
              executionDraft.items.filter(item => item.sectionId === section.id),
              answers
            );
            let blockReached = false;
            return (
              <div className="space-y-3 rounded-2xl border p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Seção {sectionIdx + 1} de {executionDraft.sections.length}
                    </p>
                    <h3 className="font-semibold">{section.title}</h3>
                  </div>
                  <div className="flex gap-2">
                    {section.requirePhoto ? <Badge variant="outline">Foto obrigatória</Badge> : null}
                    {section.requireSignature ? <Badge variant="outline">Assinatura obrigatória</Badge> : null}
                  </div>
                </div>
                <div className="space-y-3">
                  {visibleItems.map(item => {
                    const disabled = blockReached || isCompleted;
                    if (item.blockNext && !isChecklistExecutionItemCompleted(item)) blockReached = true;
                    return (
                      <div key={item.templateItemId} style={{ marginLeft: `${(item.branchPath?.length ?? 0) * 16}px` }}>
                        <ExecutionItemField item={item} disabled={disabled}
                          onChange={patch => patchItem(item.templateItemId, patch)} />
                      </div>
                    );
                  })}
                  {visibleItems.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted-foreground">Nenhum item visível nesta seção.</p>
                  )}
                </div>
                {/* Section nav */}
                <div className="flex items-center justify-between pt-2">
                  <Button type="button" variant="outline" size="sm" disabled={sectionIdx === 0}
                    onClick={() => setSectionIdx(i => Math.max(0, i - 1))}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
                  </Button>
                  <span className="text-xs text-muted-foreground">Seção {sectionIdx + 1} / {executionDraft.sections.length}</span>
                  <Button type="button" variant="outline" size="sm"
                    disabled={sectionIdx >= executionDraft.sections.length - 1 || sectionIdx >= sectionBlockedAt}
                    onClick={() => setSectionIdx(i => Math.min(executionDraft.sections.length - 1, i + 1))}>
                    Próxima <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            );
          })() : (
            // Lista: all sections
            executionDraft.sections.map((section, sIdx) => {
              const answers = buildExecutionAnswerMap(executionDraft.items);
              const visibleItems = getActiveExecutionItems(
                executionDraft.items.filter(item => item.sectionId === section.id),
                answers
              );
              if (!visibleItems.length) return null;
              let blockReached = false;
              return (
                <div key={section.id} className="space-y-3 rounded-2xl border p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Seção {sIdx + 1}
                      </p>
                      <h3 className="font-semibold">{section.title}</h3>
                    </div>
                    <div className="flex gap-2">
                      {section.requirePhoto ? <Badge variant="outline">Foto obrigatória</Badge> : null}
                      {section.requireSignature ? <Badge variant="outline">Assinatura obrigatória</Badge> : null}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {visibleItems.map(item => {
                      const disabled = blockReached || isCompleted;
                      if (item.blockNext && !isChecklistExecutionItemCompleted(item)) blockReached = true;
                      return (
                        <div key={item.templateItemId} style={{ marginLeft: `${(item.branchPath?.length ?? 0) * 16}px` }}>
                          <ExecutionItemField item={item} disabled={disabled}
                            onChange={patch => patchItem(item.templateItemId, patch)} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}

          {executionDraft.sections.length === 0 && (
            <div className="rounded-2xl border p-8 text-center text-muted-foreground">
              <p className="text-sm">Este checklist foi criado em branco e não possui itens.</p>
              <p className="mt-1 text-xs">Você pode concluí-lo diretamente ou criar um novo a partir de um template.</p>
            </div>
          )}

          {/* Sticky footer */}
          <div className="fixed bottom-0 left-0 right-0 z-10 border-t bg-background/95 px-6 py-4 backdrop-blur lg:left-64">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {completedItems} de {activeItems} item(ns) respondidos.
              </p>
              {!isCompleted && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline"
                    disabled={isBusySave || isBusyComplete}
                    onClick={() => void handlePersist("save")}>
                    {isBusySave ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Salvar progresso
                  </Button>
                  <Button type="button"
                    disabled={isBusySave || isBusyComplete || activeItems === 0}
                    onClick={() => void handlePersist("complete")}>
                    {isBusyComplete ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Concluir checklist
                  </Button>
                </div>
              )}
              {isCompleted && (
                <Badge className="bg-emerald-500 text-white">Checklist concluído</Badge>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
