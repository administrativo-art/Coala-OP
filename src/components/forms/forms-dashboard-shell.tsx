"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FolderKanban,
  Layers3,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";

import type { FormExecution, FormProject, FormTemplate } from "@/types/forms";
import { useAuth } from "@/hooks/use-auth";
import {
  createFormProject,
  createFormTemplate,
  fetchFormsBootstrap,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

function formatDateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
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

export function FormsDashboardShell() {
  const router = useRouter();
  const { firebaseUser } = useAuth();
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
  const [templateForm, setTemplateForm] = useState({
    form_project_id: "",
    name: "",
    description: "",
    context: "operational",
    occurrence_type: "manual",
    section_title: "Seção principal",
    item_title: "Novo item",
    item_type: "text",
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
      const result = await createFormTemplate(firebaseUser, {
        form_project_id: templateForm.form_project_id,
        form_type_id: "manual",
        context: templateForm.context,
        name: templateForm.name,
        description: templateForm.description,
        occurrence_type: templateForm.occurrence_type,
        unit_ids: [],
        job_role_ids: [],
        job_function_ids: [],
        shift_definition_ids: [],
        is_active: true,
        sections: [
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
        ],
      });

      setTemplateDialogOpen(false);
      setTemplateForm((current) => ({
        ...current,
        name: "",
        description: "",
        section_title: "Seção principal",
        item_title: "Novo item",
      }));
      router.push(`/dashboard/forms/${result.template.id}`);
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: saveError instanceof Error ? saveError.message : "Falha ao criar template.",
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
            Experiência operacional no novo domínio de formulários, preservando projetos, templates e execuções num fluxo mais próximo do checklist.
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
                setTemplateDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo template
            </Button>
          ) : null}
          <Link href="/dashboard/dp/checklists">
            <Button variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Abrir checklist legado
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pendentes" value={stats.pending} subtitle="Execuções aguardando início" tone="amber" />
        <KpiCard label="Em andamento" value={stats.inProgress} subtitle="Execuções já assumidas" tone="blue" />
        <KpiCard label="Concluídas" value={stats.completed} subtitle="Fluxos encerrados" tone="emerald" />
        <KpiCard label="Atrasadas" value={stats.overdue} subtitle="Execuções em atenção" tone="red" />
      </div>

      <Tabs defaultValue="operations" className="space-y-4">
        <TabsList className="h-auto rounded-full bg-slate-100/80 p-1">
          <TabsTrigger value="operations">Operação</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
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
                      <Badge variant="outline">{projectTemplates.length} template(s)</Badge>
                      <Badge variant="outline">{projectExecutions.length} execução(ões)</Badge>
                      <Badge variant="outline">{items} item(ns)</Badge>
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
                  {projectExecutions.length > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                          Execuções recentes
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
                                      {execution.unit_name ?? execution.unit_id} • {execution.assigned_username}
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
                      Nenhuma execução recente para este projeto.
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
                <Layers3 className="h-5 w-5" />
                Catálogo de templates
              </CardTitle>
              <CardDescription>
                Versões, escopo e última atividade dos formulários ativos por projeto.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Projeto</TableHead>
                    <TableHead>Recorrência</TableHead>
                    <TableHead>Itens</TableHead>
                    <TableHead>Última execução</TableHead>
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
                        <TableCell>{formatOccurrence(template.occurrence_type)}</TableCell>
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

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Saúde operacional
                </CardTitle>
                <CardDescription>
                  Leitura consolidada das execuções do novo módulo.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {projectSummaries.map(({ project, executions: projectExecutions, completionRate }) => (
                  <div key={project.id} className="rounded-xl border p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {projectExecutions.length} execução(ões)
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
                  Distribuição dos templates por frequência operacional.
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
              Configure a base operacional que agrupa templates e execuções do novo módulo.
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo template</DialogTitle>
            <DialogDescription>
              Cria a estrutura mínima e abre o editor completo em seguida.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={templateForm.name}
              onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nome do template"
            />
            <Textarea
              value={templateForm.description}
              onChange={(event) => setTemplateForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descrição"
            />
            <Input
              value={templateForm.section_title}
              onChange={(event) => setTemplateForm((current) => ({ ...current, section_title: event.target.value }))}
              placeholder="Primeira seção"
            />
            <Input
              value={templateForm.item_title}
              onChange={(event) => setTemplateForm((current) => ({ ...current, item_title: event.target.value }))}
              placeholder="Primeiro item"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleCreateTemplate()} disabled={saving === "template"}>
              {saving === "template" ? "Criando..." : "Criar template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
