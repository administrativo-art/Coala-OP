"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarClock,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Copy,
  FileText,
  FolderKanban,
  Layers3,
  Lock,
  MapPin,
  Pencil,
  Plus,
  UserCheck,
} from "lucide-react";

import type { FormExecution, FormProject, FormTemplate } from "@/types/forms";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import {
  createFormProject,
  createFormTemplate,
  fetchFormsBootstrap,
  updateFormTemplateApplication,
  updateFormProject,
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

const FORM_MODEL_LIBRARY = [
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

function KpiCard({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: number;
  subtitle: string;
  tone: "amber" | "blue" | "emerald" | "red";
}) {
  const toneClass =
    tone === "amber"
      ? "from-amber-50 to-white text-amber-700 border-amber-200"
      : tone === "blue"
        ? "from-blue-50 to-white text-blue-700 border-blue-200"
        : tone === "emerald"
          ? "from-emerald-50 to-white text-emerald-700 border-emerald-200"
          : "from-red-50 to-white text-red-700 border-red-200";

  return (
    <Card className={cn("bg-gradient-to-br", toneClass)}>
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

type TemplateDialogSource = "blank" | "model" | "duplicate";

type TemplateFormState = {
  source: TemplateDialogSource;
  model_id: string;
  duplicate_template_id: string;
  form_project_id: string;
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
  const { firebaseUser } = useAuth();
  const { units, shiftDefinitions } = useDPBootstrap();
  const { toast } = useToast();
  const [projects, setProjects] = useState<FormProject[]>([]);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [executions, setExecutions] = useState<FormExecution[]>([]);
  const [canCreateProjects, setCanCreateProjects] = useState(false);
  const [canManageTemplates, setCanManageTemplates] = useState(false);
  const [canViewAnalytics, setCanViewAnalytics] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<FormProject | null>(null);
  const [saving, setSaving] = useState<"project" | "template" | null>(null);
  const [projectForm, setProjectForm] = useState({
    name: "",
    description: "",
    color: "",
  });
  const [templateForm, setTemplateForm] = useState<TemplateFormState>({
    source: "blank",
    model_id: FORM_MODEL_LIBRARY[0]?.id ?? "",
    duplicate_template_id: "",
    form_project_id: "",
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

  const templatesByProject = useMemo(() => {
    return templates.reduce<Record<string, FormTemplate[]>>((accumulator, template) => {
      const key = template.form_project_id;
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
    return {
      pending: executions.filter((execution) => execution.status === "pending").length,
      inProgress: executions.filter((execution) => execution.status === "in_progress").length,
      completed: executions.filter((execution) => execution.status === "completed").length,
      overdue: executions.filter((execution) => execution.status === "overdue").length,
    };
  }, [executions]);

  const selectedModel = useMemo(() => {
    return FORM_MODEL_LIBRARY.find((model) => model.id === templateForm.model_id) ?? FORM_MODEL_LIBRARY[0];
  }, [templateForm.model_id]);

  const selectedModelItemIds = useMemo(() => {
    return new Set(templateForm.selected_model_item_ids);
  }, [templateForm.selected_model_item_ids]);

  const selectedModelTotalItems = useMemo(() => {
    return selectedModel?.sections.reduce((total, section) => total + section.items.length, 0) ?? 0;
  }, [selectedModel]);

  const selectedDuplicateTemplate = useMemo(() => {
    return templates.find((template) => template.id === templateForm.duplicate_template_id) ?? null;
  }, [templateForm.duplicate_template_id, templates]);

  const projectSummaries = useMemo(() => {
    return projects.map((project) => {
      const projectTemplates = templatesByProject[project.id] ?? [];
      const projectExecutions = executionsByProject[project.id] ?? [];
      return {
        project,
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
  }, [executionsByProject, projects, templatesByProject]);

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
        const data = await fetchFormsBootstrap(firebaseUser);
        if (!cancelled) {
          setProjects(data.projects);
          setTemplates(data.templates);
          setExecutions(data.executions);
          setCanCreateProjects(data.access.can_create_projects);
          setCanManageTemplates(data.access.can_manage_templates);
          setCanViewAnalytics(data.access.can_view_analytics);
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
    setProjectForm({ name: "", description: "", color: "" });
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
    });
    setProjectDialogOpen(true);
  }

  function selectAllModelItems(modelId = templateForm.model_id) {
    const model = FORM_MODEL_LIBRARY.find((entry) => entry.id === modelId);
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
    setProjects(data.projects);
    setTemplates(data.templates);
    setExecutions(data.executions);
    setCanCreateProjects(data.access.can_create_projects);
    setCanManageTemplates(data.access.can_manage_templates);
    setCanViewAnalytics(data.access.can_view_analytics);
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
          icon: editingProject.icon ?? "",
          is_active: true,
          members: editingProject.members ?? [],
        });
      } else {
        await createFormProject(firebaseUser, {
          name: projectForm.name,
          description: projectForm.description,
          color: projectForm.color,
          icon: "",
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
        form_type_id: "manual",
        context: templateForm.context,
        name:
          templateForm.name ||
          selectedModel?.name ||
          selectedDuplicateTemplate?.name ||
          "Novo formulário",
        description:
          templateForm.description ||
          selectedModel?.description ||
          selectedDuplicateTemplate?.description ||
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
        model_id: FORM_MODEL_LIBRARY[0]?.id ?? "",
        duplicate_template_id: "",
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
    <div className="space-y-6">
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
                setTemplateForm((current) => ({
                  ...current,
                  form_project_id: current.form_project_id || projects[0]?.id || "",
                }));
                selectAllModelItems();
                setTemplateDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo formulário
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pendentes" value={stats.pending} subtitle="Preenchimentos aguardando início" tone="amber" />
        <KpiCard label="Em andamento" value={stats.inProgress} subtitle="Preenchimentos já assumidos" tone="blue" />
        <KpiCard label="Concluídas" value={stats.completed} subtitle="Fluxos encerrados" tone="emerald" />
        <KpiCard label="Atrasadas" value={stats.overdue} subtitle="Preenchimentos em atenção" tone="red" />
      </div>

      <Tabs defaultValue="operations" className="space-y-4">
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
            projectSummaries.map(({ project, templates: projectTemplates, executions: projectExecutions, completionRate, items }) => (
              <Card key={project.id}>
                <CardHeader>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <FolderKanban className="h-5 w-5" />
                        {project.name}
                      </CardTitle>
                      <CardDescription>
                        {project.description?.trim() || "Projeto operacional no novo domínio de formulários."}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{projectTemplates.length} formulário(s)</Badge>
                      <Badge variant="outline">{projectExecutions.length} preenchimento(s)</Badge>
                      <Badge variant="outline">{items} pergunta(s)</Badge>
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        {completionRate}% concluído
                      </Badge>
                      {canCreateProjects ? (
                        <Button variant="ghost" size="sm" onClick={() => openEditProjectDialog(project)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Editar projeto
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {projectTemplates.length > 0 ? (
                    <div className="grid gap-3 xl:grid-cols-3">
                      {projectTemplates.slice(0, 3).map((template) => {
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
                            <div className="h-full rounded-xl border p-4 transition-colors hover:bg-muted/30">
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
                    <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                      Este projeto ainda não tem formulários publicados.
                    </div>
                  )}

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
                  ) : (
                    <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                      Nenhum preenchimento recente para este projeto.
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
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
                    <TableHead>Aplicação</TableHead>
                    <TableHead>Escopo</TableHead>
                    <TableHead>Perguntas</TableHead>
                    <TableHead>Último preenchimento</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((template) => {
                    const project = projects.find((entry) => entry.id === template.form_project_id);
                    return (
                      <TableRow key={template.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{template.name}</span>
                              <Badge variant="outline">v{template.version}</Badge>
                            </div>
                            {template.description ? (
                              <p className="line-clamp-1 text-xs text-muted-foreground">
                                {template.description}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{project?.name ?? template.form_project_id}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant="outline">{formatApplicationMode(template)}</Badge>
                            <p className="text-xs text-muted-foreground">{formatOccurrence(template.occurrence_type)}</p>
                          </div>
                        </TableCell>
                        <TableCell>{formatTemplateScope(template)}</TableCell>
                        <TableCell>{countTemplateItems(template)}</TableCell>
                        <TableCell>{formatRelative(template.last_execution_at)}</TableCell>
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
          <div className="grid gap-4 xl:grid-cols-3">
            {FORM_MODEL_LIBRARY.map((model) => {
              const itemCount = model.sections.reduce((total, section) => total + section.items.length, 0);
              return (
                <Card key={model.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Layers3 className="h-5 w-5" />
                      {model.name}
                    </CardTitle>
                    <CardDescription>{model.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{model.sections.length} seção(ões)</Badge>
                      <Badge variant="outline">{itemCount} pergunta(s)</Badge>
                    </div>
                    <div className="space-y-2">
                      {model.sections.map((section) => (
                        <div key={section.id} className="rounded-xl border p-3">
                          <p className="text-sm font-medium">{section.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {section.items.length} pergunta(s)
                          </p>
                        </div>
                      ))}
                    </div>
                    {projects.length > 0 && canManageTemplates ? (
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => {
                          const itemIds = model.sections.flatMap((section) => section.items.map((item) => item.id));
                          setTemplateForm((current) => ({
                            ...current,
                            source: "model",
                            model_id: model.id,
                            form_project_id: current.form_project_id || projects[0]?.id || "",
                            name: model.name,
                            description: model.description,
                            selected_model_item_ids: itemIds,
                          }));
                          setTemplateDialogOpen(true);
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Criar formulário
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Saúde operacional
                </CardTitle>
                <CardDescription>
                  Leitura consolidada dos preenchimentos do novo módulo.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {projectSummaries.map(({ project, executions: projectExecutions, completionRate }) => (
                  <div key={project.id} className="rounded-xl border p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {projectExecutions.length} preenchimento(s)
                        </p>
                      </div>
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        {completionRate}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="h-5 w-5" />
                  Recorrência
                </CardTitle>
                <CardDescription>
                  Distribuição dos formulários por frequência operacional.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(
                  templates.reduce<Record<string, number>>((accumulator, template) => {
                    const key = formatOccurrence(template.occurrence_type);
                    accumulator[key] = (accumulator[key] ?? 0) + 1;
                    return accumulator;
                  }, {})
                ).map(([label, total]) => (
                  <div key={label} className="flex items-center justify-between rounded-xl border p-4">
                    <span className="font-medium">{label}</span>
                    <Badge variant="outline">{total}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProject ? "Editar projeto" : "Novo projeto"}</DialogTitle>
            <DialogDescription>
              Configure a base operacional que agrupa formulários e preenchimentos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={projectForm.name}
              onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nome do projeto"
            />
            <Textarea
              value={projectForm.description}
              onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descrição"
            />
            <Input
              value={projectForm.color}
              onChange={(event) => setProjectForm((current) => ({ ...current, color: event.target.value }))}
              placeholder="Cor (ex: #0f766e)"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectDialogOpen(false)}>
              Fechar
            </Button>
            <Button onClick={() => void handleSaveProject()} disabled={saving === "project"}>
              {saving === "project" ? "Salvando..." : "Salvar projeto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo formulário</DialogTitle>
            <DialogDescription>
              Crie em branco, use um modelo com perguntas selecionáveis ou duplique um formulário existente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { value: "blank", label: "Em branco", icon: FileText },
                { value: "model", label: "Usar modelo", icon: Layers3 },
                { value: "duplicate", label: "Duplicar", icon: Copy },
              ].map((option) => {
                const Icon = option.icon;
                const active = templateForm.source === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-4 text-left transition-colors",
                      active ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/40"
                    )}
                    onClick={() => {
                      setTemplateForm((current) => ({
                            ...current,
                            source: option.value as TemplateDialogSource,
                        selected_model_item_ids:
                          option.value === "model" && current.selected_model_item_ids.length === 0
                            ? selectedModel?.sections.flatMap((section) => section.items.map((item) => item.id)) ?? []
                            : current.selected_model_item_ids,
                      }));
                    }}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="font-medium">{option.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Projeto</Label>
                <Select
                  value={templateForm.form_project_id}
                  onValueChange={(value) => setTemplateForm((current) => ({ ...current, form_project_id: value }))}
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
                <Label>Nome do formulário</Label>
                <Input
                  value={templateForm.name}
                  onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Ex: Checklist de abertura"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={templateForm.description}
                onChange={(event) => setTemplateForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Descreva quando e por que este formulário será usado."
              />
            </div>

            {templateForm.source === "model" ? (
              <div className="space-y-4 rounded-xl border p-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <div className="space-y-2">
                    <Label>Modelo</Label>
                    <Select
                      value={templateForm.model_id}
                      onValueChange={(value) => {
                        const model = FORM_MODEL_LIBRARY.find((entry) => entry.id === value);
                        const itemIds = model?.sections.flatMap((section) => section.items.map((item) => item.id)) ?? [];
                        setTemplateForm((current) => ({
                          ...current,
                          model_id: value,
                          name: current.name || model?.name || "",
                          description: current.description || model?.description || "",
                          selected_model_item_ids: itemIds,
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um modelo" />
                      </SelectTrigger>
                      <SelectContent>
                        {FORM_MODEL_LIBRARY.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" variant="outline" onClick={() => selectAllModelItems()}>
                    <CheckSquare className="mr-2 h-4 w-4" />
                    Selecionar tudo
                  </Button>
                </div>

                <div className="space-y-3">
                  {selectedModel?.sections.map((section) => {
                    const sectionSelectedCount = section.items.filter((item) => selectedModelItemIds.has(item.id)).length;
                    const sectionChecked = sectionSelectedCount === section.items.length;
                    return (
                      <div key={section.id} className="rounded-xl border p-3">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={sectionChecked}
                            onCheckedChange={(checked) => toggleModelSection(section.id, checked === true)}
                          />
                          <div>
                            <p className="text-sm font-medium">{section.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {sectionSelectedCount}/{section.items.length} pergunta(s) selecionada(s)
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {section.items.map((item) => (
                            <label key={item.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                              <Checkbox
                                checked={selectedModelItemIds.has(item.id)}
                                onCheckedChange={(checked) => toggleModelItem(item.id, checked === true)}
                              />
                              <span>{item.title}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {templateForm.source === "duplicate" ? (
              <div className="space-y-2 rounded-xl border p-4">
                <Label>Formulário base</Label>
                <Select
                  value={templateForm.duplicate_template_id}
                  onValueChange={(value) => {
                    const template = templates.find((entry) => entry.id === value);
                    setTemplateForm((current) => ({
                      ...current,
                      duplicate_template_id: value,
                      name: current.name || (template ? `${template.name} - cópia` : ""),
                      description: current.description || template?.description || "",
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um formulário para duplicar" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {templateForm.source === "blank" ? (
              <div className="grid gap-4 rounded-xl border p-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Primeira seção</Label>
                  <Input
                    value={templateForm.section_title}
                    onChange={(event) => setTemplateForm((current) => ({ ...current, section_title: event.target.value }))}
                    placeholder="Primeira seção"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Primeira pergunta</Label>
                  <Input
                    value={templateForm.item_title}
                    onChange={(event) => setTemplateForm((current) => ({ ...current, item_title: event.target.value }))}
                    placeholder="Primeira pergunta"
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-4 rounded-xl border p-4">
              <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Aplicação</Label>
                <Select
                  value={templateForm.application_mode}
                  onValueChange={(value) =>
                    setTemplateForm((current) => ({
                      ...current,
                      application_mode: value,
                      occurrence_type: value === "manual" ? "manual" : current.occurrence_type === "manual" ? "daily" : current.occurrence_type,
                      shift_definition_ids: value === "schedule" ? current.shift_definition_ids : [],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="unit">Recorrente por unidade</SelectItem>
                    <SelectItem value="schedule">Por escala/turno</SelectItem>
                    <SelectItem value="event">Evento do sistema</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Recorrência inicial</Label>
                <Select
                  value={templateForm.occurrence_type}
                  onValueChange={(value) => setTemplateForm((current) => ({ ...current, occurrence_type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="daily">Diária</SelectItem>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="custom">Personalizada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
                Unidades e períodos ficam gravados no formulário. Funções, prazos e regras avançadas continuam editáveis pelo fluxo completo.
              </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Unidades vinculadas</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setTemplateForm((current) => ({
                        ...current,
                        unit_ids:
                          current.unit_ids.length === units.length
                            ? []
                            : units.map((unit) => unit.id),
                      }))
                    }
                  >
                    {templateForm.unit_ids.length === units.length ? "Limpar" : "Selecionar todas"}
                  </Button>
                </div>
                {units.length > 0 ? (
                  <div className="grid max-h-44 gap-2 overflow-y-auto rounded-xl border p-3 md:grid-cols-2">
                    {units.map((unit) => (
                      <label key={unit.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted/50">
                        <Checkbox
                          checked={templateForm.unit_ids.includes(unit.id)}
                          onCheckedChange={(checked) => toggleTemplateArrayField("unit_ids", unit.id, checked === true)}
                        />
                        <span>{unit.name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                    Nenhuma unidade do DP carregada neste contexto.
                  </div>
                )}
              </div>

              {templateForm.application_mode === "schedule" ? (
                <div className="space-y-2">
                  <Label>Períodos da escala</Label>
                  {shiftDefinitions.length > 0 ? (
                    <div className="grid max-h-44 gap-2 overflow-y-auto rounded-xl border p-3 md:grid-cols-2">
                      {shiftDefinitions.map((shift) => (
                        <label key={shift.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted/50">
                          <Checkbox
                            checked={templateForm.shift_definition_ids.includes(shift.id)}
                            onCheckedChange={(checked) => toggleTemplateArrayField("shift_definition_ids", shift.id, checked === true)}
                          />
                          <span>{shift.name} · {shift.startTime}-{shift.endTime}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                      Nenhum período de escala carregado neste contexto.
                    </div>
                  )}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{templateForm.unit_ids.length} unidade(s)</Badge>
                {templateForm.application_mode === "schedule" ? (
                  <Badge variant="outline">{templateForm.shift_definition_ids.length} período(s)</Badge>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-sm font-medium">Resumo</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {templateForm.source === "model"
                  ? `${selectedModelItemIds.size}/${selectedModelTotalItems} pergunta(s) do modelo serão usadas.`
                  : templateForm.source === "duplicate"
                    ? selectedDuplicateTemplate
                      ? `A estrutura de "${selectedDuplicateTemplate.name}" será copiada.`
                      : "Selecione um formulário para duplicar."
                    : "Será criado um formulário em branco com uma seção e uma pergunta inicial."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void handleCreateTemplate()}
              disabled={
                saving === "template" ||
                !templateForm.form_project_id ||
                (templateForm.source === "model" && selectedModelItemIds.size === 0) ||
                (templateForm.source === "duplicate" && !templateForm.duplicate_template_id)
              }
            >
              {saving === "template" ? "Criando..." : "Criar formulário"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
