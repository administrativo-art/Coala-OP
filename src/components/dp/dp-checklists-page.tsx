"use client";

import React from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  GripVertical,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
} from "lucide-react";

import type {
  DPChecklistExecution,
  DPChecklistExecutionItem,
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
  claimDPChecklistExecution,
  createDPChecklistTemplate,
  fetchDPChecklistBootstrap,
  generateDPChecklistExecutions,
  updateDPChecklistExecution,
  updateDPChecklistTemplate,
  type DPChecklistBootstrapPayload,
} from "@/features/dp-checklists/lib/client";
import {
  countTemplateItems,
  getChecklistExecutionMetrics,
  isChecklistExecutionItemCompleted,
} from "@/features/dp-checklists/lib/core";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateInputValue(date = new Date()) {
  return format(date, "yyyy-MM-dd");
}

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

function getExecutionStatusMeta(status: DPChecklistExecution["status"]) {
  if (status === "completed") {
    return {
      label: "Concluído",
      className:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300",
    };
  }
  if (status === "claimed") {
    return {
      label: "Em andamento",
      className:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
    };
  }
  if (status === "overdue") {
    return {
      label: "Atrasado",
      className:
        "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
    };
  }
  return {
    label: "Pendente",
    className:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300",
  };
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
// Template editor types
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
          placeholder="Opção 1&#10;Opção 2&#10;Opção 3"
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
// Section item editor row
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

  // Section helpers
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

  function updateSection(
    sectionId: string,
    updater: (s: EditorSection) => EditorSection
  ) {
    setValues((v) => ({
      ...v,
      sections: v.sections.map((s) => (s.id === sectionId ? updater(s) : s)),
    }));
  }

  // Item helpers within a section
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

  function updateItem(
    sectionId: string,
    itemId: string,
    updater: (i: EditorItem) => EditorItem
  ) {
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
    await onSubmit({ ...values, name: values.name.trim(), description: values.description.trim(), sections: cleanedSections });
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
          {/* Nome e status */}
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

          {/* Descrição */}
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea
              rows={2}
              value={values.description}
              onChange={(e) =>
                setValues((v) => ({ ...v, description: e.target.value }))
              }
              placeholder="Contexto operacional do checklist."
            />
          </div>

          {/* Escopo */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Unidades</Label>
              <MultiSelect
                options={unitOptions}
                selected={values.unitIds}
                onChange={(selected) =>
                  setValues((v) => ({ ...v, unitIds: selected }))
                }
                placeholder="Todas as unidades"
              />
            </div>
            <div className="space-y-2">
              <Label>Turnos</Label>
              <MultiSelect
                options={shiftOptions}
                selected={values.shiftDefinitionIds}
                onChange={(selected) =>
                  setValues((v) => ({ ...v, shiftDefinitionIds: selected }))
                }
                placeholder="Todos os turnos"
              />
            </div>
          </div>

          {/* Seções */}
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
                        updateSection(section.id, (s) => ({
                          ...s,
                          title: e.target.value,
                        }))
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
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
          >
            {saving
              ? "Salvando..."
              : template
                ? "Salvar alterações"
                : "Criar template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Execution item renderer (dentro do dialog de execução)
// ---------------------------------------------------------------------------

function ExecutionItemInput({
  item,
  editable,
  onUpdate,
}: {
  item: DPChecklistExecutionItem;
  editable: boolean;
  onUpdate: (updates: Partial<DPChecklistExecutionItem>) => void;
}) {
  if (item.type === "checkbox") {
    return (
      <label className="flex items-center gap-3 rounded-md border px-3 py-3 text-sm cursor-pointer">
        <Checkbox
          checked={item.checked === true}
          disabled={!editable}
          onCheckedChange={(checked) => onUpdate({ checked: !!checked })}
        />
        <span>Item conferido</span>
      </label>
    );
  }

  if (item.type === "text") {
    return (
      <Textarea
        rows={3}
        disabled={!editable}
        value={item.textValue ?? ""}
        onChange={(e) => onUpdate({ textValue: e.target.value })}
        placeholder="Registre a observação deste item."
      />
    );
  }

  if (item.type === "select") {
    const options = item.config?.options ?? [];
    if (options.length === 0) {
      return (
        <p className="text-sm text-muted-foreground italic">
          Nenhuma opção configurada neste item.
        </p>
      );
    }
    return (
      <Select
        value={item.textValue ?? ""}
        disabled={!editable}
        onValueChange={(v) => onUpdate({ textValue: v })}
      >
        <SelectTrigger>
          <SelectValue placeholder="Selecione uma opção" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (item.type === "number" || item.type === "temperature") {
    const unit = item.config?.unit ?? (item.type === "temperature" ? "°C" : "");
    return (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          disabled={!editable}
          value={item.numberValue ?? ""}
          min={item.config?.min}
          max={item.config?.max}
          onChange={(e) =>
            onUpdate({
              numberValue: e.target.value !== "" ? Number(e.target.value) : undefined,
            })
          }
          placeholder={
            item.config?.min !== undefined && item.config?.max !== undefined
              ? `${item.config.min} – ${item.config.max}`
              : "Valor"
          }
          className="w-40"
        />
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        {item.isOutOfRange && (
          <Badge
            variant="outline"
            className="border-orange-200 bg-orange-50 text-orange-700 text-xs"
          >
            Fora do intervalo
          </Badge>
        )}
      </div>
    );
  }

  if (item.type === "photo") {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        Upload de fotos — em breve.
        {item.photoUrls && item.photoUrls.length > 0 && (
          <p className="mt-1 font-medium text-foreground">
            {item.photoUrls.length} foto(s) registrada(s)
          </p>
        )}
      </div>
    );
  }

  if (item.type === "signature") {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        Assinatura digital — em breve.
        {item.signatureUrl && (
          <p className="mt-1 font-medium text-foreground">Assinatura registrada</p>
        )}
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Execution dialog
// ---------------------------------------------------------------------------

function ExecutionDialog({
  open,
  onOpenChange,
  execution,
  currentUserId,
  canOperate,
  claiming,
  saving,
  onClaim,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  execution: DPChecklistExecution | null;
  currentUserId: string | null;
  canOperate: boolean;
  claiming: boolean;
  saving: boolean;
  onClaim: (execution: DPChecklistExecution) => Promise<void>;
  onSubmit: (
    execution: DPChecklistExecution,
    action: "save" | "complete",
    items: DPChecklistExecutionItem[]
  ) => Promise<void>;
}) {
  const [items, setItems] = React.useState<DPChecklistExecutionItem[]>([]);

  React.useEffect(() => {
    if (!execution) {
      setItems([]);
      return;
    }
    setItems(execution.items.map((item) => ({ ...item })));
  }, [execution]);

  if (!execution) return null;

  const isCompleted = execution.status === "completed";
  const isClaimedByCurrentUser =
    execution.claimedByUserId && execution.claimedByUserId === currentUserId;
  const isLockedByOtherUser =
    (execution.status === "claimed" || execution.status === "overdue") &&
    execution.claimedByUserId &&
    execution.claimedByUserId !== currentUserId;
  const editable = canOperate && !isCompleted && !!isClaimedByCurrentUser;

  const metrics = getChecklistExecutionMetrics({
    execution: { ...execution, items },
  });

  const completedItems = items.filter(isChecklistExecutionItemCompleted).length;

  // Group items by section
  const sections = React.useMemo(() => {
    const sectionMap = new Map<string, { title: string; items: DPChecklistExecutionItem[] }>();
    items.forEach((item) => {
      const sectionId = item.sectionId ?? "__default__";
      const sectionTitle = item.sectionTitle ?? "Geral";
      if (!sectionMap.has(sectionId)) {
        sectionMap.set(sectionId, { title: sectionTitle, items: [] });
      }
      sectionMap.get(sectionId)!.items.push(item);
    });
    return Array.from(sectionMap.entries()).map(([id, data]) => ({ id, ...data }));
  }, [items]);

  function updateItem(templateItemId: string, updates: Partial<DPChecklistExecutionItem>) {
    setItems((current) =>
      current.map((item) =>
        item.templateItemId === templateItemId ? { ...item, ...updates } : item
      )
    );
  }

  const statusMeta = getExecutionStatusMeta(execution.status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{execution.templateName}</DialogTitle>
          <DialogDescription>
            {execution.unitName ?? "Sem unidade"} • {execution.assignedUsername} •{" "}
            {execution.shiftStartTime} – {execution.shiftEndTime}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn(statusMeta.className)}>
              {statusMeta.label}
            </Badge>
            {execution.claimedByUsername && (
              <Badge variant="secondary">
                Assumido por {execution.claimedByUsername}
              </Badge>
            )}
            {execution.completedAt && (
              <Badge variant="secondary">
                Concluído em {formatTimestamp(execution.completedAt)}
              </Badge>
            )}
            {execution.score !== undefined && execution.score !== null && (
              <Badge variant="secondary">Score: {execution.score}%</Badge>
            )}
          </div>

          {!isCompleted && execution.status === "pending" && (
            <Alert>
              <AlertTitle>Checklist ainda não assumido</AlertTitle>
              <AlertDescription>
                Assuma o checklist para registrar a execução e concluir o turno.
              </AlertDescription>
            </Alert>
          )}

          {isLockedByOtherUser && (
            <Alert>
              <AlertTitle>Checklist em andamento</AlertTitle>
              <AlertDescription>
                {execution.claimedByUsername} já assumiu essa execução.
              </AlertDescription>
            </Alert>
          )}

          {metrics.isOverdue && !isCompleted && (
            <Alert variant="destructive">
              <AlertTitle>Execução em atraso</AlertTitle>
              <AlertDescription>
                O turno encerrou em {metrics.overdueSinceLocal ?? "—"}. Itens respondidos agora receberão pontuação reduzida.
              </AlertDescription>
            </Alert>
          )}

          {/* Progresso */}
          <Card>
            <CardContent className="flex items-center justify-between p-4 text-sm">
              <div>
                <p className="font-medium">Andamento</p>
                <p className="text-muted-foreground">
                  {completedItems} de {items.length} itens •{" "}
                  {metrics.requiredCompletionPercent}% obrigatório
                </p>
              </div>
              <p className="text-lg font-semibold">{metrics.score}%</p>
            </CardContent>
          </Card>

          {/* Itens por seção */}
          {sections.map((section) => (
            <div key={section.id} className="space-y-3">
              <h3 className="text-sm font-semibold border-b pb-1">{section.title}</h3>
              {section.items
                .slice()
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((item) => (
                  <Card key={item.templateItemId} className="border-dashed">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{item.title}</p>
                          {item.description && (
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {item.description}
                            </p>
                          )}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {ITEM_TYPE_LABELS[item.type]} • Peso {item.weight ?? 1}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {item.required && (
                            <Badge variant="outline">Obrigatório</Badge>
                          )}
                          {item.isLate && (
                            <Badge
                              variant="outline"
                              className="border-orange-200 bg-orange-50 text-orange-700 text-xs"
                            >
                              Atrasado
                            </Badge>
                          )}
                        </div>
                      </div>

                      <ExecutionItemInput
                        item={item}
                        editable={editable}
                        onUpdate={(updates) =>
                          updateItem(item.templateItemId, updates)
                        }
                      />
                    </CardContent>
                  </Card>
                ))}
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>

          {canOperate && (execution.status === "pending" || execution.status === "overdue") && !isClaimedByCurrentUser && (
            <Button
              type="button"
              onClick={() => void onClaim(execution)}
              disabled={claiming}
            >
              {claiming ? "Assumindo..." : "Assumir checklist"}
            </Button>
          )}

          {editable && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => void onSubmit(execution, "save", items)}
                disabled={saving}
              >
                {saving ? "Salvando..." : "Salvar andamento"}
              </Button>
              <Button
                type="button"
                onClick={() => void onSubmit(execution, "complete", items)}
                disabled={saving}
              >
                {saving ? "Concluindo..." : "Concluir checklist"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function DPChecklistsPage() {
  const { firebaseUser, user } = useAuth();
  const { units, shiftDefinitions, loading: dpLoading } = useDPBootstrap();
  const { toast } = useToast();

  const [selectedDate, setSelectedDate] = React.useState(toDateInputValue(new Date()));
  const [payload, setPayload] = React.useState<DPChecklistBootstrapPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [unitFilter, setUnitFilter] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [generateLoading, setGenerateLoading] = React.useState(false);
  const [selectedExecutionId, setSelectedExecutionId] = React.useState<string | null>(
    null
  );
  const [executionClaiming, setExecutionClaiming] = React.useState(false);
  const [executionSaving, setExecutionSaving] = React.useState(false);

  async function loadData(date = selectedDate) {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchDPChecklistBootstrap(firebaseUser, { date });
      setPayload(next);
    } catch (err) {
      setPayload(null);
      setError(err instanceof Error ? err.message : "Falha ao carregar os checklists.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!firebaseUser) return;
    void loadData(selectedDate);
  }, [firebaseUser, selectedDate]);

  const executions = payload?.executions ?? [];
  const templates = payload?.templates ?? [];
  const canOperate = payload?.access.canOperate ?? false;

  const filteredExecutions = executions.filter((execution) => {
    if (statusFilter !== "all" && execution.status !== statusFilter) return false;
    if (unitFilter !== "all" && execution.unitId !== unitFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [
      execution.templateName,
      execution.assignedUsername,
      execution.unitName ?? "",
      execution.shiftDefinitionName ?? "",
    ].some((v) => v.toLowerCase().includes(q));
  });

  const selectedExecution =
    executions.find((e) => e.id === selectedExecutionId) ?? null;

  const pendingCount = executions.filter((e) => e.status === "pending").length;
  const claimedCount = executions.filter((e) => e.status === "claimed").length;
  const completedCount = executions.filter((e) => e.status === "completed").length;
  const overdueCount = executions.filter(
    (e) => e.status === "overdue" || getChecklistExecutionMetrics({ execution: e }).isOverdue
  ).length;
  const activeTemplateCount = templates.filter((t) => t.isActive).length;
  const averageScore =
    executions.length > 0
      ? Math.round(
          executions.reduce(
            (sum, e) => sum + getChecklistExecutionMetrics({ execution: e }).score,
            0
          ) / executions.length
        )
      : 0;

  async function handleGenerate() {
    if (!firebaseUser) return;
    setGenerateLoading(true);
    try {
      const result = await generateDPChecklistExecutions(firebaseUser, { date: selectedDate });
      toast({
        title: "Checklists do dia sincronizados",
        description: `${result.createdExecutions} criados, ${result.skippedExecutions} já existentes.`,
      });
      await loadData(selectedDate);
    } catch (err) {
      toast({
        title: "Falha ao gerar checklists",
        description: err instanceof Error ? err.message : "Não foi possível gerar.",
        variant: "destructive",
      });
    } finally {
      setGenerateLoading(false);
    }
  }

  async function handleClaim(execution: DPChecklistExecution) {
    if (!firebaseUser) return;
    setExecutionClaiming(true);
    try {
      await claimDPChecklistExecution(firebaseUser, execution.id);
      toast({ title: "Checklist assumido" });
      await loadData(selectedDate);
    } catch (err) {
      toast({
        title: "Falha ao assumir checklist",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setExecutionClaiming(false);
    }
  }

  async function handleExecutionSubmit(
    execution: DPChecklistExecution,
    action: "save" | "complete",
    items: DPChecklistExecutionItem[]
  ) {
    if (!firebaseUser) return;
    setExecutionSaving(true);
    try {
      await updateDPChecklistExecution(firebaseUser, execution.id, {
        action,
        items: items.map((item) => ({
          templateItemId: item.templateItemId,
          sectionId: item.sectionId,
          checked: item.checked,
          textValue: item.textValue,
          numberValue: item.numberValue,
          photoUrls: item.photoUrls,
          signatureUrl: item.signatureUrl,
        })),
      });
      toast({
        title: action === "complete" ? "Checklist concluído" : "Checklist salvo",
      });
      await loadData(selectedDate);
    } catch (err) {
      toast({
        title: action === "complete" ? "Falha ao concluir" : "Falha ao salvar",
        description: err instanceof Error ? err.message : "Não foi possível atualizar.",
        variant: "destructive",
      });
    } finally {
      setExecutionSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Checklists operacionais
          </h1>
          <p className="text-sm text-muted-foreground">
            Gere as execuções do dia, assuma o checklist do turno e conclua a rotina
            operacional.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-[180px]"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadData(selectedDate)}
            disabled={loading || !firebaseUser}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
          <Button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generateLoading || !firebaseUser}
          >
            {generateLoading ? "Sincronizando..." : "Gerar checklists do dia"}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar módulo</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {(loading || dpLoading) && !payload ? (
        <div className="space-y-4">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            {[
              { label: "Templates ativos", value: activeTemplateCount, icon: ClipboardList },
              { label: "Pendentes", value: pendingCount, icon: Clock3 },
              { label: "Em andamento", value: claimedCount, icon: UserCheck },
              { label: "Concluídos", value: completedCount, icon: ShieldCheck },
              { label: "Atrasados", value: overdueCount, icon: Clock3 },
              { label: "Score médio", value: `${averageScore}%`, icon: ClipboardCheck },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label}>
                <CardContent className="flex items-start justify-between gap-3 p-5">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="text-2xl font-semibold">{value}</p>
                  </div>
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>

          <Tabs defaultValue="daily" className="space-y-4">
            <TabsList>
              <TabsTrigger value="daily">Checklist do dia</TabsTrigger>
              <TabsTrigger value="analytics">Painel gerencial</TabsTrigger>
            </TabsList>

            {/* Daily */}
            <TabsContent value="daily" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Execuções do dia</CardTitle>
                  <CardDescription>
                    Filtre por status, unidade ou colaborador e acompanhe o andamento dos
                    turnos.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-[220px_220px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="pending">Pendentes</SelectItem>
                        <SelectItem value="claimed">Em andamento</SelectItem>
                        <SelectItem value="overdue">Atrasados</SelectItem>
                        <SelectItem value="completed">Concluídos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Unidade</Label>
                    <Select value={unitFilter} onValueChange={setUnitFilter}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as unidades</SelectItem>
                        {units.map((unit) => (
                          <SelectItem key={unit.id} value={unit.id}>
                            {unit.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Busca</Label>
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Template, colaborador, unidade ou turno"
                    />
                  </div>
                </CardContent>
              </Card>

              {filteredExecutions.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                    <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
                    <div className="space-y-1">
                      <p className="font-medium">Nenhuma execução encontrada</p>
                      <p className="text-sm text-muted-foreground">
                        Gere os checklists do dia ou ajuste os filtros.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {filteredExecutions.map((execution) => {
                    const statusMeta = getExecutionStatusMeta(execution.status);
                    const metrics = getChecklistExecutionMetrics({ execution });
                    const completedItems = execution.items.filter(
                      isChecklistExecutionItemCompleted
                    ).length;

                    return (
                      <Card key={execution.id}>
                        <CardHeader className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <CardTitle className="text-lg">
                                {execution.templateName}
                              </CardTitle>
                              <CardDescription>
                                {execution.unitName ?? "Sem unidade"} •{" "}
                                {execution.shiftDefinitionName ?? "Sem turno"} •{" "}
                                {execution.assignedUsername}
                              </CardDescription>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(statusMeta.className)}
                            >
                              {statusMeta.label}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary">
                              {execution.shiftStartTime} – {execution.shiftEndTime}
                            </Badge>
                            <Badge variant="secondary">
                              {metrics.score}% score
                            </Badge>
                            {metrics.isOverdue && (
                              <Badge
                                variant="outline"
                                className="border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
                              >
                                Atrasado
                              </Badge>
                            )}
                            {execution.claimedByUsername ? (
                              <Badge variant="secondary">
                                {execution.status === "completed"
                                  ? `Concluído por ${execution.completedByUsername ?? execution.claimedByUsername}`
                                  : `Assumido por ${execution.claimedByUsername}`}
                              </Badge>
                            ) : null}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Andamento</span>
                            <span className="font-medium">
                              {completedItems}/{execution.items.length}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-muted-foreground">
                              {execution.completedAt
                                ? `Finalizado em ${formatTimestamp(execution.completedAt)}`
                                : metrics.isOverdue
                                  ? `Atrasado desde ${metrics.overdueSinceLocal ?? "—"}`
                                  : execution.claimedAt
                                    ? `Assumido em ${formatTimestamp(execution.claimedAt)}`
                                    : "Ainda não assumido"}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setSelectedExecutionId(execution.id)}
                            >
                              Abrir
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* Analytics */}
            <TabsContent value="analytics">
              <DPChecklistsAnalytics units={units} templates={templates} />
            </TabsContent>

          </Tabs>
        </>
      )}

      <ExecutionDialog
        open={!!selectedExecution}
        onOpenChange={(open) => {
          if (!open) setSelectedExecutionId(null);
        }}
        execution={selectedExecution}
        currentUserId={user?.id ?? null}
        canOperate={canOperate}
        claiming={executionClaiming}
        saving={executionSaving}
        onClaim={handleClaim}
        onSubmit={handleExecutionSubmit}
      />
    </div>
  );
}
