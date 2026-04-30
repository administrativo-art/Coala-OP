"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Layers3, ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";

import type { FormTemplate } from "@/types/forms";
import { useAuth } from "@/hooks/use-auth";
import { fetchFormTemplate, updateFormTemplate } from "@/features/forms/lib/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type EditorItem = {
  id: string;
  title: string;
  description: string;
  type: string;
  required: boolean;
  weight: number;
  block_next: boolean;
  criticality: "low" | "medium" | "high" | "critical";
  reference_value: string;
  tolerance_percent: string;
  action_required: boolean;
  show_if_enabled: boolean;
  show_if_item_id: string;
  show_if_operator:
    | "equals"
    | "not_equals"
    | "gt"
    | "lt"
    | "gte"
    | "lte"
    | "contains"
    | "is_empty"
    | "is_not_empty";
  show_if_value: string;
  task_triggers: EditorTaskTrigger[];
  conditional_branches: EditorConditionalBranch[];
};

type EditorSection = {
  id: string;
  title: string;
  show_if_enabled: boolean;
  show_if_item_id: string;
  show_if_operator:
    | "equals"
    | "not_equals"
    | "gt"
    | "lt"
    | "gte"
    | "lte"
    | "contains"
    | "is_empty"
    | "is_not_empty";
  show_if_value: string;
  items: EditorItem[];
};

type EditorTaskTrigger = {
  id: string;
  title_template: string;
  description_template: string;
  task_project_id: string;
  assignee_type: "user" | "role";
  assignee_id: string;
  assignee_name: string;
  requires_approval: boolean;
  approver_id: string;
  approver_name: string;
  sla_hours: string;
};

type EditorConditionalBranch = {
  id: string;
  value: string;
  label: string;
  items: EditorItem[];
};

function createLocalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyEditorItem(): EditorItem {
  return {
    id: createLocalId(),
    title: "Novo item",
    description: "",
    type: "text",
    required: true,
    weight: 1,
    block_next: false,
    criticality: "medium",
    reference_value: "",
    tolerance_percent: "",
    action_required: false,
    show_if_enabled: false,
    show_if_item_id: "",
    show_if_operator: "equals",
    show_if_value: "",
    task_triggers: [],
    conditional_branches: [],
  };
}

export function FormTemplateDetailShell({ templateId }: { templateId: string }) {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState({
    name: "",
    description: "",
    sections: [] as EditorSection[],
  });
  const defaultTaskProjectId = template?.form_project_id ?? "";

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) return;

      try {
        const payload = await fetchFormTemplate(firebaseUser, templateId);
        if (!cancelled) {
          setTemplate(payload);
          setFormState({
            name: payload.name,
            description: payload.description ?? "",
            sections: payload.sections.map((section) => ({
              id: section.id,
              title: section.title,
              show_if_enabled: !!section.show_if,
              show_if_item_id: section.show_if?.item_id ?? "",
              show_if_operator: section.show_if?.operator ?? "equals",
              show_if_value:
                section.show_if?.value === undefined
                  ? ""
                  : String(section.show_if.value),
              items: section.items.map((item) => ({
                id: item.id,
                title: item.title,
                description: item.description ?? "",
                type: item.type,
                required: item.required,
                weight: item.weight ?? 1,
                block_next: item.block_next ?? false,
                criticality: item.criticality ?? "medium",
                reference_value:
                  typeof item.reference_value === "number"
                    ? String(item.reference_value)
                    : "",
                tolerance_percent:
                  typeof item.tolerance_percent === "number"
                    ? String(item.tolerance_percent)
                    : "",
                action_required: item.action_required ?? false,
                show_if_enabled: !!item.show_if,
                show_if_item_id: item.show_if?.item_id ?? "",
                show_if_operator: item.show_if?.operator ?? "equals",
                show_if_value:
                  item.show_if?.value === undefined ? "" : String(item.show_if.value),
                task_triggers: (item.task_triggers ?? []).map((trigger) => ({
                  id: trigger.id,
                  title_template: trigger.title_template,
                  description_template: trigger.description_template ?? "",
                  task_project_id: trigger.task_project_id,
                  assignee_type: trigger.assignee_type,
                  assignee_id: trigger.assignee_id,
                  assignee_name: trigger.assignee_name ?? "",
                  requires_approval: trigger.requires_approval,
                  approver_id: trigger.approver_id ?? "",
                  approver_name: trigger.approver_name ?? "",
                  sla_hours:
                    typeof trigger.sla_hours === "number"
                      ? String(trigger.sla_hours)
                      : "",
                })),
                conditional_branches: (item.conditional_branches ?? []).map(
                  (branch) => ({
                    id: createLocalId(),
                    value:
                      branch.value === undefined ? "" : String(branch.value),
                    label: branch.label,
                    items: (branch.items ?? []).map((branchItem) => ({
                      id: branchItem.id,
                      title: branchItem.title,
                      description: branchItem.description ?? "",
                      type: branchItem.type,
                      required: branchItem.required,
                      weight: branchItem.weight ?? 1,
                      block_next: branchItem.block_next ?? false,
                      criticality: branchItem.criticality ?? "medium",
                      reference_value:
                        typeof branchItem.reference_value === "number"
                          ? String(branchItem.reference_value)
                          : "",
                      tolerance_percent:
                        typeof branchItem.tolerance_percent === "number"
                          ? String(branchItem.tolerance_percent)
                          : "",
                      action_required: branchItem.action_required ?? false,
                      show_if_enabled: !!branchItem.show_if,
                      show_if_item_id: branchItem.show_if?.item_id ?? "",
                      show_if_operator: branchItem.show_if?.operator ?? "equals",
                      show_if_value:
                        branchItem.show_if?.value === undefined
                          ? ""
                          : String(branchItem.show_if.value),
                      task_triggers: [],
                      conditional_branches: [],
                    })),
                  })
                ),
              })),
            })),
          });
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Falha ao carregar template."
          );
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, templateId]);

  if (!template && !error) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (error || !template) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Template</CardTitle>
          <CardDescription>{error ?? "Template não encontrado."}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  async function handleSaveTemplate() {
    if (!firebaseUser || !template) return;

    try {
      setSaving(true);
      await updateFormTemplate(firebaseUser, template.id, {
        form_project_id: template.form_project_id,
        form_type_id: template.form_type_id,
        form_subtype_id: template.form_subtype_id,
        context: template.context,
        name: formState.name,
        description: formState.description,
        occurrence_type: template.occurrence_type ?? "manual",
        unit_ids: template.unit_ids ?? [],
        job_role_ids: template.job_role_ids ?? [],
        job_function_ids: template.job_function_ids ?? [],
        shift_definition_ids: template.shift_definition_ids ?? [],
        is_active: template.is_active,
        sections: formState.sections.map((section, sectionIndex) => ({
          id: section.id,
          title: section.title,
          order: sectionIndex,
          show_if:
            section.show_if_enabled && section.show_if_item_id
              ? {
                  item_id: section.show_if_item_id,
                  operator: section.show_if_operator,
                  value:
                    section.show_if_value.trim() === ""
                      ? undefined
                      : section.show_if_value,
                }
              : undefined,
          items: section.items.map((item, itemIndex) => ({
            id: item.id,
            order: itemIndex,
            title: item.title,
            description: item.description || undefined,
            type: item.type,
            required: item.required,
            weight: item.weight,
            block_next: item.block_next,
            criticality: item.criticality,
            reference_value:
              item.reference_value.trim() === ""
                ? undefined
                : Number(item.reference_value),
            tolerance_percent:
              item.tolerance_percent.trim() === ""
                ? undefined
                : Number(item.tolerance_percent),
            action_required: item.action_required,
            show_if:
              item.show_if_enabled && item.show_if_item_id
                ? {
                    item_id: item.show_if_item_id,
                    operator: item.show_if_operator,
                    value:
                      item.show_if_value.trim() === ""
                        ? undefined
                        : item.show_if_value,
                  }
                : undefined,
            task_triggers: item.task_triggers.map((trigger) => ({
              id: trigger.id,
              title_template: trigger.title_template,
              description_template:
                trigger.description_template.trim() === ""
                  ? undefined
                  : trigger.description_template,
              task_project_id: trigger.task_project_id,
              assignee_type: trigger.assignee_type,
              assignee_id: trigger.assignee_id,
              assignee_name:
                trigger.assignee_name.trim() === ""
                  ? undefined
                  : trigger.assignee_name,
              requires_approval: trigger.requires_approval,
              approver_id:
                trigger.approver_id.trim() === ""
                  ? undefined
                  : trigger.approver_id,
              approver_name:
                trigger.approver_name.trim() === ""
                  ? undefined
                  : trigger.approver_name,
              sla_hours:
                trigger.sla_hours.trim() === ""
                  ? undefined
                  : Number(trigger.sla_hours),
            })),
            conditional_branches: item.conditional_branches.map((branch) => ({
              value: branch.value.trim() === "" ? undefined : branch.value,
              label: branch.label,
              items: branch.items.map((branchItem, branchItemIndex) => ({
                id: branchItem.id,
                order: branchItemIndex,
                title: branchItem.title,
                description: branchItem.description || undefined,
                type: branchItem.type,
                required: branchItem.required,
                weight: branchItem.weight,
                block_next: branchItem.block_next,
                criticality: branchItem.criticality,
                reference_value:
                  branchItem.reference_value.trim() === ""
                    ? undefined
                    : Number(branchItem.reference_value),
                tolerance_percent:
                  branchItem.tolerance_percent.trim() === ""
                    ? undefined
                    : Number(branchItem.tolerance_percent),
                action_required: branchItem.action_required,
                show_if:
                  branchItem.show_if_enabled && branchItem.show_if_item_id
                    ? {
                        item_id: branchItem.show_if_item_id,
                        operator: branchItem.show_if_operator,
                        value:
                          branchItem.show_if_value.trim() === ""
                            ? undefined
                            : branchItem.show_if_value,
                      }
                    : undefined,
                task_triggers: [],
                conditional_branches: [],
              })),
            })),
          })),
        })),
      });

      const refreshed = await fetchFormTemplate(firebaseUser, template.id);
      setTemplate(refreshed);
      setEditorOpen(false);
      toast({ title: "Template atualizado" });
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: saveError instanceof Error ? saveError.message : "Falha ao atualizar template.",
      });
    } finally {
      setSaving(false);
    }
  }

  function addSection() {
    setFormState((current) => ({
      ...current,
      sections: [
        ...current.sections,
        {
          id: createLocalId(),
          title: "Nova seção",
          show_if_enabled: false,
          show_if_item_id: "",
          show_if_operator: "equals",
          show_if_value: "",
          items: [createEmptyEditorItem()],
        },
      ],
    }));
  }

  function updateSection(sectionId: string, patch: Partial<EditorSection>) {
    setFormState((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section
      ),
    }));
  }

  function removeSection(sectionId: string) {
    setFormState((current) => ({
      ...current,
      sections: current.sections.filter((section) => section.id !== sectionId),
    }));
  }

  function addItem(sectionId: string) {
    setFormState((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: [
                ...section.items,
                createEmptyEditorItem(),
              ],
            }
          : section
      ),
    }));
  }

  function updateItem(sectionId: string, itemId: string, patch: Partial<EditorItem>) {
    setFormState((current) => ({
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

  function removeItem(sectionId: string, itemId: string) {
    setFormState((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: section.items.filter((item) => item.id !== itemId),
            }
          : section
      ),
    }));
  }

  function addTaskTrigger(sectionId: string, itemId: string) {
    updateItem(sectionId, itemId, {
      task_triggers: [
        ...(formState.sections
          .find((section) => section.id === sectionId)
          ?.items.find((item) => item.id === itemId)?.task_triggers ?? []),
        {
          id: createLocalId(),
          title_template: "Ação corretiva: {{item_title}}",
          description_template: "",
          task_project_id: defaultTaskProjectId,
          assignee_type: "role",
          assignee_id: "",
          assignee_name: "",
          requires_approval: false,
          approver_id: "",
          approver_name: "",
          sla_hours: "",
        },
      ],
    });
  }

  function updateTaskTrigger(
    sectionId: string,
    itemId: string,
    triggerId: string,
    patch: Partial<EditorTaskTrigger>
  ) {
    const currentItem = formState.sections
      .find((section) => section.id === sectionId)
      ?.items.find((item) => item.id === itemId);
    if (!currentItem) return;

    updateItem(sectionId, itemId, {
      task_triggers: currentItem.task_triggers.map((trigger) =>
        trigger.id === triggerId ? { ...trigger, ...patch } : trigger
      ),
    });
  }

  function removeTaskTrigger(sectionId: string, itemId: string, triggerId: string) {
    const currentItem = formState.sections
      .find((section) => section.id === sectionId)
      ?.items.find((item) => item.id === itemId);
    if (!currentItem) return;

    updateItem(sectionId, itemId, {
      task_triggers: currentItem.task_triggers.filter(
        (trigger) => trigger.id !== triggerId
      ),
    });
  }

  function addConditionalBranch(sectionId: string, itemId: string) {
    updateItem(sectionId, itemId, {
      conditional_branches: [
        ...(formState.sections
          .find((section) => section.id === sectionId)
          ?.items.find((item) => item.id === itemId)?.conditional_branches ?? []),
        {
          id: createLocalId(),
          value: "",
          label: "Nova branch",
          items: [createEmptyEditorItem()],
        },
      ],
    });
  }

  function updateConditionalBranch(
    sectionId: string,
    itemId: string,
    branchId: string,
    patch: Partial<EditorConditionalBranch>
  ) {
    const currentItem = formState.sections
      .find((section) => section.id === sectionId)
      ?.items.find((item) => item.id === itemId);
    if (!currentItem) return;

    updateItem(sectionId, itemId, {
      conditional_branches: currentItem.conditional_branches.map((branch) =>
        branch.id === branchId ? { ...branch, ...patch } : branch
      ),
    });
  }

  function removeConditionalBranch(
    sectionId: string,
    itemId: string,
    branchId: string
  ) {
    const currentItem = formState.sections
      .find((section) => section.id === sectionId)
      ?.items.find((item) => item.id === itemId);
    if (!currentItem) return;

    updateItem(sectionId, itemId, {
      conditional_branches: currentItem.conditional_branches.filter(
        (branch) => branch.id !== branchId
      ),
    });
  }

  function addConditionalBranchItem(
    sectionId: string,
    itemId: string,
    branchId: string
  ) {
    const currentItem = formState.sections
      .find((section) => section.id === sectionId)
      ?.items.find((item) => item.id === itemId);
    const currentBranch = currentItem?.conditional_branches.find(
      (branch) => branch.id === branchId
    );
    if (!currentBranch) return;

    updateConditionalBranch(sectionId, itemId, branchId, {
      items: [...currentBranch.items, createEmptyEditorItem()],
    });
  }

  function updateConditionalBranchItem(
    sectionId: string,
    itemId: string,
    branchId: string,
    branchItemId: string,
    patch: Partial<EditorItem>
  ) {
    const currentItem = formState.sections
      .find((section) => section.id === sectionId)
      ?.items.find((item) => item.id === itemId);
    const currentBranch = currentItem?.conditional_branches.find(
      (branch) => branch.id === branchId
    );
    if (!currentBranch) return;

    updateConditionalBranch(sectionId, itemId, branchId, {
      items: currentBranch.items.map((branchItem) =>
        branchItem.id === branchItemId ? { ...branchItem, ...patch } : branchItem
      ),
    });
  }

  function removeConditionalBranchItem(
    sectionId: string,
    itemId: string,
    branchId: string,
    branchItemId: string
  ) {
    const currentItem = formState.sections
      .find((section) => section.id === sectionId)
      ?.items.find((item) => item.id === itemId);
    const currentBranch = currentItem?.conditional_branches.find(
      (branch) => branch.id === branchId
    );
    if (!currentBranch) return;

    updateConditionalBranch(sectionId, itemId, branchId, {
      items: currentBranch.items.filter((branchItem) => branchItem.id !== branchItemId),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/forms">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        </Link>
        <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
          <Pencil className="mr-2 h-4 w-4" />
          Editar template
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {template.name}
          </CardTitle>
          <CardDescription>
            {template.description?.trim() || "Template do novo domínio de formulários."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border p-3 text-sm">Versão {template.version}</div>
          <div className="rounded-lg border p-3 text-sm">Contexto: {template.context}</div>
          <div className="rounded-lg border p-3 text-sm">
            {template.sections.length} seção(ões)
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {template.sections.map((section) => (
          <Card key={section.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Layers3 className="h-4 w-4" />
                {section.title}
              </CardTitle>
              <CardDescription>
                {section.items.length} item(ns) nesta seção
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {section.items.map((item) => (
                <div key={item.id} className="rounded-lg border p-3 text-sm">
                  <div className="font-medium">{item.title}</div>
                  <div className="text-muted-foreground">
                    {item.type} • {item.required ? "obrigatório" : "opcional"} • peso {item.weight}
                  </div>
                  {item.description ? (
                    <div className="mt-1 text-muted-foreground">{item.description}</div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {item.block_next ? <span>bloqueia próximo</span> : null}
                    {item.action_required ? <span>gera ação</span> : null}
                    {item.reference_value !== undefined ? (
                      <span>
                        ref {item.reference_value}
                        {item.tolerance_percent !== undefined
                          ? ` ± ${item.tolerance_percent}%`
                          : ""}
                      </span>
                    ) : null}
                    {item.show_if ? <span>condicional</span> : null}
                    {item.conditional_branches?.length ? (
                      <span>{item.conditional_branches.length} branch(es)</span>
                    ) : null}
                    {item.task_triggers?.length ? (
                      <span>{item.task_triggers.length} trigger(s) de tarefa</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar template</DialogTitle>
            <DialogDescription>
              Builder leve para múltiplas seções e itens.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <Input
              value={formState.name}
              onChange={(event) =>
                setFormState((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Nome do template"
            />
            <Textarea
              value={formState.description}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Descrição"
            />
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={addSection}>
                <Plus className="mr-2 h-4 w-4" />
                Adicionar seção
              </Button>
            </div>
            <div className="space-y-4">
              {formState.sections.map((section) => (
                <div key={section.id} className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Input
                      value={section.title}
                      onChange={(event) =>
                        updateSection(section.id, { title: event.target.value })
                      }
                      placeholder="Título da seção"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSection(section.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-3 rounded-md border p-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={section.show_if_enabled}
                        onChange={(event) =>
                          updateSection(section.id, {
                            show_if_enabled: event.target.checked,
                          })
                        }
                      />
                      Exibir seção condicionalmente
                    </label>
                    {section.show_if_enabled ? (
                      <div className="grid gap-3 md:grid-cols-3">
                        <select
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          value={section.show_if_item_id}
                          onChange={(event) =>
                            updateSection(section.id, {
                              show_if_item_id: event.target.value,
                            })
                          }
                        >
                          <option value="">Selecione o item base</option>
                          {formState.sections.flatMap((candidateSection) =>
                            candidateSection.items.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidateSection.title} • {candidate.title}
                              </option>
                            ))
                          )}
                        </select>
                        <select
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          value={section.show_if_operator}
                          onChange={(event) =>
                            updateSection(section.id, {
                              show_if_operator:
                                event.target.value as EditorSection["show_if_operator"],
                            })
                          }
                        >
                          <option value="equals">igual a</option>
                          <option value="not_equals">diferente de</option>
                          <option value="gt">maior que</option>
                          <option value="lt">menor que</option>
                          <option value="gte">maior ou igual</option>
                          <option value="lte">menor ou igual</option>
                          <option value="contains">contém</option>
                          <option value="is_empty">vazio</option>
                          <option value="is_not_empty">não vazio</option>
                        </select>
                        <Input
                          value={section.show_if_value}
                          onChange={(event) =>
                            updateSection(section.id, {
                              show_if_value: event.target.value,
                            })
                          }
                          placeholder="Valor gatilho"
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-3">
                    {section.items.map((item) => (
                      <div key={item.id} className="rounded-md border p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <Input
                            value={item.title}
                            onChange={(event) =>
                              updateItem(section.id, item.id, {
                                title: event.target.value,
                              })
                            }
                            placeholder="Título do item"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(section.id, item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <Textarea
                          value={item.description}
                          onChange={(event) =>
                            updateItem(section.id, item.id, {
                              description: event.target.value,
                            })
                          }
                          placeholder="Descrição do item"
                        />
                        <div className="grid gap-3 md:grid-cols-2">
                          <select
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                            value={item.type}
                            onChange={(event) =>
                              updateItem(section.id, item.id, {
                                type: event.target.value,
                              })
                            }
                          >
                            <option value="text">Texto</option>
                            <option value="checkbox">Checkbox</option>
                            <option value="yes_no">Sim/Não</option>
                            <option value="number">Número</option>
                            <option value="temperature">Temperatura</option>
                            <option value="photo">Foto</option>
                            <option value="signature">Assinatura</option>
                            <option value="file_upload">Arquivo</option>
                            <option value="location">Localização</option>
                          </select>
                          <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={item.required}
                              onChange={(event) =>
                                updateItem(section.id, item.id, {
                                  required: event.target.checked,
                                })
                              }
                            />
                            Obrigatório
                          </label>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input
                            type="number"
                            value={String(item.weight)}
                            onChange={(event) =>
                              updateItem(section.id, item.id, {
                                weight: Number(event.target.value || 1),
                              })
                            }
                            placeholder="Peso"
                          />
                          <select
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                            value={item.criticality}
                            onChange={(event) =>
                              updateItem(section.id, item.id, {
                                criticality: event.target.value as EditorItem["criticality"],
                              })
                            }
                          >
                            <option value="low">Baixa</option>
                            <option value="medium">Média</option>
                            <option value="high">Alta</option>
                            <option value="critical">Crítica</option>
                          </select>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={item.block_next}
                              onChange={(event) =>
                                updateItem(section.id, item.id, {
                                  block_next: event.target.checked,
                                })
                              }
                            />
                            Bloquear próximo item
                          </label>
                          <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={item.action_required}
                              onChange={(event) =>
                                updateItem(section.id, item.id, {
                                  action_required: event.target.checked,
                                })
                              }
                            />
                            Exige ação corretiva
                          </label>
                        </div>
                        {(item.type === "number" || item.type === "temperature") ? (
                          <div className="grid gap-3 md:grid-cols-2">
                            <Input
                              type="number"
                              value={item.reference_value}
                              onChange={(event) =>
                                updateItem(section.id, item.id, {
                                  reference_value: event.target.value,
                                })
                              }
                              placeholder="Valor de referência"
                            />
                            <Input
                              type="number"
                              value={item.tolerance_percent}
                              onChange={(event) =>
                                updateItem(section.id, item.id, {
                                  tolerance_percent: event.target.value,
                                })
                              }
                              placeholder="Tolerância %"
                            />
                          </div>
                        ) : null}
                        <div className="space-y-3 rounded-md border p-3">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={item.show_if_enabled}
                              onChange={(event) =>
                                updateItem(section.id, item.id, {
                                  show_if_enabled: event.target.checked,
                                })
                              }
                            />
                            Exibir condicionalmente
                          </label>
                          {item.show_if_enabled ? (
                            <div className="grid gap-3 md:grid-cols-3">
                              <select
                                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                value={item.show_if_item_id}
                                onChange={(event) =>
                                  updateItem(section.id, item.id, {
                                    show_if_item_id: event.target.value,
                                  })
                                }
                              >
                                <option value="">Selecione o item base</option>
                                {formState.sections.flatMap((candidateSection) =>
                                  candidateSection.items
                                    .filter((candidate) => candidate.id !== item.id)
                                    .map((candidate) => (
                                      <option key={candidate.id} value={candidate.id}>
                                        {candidateSection.title} • {candidate.title}
                                      </option>
                                    ))
                                )}
                              </select>
                              <select
                                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                value={item.show_if_operator}
                                onChange={(event) =>
                                  updateItem(section.id, item.id, {
                                    show_if_operator:
                                      event.target.value as EditorItem["show_if_operator"],
                                  })
                                }
                              >
                                <option value="equals">igual a</option>
                                <option value="not_equals">diferente de</option>
                                <option value="gt">maior que</option>
                                <option value="lt">menor que</option>
                                <option value="gte">maior ou igual</option>
                                <option value="lte">menor ou igual</option>
                                <option value="contains">contém</option>
                                <option value="is_empty">vazio</option>
                                <option value="is_not_empty">não vazio</option>
                              </select>
                              <Input
                                value={item.show_if_value}
                                onChange={(event) =>
                                  updateItem(section.id, item.id, {
                                    show_if_value: event.target.value,
                                  })
                                }
                                placeholder="Valor gatilho"
                              />
                            </div>
                          ) : null}
                        </div>
                        <div className="space-y-3 rounded-md border p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium">
                              Conditional branches
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addConditionalBranch(section.id, item.id)}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Adicionar branch
                            </Button>
                          </div>
                          {item.conditional_branches.length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                              Nenhuma branch configurada.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {item.conditional_branches.map((branch) => (
                                <div
                                  key={branch.id}
                                  className="rounded-md border p-3 space-y-3"
                                >
                                  <div className="flex items-center gap-2">
                                    <Input
                                      value={branch.label}
                                      onChange={(event) =>
                                        updateConditionalBranch(
                                          section.id,
                                          item.id,
                                          branch.id,
                                          { label: event.target.value }
                                        )
                                      }
                                      placeholder="Nome da branch"
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() =>
                                        removeConditionalBranch(
                                          section.id,
                                          item.id,
                                          branch.id
                                        )
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                  <Input
                                    value={branch.value}
                                    onChange={(event) =>
                                      updateConditionalBranch(
                                        section.id,
                                        item.id,
                                        branch.id,
                                        { value: event.target.value }
                                      )
                                    }
                                    placeholder="Valor que ativa a branch"
                                  />
                                  <div className="text-xs text-muted-foreground">
                                    Itens internos ativados por essa branch.
                                  </div>
                                  <div className="space-y-3">
                                    {branch.items.map((branchItem) => (
                                      <div
                                        key={branchItem.id}
                                        className="rounded-md border bg-muted/30 p-3 space-y-3"
                                      >
                                        <div className="flex items-center gap-2">
                                          <Input
                                            value={branchItem.title}
                                            onChange={(event) =>
                                              updateConditionalBranchItem(
                                                section.id,
                                                item.id,
                                                branch.id,
                                                branchItem.id,
                                                { title: event.target.value }
                                              )
                                            }
                                            placeholder="Título do item da branch"
                                          />
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() =>
                                              removeConditionalBranchItem(
                                                section.id,
                                                item.id,
                                                branch.id,
                                                branchItem.id
                                              )
                                            }
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                        <Textarea
                                          value={branchItem.description}
                                          onChange={(event) =>
                                            updateConditionalBranchItem(
                                              section.id,
                                              item.id,
                                              branch.id,
                                              branchItem.id,
                                              { description: event.target.value }
                                            )
                                          }
                                          placeholder="Descrição do item da branch"
                                        />
                                        <div className="grid gap-3 md:grid-cols-3">
                                          <select
                                            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                            value={branchItem.type}
                                            onChange={(event) =>
                                              updateConditionalBranchItem(
                                                section.id,
                                                item.id,
                                                branch.id,
                                                branchItem.id,
                                                { type: event.target.value }
                                              )
                                            }
                                          >
                                            <option value="text">Texto</option>
                                            <option value="checkbox">Checkbox</option>
                                            <option value="yes_no">Sim/Não</option>
                                            <option value="number">Número</option>
                                            <option value="temperature">Temperatura</option>
                                            <option value="photo">Foto</option>
                                            <option value="signature">Assinatura</option>
                                            <option value="file_upload">Arquivo</option>
                                            <option value="location">Localização</option>
                                          </select>
                                          <Input
                                            type="number"
                                            value={String(branchItem.weight)}
                                            onChange={(event) =>
                                              updateConditionalBranchItem(
                                                section.id,
                                                item.id,
                                                branch.id,
                                                branchItem.id,
                                                { weight: Number(event.target.value || 1) }
                                              )
                                            }
                                            placeholder="Peso"
                                          />
                                          <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                                            <input
                                              type="checkbox"
                                              checked={branchItem.required}
                                              onChange={(event) =>
                                                updateConditionalBranchItem(
                                                  section.id,
                                                  item.id,
                                                  branch.id,
                                                  branchItem.id,
                                                  { required: event.target.checked }
                                                )
                                              }
                                            />
                                            Obrigatório
                                          </label>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      addConditionalBranchItem(
                                        section.id,
                                        item.id,
                                        branch.id
                                      )
                                    }
                                  >
                                    <Plus className="mr-2 h-4 w-4" />
                                    Adicionar item na branch
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="space-y-3 rounded-md border p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium">
                              Triggers de tarefa
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addTaskTrigger(section.id, item.id)}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Adicionar trigger
                            </Button>
                          </div>
                          {item.task_triggers.length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                              Nenhum trigger configurado.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {item.task_triggers.map((trigger) => (
                                <div
                                  key={trigger.id}
                                  className="rounded-md border p-3 space-y-3"
                                >
                                  <div className="flex items-center gap-2">
                                    <Input
                                      value={trigger.title_template}
                                      onChange={(event) =>
                                        updateTaskTrigger(
                                          section.id,
                                          item.id,
                                          trigger.id,
                                          { title_template: event.target.value }
                                        )
                                      }
                                      placeholder="Título da tarefa"
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() =>
                                        removeTaskTrigger(
                                          section.id,
                                          item.id,
                                          trigger.id
                                        )
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                  <Textarea
                                    value={trigger.description_template}
                                    onChange={(event) =>
                                      updateTaskTrigger(
                                        section.id,
                                        item.id,
                                        trigger.id,
                                        {
                                          description_template:
                                            event.target.value,
                                        }
                                      )
                                    }
                                    placeholder="Descrição da tarefa"
                                  />
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <Input
                                      value={trigger.task_project_id}
                                      onChange={(event) =>
                                        updateTaskTrigger(
                                          section.id,
                                          item.id,
                                          trigger.id,
                                          {
                                            task_project_id:
                                              event.target.value,
                                          }
                                        )
                                      }
                                      placeholder="Task project id"
                                    />
                                    <select
                                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                      value={trigger.assignee_type}
                                      onChange={(event) =>
                                        updateTaskTrigger(
                                          section.id,
                                          item.id,
                                          trigger.id,
                                          {
                                            assignee_type:
                                              event.target.value as "user" | "role",
                                          }
                                        )
                                      }
                                    >
                                      <option value="role">Cargo</option>
                                      <option value="user">Usuário</option>
                                    </select>
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <Input
                                      value={trigger.assignee_id}
                                      onChange={(event) =>
                                        updateTaskTrigger(
                                          section.id,
                                          item.id,
                                          trigger.id,
                                          {
                                            assignee_id: event.target.value,
                                          }
                                        )
                                      }
                                      placeholder="Assignee id"
                                    />
                                    <Input
                                      value={trigger.assignee_name}
                                      onChange={(event) =>
                                        updateTaskTrigger(
                                          section.id,
                                          item.id,
                                          trigger.id,
                                          {
                                            assignee_name:
                                              event.target.value,
                                          }
                                        )
                                      }
                                      placeholder="Assignee name"
                                    />
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={trigger.requires_approval}
                                        onChange={(event) =>
                                          updateTaskTrigger(
                                            section.id,
                                            item.id,
                                            trigger.id,
                                            {
                                              requires_approval:
                                                event.target.checked,
                                            }
                                          )
                                        }
                                      />
                                      Requer aprovação
                                    </label>
                                    <Input
                                      value={trigger.sla_hours}
                                      onChange={(event) =>
                                        updateTaskTrigger(
                                          section.id,
                                          item.id,
                                          trigger.id,
                                          {
                                            sla_hours: event.target.value,
                                          }
                                        )
                                      }
                                      placeholder="SLA em horas"
                                    />
                                  </div>
                                  {trigger.requires_approval ? (
                                    <div className="grid gap-3 md:grid-cols-2">
                                      <Input
                                        value={trigger.approver_id}
                                        onChange={(event) =>
                                          updateTaskTrigger(
                                            section.id,
                                            item.id,
                                            trigger.id,
                                            {
                                              approver_id:
                                                event.target.value,
                                            }
                                          )
                                        }
                                        placeholder="Approver id"
                                      />
                                      <Input
                                        value={trigger.approver_name}
                                        onChange={(event) =>
                                          updateTaskTrigger(
                                            section.id,
                                            item.id,
                                            trigger.id,
                                            {
                                              approver_name:
                                                event.target.value,
                                            }
                                          )
                                        }
                                        placeholder="Approver name"
                                      />
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button type="button" variant="outline" onClick={() => addItem(section.id)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar item
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Fechar
            </Button>
            <Button onClick={() => void handleSaveTemplate()} disabled={saving}>
              {saving ? "Salvando..." : "Salvar template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
