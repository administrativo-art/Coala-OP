"use client";

import { useEffect, useState, type DragEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ClipboardList,
  FileQuestion,
  GitBranch,
  GripVertical,
  Layers3,
  MapPin,
  Plus,
  Save,
  Settings2,
  Trash2,
  Zap,
} from "lucide-react";

import type { FormAssignment, FormTemplate } from "@/types/forms";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import {
  fetchFormTemplate,
  fetchFormTemplateApplication,
  updateFormTemplate,
  updateFormTemplateApplication,
} from "@/features/forms/lib/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const OCCURRENCE_LABELS: Record<string, string> = {
  manual: "Manual",
  daily: "Diária",
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
  annual: "Anual",
  custom: "Personalizada",
};

const ITEM_TYPE_OPTIONS = [
  { type: "text", label: "Texto" },
  { type: "checkbox", label: "Checkbox" },
  { type: "yes_no", label: "Sim/Não" },
  { type: "number", label: "Número" },
  { type: "temperature", label: "Temperatura" },
  { type: "photo", label: "Foto" },
  { type: "signature", label: "Assinatura" },
  { type: "date", label: "Data" },
  { type: "file_upload", label: "Arquivo" },
  { type: "location", label: "Localização" },
] as const;

function formatOccurrence(value?: string) {
  if (!value) return "Manual";
  return OCCURRENCE_LABELS[value] ?? value;
}

function inferApplicationMode(template: FormTemplate) {
  if ((template.shift_definition_ids?.length ?? 0) > 0) return "Por escala/turno";
  if ((template.unit_ids?.length ?? 0) > 0) return "Recorrente por unidade";
  return "Manual";
}

function inferApplicationModeValue(template: FormTemplate): ApplicationFormState["application_mode"] {
  if ((template.shift_definition_ids?.length ?? 0) > 0) return "schedule";
  if ((template.unit_ids?.length ?? 0) > 0) return "unit";
  return "manual";
}

function formatScope(template: FormTemplate) {
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

function formatDueRule(rule?: FormAssignment["due_rule"] | FormTemplate["due_rule"]) {
  if (!rule || rule.type === "none") return "Sem prazo automático";
  if (rule.type === "fixed_time") return `Até ${rule.time ?? "horário definido"}`;
  if (rule.type === "after_shift_start") return `${rule.minutes ?? 0} min após início do turno`;
  return `${rule.minutes ?? 0} min após criação`;
}

function formatPendingPolicy(policy?: FormAssignment["pending_policy"]) {
  if (policy === "cancel") return "Cancelar pendentes substituídos";
  if (policy === "manual_migration") return "Migrar pendentes manualmente";
  return "Manter pendentes antigos";
}

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

type ApplicationFormState = {
  application_mode: "manual" | "unit" | "schedule" | "event";
  occurrence_type: string;
  unit_ids: string[];
  shift_definition_ids: string[];
  pending_policy: "keep" | "cancel" | "manual_migration";
  due_rule_type: "none" | "fixed_time" | "after_shift_start" | "after_creation";
  due_minutes: string;
  due_time: string;
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

function createEditorItemByType(type: string): EditorItem {
  return {
    ...createEmptyEditorItem(),
    title: `Nova pergunta ${ITEM_TYPE_OPTIONS.find((option) => option.type === type)?.label.toLowerCase() ?? ""}`.trim(),
    type,
    action_required: type === "temperature" || type === "yes_no",
  };
}

function getItemTypeLabel(type: string) {
  return ITEM_TYPE_OPTIONS.find((option) => option.type === type)?.label ?? type;
}

export function FormTemplateDetailShell({ templateId }: { templateId: string }) {
  const { firebaseUser } = useAuth();
  const { units, shiftDefinitions } = useDPBootstrap();
  const { toast } = useToast();
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [activeAssignment, setActiveAssignment] = useState<FormAssignment | null>(null);
  const [assignments, setAssignments] = useState<FormAssignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingApplication, setSavingApplication] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    name: "",
    description: "",
    sections: [] as EditorSection[],
  });
  const [applicationForm, setApplicationForm] = useState<ApplicationFormState>({
    application_mode: "manual",
    occurrence_type: "manual",
    unit_ids: [],
    shift_definition_ids: [],
    pending_policy: "keep",
    due_rule_type: "none",
    due_minutes: "",
    due_time: "",
  });
  const defaultTaskProjectId = template?.form_project_id ?? "";
  const displayedSections = formState.sections.length > 0 ? formState.sections : [];
  const questionCount = displayedSections.reduce((total, section) => total + section.items.length, 0);
  const conditionalCount = displayedSections.reduce(
    (total, section) =>
      total +
      section.items.reduce(
        (innerTotal, item) => innerTotal + (item.conditional_branches?.length ?? 0) + (item.show_if_enabled ? 1 : 0),
        0
      ),
    0
  );
  const taskTriggerCount = displayedSections.reduce(
    (total, section) =>
      total + section.items.reduce((innerTotal, item) => innerTotal + (item.task_triggers?.length ?? 0), 0),
    0
  );

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) return;

      try {
        const [payload, applicationPayload] = await Promise.all([
          fetchFormTemplate(firebaseUser, templateId),
          fetchFormTemplateApplication(firebaseUser, templateId).catch(() => ({
            active_assignment: null,
            assignments: [],
          })),
        ]);
        if (!cancelled) {
          setTemplate(payload);
          setActiveAssignment(applicationPayload.active_assignment);
          setAssignments(applicationPayload.assignments);
          const assignment = applicationPayload.active_assignment;
          setApplicationForm({
            application_mode:
              assignment?.application_mode ??
              payload.application_mode ??
              inferApplicationModeValue(payload),
            occurrence_type:
              assignment?.occurrence_type ?? payload.occurrence_type ?? "manual",
            unit_ids: assignment?.unit_ids ?? payload.unit_ids ?? [],
            shift_definition_ids:
              assignment?.shift_definition_ids ?? payload.shift_definition_ids ?? [],
            pending_policy: assignment?.pending_policy ?? "keep",
            due_rule_type: assignment?.due_rule?.type ?? "none",
            due_minutes:
              typeof assignment?.due_rule?.minutes === "number"
                ? String(assignment.due_rule.minutes)
                : "",
            due_time: assignment?.due_rule?.time ?? "",
          });
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
              : "Falha ao carregar formulário."
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
          <CardTitle>Formulário</CardTitle>
          <CardDescription>{error ?? "Formulário não encontrado."}</CardDescription>
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
      toast({ title: "Formulário atualizado" });
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: saveError instanceof Error ? saveError.message : "Falha ao atualizar formulário.",
      });
    } finally {
      setSaving(false);
    }
  }

  function toggleApplicationArray(field: "unit_ids" | "shift_definition_ids", value: string, checked: boolean) {
    setApplicationForm((current) => {
      const next = new Set(current[field]);
      if (checked) next.add(value);
      else next.delete(value);
      return { ...current, [field]: Array.from(next) };
    });
  }

  async function handleSaveApplication() {
    if (!firebaseUser || !template) return;

    try {
      setSavingApplication(true);
      const unitNames = applicationForm.unit_ids
        .map((unitId) => units.find((unit) => unit.id === unitId)?.name)
        .filter((name): name is string => !!name);
      const shiftNames = applicationForm.shift_definition_ids
        .map((shiftId) => shiftDefinitions.find((shift) => shift.id === shiftId)?.name)
        .filter((name): name is string => !!name);

      const result = await updateFormTemplateApplication(firebaseUser, template.id, {
        application_mode: applicationForm.application_mode,
        occurrence_type: applicationForm.occurrence_type,
        unit_ids: applicationForm.unit_ids,
        unit_names: unitNames,
        shift_definition_ids:
          applicationForm.application_mode === "schedule"
            ? applicationForm.shift_definition_ids
            : [],
        shift_definition_names:
          applicationForm.application_mode === "schedule" ? shiftNames : [],
        pending_policy: applicationForm.pending_policy,
        due_rule: {
          type: applicationForm.due_rule_type,
          minutes:
            applicationForm.due_minutes.trim() === ""
              ? undefined
              : Number(applicationForm.due_minutes),
          time: applicationForm.due_time.trim() || undefined,
        },
      });

      const refreshed = await fetchFormTemplate(firebaseUser, template.id);
      const applicationPayload = await fetchFormTemplateApplication(firebaseUser, template.id);
      setTemplate(refreshed);
      setActiveAssignment(result.assignment);
      setAssignments(applicationPayload.assignments);
      setApplicationOpen(false);
      toast({ title: "Aplicação atualizada" });
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: saveError instanceof Error ? saveError.message : "Falha ao atualizar aplicação.",
      });
    } finally {
      setSavingApplication(false);
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

  function addItemAt(sectionId: string, itemType: string, index: number) {
    const nextItem = createEditorItemByType(itemType);
    setFormState((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) return section;
        const nextItems = [...section.items];
        nextItems.splice(Math.max(0, Math.min(index, nextItems.length)), 0, nextItem);
        return { ...section, items: nextItems };
      }),
    }));
    setExpandedItemId(nextItem.id);
  }

  function moveItemTo(sourceSectionId: string, itemId: string, targetSectionId: string, targetIndex: number) {
    setFormState((current) => {
      const sourceSection = current.sections.find((section) => section.id === sourceSectionId);
      const movingItem = sourceSection?.items.find((item) => item.id === itemId);
      if (!sourceSection || !movingItem) return current;
      const sourceIndex = sourceSection.items.findIndex((item) => item.id === itemId);

      return {
        ...current,
        sections: current.sections.map((section) => {
          const withoutMovingItem =
            section.id === sourceSectionId
              ? section.items.filter((item) => item.id !== itemId)
              : section.items;

          if (section.id !== targetSectionId) {
            return { ...section, items: withoutMovingItem };
          }

          const adjustedIndex =
            sourceSectionId === targetSectionId
              ? Math.max(0, targetIndex - (sourceIndex < targetIndex ? 1 : 0))
              : targetIndex;
          const nextItems = [...withoutMovingItem];
          nextItems.splice(Math.max(0, Math.min(adjustedIndex, nextItems.length)), 0, movingItem);
          return { ...section, items: nextItems };
        }),
      };
    });
    setExpandedItemId(itemId);
  }

  function handleQuestionDrop(sectionId: string, index: number, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const existingPayload = event.dataTransfer.getData("application/x-form-existing-item");
    if (existingPayload) {
      try {
        const payload = JSON.parse(existingPayload) as { sectionId?: string; itemId?: string };
        if (payload.sectionId && payload.itemId) {
          moveItemTo(payload.sectionId, payload.itemId, sectionId, index);
        }
      } catch {
        return;
      }
      return;
    }

    const itemType = event.dataTransfer.getData("application/x-form-item-type");
    if (!itemType) return;
    addItemAt(sectionId, itemType, index);
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
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <Link href="/dashboard/forms">
            <Button variant="ghost" className="w-fit px-0 text-muted-foreground">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar para formulários
            </Button>
          </Link>
          <div className="flex items-start gap-3">
            <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{formState.name || template.name}</h1>
                <Badge variant="outline">v{template.version}</Badge>
                <Badge variant="outline">{template.context}</Badge>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {formState.description.trim() || template.description?.trim() || "Formulário operacional publicado para gerar preenchimentos."}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setApplicationOpen(true)}>
            <MapPin className="mr-2 h-4 w-4" />
            Editar aplicação
          </Button>
          <Button onClick={() => void handleSaveTemplate()} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Salvando..." : "Publicar nova versão"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
              <Layers3 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold tracking-tight">{displayedSections.length}</p>
              <p className="text-xs font-medium text-muted-foreground">seções</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
              <FileQuestion className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold tracking-tight">{questionCount}</p>
              <p className="text-xs font-medium text-muted-foreground">perguntas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
              <GitBranch className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold tracking-tight">{conditionalCount}</p>
              <p className="text-xs font-medium text-muted-foreground">condicionais</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
              <Zap className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold tracking-tight">{taskTriggerCount}</p>
              <p className="text-xs font-medium text-muted-foreground">gatilhos de tarefa</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2.4fr)_minmax(340px,1fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <Input
                value={formState.name}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Nome do formulário"
              />
              <Textarea
                value={formState.description}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Descrição do formulário"
                className="min-h-10"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={addSection}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar seção
            </Button>
          </div>

          {displayedSections.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Adicione uma seção para começar a montar o formulário.
              </CardContent>
            </Card>
          ) : (
            displayedSections.map((section) => (
              <Card key={section.id}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Layers3 className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={section.title}
                    onChange={(event) =>
                      updateSection(section.id, { title: event.target.value })
                    }
                    placeholder="Título da seção"
                    className="text-base font-semibold"
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
                <CardDescription>{section.items.length} pergunta(s) nesta seção</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                        <option value="">Pergunta base</option>
                        {formState.sections.flatMap((candidateSection) =>
                          candidateSection.items.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidateSection.title} - {candidate.title}
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
                          updateSection(section.id, { show_if_value: event.target.value })
                        }
                        placeholder="Valor"
                      />
                    </div>
                  ) : null}
                </div>

                <div
                  className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleQuestionDrop(section.id, 0, event)}
                >
                  + Início da seção
                </div>

                {section.items.map((item, itemIndex) => (
                  <div key={item.id} className="space-y-3">
                    <div className="rounded-lg border bg-background p-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          draggable
                          onClick={() =>
                            setExpandedItemId((current) => (current === item.id ? null : item.id))
                          }
                          onDragStart={(event) => {
                            event.dataTransfer.setData(
                              "application/x-form-existing-item",
                              JSON.stringify({ sectionId: section.id, itemId: item.id })
                            );
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-muted/60"
                        >
                          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {item.title.trim() || "Pergunta sem título"}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                              <span>{getItemTypeLabel(item.type)}</span>
                              <span>peso {item.weight}</span>
                              <span>{item.required ? "obrigatória" : "opcional"}</span>
                              {item.show_if_enabled ? <span>condicional</span> : null}
                              {item.action_required ? <span>ação corretiva</span> : null}
                              {item.task_triggers.length > 0 ? <span>{item.task_triggers.length} tarefa(s)</span> : null}
                            </div>
                          </div>
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-muted-foreground transition ${
                              expandedItemId === item.id ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setExpandedItemId((current) => (current === item.id ? null : item.id))
                          }
                        >
                          <Settings2 className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(section.id, item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {expandedItemId === item.id ? (
                        <div className="mt-4 border-t pt-4">
                      <Input
                        value={item.title}
                        onChange={(event) =>
                          updateItem(section.id, item.id, { title: event.target.value })
                        }
                        placeholder="Texto da pergunta"
                        className="font-medium"
                      />
                      <Textarea
                        value={item.description}
                        onChange={(event) =>
                          updateItem(section.id, item.id, {
                            description: event.target.value,
                          })
                        }
                        placeholder="Detalhes ou orientação para preenchimento"
                        className="mt-3"
                      />
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <select
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          value={item.type}
                          onChange={(event) =>
                            updateItem(section.id, item.id, { type: event.target.value })
                          }
                        >
                          {ITEM_TYPE_OPTIONS.map((option) => (
                            <option key={option.type} value={option.type}>
                              {option.label}
                            </option>
                          ))}
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
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <Input
                          type="number"
                          min="1"
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
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
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
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
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
                      <div className="mt-3 space-y-3 rounded-md border p-3">
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
                              <option value="">Pergunta base</option>
                              {formState.sections.flatMap((candidateSection) =>
                                candidateSection.items
                                  .filter((candidate) => candidate.id !== item.id)
                                  .map((candidate) => (
                                    <option key={candidate.id} value={candidate.id}>
                                      {candidateSection.title} - {candidate.title}
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
                              placeholder="Valor"
                            />
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-md border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">Branches condicionais</p>
                              <p className="text-xs text-muted-foreground">
                                {item.conditional_branches.length} configurada(s)
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addConditionalBranch(section.id, item.id)}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Branch
                            </Button>
                          </div>
                          {item.conditional_branches.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {item.conditional_branches.map((branch) => (
                                <div key={branch.id} className="grid gap-2 rounded-md bg-muted/40 p-2 md:grid-cols-[1fr_1fr_auto]">
                                  <Input
                                    value={branch.value}
                                    onChange={(event) =>
                                      updateConditionalBranch(section.id, item.id, branch.id, {
                                        value: event.target.value,
                                      })
                                    }
                                    placeholder="Valor"
                                  />
                                  <Input
                                    value={branch.label}
                                    onChange={(event) =>
                                      updateConditionalBranch(section.id, item.id, branch.id, {
                                        label: event.target.value,
                                      })
                                    }
                                    placeholder="Rótulo"
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      removeConditionalBranch(section.id, item.id, branch.id)
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">Triggers de tarefa</p>
                              <p className="text-xs text-muted-foreground">
                                {item.task_triggers.length} configurado(s)
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addTaskTrigger(section.id, item.id)}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Trigger
                            </Button>
                          </div>
                          {item.task_triggers.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {item.task_triggers.map((trigger) => (
                                <div key={trigger.id} className="grid gap-2 rounded-md bg-muted/40 p-2 md:grid-cols-[1fr_auto]">
                                  <Input
                                    value={trigger.title_template}
                                    onChange={(event) =>
                                      updateTaskTrigger(section.id, item.id, trigger.id, {
                                        title_template: event.target.value,
                                      })
                                    }
                                    placeholder="Título da tarefa"
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      removeTaskTrigger(section.id, item.id, trigger.id)
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                        </div>
                      ) : null}
                    </div>
                    <div
                      className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleQuestionDrop(section.id, itemIndex + 1, event)}
                    >
                      + Depois desta pergunta
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => addItemAt(section.id, "text", section.items.length)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar pergunta de texto
                </Button>
              </CardContent>
            </Card>
            ))
          )}
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                Adicionar pergunta
              </CardTitle>
              <CardDescription>Tipos disponíveis para o formulário.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {ITEM_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-form-item-type", option.type);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  className="flex w-full cursor-grab items-center justify-between rounded-lg border bg-background px-3 py-3 text-left text-sm transition hover:bg-muted active:cursor-grabbing"
                >
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.type}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Aplicação
              </CardTitle>
              <CardDescription>Quando, onde e para quem este formulário é gerado.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="rounded-xl border p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recorrência</p>
                <p className="mt-1 font-medium">{formatOccurrence(activeAssignment?.occurrence_type ?? template.occurrence_type)}</p>
              </div>
              <div className="rounded-xl border p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Modo de aplicação</p>
                <p className="mt-1 font-medium">{inferApplicationMode(template)}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Unidades</p>
                <div className="flex flex-wrap gap-2">
                  {(activeAssignment?.unit_names?.length ? activeAssignment.unit_names : template.unit_names ?? []).slice(0, 6).map((unitName) => (
                    <Badge key={unitName} variant="outline" className="border-primary/30 text-primary">
                      {unitName}
                    </Badge>
                  ))}
                  {(activeAssignment?.unit_names?.length || template.unit_names?.length) ? null : (
                    <Badge variant="outline">Todas / manual</Badge>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Períodos / turnos</p>
                <div className="space-y-2">
                  {(activeAssignment?.shift_definition_names?.length
                    ? activeAssignment.shift_definition_names
                    : template.shift_definition_names ?? []
                  ).slice(0, 4).map((shiftName) => (
                    <div key={shiftName} className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-primary">
                      {shiftName}
                    </div>
                  ))}
                  {(activeAssignment?.shift_definition_names?.length || template.shift_definition_names?.length) ? null : (
                    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground">
                      Sem vínculo de turno
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-xl border p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Prazo</p>
                <p className="mt-1 font-medium">{formatDueRule(activeAssignment?.due_rule ?? template.due_rule)}</p>
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={() => setApplicationOpen(true)}>
                Editar aplicação
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Versão
              </CardTitle>
              <CardDescription>Histórico preservado para execuções antigas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-xl border p-3">
                <span className="text-muted-foreground">Atual</span>
                <Badge variant="outline">v{template.version}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-xl border p-3">
                <span className="text-muted-foreground">Vínculos</span>
                <span className="font-medium">{assignments.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Resumo do formulário
          </CardTitle>
          <CardDescription>
            Estrutura, aplicação e versionamento preservados para os próximos preenchimentos.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border p-3">
            <p className="font-medium">Escopo</p>
            <p className="mt-1 text-muted-foreground">
              Projeto {template.form_project_id} · contexto {template.context}
            </p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="font-medium">Aplicação</p>
            <p className="mt-1 text-muted-foreground">
              {inferApplicationMode(template)} · {formatScope(template)}
            </p>
            {activeAssignment ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Vínculo ativo desde {String(activeAssignment.starts_at).slice(0, 10)}
              </p>
            ) : null}
          </div>
          <div className="rounded-xl border p-3">
            <p className="font-medium">Recorrência</p>
            <p className="mt-1 text-muted-foreground">
              {formatOccurrence(template.occurrence_type)}
            </p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="font-medium">Controle operacional</p>
            <p className="mt-1 text-muted-foreground">
              Responsável definido por {activeAssignment?.application_mode === "schedule" ? "escala/turno" : "aplicação"}
            </p>
            <p className="mt-1 text-muted-foreground">
              Prazo: {formatDueRule(activeAssignment?.due_rule ?? template.due_rule)}
            </p>
            <p className="mt-1 text-muted-foreground">
              Pendentes: {formatPendingPolicy(activeAssignment?.pending_policy)}
            </p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="font-medium">Histórico seguro</p>
            <p className="mt-1 text-muted-foreground">
              Alterações neste formulário valem para novos preenchimentos; preenchimentos antigos preservam o snapshot da versão usada.
            </p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="font-medium">Última atividade</p>
            <p className="mt-1 text-muted-foreground">
              {template.updated_at ? String(template.updated_at) : "Sem atualização registrada"}
            </p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="font-medium">Histórico de vínculos</p>
            <p className="mt-1 text-muted-foreground">
              {assignments.length} registro(s) de aplicação preservado(s).
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={applicationOpen} onOpenChange={setApplicationOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-sm">
                <MapPin className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle>Editar aplicação</DialogTitle>
                <DialogDescription>
                  Defina quando, onde e para quem este formulário será gerado. O histórico anterior permanece preservado.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(92vh-145px)] space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border bg-primary/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">1 · Frequência</p>
                <p className="mt-1 text-sm text-muted-foreground">Recorrência e prazo de resposta.</p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">2 · Escopo</p>
                <p className="mt-1 text-sm text-muted-foreground">Unidades que receberão o formulário.</p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">3 · Turnos</p>
                <p className="mt-1 text-sm text-muted-foreground">Períodos usados quando houver escala.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Modo</Label>
                <Select
                  value={applicationForm.application_mode}
                  onValueChange={(value) =>
                    setApplicationForm((current) => ({
                      ...current,
                      application_mode: value as ApplicationFormState["application_mode"],
                      occurrence_type:
                        value === "manual"
                          ? "manual"
                          : current.occurrence_type === "manual"
                            ? "daily"
                            : current.occurrence_type,
                      shift_definition_ids:
                        value === "schedule" ? current.shift_definition_ids : [],
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
                <Label>Recorrência</Label>
                <Select
                  value={applicationForm.occurrence_type}
                  onValueChange={(value) =>
                    setApplicationForm((current) => ({ ...current, occurrence_type: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="daily">Diária</SelectItem>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="biweekly">Quinzenal</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="custom">Personalizada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Pendentes ao substituir</Label>
                <Select
                  value={applicationForm.pending_policy}
                  onValueChange={(value) =>
                    setApplicationForm((current) => ({
                      ...current,
                      pending_policy: value as ApplicationFormState["pending_policy"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Manter</SelectItem>
                    <SelectItem value="cancel">Cancelar</SelectItem>
                    <SelectItem value="manual_migration">Migrar manualmente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Regra de prazo</Label>
                <Select
                  value={applicationForm.due_rule_type}
                  onValueChange={(value) =>
                    setApplicationForm((current) => ({
                      ...current,
                      due_rule_type: value as ApplicationFormState["due_rule_type"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem prazo</SelectItem>
                    <SelectItem value="fixed_time">Horário fixo</SelectItem>
                    <SelectItem value="after_shift_start">Após início do turno</SelectItem>
                    <SelectItem value="after_creation">Após criação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Minutos</Label>
                <Input
                  type="number"
                  value={applicationForm.due_minutes}
                  onChange={(event) =>
                    setApplicationForm((current) => ({ ...current, due_minutes: event.target.value }))
                  }
                  placeholder="Ex: 30"
                />
              </div>
              <div className="space-y-2">
                <Label>Horário</Label>
                <Input
                  type="time"
                  value={applicationForm.due_time}
                  onChange={(event) =>
                    setApplicationForm((current) => ({ ...current, due_time: event.target.value }))
                  }
                />
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
                    setApplicationForm((current) => ({
                      ...current,
                      unit_ids:
                        current.unit_ids.length === units.length
                          ? []
                          : units.map((unit) => unit.id),
                    }))
                  }
                >
                  {applicationForm.unit_ids.length === units.length ? "Limpar" : "Selecionar todas"}
                </Button>
              </div>
              <div className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border p-3 md:grid-cols-2">
                {units.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma unidade carregada.</p>
                ) : (
                  units.map((unit) => (
                    <label key={unit.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted/50">
                      <Checkbox
                        checked={applicationForm.unit_ids.includes(unit.id)}
                        onCheckedChange={(checked) => toggleApplicationArray("unit_ids", unit.id, checked === true)}
                      />
                      <span>{unit.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {applicationForm.application_mode === "schedule" ? (
              <div className="space-y-2">
                <Label>Períodos da escala</Label>
                <div className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border p-3 md:grid-cols-2">
                  {shiftDefinitions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum período carregado.</p>
                  ) : (
                    shiftDefinitions.map((shift) => (
                      <label key={shift.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted/50">
                        <Checkbox
                          checked={applicationForm.shift_definition_ids.includes(shift.id)}
                          onCheckedChange={(checked) => toggleApplicationArray("shift_definition_ids", shift.id, checked === true)}
                        />
                        <span>{shift.name} · {shift.startTime}-{shift.endTime}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Desvincular uma unidade não apaga preenchimentos antigos. O vínculo anterior fica inativo e as próximas gerações usam esta nova aplicação.
            </div>
          </div>
          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setApplicationOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleSaveApplication()} disabled={savingApplication}>
              {savingApplication ? "Salvando..." : "Salvar aplicação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-sm">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle>Editar formulário</DialogTitle>
                <DialogDescription>
                  Edite perguntas, condicionais e gatilhos de tarefa. O histórico de preenchimentos já gerados permanece preservado.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(92vh-145px)] space-y-4 overflow-y-auto px-6 py-5">
            <Input
              value={formState.name}
              onChange={(event) =>
                setFormState((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Nome do formulário"
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
          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Fechar
            </Button>
            <Button onClick={() => void handleSaveTemplate()} disabled={saving}>
              {saving ? "Salvando..." : "Salvar formulário"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
