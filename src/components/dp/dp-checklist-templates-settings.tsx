"use client";

import React from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";

import type {
  DPChecklistItemConfig,
  DPChecklistItemType,
  DPChecklistSection,
  DPChecklistTemplate,
  DPChecklistTemplateItem,
  DPShiftDefinition,
  DPUnit,
} from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { useToast } from "@/hooks/use-toast";
import {
  createDPChecklistTemplate,
  fetchDPChecklistBootstrap,
  updateDPChecklistTemplate,
} from "@/features/dp-checklists/lib/client";
import { countTemplateItems } from "@/features/dp-checklists/lib/core";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLocalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) return "—";
  try {
    const date = typeof value === "string" ? parseISO(value) : value;
    return format(date, "dd/MM/yyyy HH:mm", { locale: ptBR });
  } catch {
    return typeof value === "string" ? value : "—";
  }
}

function formatScopeLabel(template: DPChecklistTemplate) {
  const unitLabel = template.unitNames?.length
    ? template.unitNames.join(", ")
    : "Todas as unidades";
  const shiftLabel = template.shiftDefinitionNames?.length
    ? template.shiftDefinitionNames.join(", ")
    : "Todos os turnos";
  return `${unitLabel} • ${shiftLabel}`;
}

const ITEM_TYPE_LABELS: Record<DPChecklistItemType, string> = {
  checkbox: "Marcação",
  text: "Texto",
  number: "Número",
  temperature: "Temperatura",
  select: "Seleção",
  photo: "Foto",
  signature: "Assinatura",
  yes_no: "Sim ou não",
  multi_select: "Múltipla escolha",
  date: "Data",
};

// ---------------------------------------------------------------------------
// Editor types
// ---------------------------------------------------------------------------

type EditorItem = {
  id: string;
  order: number;
  title: string;
  description: string;
  type: DPChecklistItemType;
  required: boolean;
  weight: number;
  config: DPChecklistItemConfig;
};

type EditorSection = {
  id: string;
  title: string;
  order: number;
  items: EditorItem[];
};

type TemplateEditorValues = {
  name: string;
  description: string;
  unitIds: string[];
  shiftDefinitionIds: string[];
  isActive: boolean;
  sections: EditorSection[];
};

function makeDefaultItem(order = 0): EditorItem {
  return {
    id: createLocalId(),
    order,
    title: "",
    description: "",
    type: "checkbox",
    required: true,
    weight: 1,
    config: {},
  };
}

function makeDefaultSection(order = 0): EditorSection {
  return {
    id: createLocalId(),
    title: "",
    order,
    items: [makeDefaultItem(0)],
  };
}

function templateToEditorValues(template: DPChecklistTemplate): TemplateEditorValues {
  return {
    name: template.name,
    description: template.description ?? "",
    unitIds: template.unitIds ?? [],
    shiftDefinitionIds: template.shiftDefinitionIds ?? [],
    isActive: template.isActive,
    sections: (template.sections ?? []).map((section, sIdx) => ({
      id: section.id,
      title: section.title,
      order: sIdx,
      items: section.items.map((item, iIdx) => ({
        id: item.id,
        order: iIdx,
        title: item.title,
        description: item.description ?? "",
        type: item.type,
        required: item.required,
        weight: item.weight ?? 1,
        config: item.config ?? {},
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Item config editor
// ---------------------------------------------------------------------------

function ItemConfigEditor({
  type,
  config,
  onChange,
}: {
  type: DPChecklistItemType;
  config: DPChecklistItemConfig;
  onChange: (config: DPChecklistItemConfig) => void;
}) {
  if (type === "number" || type === "temperature") {
    const unit = type === "temperature" ? (config.unit ?? "°C") : (config.unit ?? "");
    return (
      <div className="grid gap-2 grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Mínimo</Label>
          <Input
            type="number"
            value={config.min ?? ""}
            onChange={(e) =>
              onChange({ ...config, min: e.target.value !== "" ? Number(e.target.value) : undefined })
            }
            placeholder="—"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Máximo</Label>
          <Input
            type="number"
            value={config.max ?? ""}
            onChange={(e) =>
              onChange({ ...config, max: e.target.value !== "" ? Number(e.target.value) : undefined })
            }
            placeholder="—"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Unidade</Label>
          <Input
            value={unit}
            onChange={(e) => onChange({ ...config, unit: e.target.value })}
            placeholder={type === "temperature" ? "°C" : "kg, L…"}
          />
        </div>
        <div className="col-span-3 flex items-center gap-2">
          <Checkbox
            id="alert-range"
            checked={config.alertOutOfRange ?? false}
            onCheckedChange={(checked) =>
              onChange({ ...config, alertOutOfRange: !!checked })
            }
          />
          <Label htmlFor="alert-range" className="text-xs font-normal">
            Alertar quando fora do intervalo
          </Label>
        </div>
      </div>
    );
  }

  if (type === "select") {
    const options = config.options ?? [];
    return (
      <div className="space-y-2">
        <Label className="text-xs">Opções (uma por linha)</Label>
        <Textarea
          rows={3}
          value={options.join("\n")}
          onChange={(e) =>
            onChange({
              ...config,
              options: e.target.value
                .split("\n")
                .map((o) => o.trim())
                .filter(Boolean),
            })
          }
          placeholder={"Opção 1\nOpção 2\nOpção 3"}
        />
      </div>
    );
  }

  if (type === "photo") {
    return (
      <div className="grid gap-2 grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Mín. fotos</Label>
          <Input
            type="number"
            min={1}
            value={config.minPhotos ?? ""}
            onChange={(e) =>
              onChange({ ...config, minPhotos: e.target.value !== "" ? Number(e.target.value) : undefined })
            }
            placeholder="1"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Máx. fotos</Label>
          <Input
            type="number"
            min={1}
            value={config.maxPhotos ?? ""}
            onChange={(e) =>
              onChange({ ...config, maxPhotos: e.target.value !== "" ? Number(e.target.value) : undefined })
            }
            placeholder="5"
          />
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Item editor row
// ---------------------------------------------------------------------------

function ItemEditorRow({
  item,
  index,
  total,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  item: EditorItem;
  index: number;
  total: number;
  onUpdate: (updater: (i: EditorItem) => EditorItem) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const hasConfig =
    item.type === "number" ||
    item.type === "temperature" ||
    item.type === "select" ||
    item.type === "photo";

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">
            Item {index + 1}
          </span>
          <div className="ml-auto flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={index === 0}
              onClick={onMoveUp}
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={index === total - 1}
              onClick={onMoveDown}
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_100px_80px]">
          <div className="space-y-1">
            <Label className="text-xs">Título</Label>
            <Input
              value={item.title}
              onChange={(e) => onUpdate((i) => ({ ...i, title: e.target.value }))}
              placeholder="Ex: Conferir temperatura do freezer"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select
              value={item.type}
              onValueChange={(v) =>
                onUpdate((i) => ({ ...i, type: v as DPChecklistItemType, config: {} }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Peso (1–10)</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={item.weight}
              onChange={(e) =>
                onUpdate((i) => ({
                  ...i,
                  weight: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                }))
              }
            />
          </div>
          <div className="flex items-end pb-1">
            <div className="flex items-center gap-2">
              <Switch
                checked={item.required}
                onCheckedChange={(checked) =>
                  onUpdate((i) => ({ ...i, required: checked }))
                }
              />
              <Label className="text-xs">Obrig.</Label>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Descrição (opcional)</Label>
          <Textarea
            rows={2}
            value={item.description}
            onChange={(e) => onUpdate((i) => ({ ...i, description: e.target.value }))}
            placeholder="Orientação para quem executa."
          />
        </div>

        {hasConfig && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium mb-2">Configuração do tipo</p>
            <ItemConfigEditor
              type={item.type}
              config={item.config}
              onChange={(config) => onUpdate((i) => ({ ...i, config }))}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Template dialog
// ---------------------------------------------------------------------------

function TemplateDialog({
  open,
  onOpenChange,
  template,
  units,
  shiftDefinitions,
  onSubmit,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: DPChecklistTemplate | null;
  units: DPUnit[];
  shiftDefinitions: DPShiftDefinition[];
  onSubmit: (values: TemplateEditorValues) => Promise<void>;
  saving: boolean;
}) {
  const [values, setValues] = React.useState<TemplateEditorValues>(() => ({
    name: "",
    description: "",
    unitIds: [],
    shiftDefinitionIds: [],
    isActive: true,
    sections: [makeDefaultSection(0)],
  }));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    if (template) {
      setValues(templateToEditorValues(template));
    } else {
      setValues({
        name: "",
        description: "",
        unitIds: [],
        shiftDefinitionIds: [],
        isActive: true,
        sections: [makeDefaultSection(0)],
      });
    }
    setError(null);
  }, [open, template]);

  function addSection() {
    setValues((v) => ({
      ...v,
      sections: [...v.sections, makeDefaultSection(v.sections.length)],
    }));
  }

  function removeSection(sectionId: string) {
    setValues((v) => {
      const next = v.sections.filter((s) => s.id !== sectionId);
      return { ...v, sections: next.length > 0 ? next : [makeDefaultSection(0)] };
    });
  }

  function updateSection(sectionId: string, updater: (s: EditorSection) => EditorSection) {
    setValues((v) => ({
      ...v,
      sections: v.sections.map((s) => (s.id === sectionId ? updater(s) : s)),
    }));
  }

  function addItem(sectionId: string) {
    updateSection(sectionId, (s) => ({
      ...s,
      items: [...s.items, makeDefaultItem(s.items.length)],
    }));
  }

  function removeItem(sectionId: string, itemId: string) {
    updateSection(sectionId, (s) => {
      const next = s.items.filter((i) => i.id !== itemId);
      return {
        ...s,
        items: next.length > 0 ? next.map((i, idx) => ({ ...i, order: idx })) : [makeDefaultItem(0)],
      };
    });
  }

  function updateItem(sectionId: string, itemId: string, updater: (i: EditorItem) => EditorItem) {
    updateSection(sectionId, (s) => ({
      ...s,
      items: s.items.map((i) => (i.id === itemId ? updater(i) : i)),
    }));
  }

  function moveItem(sectionId: string, fromIndex: number, toIndex: number) {
    updateSection(sectionId, (s) => {
      const next = [...s.items];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { ...s, items: next.map((i, idx) => ({ ...i, order: idx })) };
    });
  }

  async function handleSubmit() {
    const cleanedSections = values.sections
      .map((section, sIdx) => ({
        ...section,
        title: section.title.trim(),
        order: sIdx,
        items: section.items
          .map((item, iIdx) => ({
            ...item,
            title: item.title.trim(),
            description: item.description.trim(),
            order: iIdx,
          }))
          .filter((item) => item.title.length >= 2),
      }))
      .filter((s) => s.title.length > 0 && s.items.length > 0);

    if (values.name.trim().length < 2) {
      setError("Informe o nome do template.");
      return;
    }
    if (cleanedSections.length === 0) {
      setError("Inclua pelo menos uma seção com título e um item válido.");
      return;
    }

    setError(null);
    await onSubmit({
      ...values,
      name: values.name.trim(),
      description: values.description.trim(),
      sections: cleanedSections,
    });
  }

  const unitOptions = units.map((u) => ({ value: u.id, label: u.name }));
  const shiftOptions = shiftDefinitions.map((s) => ({ value: s.id, label: s.name }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {template ? "Editar template" : "Novo template de checklist"}
          </DialogTitle>
          <DialogDescription>
            Organize o checklist em seções e defina o escopo por unidade e turno.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                placeholder="Ex: Abertura da unidade"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Template ativo</p>
                <p className="text-xs text-muted-foreground">
                  Templates inativos não entram na geração diária.
                </p>
              </div>
              <Switch
                checked={values.isActive}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, isActive: checked }))
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea
              rows={2}
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
              placeholder="Contexto operacional do checklist."
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Unidades</Label>
              <MultiSelect
                options={unitOptions}
                selected={values.unitIds}
                onChange={(selected) => setValues((v) => ({ ...v, unitIds: selected }))}
                placeholder="Todas as unidades"
              />
            </div>
            <div className="space-y-2">
              <Label>Turnos</Label>
              <MultiSelect
                options={shiftOptions}
                selected={values.shiftDefinitionIds}
                onChange={(selected) => setValues((v) => ({ ...v, shiftDefinitionIds: selected }))}
                placeholder="Todos os turnos"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Seções</h3>
                <p className="text-xs text-muted-foreground">
                  Agrupe os itens do checklist em seções temáticas.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addSection}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Adicionar seção
              </Button>
            </div>

            {values.sections.map((section, sIdx) => (
              <Card key={section.id} className="border-primary/20">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={section.title}
                      onChange={(e) =>
                        updateSection(section.id, (s) => ({ ...s, title: e.target.value }))
                      }
                      placeholder={`Seção ${sIdx + 1} — Ex: Equipamentos`}
                      className="font-medium"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => removeSection(section.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {section.items.map((item, iIdx) => (
                    <ItemEditorRow
                      key={item.id}
                      item={item}
                      index={iIdx}
                      total={section.items.length}
                      onUpdate={(updater) => updateItem(section.id, item.id, updater)}
                      onRemove={() => removeItem(section.id, item.id)}
                      onMoveUp={() => moveItem(section.id, iIdx, iIdx - 1)}
                      onMoveDown={() => moveItem(section.id, iIdx, iIdx + 1)}
                    />
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full border border-dashed"
                    onClick={() => addItem(section.id)}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Adicionar item
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Template inválido</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "Salvando..." : template ? "Salvar alterações" : "Criar template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DPChecklistTemplatesSettings() {
  const { firebaseUser } = useAuth();
  const { units, shiftDefinitions } = useDPBootstrap();
  const { toast } = useToast();

  const [templates, setTemplates] = React.useState<DPChecklistTemplate[]>([]);
  const [canManageTemplates, setCanManageTemplates] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedTemplate, setSelectedTemplate] = React.useState<DPChecklistTemplate | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function loadTemplates() {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const today = format(new Date(), "yyyy-MM-dd");
      const payload = await fetchDPChecklistBootstrap(firebaseUser, { date: today });
      setTemplates(payload.templates);
      setCanManageTemplates(payload.access.canManageTemplates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar os templates.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!firebaseUser) return;
    void loadTemplates();
  }, [firebaseUser]);

  async function handleSubmit(values: TemplateEditorValues) {
    if (!firebaseUser) return;
    setSaving(true);
    try {
      const body = {
        ...values,
        sections: values.sections.map((section, sIdx) => ({
          ...section,
          order: sIdx,
          items: section.items.map((item, iIdx) => ({
            ...item,
            order: iIdx,
            description: item.description?.trim() || undefined,
            config: Object.keys(item.config ?? {}).length > 0 ? item.config : undefined,
          })),
        })),
      };

      if (selectedTemplate) {
        await updateDPChecklistTemplate(firebaseUser, selectedTemplate.id, body);
        toast({ title: "Template atualizado" });
      } else {
        await createDPChecklistTemplate(firebaseUser, body);
        toast({ title: "Template criado" });
      }

      setDialogOpen(false);
      setSelectedTemplate(null);
      await loadTemplates();
    } catch (err) {
      toast({
        title: "Falha ao salvar template",
        description: err instanceof Error ? err.message : "Não foi possível salvar.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Falha ao carregar templates</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Templates de checklist</CardTitle>
            <CardDescription>
              Defina os modelos que entram na geração diária de execuções por turno.
            </CardDescription>
          </div>
          {canManageTemplates && (
            <Button
              type="button"
              onClick={() => {
                setSelectedTemplate(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo template
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <ClipboardList className="h-10 w-10 text-muted-foreground" />
              <div className="space-y-1">
                <p className="font-medium">Nenhum template cadastrado</p>
                <p className="text-sm text-muted-foreground">
                  Cadastre o primeiro template para começar a gerar os checklists do dia.
                </p>
              </div>
              {canManageTemplates && (
                <Button
                  type="button"
                  onClick={() => {
                    setSelectedTemplate(null);
                    setDialogOpen(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Criar primeiro template
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Escopo</TableHead>
                  <TableHead>Seções / Itens</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Atualização</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium">{template.name}</p>
                        {template.description && (
                          <p className="max-w-[360px] text-xs text-muted-foreground">
                            {template.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatScopeLabel(template)}
                    </TableCell>
                    <TableCell>
                      {template.sections?.length ?? 0} seções /{" "}
                      {countTemplateItems(template)} itens
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          template.isActive
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                            : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300"
                        }
                      >
                        {template.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatTimestamp(
                        typeof template.updatedAt === "string" ? template.updatedAt : null
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManageTemplates ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedTemplate(template);
                            setDialogOpen(true);
                          }}
                        >
                          Editar
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Somente leitura</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TemplateDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setSelectedTemplate(null);
        }}
        template={selectedTemplate}
        units={units}
        shiftDefinitions={shiftDefinitions}
        onSubmit={handleSubmit}
        saving={saving}
      />
    </>
  );
}
