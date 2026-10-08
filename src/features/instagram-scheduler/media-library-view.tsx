"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import { Film } from "lucide-react";

import { BulkBar } from "@/components/patterns/bulk-bar";
import { ControlSearch } from "@/components/patterns/control-panel";
import { FilterChips } from "@/components/patterns/filter-chips";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { SelectBox } from "@/components/patterns/select-box";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HeroChip, PulseHero } from "./hero-panel";

import type {
  InstagramMediaFolder,
  InstagramMediaLibraryItem,
  InstagramMediaLibraryKind,
  InstagramScheduleListItem,
} from "./contracts";
import { FolderNameDialog, MoveToFolderDialog } from "./media-folder-dialogs";
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
  | { type: "move-media"; ids: string[] };

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    setConfirmingDelete(false);
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

  const dropClass = (key: string) => (dropTarget === key ? "outline outline-2 outline-ds-accent-ink" : "");
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
          className={cn("flex items-center rounded-ds-btn", active ? "bg-ds-accent-row font-extrabold" : "hover:bg-ds-muted", dropClass(`tree:${node.id}`))}
          style={{ paddingLeft: (node.depth - 1) * 12 }}
          draggable
          onDragStart={(event) => dragFolder(event, node.id)}
          {...dropProps(`tree:${node.id}`, node.id)}
        >
          <button
            type="button"
            aria-label={open ? "Recolher" : "Expandir"}
            aria-expanded={open}
            disabled={node.children.length === 0}
            onClick={() => setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(node.id)) next.delete(node.id);
              else next.add(node.id);
              return next;
            })}
            className="grid h-7 w-5 shrink-0 place-items-center text-[11px] text-ds-ink-faint disabled:opacity-0"
          >
            {open ? "▾" : "▸"}
          </button>
          <button
            type="button"
            aria-pressed={active}
            onClick={() => openFolder(node.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pr-2 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
          >
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

  const unusedCount = media.filter((item) => item.uses.length === 0).length;
  const folderButton = (active: boolean) => cn("flex w-full items-center gap-2 rounded-ds-btn px-2 py-2 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink", active ? "bg-ds-accent-row font-extrabold" : "hover:bg-ds-muted");

  async function removeCurrentFolder() {
    if (!currentFolder) return;
    setDeleting(true);
    try {
      if (await onDeleteFolder(currentFolder.id)) {
        setConfirmingDelete(false);
        openFolder(currentFolder.parentId);
      } else {
        setConfirmingDelete(false);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-5 bg-ds-warm px-4 py-5 font-ds text-ds-ink md:px-7" aria-labelledby="instagram-media-title">
      <PulseHero
        kicker="Programação do Instagram"
        title="Biblioteca de mídia"
        titleId="instagram-media-title"
        actions={(
          <>
            <Button type="button" variant="on-dark-secondary" size="xl" onClick={() => setDialog({ type: "create", parentId: currentFolderId })} disabled={scheduledView} className="whitespace-nowrap">
              {currentFolderId ? "Nova subpasta" : "Nova pasta"}
            </Button>
            <Button type="button" variant="primary-page" size="xl" loading={uploading} loadingLabel="Enviando…" onClick={() => inputRef.current?.click()} disabled={scheduledView} className="whitespace-nowrap">
              + Enviar arquivos
            </Button>
          </>
        )}
        compactActions={(
          <Button type="button" variant="primary-page" size="md" loading={uploading} loadingLabel="Enviando…" onClick={() => inputRef.current?.click()} disabled={scheduledView} className="whitespace-nowrap">
            + Enviar arquivos
          </Button>
        )}
        search={<ControlSearch value={query} onChange={setQuery} placeholder="Buscar nesta pasta pelo nome" />}
        chips={(
          <>
            <HeroChip value={media.length} label={scheduledView ? "Arquivos dos agendamentos" : "Arquivos nesta pasta"} />
            <HeroChip value={unusedCount} label="Nunca usadas" tone="warning" active={unusedOnly} onClick={() => setUnusedOnly((current) => !current)} />
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/15" />
            <FilterChips
              chips={[{ value: "image", label: "Fotos" }, { value: "video", label: "Vídeos" }]}
              value={kind === "all" ? null : kind}
              onChange={(value) => setKind((value as InstagramMediaLibraryKind | null) ?? "all")}
              allLabel="Tudo"
            />
          </>
        )}
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
        className="sr-only"
        aria-label="Escolher arquivos"
        onChange={(event) => void uploadSelection(event.target.files)}
      />

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_300px]">
        <aside className="hidden self-start overflow-y-auto rounded-ds-card-lg border border-ds-border bg-ds-surface px-3 py-4 lg:block">
          <div className="px-2 pb-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Pastas</div>
          <button
            type="button"
            aria-pressed={!scheduledView && currentFolderId === null}
            onClick={() => openFolder(null)}
            {...dropProps("tree:root", null)}
            className={cn(folderButton(!scheduledView && currentFolderId === null), dropClass("tree:root"))}
          >
            <span className="truncate">Biblioteca</span>
          </button>
          <ul>{tree.map(renderTreeNode)}</ul>
          <div className="mt-3 border-t border-ds-divider pt-3">
            <button
              type="button"
              aria-pressed={scheduledView}
              onClick={() => { setScheduledView(true); setChecked(new Set()); setSelectedId(null); setConfirmingDelete(false); }}
              className={folderButton(scheduledView)}
            >
              <span className="truncate">Agendamentos</span>
              <span className="ml-auto text-[10px] font-bold text-ds-ink-faint">leitura</span>
            </button>
          </div>
        </aside>

        <div className="min-h-0 min-w-0 overflow-y-auto">
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
              className="h-10 w-full rounded-ds-md border border-ds-border-input bg-ds-input px-3 text-[13px] font-bold"
            >
              {mobileOptions.map((option) => (
                <option key={option.id ?? "root"} value={option.id ?? ""}>{option.label}</option>
              ))}
              <option value="@scheduled">Agendamentos (leitura)</option>
            </select>
          </label>

          <nav aria-label="Caminho da pasta" className="mb-3 flex flex-wrap items-center gap-1 text-[13px]">
            {scheduledView ? (
              <span className="font-extrabold">Agendamentos</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openFolder(null)}
                  {...dropProps("crumb:root", null)}
                  className={cn("rounded-ds-sm px-1.5 py-0.5 font-bold hover:bg-ds-muted", path.length === 0 ? "text-ds-ink" : "text-ds-ink-muted", dropClass("crumb:root"))}
                >
                  Biblioteca
                </button>
                {path.map((folder, index) => (
                  <span key={folder.id} className="flex items-center gap-1">
                    <span aria-hidden="true" className="text-ds-ink-faint">›</span>
                    <button
                      type="button"
                      onClick={() => openFolder(folder.id)}
                      {...dropProps(`crumb:${folder.id}`, folder.id)}
                      className={cn("rounded-ds-sm px-1.5 py-0.5 font-bold hover:bg-ds-muted", index === path.length - 1 ? "text-ds-ink" : "text-ds-ink-muted", dropClass(`crumb:${folder.id}`))}
                    >
                      {folder.name}
                    </button>
                  </span>
                ))}
              </>
            )}
            {currentFolder && !scheduledView && !confirmingDelete && (
              <span className="ml-auto flex items-center gap-1.5">
                <Button type="button" variant="ds-secondary" size="xs" onClick={() => setDialog({ type: "rename", folder: currentFolder })}>Renomear</Button>
                <Button type="button" variant="ds-secondary" size="xs" onClick={() => setDialog({ type: "move-folder", folder: currentFolder })}>Mover</Button>
                <Button type="button" variant="danger-link" size="xs" onClick={() => setConfirmingDelete(true)}>Excluir</Button>
              </span>
            )}
          </nav>

          {confirmingDelete && currentFolder ? (
            <InlineConfirm
              className="mb-3"
              message={`Excluir a pasta “${currentFolder.name}”? Nenhum arquivo é apagado: as mídias e as subpastas sobem para a pasta de cima.`}
              confirmLabel="Excluir pasta"
              cancelLabel="Manter"
              loadingLabel="Excluindo…"
              loading={deleting}
              onCancel={() => setConfirmingDelete(false)}
              onConfirm={() => void removeCurrentFolder()}
            />
          ) : null}

          {scheduledView && (
            <p className="mb-3 rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-[12px] text-ds-ink-muted">
              Estes arquivos pertencem aos agendamentos e não podem ser movidos nem enviados para pastas por aqui.
            </p>
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
                  className={cn("flex items-center gap-2 rounded-ds-btn-lg border border-ds-border bg-ds-surface px-3 py-3 text-left text-[13px] font-bold hover:shadow-ds-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink", dropClass(`card:${folder.id}`))}
                >
                  <span aria-hidden="true" className="text-ds-accent-ink">▤</span>
                  <span className="min-w-0 truncate">{folder.name}</span>
                </button>
              ))}
            </div>
          )}

          {loading && media.length === 0 ? (
            <div role="status" className="grid min-h-64 place-items-center text-[13px] text-ds-ink-muted">Carregando biblioteca…</div>
          ) : visible.length === 0 ? (
            !(showFolders && subfolders.length > 0) && (
              <div className="grid min-h-64 place-items-center rounded-ds-card-lg border border-dashed border-ds-border-input px-8 text-center text-[13px] text-ds-ink-muted">
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
                        className={cn(
                          "relative aspect-[4/5] overflow-hidden rounded-ds-btn border border-ds-border bg-ds-muted outline-offset-2",
                          selected?.id === item.id && "outline outline-2 outline-ds-accent-ink"
                        )}
                      >
                        <ProtectedMedia url={item.previewUrl} kind={item.kind} alt={item.name} />
                        {item.kind === "video" && (
                          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-ds-sm bg-ds-dark px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                            <Film className="h-2.5 w-2.5" aria-hidden="true" /> Vídeo
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 truncate text-[12px] font-bold">{item.name}</div>
                      <div className="text-[10px] text-ds-ink-muted">{item.uses.length ? `Usada em ${item.uses.length} post` : "Nunca usada"}</div>
                    </button>
                    {item.libraryId !== null && (
                      <span className="absolute left-1.5 top-1.5 rounded-ds-sm bg-white/90 p-1 shadow-ds-lift">
                        <SelectBox checked={isChecked} onToggle={() => toggleChecked(item.libraryId!)} label={`Selecionar ${item.name}`} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {hasMore && !scheduledView && (
            <div className="mt-4 text-center">
              <Button type="button" variant="ds-secondary" size="md" onClick={onLoadMore} disabled={loading}>
                {loading ? "Carregando…" : "Carregar mais"}
              </Button>
            </div>
          )}
        </div>

        <aside className="hidden self-start rounded-ds-card-lg border border-ds-border bg-ds-surface p-5 xl:flex xl:flex-col xl:gap-4">
          {selected ? (
            <>
              <div className="aspect-[4/5] max-h-[340px] overflow-hidden rounded-ds-btn border border-ds-border bg-ds-muted">
                <ProtectedMedia url={selected.previewUrl} kind={selected.kind} alt={selected.name} eager />
              </div>
              <div>
                <h2 className="break-words text-[18px] font-extrabold">{selected.name}</h2>
                <p className="mt-1 text-[12px] text-ds-ink-muted">
                  {scheduledView ? "Agendamentos" : path.map((folder) => folder.name).join(" / ") || "Biblioteca"} · {selected.kind === "video" ? "vídeo" : "foto"} · {sizeLabel(selected.sizeBytes)}
                </p>
                {selected.width && selected.height && (
                  <p className="mt-1 font-ds-mono text-[11px] text-ds-ink-muted">{selected.width} × {selected.height} px</p>
                )}
              </div>
              <div className="space-y-1.5 text-[12px]">
                <div className="font-extrabold">{selected.uses.length ? `Usada em ${selected.uses.length} post` : "Ainda não usada"}</div>
                {selected.uses.map((use) => (
                  <div key={use.id} className="font-semibold text-ds-info">{use.title} · {use.date}</div>
                ))}
              </div>
              {selected.libraryId && (
                <Button type="button" variant="ds-secondary" size="md" onClick={() => setDialog({ type: "move-media", ids: [selected.libraryId!] })}>Mover para…</Button>
              )}
              <Button type="button" variant="primary-modal" size="md" onClick={() => onFutureFeature("Editor de posts")} className="mt-auto">
                Criar post com esta mídia · em breve
              </Button>
            </>
          ) : (
            <p className="text-[13px] text-ds-ink-muted">Selecione um arquivo para conferir seus detalhes.</p>
          )}
        </aside>
      </div>

      <p className="text-[11px] text-ds-ink-muted">
        Crie pastas e subpastas, arraste arquivos e pastas para reorganizar. A busca e os filtros valem para os arquivos já carregados nesta pasta. Imagens: 8 MB. Vídeos: 24 MB. Arquivos dos agendamentos ficam na pasta “Agendamentos”, somente leitura.
      </p>

      <BulkBar
        count={checked.size}
        summary={`${checked.size} selecionado${checked.size > 1 ? "s" : ""}`}
        actions={[{ label: "Mover para…", onClick: () => setDialog({ type: "move-media", ids: [...checked] }) }]}
        onClear={() => setChecked(new Set())}
      />

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
    </section>
  );
}
