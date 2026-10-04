"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Library,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import type {
  InstagramMediaFolder,
  InstagramMediaLibraryItem,
  InstagramMediaLibraryKind,
  InstagramScheduleListItem,
} from "./contracts";
import {
  DeleteFolderDialog,
  FolderNameDialog,
  MoveToFolderDialog,
} from "./media-folder-dialogs";
import {
  buildFolderTree,
  folderPath,
  isFolderDescendant,
  type InstagramMediaFolderNode,
} from "./media-folders";
import { ProtectedMedia } from "./protected-media";
import {
  dateKeyInBelem,
  instagramPostTitle,
  longDate,
} from "./workspace-utils";

const MEDIA_DRAG_TYPE = "application/x-coala-media";
const FOLDER_DRAG_TYPE = "application/x-coala-folder";

type WorkspaceMediaItem = {
  id: string;
  /** ID do documento da biblioteca; ausente nos arquivos que vêm dos agendamentos. */
  libraryId: string | null;
  name: string;
  kind: InstagramMediaLibraryKind;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  previewUrl: string | null;
  uses: Array<{ id: string; title: string; date: string }>;
};

type Dialog =
  | { type: "create"; parentId: string | null }
  | { type: "rename"; folder: InstagramMediaFolder }
  | { type: "move-folder"; folder: InstagramMediaFolder }
  | { type: "move-media"; ids: string[] }
  | { type: "delete"; folder: InstagramMediaFolder };

type MediaLibraryViewProps = {
  folders: InstagramMediaFolder[];
  currentFolderId: string | null;
  libraryItems: InstagramMediaLibraryItem[];
  hasMore: boolean;
  schedules: InstagramScheduleListItem[];
  loading: boolean;
  uploading: boolean;
  onOpenFolder: (folderId: string | null) => void;
  onLoadMore: () => void;
  onUpload: (files: File[], folderId: string | null) => Promise<void>;
  onCreateFolder: (name: string, parentId: string | null) => Promise<boolean>;
  onRenameFolder: (id: string, name: string) => Promise<boolean>;
  onMoveFolder: (id: string, parentId: string | null) => Promise<boolean>;
  onDeleteFolder: (id: string) => Promise<boolean>;
  onMoveMedia: (ids: string[], folderId: string | null) => Promise<boolean>;
  onFutureFeature: (label: string) => void;
};

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaLibraryView({
  folders,
  currentFolderId,
  libraryItems,
  hasMore,
  schedules,
  loading,
  uploading,
  onOpenFolder,
  onLoadMore,
  onUpload,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onMoveMedia,
  onFutureFeature,
}: MediaLibraryViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | InstagramMediaLibraryKind>("all");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [scheduledView, setScheduledView] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const path = useMemo(() => folderPath(folders, currentFolderId), [folders, currentFolderId]);
  const currentFolder = path[path.length - 1] ?? null;
  const subfolders = useMemo(
    () => folders
      .filter((folder) => folder.parentId === currentFolderId)
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" })),
    [folders, currentFolderId],
  );

  const media = useMemo<WorkspaceMediaItem[]>(() => {
    if (scheduledView) {
      return schedules.flatMap((schedule) => schedule.media.map((item, index) => ({
        id: `scheduled:${schedule.id}:${index}`,
        libraryId: null,
        name: item.fileName,
        kind: item.kind,
        contentType: item.contentType,
        sizeBytes: item.sizeBytes,
        width: item.width,
        height: item.height,
        previewUrl: item.previewUrl,
        uses: [{
          id: schedule.id,
          title: instagramPostTitle(schedule),
          date: longDate(dateKeyInBelem(schedule.scheduledAt)),
        }],
      })));
    }
    return libraryItems.map((item) => ({
      id: `library:${item.id}`,
      libraryId: item.id,
      name: item.fileName,
      kind: item.kind,
      contentType: item.contentType,
      sizeBytes: item.sizeBytes,
      width: item.width,
      height: item.height,
      previewUrl: item.previewUrl,
      uses: [],
    }));
  }, [libraryItems, schedules, scheduledView]);

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return media.filter((item) => {
      if (kind !== "all" && item.kind !== kind) return false;
      if (unusedOnly && item.uses.length > 0) return false;
      return !normalizedQuery || item.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
    });
  }, [kind, media, query, unusedOnly]);
  const selected = media.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  const showFolders = !scheduledView && !query.trim();

  function openFolder(folderId: string | null) {
    setScheduledView(false);
    setChecked(new Set());
    setSelectedId(null);
    onOpenFolder(folderId);
  }

  function toggleChecked(libraryId: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(libraryId)) next.delete(libraryId);
      else next.add(libraryId);
      return next;
    });
  }

  async function uploadSelection(files: FileList | null) {
    if (!files?.length) return;
    await onUpload(Array.from(files).slice(0, 10), currentFolderId);
    if (inputRef.current) inputRef.current.value = "";
  }

  function dragMedia(event: DragEvent, libraryId: string) {
    const ids = checked.has(libraryId) ? [...checked] : [libraryId];
    event.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(ids));
    event.dataTransfer.effectAllowed = "move";
  }

  function dragFolder(event: DragEvent, folderId: string) {
    event.dataTransfer.setData(FOLDER_DRAG_TYPE, folderId);
    event.dataTransfer.effectAllowed = "move";
  }

  function allowDrop(event: DragEvent, key: string) {
    if (scheduledView) return;
    const types = Array.from(event.dataTransfer.types);
    if (!types.includes(MEDIA_DRAG_TYPE) && !types.includes(FOLDER_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(key);
  }

  async function dropOn(event: DragEvent, targetFolderId: string | null) {
    event.preventDefault();
    setDropTarget(null);
    const mediaPayload = event.dataTransfer.getData(MEDIA_DRAG_TYPE);
    if (mediaPayload) {
      try {
        const ids = JSON.parse(mediaPayload) as string[];
        if (Array.isArray(ids) && ids.length && (await onMoveMedia(ids, targetFolderId))) setChecked(new Set());
      } catch {
        /* payload externo ou inválido: ignora */
      }
      return;
    }
    const folderId = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
    if (!folderId || folderId === targetFolderId) return;
    const dragged = folders.find((folder) => folder.id === folderId);
    if (!dragged || dragged.parentId === targetFolderId) return;
    if (targetFolderId !== null && isFolderDescendant(folders, folderId, targetFolderId)) return;
    await onMoveFolder(folderId, targetFolderId);
  }

  const dropClass = (key: string) => (dropTarget === key ? "outline outline-2 outline-[#D90F6F]" : "");
  const dropProps = (key: string, targetFolderId: string | null) => ({
    onDragOver: (event: DragEvent) => allowDrop(event, key),
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (event: DragEvent) => void dropOn(event, targetFolderId),
  });

  function renderTreeNode(node: InstagramMediaFolderNode) {
    const open = !collapsed.has(node.id) || path.some((folder) => folder.id === node.id && folder.id !== currentFolderId);
    const active = !scheduledView && currentFolderId === node.id;
    return (
      <li key={node.id}>
        <div
          className={`flex items-center rounded-lg ${active ? "bg-white font-extrabold shadow-sm" : "hover:bg-white/70"} ${dropClass(`tree:${node.id}`)}`}
          style={{ paddingLeft: (node.depth - 1) * 12 }}
          draggable
          onDragStart={(event) => dragFolder(event, node.id)}
          {...dropProps(`tree:${node.id}`, node.id)}
        >
          <button
            type="button"
            aria-label={open ? "Recolher" : "Expandir"}
            disabled={node.children.length === 0}
            onClick={() => setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(node.id)) next.delete(node.id);
              else next.add(node.id);
              return next;
            })}
            className="grid h-7 w-5 shrink-0 place-items-center text-[#7A5646] disabled:opacity-0"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
          <button
            type="button"
            aria-pressed={active}
            onClick={() => openFolder(node.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pr-2 text-left text-[13px]"
          >
            {active ? <FolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Folder className="h-4 w-4 shrink-0 text-[#7A5646]" aria-hidden="true" />}
            <span className="truncate">{node.name}</span>
          </button>
        </div>
        {open && node.children.length > 0 && <ul>{node.children.map(renderTreeNode)}</ul>}
      </li>
    );
  }

  const mobileOptions = useMemo(() => {
    const flat: Array<{ id: string | null; label: string }> = [{ id: null, label: "Biblioteca (raiz)" }];
    const walk = (nodes: InstagramMediaFolderNode[]) => nodes.forEach((node) => {
      flat.push({ id: node.id, label: `${"— ".repeat(node.depth - 1)}${node.name}` });
      walk(node.children);
    });
    walk(tree);
    return flat;
  }, [tree]);

  const iconButton =
    "flex h-9 items-center gap-1.5 rounded-[9px] border border-[#EADFD3] bg-white px-3 text-[12px] font-bold text-[#4A1A04] hover:border-[#F462A7] disabled:opacity-50";

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="instagram-media-title">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#EADFD3] px-4 py-4 md:px-7">
        <h1 id="instagram-media-title" className="text-[22px] font-extrabold tracking-tight text-[#4A1A04]">Biblioteca de mídia</h1>
        <label className="relative min-w-[190px] flex-1 sm:max-w-[380px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7A5646]" aria-hidden="true" />
          <span className="sr-only">Buscar por nome</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar nesta pasta…"
            className="h-9 w-full rounded-[9px] border border-[#EADFD3] bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#F462A7]"
          />
        </label>
        <div className="flex rounded-[9px] bg-[#F3E8DC] p-[3px] text-[13px]">
          {([
            ["all", "Tudo"],
            ["image", "Fotos"],
            ["video", "Vídeos"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={`rounded-[7px] px-3 py-1.5 ${kind === value ? "bg-white font-extrabold shadow-sm" : "font-medium"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-[#5E3A28]">
          <input type="checkbox" checked={unusedOnly} onChange={(event) => setUnusedOnly(event.target.checked)} className="accent-[#D90F6F]" />
          Nunca usadas
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDialog({ type: "create", parentId: currentFolderId })}
            disabled={scheduledView}
            className={iconButton}
          >
            <FolderPlus className="h-4 w-4" aria-hidden="true" />
            {currentFolderId ? "Nova subpasta" : "Nova pasta"}
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || scheduledView}
            className="flex h-9 items-center gap-2 rounded-[9px] bg-[#F462A7] px-3.5 text-[13px] font-extrabold text-[#4A1A04] transition hover:bg-[#E9509A] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className={`h-4 w-4 ${uploading ? "animate-pulse" : ""}`} aria-hidden="true" />
            {uploading ? "Enviando…" : "Enviar arquivos"}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            className="sr-only"
            onChange={(event) => void uploadSelection(event.target.files)}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_300px]">
        <aside className="hidden overflow-y-auto border-r border-[#EADFD3] px-3 py-4 lg:block">
          <div className="px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.09em] text-[#7A5646]">Pastas</div>
          <button
            type="button"
            aria-pressed={!scheduledView && currentFolderId === null}
            onClick={() => openFolder(null)}
            {...dropProps("tree:root", null)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] ${!scheduledView && currentFolderId === null ? "bg-white font-extrabold shadow-sm" : "hover:bg-white/70"} ${dropClass("tree:root")}`}
          >
            <Library className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Biblioteca</span>
          </button>
          <ul>{tree.map(renderTreeNode)}</ul>
          <div className="mt-3 border-t border-[#EADFD3] pt-3">
            <button
              type="button"
              aria-pressed={scheduledView}
              onClick={() => { setScheduledView(true); setChecked(new Set()); setSelectedId(null); }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] ${scheduledView ? "bg-white font-extrabold shadow-sm" : "hover:bg-white/70"}`}
            >
              <CalendarClock className="h-4 w-4 shrink-0 text-[#7A5646]" aria-hidden="true" />
              <span className="truncate">Agendamentos</span>
              <span className="ml-auto text-[10px] font-bold text-[#7A5646]">leitura</span>
            </button>
          </div>
        </aside>

        <div className="min-h-0 overflow-y-auto p-4">
          <label className="mb-3 block lg:hidden">
            <span className="sr-only">Pasta</span>
            <select
              value={scheduledView ? "@scheduled" : currentFolderId ?? ""}
              onChange={(event) => {
                if (event.target.value === "@scheduled") {
                  setScheduledView(true);
                  return;
                }
                openFolder(event.target.value || null);
              }}
              className="h-9 w-full rounded-[9px] border border-[#EADFD3] bg-white px-3 text-[13px] font-bold"
            >
              {mobileOptions.map((option) => (
                <option key={option.id ?? "root"} value={option.id ?? ""}>{option.label}</option>
              ))}
              <option value="@scheduled">Agendamentos (leitura)</option>
            </select>
          </label>

          <nav aria-label="Caminho da pasta" className="mb-3 flex flex-wrap items-center gap-1 text-[13px]">
            {scheduledView ? (
              <span className="font-extrabold text-[#4A1A04]">Agendamentos</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openFolder(null)}
                  {...dropProps("crumb:root", null)}
                  className={`rounded px-1.5 py-0.5 font-bold hover:bg-[#F4ECE2] ${path.length === 0 ? "text-[#4A1A04]" : "text-[#7A5646]"} ${dropClass("crumb:root")}`}
                >
                  Biblioteca
                </button>
                {path.map((folder, index) => (
                  <span key={folder.id} className="flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 text-[#7A5646]" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => openFolder(folder.id)}
                      {...dropProps(`crumb:${folder.id}`, folder.id)}
                      className={`rounded px-1.5 py-0.5 font-bold hover:bg-[#F4ECE2] ${index === path.length - 1 ? "text-[#4A1A04]" : "text-[#7A5646]"} ${dropClass(`crumb:${folder.id}`)}`}
                    >
                      {folder.name}
                    </button>
                  </span>
                ))}
              </>
            )}
            {currentFolder && !scheduledView && (
              <span className="ml-auto flex items-center gap-1.5">
                <button type="button" onClick={() => setDialog({ type: "rename", folder: currentFolder })} className={iconButton}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Renomear
                </button>
                <button type="button" onClick={() => setDialog({ type: "move-folder", folder: currentFolder })} className={iconButton}>
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> Mover
                </button>
                <button type="button" onClick={() => setDialog({ type: "delete", folder: currentFolder })} className={`${iconButton} text-[#A52E24]`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Excluir
                </button>
              </span>
            )}
          </nav>

          {scheduledView && (
            <p className="mb-3 rounded-xl border border-[#EADFD3] bg-white px-3 py-2 text-[12px] text-[#7A5646]">
              Estes arquivos pertencem aos agendamentos e não podem ser movidos nem enviados para pastas por aqui.
            </p>
          )}

          {checked.size > 0 && (
            <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#F4A6D0] bg-[#FFF3F9] px-3 py-2 text-[13px]">
              <span className="font-extrabold text-[#4A1A04]">{checked.size} selecionado{checked.size > 1 ? "s" : ""}</span>
              <button type="button" onClick={() => setDialog({ type: "move-media", ids: [...checked] })} className={iconButton}>
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> Mover para…
              </button>
              <button type="button" onClick={() => setChecked(new Set())} className="ml-auto text-[12px] font-bold text-[#7A5646] underline">Limpar seleção</button>
            </div>
          )}

          {showFolders && subfolders.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-5">
              {subfolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  draggable
                  onDragStart={(event) => dragFolder(event, folder.id)}
                  onClick={() => openFolder(folder.id)}
                  {...dropProps(`card:${folder.id}`, folder.id)}
                  className={`flex items-center gap-2 rounded-xl border border-[#EADFD3] bg-white px-3 py-3 text-left text-[13px] font-bold text-[#4A1A04] hover:border-[#F462A7] ${dropClass(`card:${folder.id}`)}`}
                >
                  <Folder className="h-5 w-5 shrink-0 text-[#D90F6F]" aria-hidden="true" />
                  <span className="min-w-0 truncate">{folder.name}</span>
                </button>
              ))}
            </div>
          )}

          {loading && media.length === 0 ? (
            <div className="grid min-h-64 place-items-center text-[13px] text-[#7A5646]">Carregando biblioteca…</div>
          ) : visible.length === 0 ? (
            !(showFolders && subfolders.length > 0) && (
              <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-[#D9C8B6] bg-white px-8 text-center text-[13px] text-[#7A5646]">
                {scheduledView || query.trim() || kind !== "all" || unusedOnly
                  ? "Nada encontrado com esses filtros."
                  : "Esta pasta está vazia. Envie arquivos ou arraste mídias de outra pasta."}
              </div>
            )
          ) : (
            <div className="grid grid-cols-2 content-start gap-3 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-5">
              {visible.map((item) => {
                const isChecked = item.libraryId !== null && checked.has(item.libraryId);
                return (
                  <div
                    key={item.id}
                    className="relative min-w-0"
                    draggable={item.libraryId !== null}
                    onDragStart={(event) => item.libraryId && dragMedia(event, item.libraryId)}
                  >
                    <button
                      type="button"
                      aria-pressed={selected?.id === item.id}
                      onClick={() => setSelectedId(item.id)}
                      className="block w-full min-w-0 text-left focus-visible:outline-none"
                    >
                      <div
                        className="relative aspect-[4/5] overflow-hidden rounded-lg border border-[#EADFD3] bg-[#F3E8DC]"
                        style={{ outline: selected?.id === item.id ? "2px solid #D90F6F" : "none", outlineOffset: "2px" }}
                      >
                        <ProtectedMedia url={item.previewUrl} kind={item.kind} alt={item.name} />
                        {item.kind === "video" && (
                          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-[#4A1A04] px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                            <Film className="h-2.5 w-2.5" aria-hidden="true" /> Vídeo
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 truncate text-[12px] font-bold text-[#4A1A04]">{item.name}</div>
                      <div className="text-[10px] text-[#7A5646]">{item.uses.length ? `Usada em ${item.uses.length} post` : "Nunca usada"}</div>
                    </button>
                    {item.libraryId !== null && (
                      <label className={`absolute left-1.5 top-1.5 grid h-6 w-6 cursor-pointer place-items-center rounded bg-white/90 shadow ${isChecked ? "" : "opacity-80"}`}>
                        <span className="sr-only">Selecionar {item.name}</span>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleChecked(item.libraryId!)}
                          className="h-4 w-4 accent-[#D90F6F]"
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {hasMore && !scheduledView && (
            <div className="mt-4 text-center">
              <button type="button" onClick={onLoadMore} disabled={loading} className={iconButton}>
                {loading ? "Carregando…" : "Carregar mais"}
              </button>
            </div>
          )}
        </div>

        <aside className="hidden border-l border-[#EADFD3] bg-white p-5 xl:flex xl:flex-col xl:gap-4">
          {selected ? (
            <>
              <div className="aspect-[4/5] max-h-[340px] overflow-hidden rounded-[10px] border border-[#EADFD3] bg-[#F3E8DC]">
                <ProtectedMedia url={selected.previewUrl} kind={selected.kind} alt={selected.name} eager />
              </div>
              <div>
                <h2 className="break-words text-[18px] font-extrabold text-[#4A1A04]">{selected.name}</h2>
                <p className="mt-1 text-[12px] text-[#7A5646]">
                  {scheduledView ? "Agendamentos" : path.map((folder) => folder.name).join(" / ") || "Biblioteca"} · {selected.kind === "video" ? "vídeo" : "foto"} · {sizeLabel(selected.sizeBytes)}
                </p>
                {selected.width && selected.height && (
                  <p className="mt-1 text-[11px] text-[#7A5646]">{selected.width} × {selected.height} px</p>
                )}
              </div>
              <div className="space-y-1.5 text-[12px]">
                <div className="font-extrabold text-[#4A1A04]">{selected.uses.length ? `Usada em ${selected.uses.length} post` : "Ainda não usada"}</div>
                {selected.uses.map((use) => (
                  <div key={use.id} className="font-semibold text-[#217A8F]">{use.title} · {use.date}</div>
                ))}
              </div>
              {selected.libraryId && (
                <button
                  type="button"
                  onClick={() => setDialog({ type: "move-media", ids: [selected.libraryId!] })}
                  className={iconButton}
                >
                  <FolderOpen className="h-4 w-4" aria-hidden="true" /> Mover para…
                </button>
              )}
              <button
                type="button"
                onClick={() => onFutureFeature("Editor de posts")}
                className="mt-auto rounded-[9px] bg-[#F462A7] px-3 py-2.5 text-[13px] font-extrabold text-[#4A1A04]"
              >
                Criar post com esta mídia · em breve
              </button>
            </>
          ) : (
            <p className="text-[13px] text-[#7A5646]">Selecione um arquivo para conferir seus detalhes.</p>
          )}
        </aside>
      </div>
      <footer className="border-t border-[#EADFD3] bg-white px-4 py-2 text-[11px] text-[#7A5646] md:px-7">
        Crie pastas e subpastas, arraste arquivos e pastas para reorganizar. A busca e os filtros valem para os arquivos já carregados nesta pasta. Imagens: 8 MB. Vídeos: 24 MB. Arquivos dos agendamentos ficam na pasta “Agendamentos”, somente leitura.
      </footer>

      {dialog?.type === "create" && (
        <FolderNameDialog
          title={dialog.parentId ? "Nova subpasta" : "Nova pasta"}
          confirmLabel="Criar pasta"
          onConfirm={(name) => onCreateFolder(name, dialog.parentId)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "rename" && (
        <FolderNameDialog
          title="Renomear pasta"
          confirmLabel="Salvar nome"
          initialName={dialog.folder.name}
          onConfirm={(name) => onRenameFolder(dialog.folder.id, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "move-folder" && (
        <MoveToFolderDialog
          title={`Mover “${dialog.folder.name}”`}
          folders={folders}
          movingFolderId={dialog.folder.id}
          currentLocationId={dialog.folder.parentId}
          onConfirm={(target) => onMoveFolder(dialog.folder.id, target)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "move-media" && (
        <MoveToFolderDialog
          title={dialog.ids.length === 1 ? "Mover arquivo" : `Mover ${dialog.ids.length} arquivos`}
          folders={folders}
          currentLocationId={currentFolderId}
          onConfirm={async (target) => {
            const moved = await onMoveMedia(dialog.ids, target);
            if (moved) setChecked(new Set());
            return moved;
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "delete" && (
        <DeleteFolderDialog
          folderName={dialog.folder.name}
          onConfirm={() => onDeleteFolder(dialog.folder.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
