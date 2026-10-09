"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Copy, GripVertical, LayoutDashboard, Library, Map as MapIcon, Plus, Redo2, Save, Trash2, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidePanel, PanelSection } from "@/components/patterns/side-panel";
import { cn } from "@/lib/utils";
import type { PermissionSet } from "@/types";

import { MANAGEMENT_WIDGET_CATALOG, MANAGEMENT_WIDGET_BY_ID } from "./catalog";
import { createDefaultManagementLayout } from "./default-layout";
import { cloneLayout } from "./layout-policy";
import { PanelMap } from "./panel-map";
import { useManagementDashboardLayouts } from "./use-layouts";
import type { ManagementDashboardLayout, ManagementWidgetId } from "./types";

type BuilderState = { layout: ManagementDashboardLayout; editing: boolean; selectedId: string | null; select: (id: string | null) => void; openSettings: () => void };
const BuilderContext = createContext<BuilderState | null>(null);

const desktopSpan: Record<number, string> = { 1: "xl:col-span-1", 2: "xl:col-span-2", 3: "xl:col-span-3", 4: "xl:col-span-4", 5: "xl:col-span-5", 6: "xl:col-span-6", 7: "xl:col-span-7", 8: "xl:col-span-8", 9: "xl:col-span-9", 10: "xl:col-span-10", 11: "xl:col-span-11", 12: "xl:col-span-12" };
const tabletSpan: Record<number, string> = { 1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4", 5: "md:col-span-5", 6: "md:col-span-6" };

export function ManagementDashboardBuilder({ firebaseUser, userId, userName, permissions, children }: { firebaseUser: import("firebase/auth").User | null; userId: string; userName: string; permissions: PermissionSet; children: ReactNode }) {
  const store = useManagementDashboardLayouts(firebaseUser, userId, userName);
  const [draft, setDraft] = useState<ManagementDashboardLayout | null>(null);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<"catalog" | "settings" | "map" | null>(null);
  const [recentId, setRecentId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const history = useRef<ManagementDashboardLayout[]>([]);
  const future = useRef<ManagementDashboardLayout[]>([]);
  const [, forceHistoryRender] = useState(0);
  const layout = draft ?? store.activeLayout;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const visibleCatalog = MANAGEMENT_WIDGET_CATALOG.filter((definition) => definition.canView(permissions));

  function resetHistory() { history.current = []; future.current = []; forceHistoryRender((value) => value + 1); }
  function updateDraft(next: ManagementDashboardLayout) {
    if (draft) history.current.push(structuredClone(draft));
    future.current = [];
    setDraft(next);
    forceHistoryRender((value) => value + 1);
  }
  function undo() {
    const previous = history.current.pop();
    if (!previous || !draft) return;
    future.current.push(structuredClone(draft));
    setDraft(previous);
    forceHistoryRender((value) => value + 1);
  }
  function redo() {
    const next = future.current.pop();
    if (!next || !draft) return;
    history.current.push(structuredClone(draft));
    setDraft(next);
    forceHistoryRender((value) => value + 1);
  }
  function startEditing() { setDraft(structuredClone(store.activeLayout)); resetHistory(); setEditing(true); setSavedMessage(false); }
  function cancelEditing() { setDraft(null); resetHistory(); setEditing(false); setPanel(null); setSelectedId(null); setRecentId(null); }
  async function save() {
    if (!draft) return;
    const personalDraft = draft.ownerId === userId && draft.visibility === "personal" ? draft : cloneLayout(draft, userId, userName);
    const saved = await store.save(personalDraft);
    setDraft(saved); resetHistory(); setEditing(false); setPanel(null); setSelectedId(null); setRecentId(null); setSavedMessage(true);
  }
  function onDragEnd(event: DragEndEvent) {
    if (!draft || !event.over || event.active.id === event.over.id) return;
    const from = draft.widgets.findIndex((item) => item.widgetId === event.active.id);
    const to = draft.widgets.findIndex((item) => item.widgetId === event.over?.id);
    if (from < 0 || to < 0) return;
    updateDraft({ ...draft, widgets: arrayMove(draft.widgets, from, to) });
  }
  function addWidget(id: ManagementWidgetId) {
    if (!draft || draft.widgets.some((item) => item.widgetId === id)) return;
    const definition = MANAGEMENT_WIDGET_BY_ID.get(id); if (!definition) return;
    const instanceId = `${id}_${crypto.randomUUID().slice(0, 8)}`;
    updateDraft({ ...draft, widgets: [...draft.widgets, { instanceId, widgetId: id, layouts: structuredClone(definition.defaultLayouts), config: {} }] });
    setSelectedId(instanceId); setRecentId(instanceId); setPanel("map");
  }
  function removeSelected() { if (!draft || !selectedId || draft.lockedWidgetIds.includes(selectedId)) return; updateDraft({ ...draft, widgets: draft.widgets.filter((item) => item.instanceId !== selectedId) }); setSelectedId(null); setPanel("catalog"); }
  function resizeWidget(instanceId: string, w: number, h: number) { if (!draft) return; updateDraft({ ...draft, widgets: draft.widgets.map((item) => item.instanceId === instanceId ? { ...item, layouts: { desktop: { ...item.layouts.desktop, w, h }, tablet: { ...item.layouts.tablet, w: Math.min(6, w), h }, mobile: { ...item.layouts.mobile, w: 1, h: Math.max(2, h) } } } : item) }); }
  function resizeSelected(w: number, h: number) { if (selectedId) resizeWidget(selectedId, w, h); }
  function reorderByInstance(activeId: string, overId: string) {
    if (!draft) return;
    const from = draft.widgets.findIndex((item) => item.instanceId === activeId);
    const to = draft.widgets.findIndex((item) => item.instanceId === overId);
    if (from < 0 || to < 0) return;
    updateDraft({ ...draft, widgets: arrayMove(draft.widgets, from, to) });
  }
  function removeWidget(instanceId: string) { if (!draft || draft.lockedWidgetIds.includes(instanceId)) return; updateDraft({ ...draft, widgets: draft.widgets.filter((item) => item.instanceId !== instanceId) }); setSelectedId(null); setRecentId(null); }
  function selectFromMap(instanceId: string) {
    setSelectedId(instanceId);
    const widgetId = draft?.widgets.find((item) => item.instanceId === instanceId)?.widgetId;
    if (widgetId) document.querySelector(`[data-widget-id="${widgetId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function renamePanel(name: string) { if (draft) updateDraft({ ...draft, name }); }
  function createPanel() { const next = createDefaultManagementLayout(userId, userName); next.id = `layout_${crypto.randomUUID().replaceAll("-", "")}`; next.name = "Novo painel"; setDraft(next); resetHistory(); setEditing(true); }
  function duplicatePanel() { const next = cloneLayout(store.activeLayout, userId, userName); setDraft(next); resetHistory(); setEditing(true); setSavedMessage(false); }
  async function deletePanel() {
    if (store.activeLayout.ownerId !== userId || store.activeLayout.id === "personal") return;
    await store.remove(store.activeLayout.id);
    setDeleteConfirm(false);
  }

  const selectedPlacement = layout.widgets.find((item) => item.instanceId === selectedId);
  const selectedDefinition = selectedPlacement ? MANAGEMENT_WIDGET_BY_ID.get(selectedPlacement.widgetId) : null;

  return (
    <BuilderContext.Provider value={{ layout, editing, selectedId, select: setSelectedId, openSettings: () => setPanel("settings") }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-ds-btn-lg border border-ds-border bg-ds-surface px-3 py-2 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Select value={store.activeLayout.id} onValueChange={(value) => void store.activate(value)} disabled={editing}>
            <SelectTrigger className="h-9 w-[220px] border-ds-border-input bg-ds-surface text-xs font-bold"><SelectValue /></SelectTrigger>
            <SelectContent>{store.layouts.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.visibility === "template" ? " · modelo" : ""}</SelectItem>)}</SelectContent>
          </Select>
          {!editing ? <Button variant="ds-secondary" size="xs" onClick={createPanel}><Plus className="h-3.5 w-3.5" />Criar painel</Button> : null}
          {store.loading ? <span className="text-xs text-ds-ink-faint">Carregando painéis…</span> : null}
          {savedMessage ? <span className="inline-flex items-center gap-1 text-xs font-bold text-ds-ok"><Check className="h-3.5 w-3.5" />Painel salvo</span> : null}
        </div>
        <div className="flex items-center gap-2">
          {editing ? <>
            <Button variant="ds-ghost" size="xs" disabled={history.current.length === 0} onClick={undo} aria-label="Desfazer"><Undo2 className="h-3.5 w-3.5" /></Button>
            <Button variant="ds-ghost" size="xs" disabled={future.current.length === 0} onClick={redo} aria-label="Refazer"><Redo2 className="h-3.5 w-3.5" /></Button>
            <Button variant="ds-secondary" size="xs" onClick={() => setPanel("map")}><MapIcon className="h-3.5 w-3.5" />Mapa</Button>
            <Button variant="ds-secondary" size="xs" onClick={() => setPanel("catalog")}><Library className="h-3.5 w-3.5" />Biblioteca</Button>
            <Button variant="ds-ghost" size="xs" onClick={cancelEditing}><X className="h-3.5 w-3.5" />Descartar</Button>
            <Button variant="primary-page" size="xs" loading={store.saving} loadingLabel="Salvando…" onClick={() => void save()}><Save className="h-3.5 w-3.5" />Salvar painel</Button>
          </> : <>
            <Button variant="ds-ghost" size="xs" onClick={duplicatePanel}><Copy className="h-3.5 w-3.5" />Duplicar</Button>
            {store.activeLayout.ownerId === userId && store.activeLayout.id !== "personal" ? deleteConfirm ? <span className="inline-flex items-center gap-1 rounded-ds-btn border border-ds-danger bg-ds-danger-bg px-2 py-1 text-xs font-bold text-ds-danger">
              Excluir “{store.activeLayout.name}”?
              <Button variant="danger-link" size="xs" onClick={() => void deletePanel()}>Confirmar</Button>
              <Button variant="ds-ghost" size="xs" onClick={() => setDeleteConfirm(false)}>Cancelar</Button>
            </span> : <Button variant="danger-link" size="xs" onClick={() => setDeleteConfirm(true)}><Trash2 className="h-3.5 w-3.5" />Excluir</Button> : null}
            <Button variant="primary-page" size="xs" onClick={startEditing}><LayoutDashboard className="h-3.5 w-3.5" />Personalizar painel</Button>
          </>}
        </div>
        {store.error ? <p className="w-full text-xs font-semibold text-ds-danger" role="alert">{store.error}</p> : null}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={layout.widgets.map((item) => item.widgetId)} strategy={rectSortingStrategy}>
          {children}
        </SortableContext>
      </DndContext>

      <SidePanel open={panel !== null} onOpenChange={(open) => !open && setPanel(null)} kicker={panel === "catalog" ? "Biblioteca de widgets" : panel === "map" ? "Mapa do painel" : selectedDefinition?.module} title={panel === "catalog" ? "Adicionar ao painel" : panel === "map" ? "Organizar o painel" : selectedDefinition?.title ?? "Configurar widget"} subtitle={panel === "catalog" ? "Escolha widgets permitidos para o seu perfil." : panel === "map" ? "Reordene e ajuste tamanhos com a visão do todo." : selectedDefinition?.description}>
        {panel === "map" ? <PanelMap widgets={layout.widgets.filter((item) => MANAGEMENT_WIDGET_BY_ID.get(item.widgetId)?.canView(permissions))} selectedId={selectedId} recentId={recentId} lockedIds={layout.lockedWidgetIds} onSelect={selectFromMap} onReorder={reorderByInstance} onResize={resizeWidget} onRemove={removeWidget} /> : panel === "catalog" ? <div className="space-y-3">
          {Array.from(new Set(visibleCatalog.map((item) => item.module))).map((module) => <PanelSection key={module} title={module} aside={`${visibleCatalog.filter((item) => item.module === module).length} widgets`}>
            {visibleCatalog.filter((item) => item.module === module).map((definition) => {
              const added = layout.widgets.some((item) => item.widgetId === definition.id);
              return <button key={definition.id} type="button" disabled={added} onClick={() => addWidget(definition.id)} className="flex w-full items-start justify-between gap-3 rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-3 text-left hover:bg-ds-muted disabled:opacity-55">
                <span><span className="block text-sm font-extrabold text-ds-ink">{definition.title}</span><span className="mt-0.5 block text-xs text-ds-ink-muted">{definition.preview}</span></span>
                <span className="text-xs font-bold text-ds-accent-ink">{added ? "Adicionado" : "Adicionar"}</span>
              </button>;
            })}
          </PanelSection>)}
        </div> : selectedDefinition && selectedPlacement ? <>
          <PanelSection title="Painel" aside="Visível somente para você">
            <Input value={layout.name} maxLength={80} onChange={(event) => renamePanel(event.target.value)} aria-label="Nome do painel" />
          </PanelSection>
          <PanelSection title="Tamanho" aside="Desktop, tablet e celular">
            <div className="grid grid-cols-1 gap-2">{selectedDefinition.allowedSizes.map((size) => <Button key={`${size.w}x${size.h}`} variant={selectedPlacement.layouts.desktop.w === size.w && selectedPlacement.layouts.desktop.h === size.h ? "primary-modal" : "ds-secondary"} size="md" onClick={() => resizeSelected(size.w, size.h)}>{size.label} · {size.w}×{size.h}</Button>)}</div>
          </PanelSection>
          <PanelSection title="Ações">
            <Button variant="danger-link" size="md" disabled={layout.lockedWidgetIds.includes(selectedPlacement.instanceId)} onClick={removeSelected}><Trash2 className="h-4 w-4" />Remover widget</Button>
          </PanelSection>
        </> : null}
      </SidePanel>
    </BuilderContext.Provider>
  );
}

export function ManagementWidgetFrame({ id, children, className }: { id: ManagementWidgetId; children: ReactNode; className?: string }) {
  const state = useContext(BuilderContext);
  const placement = state?.layout.widgets.find((item) => item.widgetId === id);
  const sortable = useSortable({ id, disabled: !state?.editing || !placement });
  if (state && !placement) return null;
  const selected = !!placement && placement.instanceId === state?.selectedId;
  const order = placement ? state?.layout.widgets.indexOf(placement) : undefined;
  const spanClasses = placement ? `${tabletSpan[Math.min(6, placement.layouts.tablet.w)]} ${desktopSpan[Math.min(12, placement.layouts.desktop.w)]}` : "md:col-span-3 xl:col-span-6";
  return <div ref={sortable.setNodeRef} data-widget-id={id} style={{ order, transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className={cn("relative min-w-0 col-span-1", spanClasses, className, state?.editing && "rounded-ds-btn-lg ring-2 ring-ds-accent", selected && "ring-4")} onClick={state?.editing ? () => { state.select(placement?.instanceId ?? null); state.openSettings(); } : undefined}>
    {state?.editing ? <button type="button" aria-label="Mover widget" className="absolute right-3 top-3 z-20 flex h-8 w-8 cursor-grab items-center justify-center rounded-ds-sm bg-ds-dark text-white shadow-md" {...sortable.attributes} {...sortable.listeners}><GripVertical className="h-4 w-4" /></button> : null}
    {children}
  </div>;
}
