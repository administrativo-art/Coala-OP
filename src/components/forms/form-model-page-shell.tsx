"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Layers3,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import type { FormModel } from "@/types/forms";
import { useAuth } from "@/hooks/use-auth";
import { createFormModel, fetchFormModels, updateFormModel } from "@/features/forms/lib/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

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

const ITEM_TYPE_OPTIONS = [
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

type ItemType = (typeof ITEM_TYPE_OPTIONS)[number]["value"];

type UiFormModel = Pick<FormModel, "id" | "name" | "description" | "category" | "context" | "sections">;

type ModelItemState = {
  id: string;
  title: string;
  type: ItemType;
};

type ModelSectionState = {
  id: string;
  title: string;
  items: ModelItemState[];
};

type ModelFormState = {
  name: string;
  description: string;
  category: string;
  context: "operational" | "recruitment";
  sections: ModelSectionState[];
};

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeItemType(value?: string): ItemType {
  return ITEM_TYPE_OPTIONS.some((option) => option.value === value) ? (value as ItemType) : "text";
}

function createDefaultItem(): ModelItemState {
  return { id: createLocalId("item"), title: "Nova pergunta", type: "text" };
}

function createDefaultSection(): ModelSectionState {
  return { id: createLocalId("section"), title: "Seção principal", items: [createDefaultItem()] };
}

function createEmptyForm(): ModelFormState {
  return {
    name: "",
    description: "",
    category: "",
    context: "operational",
    sections: [createDefaultSection()],
  };
}

function defaultModels(): UiFormModel[] {
  return DEFAULT_FORM_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    category: "Sistema",
    context: "operational",
    sections: model.sections.map((section, sectionIndex) => ({
      id: section.id,
      title: section.title,
      order: sectionIndex,
      items: section.items.map((item, itemIndex) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        order: itemIndex,
        required: true,
        weight: 1,
        block_next: false,
        criticality: "medium",
      })),
    })),
  }));
}

function modelToForm(model: UiFormModel, customize: boolean): ModelFormState {
  return {
    name: customize ? `${model.name} personalizado` : model.name,
    description: model.description ?? "",
    category: customize && model.category === "Sistema" ? "" : model.category ?? "",
    context: model.context ?? "operational",
    sections: model.sections.map((section) => ({
      id: section.id || createLocalId("section"),
      title: section.title,
      items:
        section.items.length > 0
          ? section.items.map((item) => ({
              id: item.id || createLocalId("item"),
              title: item.title,
              type: normalizeItemType(item.type),
            }))
          : [createDefaultItem()],
    })),
  };
}

function isInvalid(form: ModelFormState) {
  return (
    form.name.trim().length < 2 ||
    form.sections.length === 0 ||
    form.sections.some((section) => section.title.trim().length === 0 || section.items.some((item) => item.title.trim().length < 2))
  );
}

function buildPayload(form: ModelFormState) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    category: form.category.trim() || undefined,
    context: form.context,
    is_active: true,
    sections: form.sections.map((section, sectionIndex) => ({
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

function getModelVisual(modelId?: string, index = 0) {
  if (modelId?.includes("temperature")) return { className: "bg-amber-500 text-white", icon: ClipboardList };
  if (modelId?.includes("cleaning") || modelId?.includes("audit")) return { className: "bg-emerald-500 text-white", icon: ClipboardCheck };
  const fallbacks = [
    { className: "bg-violet-500 text-white", icon: Layers3 },
    { className: "bg-sky-500 text-white", icon: ClipboardList },
    { className: "bg-rose-500 text-white", icon: CheckSquare },
  ];
  return fallbacks[index % fallbacks.length];
}

export function FormModelPageShell({
  mode,
  modelId,
  baseModelId,
}: {
  mode: "new" | "edit";
  modelId?: string;
  baseModelId?: string;
}) {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [storedModels, setStoredModels] = useState<UiFormModel[]>([]);
  const [form, setForm] = useState<ModelFormState>(() => createEmptyForm());
  const [activeSectionId, setActiveSectionId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const allModels = useMemo(() => {
    const storedIds = new Set(storedModels.map((model) => model.id));
    return [...storedModels, ...defaultModels().filter((model) => !storedIds.has(model.id))];
  }, [storedModels]);

  const activeSection = form.sections.find((section) => section.id === activeSectionId) ?? form.sections[0];
  const questionCount = form.sections.reduce((total, section) => total + section.items.length, 0);
  const editingStoredModel = mode === "edit" && !!modelId;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) return;
      setLoading(true);
      setError(null);

      try {
        const payload = await fetchFormModels(firebaseUser).catch(() => ({ models: [] }));
        const fetchedModels = payload.models as UiFormModel[];
        const models = [...fetchedModels, ...defaultModels().filter((model) => !fetchedModels.some((stored) => stored.id === model.id))];
        const source = mode === "edit"
          ? fetchedModels.find((model) => model.id === modelId)
          : models.find((model) => model.id === baseModelId);

        if (!cancelled) {
          setStoredModels(fetchedModels);
          if (mode === "edit" && !source) {
            setError("Modelo não encontrado.");
            return;
          }
          const nextForm = source ? modelToForm(source, mode === "new") : createEmptyForm();
          setForm(nextForm);
          setActiveSectionId(nextForm.sections[0]?.id ?? "");
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Falha ao carregar modelos.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [baseModelId, firebaseUser, mode, modelId]);

  function updateSection(sectionId: string, patch: Partial<ModelSectionState>) {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)),
    }));
  }

  function addSection() {
    const section = createDefaultSection();
    setForm((current) => ({ ...current, sections: [...current.sections, section] }));
    setActiveSectionId(section.id);
  }

  function removeSection(sectionId: string) {
    setForm((current) => {
      if (current.sections.length <= 1) return current;
      const sections = current.sections.filter((section) => section.id !== sectionId);
      if (activeSectionId === sectionId) setActiveSectionId(sections[0]?.id ?? "");
      return { ...current, sections };
    });
  }

  function updateItem(sectionId: string, itemId: string, patch: Partial<ModelItemState>) {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? { ...section, items: section.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) }
          : section
      ),
    }));
  }

  function addItem(sectionId: string) {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? { ...section, items: [...section.items, createDefaultItem()] } : section
      ),
    }));
  }

  function removeItem(sectionId: string, itemId: string) {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId && section.items.length > 1
          ? { ...section, items: section.items.filter((item) => item.id !== itemId) }
          : section
      ),
    }));
  }

  async function handleSave() {
    if (!firebaseUser || isInvalid(form)) return;

    try {
      setSaving(true);
      if (editingStoredModel && modelId) {
        await updateFormModel(firebaseUser, modelId, buildPayload(form));
      } else {
        await createFormModel(firebaseUser, buildPayload(form));
      }
      toast({ title: editingStoredModel ? "Modelo atualizado" : "Modelo criado" });
      router.push("/dashboard/forms?tab=models");
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: saveError instanceof Error ? saveError.message : "Falha ao salvar modelo.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Modelo</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const visual = getModelVisual(baseModelId ?? modelId, allModels.findIndex((model) => model.id === (baseModelId ?? modelId)));
  const Icon = visual.icon;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link href="/dashboard/forms?tab=models">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Modelos
            </Link>
          </Button>
          <div className="flex items-start gap-3">
            <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", visual.className)}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">
                {editingStoredModel ? "Editar modelo" : baseModelId ? "Personalizar modelo" : "Novo modelo"}
              </h1>
              <p className="text-sm text-muted-foreground">Defina a estrutura que será reutilizada na criação de formulários.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/forms?tab=models">Cancelar</Link>
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || isInvalid(form)}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Salvando..." : "Salvar modelo"}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados do modelo</CardTitle>
              <CardDescription>{form.sections.length} seção(ões) · {questionCount} pergunta(s)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="min-h-24"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Seções</CardTitle>
                <Button type="button" variant="outline" size="icon" onClick={addSection} aria-label="Nova seção">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {form.sections.map((section, index) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSectionId(section.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                    activeSection?.id === section.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{index + 1}. {section.title}</span>
                    <Badge variant="outline">{section.items.length}</Badge>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        {activeSection ? (
          <Card>
            <CardHeader className="border-b">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 flex-1 space-y-2">
                  <Label>Título da seção</Label>
                  <Input value={activeSection.title} onChange={(event) => updateSection(activeSection.id, { title: event.target.value })} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-fit text-muted-foreground hover:text-destructive"
                  disabled={form.sections.length <= 1}
                  onClick={() => removeSection(activeSection.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remover seção
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-5">
              {activeSection.items.map((item, index) => (
                <div key={item.id} className="grid gap-3 rounded-lg border bg-muted/10 p-3 lg:grid-cols-[40px_minmax(0,1fr)_220px_40px] lg:items-end">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-background text-sm font-semibold">
                    {index + 1}
                  </div>
                  <div className="space-y-2">
                    <Label>Pergunta</Label>
                    <Input value={item.title} onChange={(event) => updateItem(activeSection.id, item.id, { title: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select value={item.type} onValueChange={(value) => updateItem(activeSection.id, item.id, { type: value as ItemType })}>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={activeSection.items.length <= 1}
                    onClick={() => removeItem(activeSection.id, item.id)}
                    aria-label="Remover pergunta"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => addItem(activeSection.id)}>
                <Plus className="mr-2 h-4 w-4" />
                Nova pergunta
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
