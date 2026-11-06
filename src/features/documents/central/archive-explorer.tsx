"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Building2, ChevronDown, ChevronRight, File, FileImage, FileSpreadsheet, FileStack, FileText, Folder, FolderOpen, HardDrive, Loader2, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { SortHeader } from "@/components/patterns/sort-header";
import { Segmented } from "@/components/patterns/segmented";
import { LiftRow } from "@/components/patterns/lift-row";
import { PanelField, SidePanel } from "@/components/patterns/side-panel";
import { sortArchiveEntries, type ArchiveSort } from "@/lib/documents/archive-entry-sort";
import {
  ARCHIVE_VIEW_MODE_LABELS,
  ARCHIVE_VIEW_MODE_STORAGE_KEY,
  ARCHIVE_VIEW_MODES,
  DEFAULT_ARCHIVE_VIEW_MODE,
  archiveFileKind,
  nextCascadeStack,
  parseArchiveViewMode,
  type ArchiveViewMode,
  type CascadeColumn,
} from "@/lib/documents/archive-view-mode";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { companyArchiveFolderLabel, companyArchiveHref } from "@/lib/documents/company-archive-navigation";
import { DocumentCreateLink } from "./document-create-link";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { warmPdfjs } from "@/lib/pdf/pdfjs-client";
import { ArchivePreviewVariantContext } from "./archive-preview";

export type ArchiveArea = "company" | "collaborators" | "financial" | "models" | "published";
export type ArchiveAction = { label: string; run: () => void; destructive?: boolean };
export type ArchiveEntry = { id: string; name: string; kind: "folder" | "file" | "model"; description?: string; modified?: string; size?: string; modifiedAt?: number | null; sizeBytes?: number | null; mimeType?: string | null; open: () => void; loadPreview?: () => void; actions?: ArchiveAction[] };
export type ArchiveFolder = { id: string; name: string; active?: boolean; depth?: number; open: () => void };
export const ARCHIVE_AREAS = [
  { id: "company" as const, name: "Empresa", description: "Arquivos internos e pastas dos colaboradores", icon: Building2 },
  { id: "published" as const, name: "Colaboradores", description: "Documentos publicados por titular", icon: FolderOpen },
];

export function useCompanyArchiveAccess() {
  const { permissions, isDefaultAdmin } = useAuth();
  return {
    documents: hasFormalizationPermission(permissions, "companyDocuments.view", isDefaultAdmin),
    financial: isDefaultAdmin || Boolean(permissions.financial?.view && permissions.financial?.inbox?.view),
    models: hasFormalizationPermission(permissions, "templates.view", isDefaultAdmin),
    people: isDefaultAdmin || Boolean(permissions.settings?.manageUsers || permissions.dp?.collaborators?.view && !permissions.dp?.collaborators?.ownProfileOnly),
  };
}

export function useArchiveAreas() {
  const access = useCompanyArchiveAccess();
  return ARCHIVE_AREAS.filter((area) => area.id === "published" || access.documents || access.financial || access.models || access.people);
}
export function archiveAreaHref(area: ArchiveArea) { return `/dashboard/documents/${area}`; }

/* ---------- Modo de visualização (salvo neste navegador) ---------- */

const modeListeners = new Set<() => void>();
let memoryMode: ArchiveViewMode = DEFAULT_ARCHIVE_VIEW_MODE;
function subscribeMode(listener: () => void) {
  modeListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { modeListeners.delete(listener); window.removeEventListener("storage", listener); };
}
function readMode(): ArchiveViewMode {
  try {
    const stored = window.localStorage.getItem(ARCHIVE_VIEW_MODE_STORAGE_KEY);
    return stored ? parseArchiveViewMode(stored) : memoryMode;
  } catch { return memoryMode; }
}
function writeMode(mode: ArchiveViewMode) {
  memoryMode = mode;
  try { window.localStorage.setItem(ARCHIVE_VIEW_MODE_STORAGE_KEY, mode); } catch { /* sem armazenamento: vale só nesta aba */ }
  modeListeners.forEach((listener) => listener());
}
export function useArchiveViewMode(): [ArchiveViewMode, (mode: ArchiveViewMode) => void] {
  const mode = useSyncExternalStore(subscribeMode, readMode, () => DEFAULT_ARCHIVE_VIEW_MODE);
  return [mode, writeMode];
}

/* ---------- Moldura comum: título e abas Pastas | Ficha do colaborador ---------- */

export function ArchiveShell({ tab, children }: { tab: "folders" | "ficha"; children: ReactNode }) {
  const access = useCompanyArchiveAccess();
  const showFolders = access.documents || access.financial || access.models || access.people;
  const tabClass = (active: boolean) => cn(
    "inline-flex h-10 items-center border-b-2 px-3 text-[13px] font-bold transition-colors",
    active ? "border-ds-accent text-ds-ink" : "border-transparent text-ds-ink-muted hover:text-ds-ink",
  );
  return <PageContainer variant="wide">
    {/* Sem overflow-hidden: o LiftRow precisa mostrar a sombra ao sair da lista. */}
    <div className="rounded-ds-card border border-ds-border bg-ds-surface font-ds">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-ds-border px-4 pt-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
          <h1 className="flex h-10 items-center gap-2 text-xl font-extrabold tracking-tight text-ds-ink"><HardDrive aria-hidden="true" className="h-5 w-5 text-ds-ink-muted" />Acervo</h1>
          <nav aria-label="Seções do Acervo" className="flex gap-1">
            {showFolders && <Link href="/dashboard/documents" aria-current={tab === "folders" ? "page" : undefined} className={tabClass(tab === "folders")}>Pastas</Link>}
            <Link href="/dashboard/documents/published" aria-current={tab === "ficha" ? "page" : undefined} className={tabClass(tab === "ficha")}>Ficha do colaborador</Link>
          </nav>
        </div>
        <div className="pb-2"><DocumentCreateLink /></div>
      </header>
      {children}
    </div>
  </PageContainer>;
}

/* ---------- Ícones neutros pelo tipo ---------- */

export function ArchiveEntryIcon({ entry, open = false, className }: { entry: Pick<ArchiveEntry, "kind" | "name" | "mimeType">; open?: boolean; className?: string }) {
  const classes = cn("shrink-0 text-ds-ink-muted", className);
  if (entry.kind === "folder") return open ? <FolderOpen aria-hidden="true" className={classes} /> : <Folder aria-hidden="true" className={classes} />;
  if (entry.kind === "model") return <FileStack aria-hidden="true" className={classes} />;
  const kind = archiveFileKind(entry.name, entry.mimeType);
  if (kind === "image") return <FileImage aria-hidden="true" className={classes} />;
  if (kind === "sheet") return <FileSpreadsheet aria-hidden="true" className={classes} />;
  if (kind === "pdf" || kind === "text") return <FileText aria-hidden="true" className={classes} />;
  return <File aria-hidden="true" className={classes} />;
}

/* ---------- Trilha em pílula: a forma de voltar para qualquer pasta anterior ---------- */

type Crumb = { name: string; href?: string; open?: () => void };
export function ArchiveCrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const item = "inline-flex h-[30px] items-center whitespace-nowrap rounded-[9px] px-2.5 text-[13px] font-semibold";
  return <nav aria-label="Caminho da pasta" className="inline-flex min-w-0 max-w-full items-center overflow-x-auto rounded-ds-md border border-ds-border bg-ds-surface p-[3px]">
    {crumbs.map((crumb, index) => {
      const last = index === crumbs.length - 1;
      return <span key={`${crumb.name}:${index}`} className="flex items-center">
        {index > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ds-ink-faint" />}
        {last ? <span aria-current="page" className={cn(item, "text-ds-ink")}>{crumb.name}</span>
          : crumb.href ? <Link href={crumb.href} className={cn(item, "text-ds-ink-muted hover:bg-ds-muted hover:text-ds-ink")}>{crumb.name}</Link>
          : <button type="button" onClick={crumb.open} disabled={!crumb.open} className={cn(item, "text-ds-ink-muted hover:bg-ds-muted hover:text-ds-ink disabled:hover:bg-transparent")}>{crumb.name}</button>}
      </span>;
    })}
  </nav>;
}

const entryLabel = (entry: ArchiveEntry) => `${entry.kind === "folder" ? "Pasta" : entry.kind === "model" ? "Modelo" : "Arquivo"}: ${entry.name}`;
const entryDomId = (entry: ArchiveEntry) => "archive-entry-" + encodeURIComponent(entry.id);

export function ArchiveExplorer({ area = null, entries, breadcrumbs = [], search, onSearch, loading, refreshing, error, toolbar, onRefresh, onUp, onRoot, preview, onSelect, footer, selectionScope = "", hasMorePages = false }: {
  area?: ArchiveArea | null; entries: ArchiveEntry[];
  /** Mantido por compatibilidade; a árvore lateral saiu com os modos de visualização (decisão 0007). */
  folders?: ArchiveFolder[];
  breadcrumbs?: Array<{ name: string; open?: () => void }>;
  search: string; onSearch: (value: string) => void; loading?: boolean; refreshing?: boolean; error?: string | null; toolbar?: ReactNode;
  onRefresh?: () => void; onUp?: () => void; onRoot?: () => void; preview?: (entry: ArchiveEntry) => ReactNode; onSelect?: (entry: ArchiveEntry | null) => void; footer?: ReactNode; selectionScope?: string; hasMorePages?: boolean;
}) {
  const [mode, setMode] = useArchiveViewMode();
  const hasPreviewable = entries.some((entry) => entry.loadPreview);
  // Baixa e inicia o leitor de PDF enquanto a pessoa escolhe o arquivo; não lê documento algum.
  useEffect(() => { if (hasPreviewable) warmPdfjs(); }, [hasPreviewable]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState(selectionScope);
  const previousScope = useRef(selectionScope);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sort, setSort] = useState<ArchiveSort>("title-asc");
  const [expanded, setExpanded] = useState(false);
  const [cascade, setCascade] = useState<CascadeColumn<ArchiveEntry>[]>([]);
  const orderedEntries = useMemo(() => sortArchiveEntries(entries, sort), [entries, sort]);
  const showMetadataColumns = entries.some((entry) => entry.kind !== "folder");
  const selected = selectedScope === selectionScope ? entries.find((entry) => entry.id === selectedId) ?? null : null;

  useEffect(() => {
    if (previousScope.current !== selectionScope) {
      previousScope.current = selectionScope;
      setSelectedId(null); setExpanded(false); setMenuId(null); setPanelOpen(false);
      setCascade((stack) => nextCascadeStack(stack, { type: "arrived", scope: selectionScope }));
      return;
    }
    if (selectedId && !entries.some((entry) => entry.id === selectedId)) {
      setSelectedId(null); setExpanded(false); setMenuId(null); setPanelOpen(false); onSelect?.(null);
    }
  }, [entries, onSelect, selectedId, selectionScope]);
  useEffect(() => {
    if (!showMetadataColumns && !sort.startsWith("title")) setSort("title-asc");
  }, [showMetadataColumns, sort]);

  const select = (entry: ArchiveEntry) => {
    setSelectedId(entry.id); setSelectedScope(selectionScope);
    if (selectedId !== entry.id || selectedScope !== selectionScope) { setExpanded(false); onSelect?.(entry); entry.loadPreview?.(); }
  };
  const clearSelection = () => { setSelectedId(null); setExpanded(false); setPanelOpen(false); onSelect?.(null); };
  const enterFolder = (entry: ArchiveEntry) => {
    setCascade((stack) => nextCascadeStack(stack, { type: "open-from-current", scope: selectionScope, entries: orderedEntries, activeId: entry.id, nextScope: `${selectionScope}\u0000${entry.id}` }));
    clearSelection(); entry.open();
  };
  /** Abrir: pasta entra; arquivo abre conforme o modo (painel, prévia ampliada ou seleção na cascata). */
  const activate = (entry: ArchiveEntry, intent: "click" | "open" = "click") => {
    if (entry.kind === "folder") { enterFolder(entry); return; }
    select(entry);
    if (mode === "panel") { setPanelOpen(true); return; }
    if (mode === "cascade" && intent === "click") return;
    if (entry.loadPreview) setExpanded(true); else entry.open();
  };
  const changeSort = (field: "title" | "modified" | "size") => setSort(current => current.startsWith(field) ? `${field}-${current.endsWith("asc") ? "desc" : "asc"}` : `${field}-asc`);
  const direction = sort.endsWith("asc") ? "asc" : "desc";
  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, entry: ArchiveEntry) => {
    if (event.altKey && event.key === "ArrowUp") { event.preventDefault(); onUp?.(); return; }
    if (event.key === "Enter") { event.preventDefault(); activate(entry, "open"); }
    else if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") { event.preventDefault(); select(entry); if (mode === "panel" && entry.kind !== "folder") setPanelOpen(true); else setMenuId(entry.id); }
    else if (event.key === "Escape") clearSelection();
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = orderedEntries.findIndex((item) => item.id === entry.id);
      const next = event.key === "Home" ? 0 : event.key === "End" ? orderedEntries.length - 1 : Math.max(0, Math.min(orderedEntries.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      const target = orderedEntries[next];
      if (target) { if (mode === "cascade" && target.kind !== "folder") select(target); window.document.getElementById(entryDomId(target))?.focus(); }
    }
    else if (event.key === "F2") { const rename = entry.actions?.find((action) => action.label === "Renomear"); if (rename) { event.preventDefault(); rename.run(); } }
  };
  const runAction = (action: ArchiveAction) => { setPanelOpen(false); action.run(); };

  const nestedInCompany = area === "financial" || area === "models" || area === "collaborators";
  const areaName = nestedInCompany ? companyArchiveFolderLabel(area === "financial" ? "Financeiro" : area === "models" ? "Modelos" : "Colaboradores") : ARCHIVE_AREAS.find((entry) => entry.id === area)?.name;
  const crumbs: Crumb[] = [
    { name: "Acervo", href: "/dashboard/documents" },
    ...(nestedInCompany ? [{ name: "Empresa", href: companyArchiveHref() }] : []),
    ...(areaName ? [{ name: areaName, open: onRoot, href: onRoot ? undefined : archiveAreaHref(area!) }] : []),
    ...breadcrumbs,
  ];
  const currentFolderName = crumbs.at(-1)?.name ?? "Acervo";
  const fileCols = "md:grid-cols-[minmax(0,1fr)_130px_90px]";
  const classicCols = "grid-cols-[minmax(0,1fr)_40px] md:grid-cols-[minmax(0,1fr)_130px_90px_40px]";

  const menuFor = (entry: ArchiveEntry, trigger: ReactNode) => <DropdownMenu open={menuId === entry.id} onOpenChange={(value) => setMenuId(value ? entry.id : null)}>
    <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => activate(entry, "open")}>{entry.kind === "folder" ? "Abrir pasta" : entry.loadPreview ? "Visualizar" : "Abrir"}</DropdownMenuItem>
      {entry.actions?.map((action) => <DropdownMenuItem key={action.label} className={action.destructive ? "text-ds-danger" : ""} onSelect={action.run}>{action.label}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;

  const sortHeader = (withMenuColumn: boolean) => <div className={cn("grid gap-3 border-b border-ds-border bg-ds-muted px-[18px] py-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-ds-ink-faint",
    withMenuColumn ? classicCols : "grid-cols-[minmax(0,1fr)]", showMetadataColumns ? (withMenuColumn ? "" : fileCols) : withMenuColumn ? "md:grid-cols-[minmax(0,1fr)_40px]" : "")}>
    <SortHeader label="Título" active={sort.startsWith("title")} direction={direction} onClick={() => changeSort("title")} />
    {showMetadataColumns && <><SortHeader className="hidden md:block" label="Modificado" active={sort.startsWith("modified")} direction={direction} onClick={() => changeSort("modified")} /><SortHeader className="hidden md:block" label="Tamanho" active={sort.startsWith("size")} direction={direction} onClick={() => changeSort("size")} /></>}
    {withMenuColumn && <span />}
  </div>;

  const nameCell = (entry: ArchiveEntry) => <span className="flex min-w-0 items-center gap-3">
    <ArchiveEntryIcon entry={entry} className={entry.kind === "folder" ? "h-6 w-6" : "h-5 w-5"} />
    <span className="min-w-0"><span className={cn("block break-words text-[13px] text-ds-ink", entry.kind === "folder" ? "font-extrabold" : "font-semibold")}>{entry.name}</span>{entry.description && <span className="mt-0.5 block truncate text-[11.5px] text-ds-ink-faint">{entry.description}</span>}</span>
  </span>;
  const metaCells = (entry: ArchiveEntry) => showMetadataColumns ? <><span className="hidden text-[12px] tabular-nums text-ds-ink-muted md:block">{entry.kind === "folder" ? "" : entry.modified || ""}</span><span className="hidden text-[12px] tabular-nums text-ds-ink-muted md:block">{entry.kind === "folder" ? "" : entry.size || ""}</span></> : null;

  const panelView = <div role="group" aria-label="Itens da pasta">
    {sortHeader(false)}
    {orderedEntries.map((entry) => <LiftRow key={entry.id} id={entryDomId(entry)} role="button" aria-label={entryLabel(entry)} table selected={selected?.id === entry.id}
      onClick={() => activate(entry)} onKeyDown={(event) => onRowKeyDown(event, entry)}
      onContextMenu={(event) => { event.preventDefault(); activate(entry); }}
      className={cn("grid items-center gap-3", showMetadataColumns ? fileCols : "")}>
      {nameCell(entry)}{metaCells(entry)}
    </LiftRow>)}
  </div>;

  const classicView = <div>
    {sortHeader(true)}
    {(area || breadcrumbs.length > 0) && <div className="flex items-center gap-3 border-b border-ds-divider px-[18px] py-[11px]">
      <FolderOpen aria-hidden="true" className="h-6 w-6 shrink-0 text-ds-ink-muted" />
      <span className="rounded-ds-pill bg-ds-accent-soft px-2 py-0.5 text-[11px] font-bold text-ds-accent-ink">Pasta atual</span>
      <span className="min-w-0 truncate text-[13px] font-semibold text-ds-ink-muted">{currentFolderName}</span>
    </div>}
    {orderedEntries.map((entry) => <div key={entry.id} onContextMenu={(event) => { event.preventDefault(); select(entry); setMenuId(entry.id); }}
      className={cn("relative grid items-center gap-3 border-b border-ds-divider px-[18px] py-2 hover:bg-ds-muted", classicCols, !showMetadataColumns && "md:grid-cols-[minmax(0,1fr)_40px]", selected?.id === entry.id && "bg-ds-accent-row shadow-[inset_3px_0_0_var(--ds-accent-ink)]")}>
      <button type="button" id={entryDomId(entry)} aria-label={entryLabel(entry)} aria-pressed={selected?.id === entry.id} onClick={() => activate(entry, "open")} onKeyDown={(event) => onRowKeyDown(event, entry)}
        className="min-w-0 rounded-ds-sm py-1 text-left hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink">{nameCell(entry)}</button>
      {metaCells(entry)}
      {menuFor(entry, <Button variant="ds-ghost" size="icon" aria-label={`Ações de ${entry.name}`} className="h-8 w-8" onClick={() => select(entry)}><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></Button>)}
    </div>)}
  </div>;

  const detailsBlock = (entry: ArchiveEntry, layout: "panel" | "column") => <>
    {(entry.modified || entry.size) && <div className="grid grid-cols-2 gap-3">{entry.modified && <PanelField label="Modificado">{entry.modified}</PanelField>}{entry.size && <PanelField label="Tamanho">{entry.size}</PanelField>}</div>}
    <div className={cn("grid gap-2", layout === "panel" ? "grid-cols-2" : "grid-cols-1")}>
      {entry.loadPreview ? <Button variant="ds-secondary" size="md" onClick={() => { setPanelOpen(false); setExpanded(true); }}>Ampliar prévia</Button>
        : <Button variant="ds-secondary" size="md" onClick={() => entry.open()}>Abrir arquivo</Button>}
      {entry.actions?.filter((action) => !action.destructive).map((action) => <Button key={action.label} variant="ds-secondary" size="md" onClick={() => runAction(action)}>{action.label}</Button>)}
    </div>
    {entry.actions?.filter((action) => action.destructive).map((action) => <Button key={action.label} variant="danger-link" size="xs" className="justify-start px-0" onClick={() => runAction(action)}>{action.label}</Button>)}
  </>;

  const cascadeView = <div className="flex min-h-[520px] overflow-x-auto">
    {cascade.map((column, columnIndex) => <div key={column.scope + ":" + columnIndex} role="group" aria-label={`Coluna ${columnIndex + 1}`} className="flex w-[220px] shrink-0 flex-col gap-0.5 border-r border-ds-border p-2">
      {column.entries.filter((entry) => entry.kind === "folder").map((entry) => {
        const active = entry.id === column.activeId;
        return <button key={entry.id} type="button" aria-current={active ? "true" : undefined}
          onClick={() => { setCascade((stack) => nextCascadeStack(stack, { type: "open-from-column", columnIndex, activeId: entry.id, nextScope: entry.id })); clearSelection(); entry.open(); }}
          className={cn("flex items-center gap-2 rounded-ds-sm px-2 py-1.5 text-left text-[12.5px]", active ? "bg-ds-muted font-bold text-ds-ink" : "text-ds-ink-2 hover:bg-ds-muted")}>
          <ArchiveEntryIcon entry={entry} open={active} className="h-4 w-4" /><span className="min-w-0 flex-1 truncate">{entry.name}</span>{active && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ds-ink-faint" />}
        </button>;
      })}
    </div>)}
    <div role="group" aria-label="Itens da pasta" className="flex w-[260px] shrink-0 flex-col gap-0.5 border-r border-ds-border p-2">
      {orderedEntries.map((entry) => <button key={entry.id} type="button" id={entryDomId(entry)} aria-label={entryLabel(entry)} aria-pressed={selected?.id === entry.id}
        onClick={() => activate(entry)} onDoubleClick={() => activate(entry, "open")} onKeyDown={(event) => onRowKeyDown(event, entry)}
        onContextMenu={(event) => { event.preventDefault(); activate(entry); }}
        className={cn("flex items-center gap-2 rounded-ds-sm px-2 py-1.5 text-left text-[12.5px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink", selected?.id === entry.id ? "bg-ds-accent-soft font-bold text-ds-accent-ink" : "text-ds-ink-2 hover:bg-ds-muted")}>
        <ArchiveEntryIcon entry={entry} className="h-4 w-4" /><span className="min-w-0 flex-1 truncate">{entry.name}</span>{entry.kind === "folder" && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ds-ink-faint" />}
      </button>)}
    </div>
    <aside aria-label="Prévia e detalhes" className="flex min-w-[300px] flex-1 flex-col gap-4 bg-ds-warm p-4">
      {selected ? <><p className="break-words text-sm font-extrabold text-ds-ink">{selected.name}</p>{!expanded && (preview ? preview(selected) : <p className="text-xs text-ds-ink-muted">{selected.description}</p>)}{expanded && <p className="text-xs text-ds-ink-muted">Prévia ampliada para leitura.</p>}{detailsBlock(selected, "column")}</>
        : <p className="pt-6 text-center text-xs text-ds-ink-faint">Selecione um arquivo para ver a prévia e os detalhes.</p>}
    </aside>
  </div>;

  const hint = mode === "panel" ? "Clique para abrir · Alt+↑ sobe uma pasta" : mode === "classic" ? "Clique no nome para abrir · ⋯ mostra as ações" : "Clique numa pasta para abrir a próxima coluna · Enter amplia a prévia";

  return <ArchiveShell tab="folders">
    <div className="flex flex-wrap items-center gap-2 border-b border-ds-border px-4 py-3">
      <ArchiveCrumbs crumbs={crumbs} />
      <span className="hidden flex-1 lg:block" />
      <div className="relative w-full sm:w-60"><Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" /><Input aria-label="Buscar nesta pasta" placeholder="Buscar nesta pasta…" value={search} onChange={(event) => onSearch(event.target.value)} className="h-9 bg-ds-surface pl-8 text-xs" /></div>
      <div className="relative"><select aria-label="Ordenar documentos" value={sort} onChange={(event) => setSort(event.target.value as ArchiveSort)} className="h-9 appearance-none rounded-ds-sm border border-ds-border-input bg-ds-surface pl-2 pr-10 text-xs"><option value="title-asc">Título: A–Z</option><option value="title-desc">Título: Z–A</option>{showMetadataColumns && <><option value="modified-asc">Modificado: mais antigo</option><option value="modified-desc">Modificado: mais recente</option><option value="size-asc">Tamanho: menor</option><option value="size-desc">Tamanho: maior</option></>}</select><span className="pointer-events-none absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-ds-sm border border-ds-border bg-ds-surface"><ChevronDown aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} /></span></div>
      <Segmented aria-label="Modo de visualização" value={mode} onChange={setMode} options={ARCHIVE_VIEW_MODES.map((value) => ({ value, label: ARCHIVE_VIEW_MODE_LABELS[value] }))} />
      {onRefresh && <Button size="icon" variant="ds-ghost" aria-label="Atualizar pasta" disabled={loading || refreshing} onClick={onRefresh}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /></Button>}{toolbar}
    </div>
    <main aria-label="Conteúdo da pasta" className="min-w-0">
      {error && <p role="alert" className="m-3 rounded-ds-md border border-ds-confirm-border bg-ds-confirm-bg p-3 text-sm text-ds-confirm-ink">{error}</p>}
      {loading ? <div role="status" className="grid min-h-64 place-items-center"><Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-ds-ink-muted" /><span className="sr-only">Carregando pasta</span></div> : <>
        {mode === "panel" ? panelView : mode === "classic" ? classicView : cascadeView}
        {entries.length === 0 && !error && mode !== "cascade" && <div className="grid min-h-64 place-items-center p-6 text-center"><div><Folder aria-hidden="true" className="mx-auto h-10 w-10 text-ds-disabled" /><p className="mt-3 text-sm text-ds-ink-muted">{hasMorePages ? (search ? "Nenhum item encontrado nas páginas carregadas." : "Nenhum item nas páginas carregadas.") : search ? "Nenhum item encontrado nesta pasta." : "Esta pasta está vazia."}</p></div></div>}
      </>}
      {footer}<p className="px-4 py-3 text-[11px] text-ds-ink-faint">{entries.length} {entries.length === 1 ? "item" : "itens"} · {hint}</p>
    </main>
    <SidePanel open={mode === "panel" && panelOpen && Boolean(selected) && selected?.kind !== "folder"} onOpenChange={setPanelOpen}
      kicker={selected?.kind === "model" ? "Modelo" : "Arquivo"} title={selected?.name ?? "Documento"} subtitle={selected?.description}>
      {selected && <>
        <div aria-label="Prévia e detalhes" role="region" className="flex flex-col gap-3">{preview ? preview(selected) : null}</div>
        {detailsBlock(selected, "panel")}
      </>}
    </SidePanel>
    <Dialog open={expanded && Boolean(selected?.loadPreview)} onOpenChange={setExpanded}><DialogContent className="flex max-h-[90vh] max-w-[min(1000px,95vw)] sm:max-w-[min(1000px,95vw)] flex-col overflow-auto"><DialogHeader><DialogTitle className="break-words">{selected?.name ?? "Documento"}</DialogTitle></DialogHeader>{error && <p role="alert" className="rounded-ds-sm border border-ds-confirm-border bg-ds-confirm-bg p-2 text-sm text-ds-confirm-ink">{error}</p>}{selected && <ArchivePreviewVariantContext.Provider value="expanded">{preview?.(selected)}</ArchivePreviewVariantContext.Provider>}</DialogContent></Dialog>
  </ArchiveShell>;
}
