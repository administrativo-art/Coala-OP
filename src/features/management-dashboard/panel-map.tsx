"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { MANAGEMENT_WIDGET_BY_ID } from "./catalog";
import type { DashboardWidgetPlacement } from "./types";
import { widgetIcons } from "./widgets/icons";

/** Quantas colunas do grid de 12 o bloco ocupa no mapa (mesma regra do cartão real). */
export function mapSpan(width: number): number {
  return Math.min(12, Math.max(1, Math.round(width)));
}

/** Altura do bloco no mapa: proporcional às linhas do widget, com piso para caber o título. */
export function mapHeight(rows: number): number {
  return 28 + Math.max(1, rows) * 18;
}

export function sizeLabelOf(placement: DashboardWidgetPlacement): string {
  const definition = MANAGEMENT_WIDGET_BY_ID.get(placement.widgetId);
  const { w, h } = placement.layouts.desktop;
  return definition?.allowedSizes.find((size) => size.w === w && size.h === h)?.label ?? `${w}×${h}`;
}

const moduleIcon = {
  "goals-revenue": widgetIcons.goals, "pending-tasks": widgetIcons.tasks, "critical-restock": widgetIcons.restock, "best-sellers": widgetIcons.sales,
  "weekly-schedule": widgetIcons.schedule, "vacation-calendar": widgetIcons.absences, "pending-payments": widgetIcons.payments,
  "financial-shortcuts": widgetIcons.financeHub, "stock-shortcuts": widgetIcons.stockHub, "people-shortcuts": widgetIcons.peopleHub,
  "operations-shortcuts": widgetIcons.operationsHub, "ai-costs-shortcuts": widgetIcons.aiHub,
} as const;

export type WidgetControlsProps = { placement: DashboardWidgetPlacement; locked: boolean; onResize: PanelMapProps["onResize"]; onRemove: PanelMapProps["onRemove"] };

/** Tamanhos e remoção de um widget; aparece no próprio bloco do mapa. */
export function WidgetControls({ placement, locked, onResize, onRemove }: WidgetControlsProps) {
  const definition = MANAGEMENT_WIDGET_BY_ID.get(placement.widgetId);
  if (!definition) return null;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-extrabold text-ds-ink">{definition.title}</p>
        <p className="text-xs font-medium text-ds-ink-muted">{definition.description}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {definition.allowedSizes.map((size) => (
          <Button
            key={`${size.w}x${size.h}`}
            variant={placement.layouts.desktop.w === size.w && placement.layouts.desktop.h === size.h ? "primary-modal" : "ds-secondary"}
            size="md"
            onClick={() => onResize(placement.instanceId, size.w, size.h)}
          >
            {size.label}
          </Button>
        ))}
      </div>
      <Button variant="danger-link" size="md" disabled={locked} onClick={() => onRemove(placement.instanceId)}>
        <Trash2 className="h-4 w-4" />Remover do painel
      </Button>
    </div>
  );
}

function MapBlock({ placement, selected, recent, locked, onSelect, onResize, onRemove }: { placement: DashboardWidgetPlacement; selected: boolean; recent: boolean; locked: boolean; onSelect: () => void; onResize: PanelMapProps["onResize"]; onRemove: PanelMapProps["onRemove"] }) {
  const [open, setOpen] = useState(false);
  const sortable = useSortable({ id: placement.instanceId });
  const definition = MANAGEMENT_WIDGET_BY_ID.get(placement.widgetId);
  const Icon = moduleIcon[placement.widgetId];
  const { w, h } = placement.layouts.desktop;
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ gridColumn: `span ${mapSpan(w)} / span ${mapSpan(w)}`, minHeight: mapHeight(h), transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        "relative flex min-w-0 flex-col justify-between rounded-ds-card border bg-ds-surface p-2 text-left shadow-sm",
        selected ? "border-ds-accent ring-2 ring-ds-accent" : "border-ds-border",
        sortable.isDragging && "z-10 opacity-80 shadow-ds-lift",
      )}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left focus-visible:outline-none">
        <span className="flex w-full items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-ds-accent-ink" aria-hidden="true" />
          <span className="truncate text-[11.5px] font-extrabold leading-tight text-ds-ink">{definition?.title ?? placement.widgetId}</span>
        </span>
        <span className="text-[10.5px] font-semibold text-ds-ink-faint">{sizeLabelOf(placement)} · {w}×{h}</span>
      </button>
      {recent ? <span className="absolute -top-2 left-2 rounded-full bg-ds-accent px-1.5 text-[9.5px] font-black text-white">Novo</span> : null}
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) onSelect(); }}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`Ajustar ${definition?.title ?? "widget"}`} className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded text-ds-accent-ink hover:bg-ds-muted">
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(18rem,calc(100vw-2rem))] rounded-ds-card border-ds-border bg-ds-surface p-4">
          <WidgetControls placement={placement} locked={locked} onResize={onResize} onRemove={(id) => { setOpen(false); onRemove(id); }} />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={`Mover ${definition?.title ?? "widget"}`}
        className="absolute right-1 top-1 flex h-6 w-6 cursor-grab items-center justify-center rounded text-ds-ink-faint hover:bg-ds-muted hover:text-ds-ink"
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export type PanelMapProps = {
  widgets: DashboardWidgetPlacement[];
  selectedId: string | null;
  recentId: string | null;
  lockedIds: string[];
  onSelect: (instanceId: string) => void;
  /** Nova ordem completa dos instanceIds visíveis. */
  onReorder: (activeId: string, overId: string) => void;
  onResize: (instanceId: string, w: number, h: number) => void;
  onRemove: (instanceId: string) => void;
};

/** Réplica reduzida do painel: blocos na proporção do grid de 12 colunas, na mesma ordem da tela real. */
export function PanelMap({ widgets, selectedId, recentId, lockedIds, onSelect, onReorder, onResize, onRemove }: PanelMapProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    onReorder(String(event.active.id), String(event.over.id));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-medium text-ds-ink-muted">Visão reduzida do painel. Arraste pelo ícone para reordenar e use o ícone de ajustes do bloco para o tamanho. A tela real mostra o resultado.</p>
      <div className="rounded-ds-card border border-ds-border bg-ds-muted p-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={widgets.map((item) => item.instanceId)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-12 items-start gap-2" data-testid="panel-map-grid">
              {widgets.map((placement) => (
                <MapBlock key={placement.instanceId} placement={placement} selected={placement.instanceId === selectedId} recent={placement.instanceId === recentId} locked={lockedIds.includes(placement.instanceId)} onSelect={() => onSelect(placement.instanceId)} onResize={onResize} onRemove={onRemove} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <p className="text-xs font-medium text-ds-ink-faint">Toque no ícone de ajustes de um bloco para trocar o tamanho ou remover.</p>
    </div>
  );
}
