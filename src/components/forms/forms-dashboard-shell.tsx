"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ClipboardCheck,
  ClipboardList,
  FolderKanban,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export function FormsDashboardShell() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<FormProject[]>([]);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [executions, setExecutions] = useState<FormExecution[]>([]);
  const [canCreateProjects, setCanCreateProjects] = useState(false);
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

    run();
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
      await createFormTemplate(firebaseUser, {
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

      await reloadBootstrap();
      setTemplateDialogOpen(false);
      setTemplateForm((current) => ({
        ...current,
        name: "",
        description: "",
        section_title: "Seção principal",
        item_title: "Novo item",
      }));
      toast({ title: "Template criado" });
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Formulários
          </CardTitle>
          <CardDescription>
            Novo domínio server-side para projetos, templates e execuções. O checklist legado continua acessível durante a migração.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border px-3 py-2 text-sm">
            {projects.length} projeto(s) visível(is)
          </div>
          {canCreateProjects ? (
            <div className="rounded-lg border px-3 py-2 text-sm">
              Gerenciamento liberado por permissão
            </div>
          ) : null}
          {canCreateProjects ? (
            <Button variant="outline" onClick={openCreateProjectDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Novo projeto
            </Button>
          ) : null}
          {projects.length > 0 ? (
            <Button variant="outline" onClick={() => {
              setTemplateForm((current) => ({
                ...current,
                form_project_id: current.form_project_id || projects[0]?.id || "",
              }));
              setTemplateDialogOpen(true);
            }}>
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
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <Card key={project.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FolderKanban className="h-5 w-5" />
                {project.name ?? project.id}
              </CardTitle>
              <CardDescription>
                {project.description?.trim() || "Projeto liberado para o novo domínio de formulários."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {canCreateProjects ? (
                <Button variant="ghost" size="sm" onClick={() => openEditProjectDialog(project)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar projeto
                </Button>
              ) : null}
              <div className="text-sm text-muted-foreground">
                {templatesByProject[project.id]?.length ?? 0} template(s) •{" "}
                {executionsByProject[project.id]?.length ?? 0} execução(ões)
              </div>

              {(templatesByProject[project.id] ?? []).slice(0, 2).map((template) => (
                <Link key={template.id} href={`/dashboard/forms/${template.id}`}>
                  <div className="rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40">
                    <div className="font-medium">{template.name}</div>
                    <div className="text-muted-foreground">
                      Template • v{template.version}
                    </div>
                  </div>
                </Link>
              ))}

              {(executionsByProject[project.id] ?? []).slice(0, 2).map((execution) => (
                <Link key={execution.id} href={`/dashboard/forms/${execution.id}/view`}>
                  <div className="rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40">
                    <div className="flex items-center gap-2 font-medium">
                      <ClipboardCheck className="h-4 w-4" />
                      {execution.template_name}
                    </div>
                    <div className="text-muted-foreground">
                      {execution.status} • {execution.unit_name ?? execution.unit_id}
                    </div>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProject ? "Editar projeto" : "Novo projeto"}</DialogTitle>
            <DialogDescription>
              Editor mínimo do domínio `forms`.
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
              Criação mínima com uma seção e um item inicial.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={templateForm.form_project_id}
              onChange={(event) =>
                setTemplateForm((current) => ({
                  ...current,
                  form_project_id: event.target.value,
                }))
              }
            >
              <option value="">Selecione o projeto</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
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
              placeholder="Título da seção"
            />
            <Input
              value={templateForm.item_title}
              onChange={(event) => setTemplateForm((current) => ({ ...current, item_title: event.target.value }))}
              placeholder="Título do item"
            />
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={templateForm.item_type}
              onChange={(event) =>
                setTemplateForm((current) => ({
                  ...current,
                  item_type: event.target.value,
                }))
              }
            >
              <option value="text">Texto</option>
              <option value="checkbox">Checkbox</option>
              <option value="yes_no">Sim/Não</option>
              <option value="number">Número</option>
              <option value="photo">Foto</option>
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              Fechar
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
