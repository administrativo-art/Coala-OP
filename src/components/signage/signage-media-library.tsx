"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FolderPlus, Search, UploadCloud, VideoIcon } from 'lucide-react';

import { fieldInputClass } from '@/components/patterns/field';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { Segmented } from '@/components/patterns/segmented';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { SIGNAGE_IMAGE_MAX_BYTES, SIGNAGE_VIDEO_MAX_BYTES } from '@/lib/signage';
import { cn } from '@/lib/utils';
import { type SignageMediaFolder, type SignageMediaItem, type SignageSlide } from '@/types';

import { formatRelativeTime } from './signage-admin-shared';
import { type SignageApiRequest } from './signage-slide-dialog';

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const NO_FOLDER = '__none';

type KindFilter = 'all' | 'image' | 'video';

type SignageMediaLibraryProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: SignageApiRequest;
  canManage: boolean;
  /** Slides que quem edita enxerga, para mostrar onde cada mídia está em uso. */
  slides: SignageSlide[];
  /** Com `pick`, a biblioteca vira seletor: só mostra o tipo pedido e devolve a mídia escolhida. */
  pick?: { kind: 'image' | 'video'; onPick: (item: SignageMediaItem) => void };
};

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function MediaThumb({ item }: { item: SignageMediaItem }) {
  return (
    <span className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-ds-sm bg-ds-dark text-ds-on-dark-2">
      {item.kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element -- mídia servida pela rota de assets do signage
        <img src={item.assetUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <>
          <video src={`${item.assetUrl}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-ds-sm bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
            <VideoIcon aria-hidden="true" className="h-3 w-3" />
            Vídeo
          </span>
        </>
      )}
    </span>
  );
}

/**
 * Biblioteca de mídias do signage: envia uma vez e usa em quantos slides quiser.
 * Segue o desenho da biblioteca do Coala Pulse (pastas, busca, filtro por tipo e "sem uso"),
 * com pastas em um nível só.
 */
export function SignageMediaLibrary({ open, onOpenChange, request, canManage, slides, pick }: SignageMediaLibraryProps) {
  const [items, setItems] = useState<SignageMediaItem[]>([]);
  const [folders, setFolders] = useState<SignageMediaFolder[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const [folderForm, setFolderForm] = useState<{ mode: 'create' | 'rename'; name: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState<'folder' | 'media' | 'import' | null>(null);
  const [confirm, setConfirm] = useState<'media' | 'folder' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await request<{ items: SignageMediaItem[]; folders: SignageMediaFolder[]; truncated: boolean }>('/api/signage/media', {
        fallbackError: 'Falha ao carregar a biblioteca.',
      });
      setItems(data.items);
      setFolders(data.folders);
      setTruncated(data.truncated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar a biblioteca.');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setKind('all');
    setUnusedOnly(false);
    setFolderId(null);
    setSelectedId(null);
    setFolderForm(null);
    setRenaming(null);
    setConfirm(null);
    setNotice(null);
    void load();
  }, [load, open]);

  const usageByPath = useMemo(() => {
    const usage = new Map<string, SignageSlide[]>();
    slides.forEach((slide) => {
      if (!slide.assetPath) return;
      usage.set(slide.assetPath, [...(usage.get(slide.assetPath) ?? []), slide]);
    });
    return usage;
  }, [slides]);

  const activeKind: KindFilter = pick?.kind ?? kind;
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR');
    return items.filter((item) => {
      if (activeKind !== 'all' && item.kind !== activeKind) return false;
      if (folderId === NO_FOLDER ? item.folderId !== null : folderId !== null && item.folderId !== folderId) return false;
      if (unusedOnly && usageByPath.has(item.assetPath)) return false;
      return !term || item.fileName.toLocaleLowerCase('pt-BR').includes(term);
    });
  }, [activeKind, folderId, items, query, unusedOnly, usageByPath]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const selectedUsage = selected ? usageByPath.get(selected.assetPath) ?? [] : [];
  const currentFolder = folders.find((folder) => folder.id === folderId) ?? null;
  const slidesWithUnlistedMedia = useMemo(() => {
    const listed = new Set(items.map((item) => item.assetPath));
    return new Set(slides.filter((slide) => slide.assetPath && !listed.has(slide.assetPath)).map((slide) => slide.assetPath)).size;
  }, [items, slides]);

  function fail(cause: unknown, fallback: string) {
    setError(cause instanceof Error ? cause.message : fallback);
  }

  async function handleUpload(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (!list.length || upload) return;
    setError(null);
    setNotice(null);

    const rejected: string[] = [];
    const accepted = list.filter((file) => {
      const isVideo = file.type.startsWith('video/');
      const fits = file.size <= (isVideo ? SIGNAGE_VIDEO_MAX_BYTES : SIGNAGE_IMAGE_MAX_BYTES);
      if (!fits) rejected.push(file.name);
      return fits;
    });

    let failures = 0;
    setUpload({ done: 0, total: accepted.length });
    for (const [index, file] of accepted.entries()) {
      const body = new FormData();
      body.append('file', file);
      if (currentFolder) body.append('folderId', currentFolder.id);
      try {
        const data = await request<{ item: SignageMediaItem }>('/api/signage/media', { method: 'POST', body, fallbackError: 'Falha no upload.', timeoutMs: UPLOAD_TIMEOUT_MS });
        setItems((prev) => [data.item, ...prev]);
        setSelectedId(data.item.id);
      } catch {
        failures += 1;
      }
      setUpload({ done: index + 1, total: accepted.length });
    }
    setUpload(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    const problems = [
      rejected.length ? `${rejected.length === 1 ? `${rejected[0]} passa` : `${rejected.length} arquivos passam`} do limite (imagem 2 MB, vídeo 30 MB)` : null,
      failures ? `${failures} ${failures === 1 ? 'arquivo não foi enviado' : 'arquivos não foram enviados'}; confira se é JPG, PNG, WebP ou MP4` : null,
    ].filter(Boolean);
    if (problems.length) setError(`${problems.join('. ')}.`);
  }

  async function handleSaveFolder() {
    if (!folderForm) return;
    const name = folderForm.name.trim();
    if (!name) {
      setError('Dê um nome para a pasta.');
      return;
    }
    try {
      setBusy('folder');
      setError(null);
      if (folderForm.mode === 'create') {
        const data = await request<{ folder: SignageMediaFolder }>('/api/signage/media/folders', { method: 'POST', json: { name }, fallbackError: 'Falha ao criar a pasta.' });
        setFolders((prev) => [...prev, data.folder].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
        setFolderId(data.folder.id);
      } else if (currentFolder) {
        await request(`/api/signage/media/folders/${currentFolder.id}`, { method: 'PATCH', json: { name }, fallbackError: 'Falha ao renomear a pasta.' });
        setFolders((prev) => prev.map((folder) => folder.id === currentFolder.id ? { ...folder, name } : folder));
      }
      setFolderForm(null);
    } catch (cause) {
      fail(cause, 'Falha ao salvar a pasta.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteFolder() {
    if (!currentFolder) return;
    try {
      setBusy('folder');
      setError(null);
      await request(`/api/signage/media/folders/${currentFolder.id}`, { method: 'DELETE', fallbackError: 'Falha ao excluir a pasta.' });
      setItems((prev) => prev.map((item) => item.folderId === currentFolder.id ? { ...item, folderId: null } : item));
      setFolders((prev) => prev.filter((folder) => folder.id !== currentFolder.id));
      setFolderId(null);
      setConfirm(null);
    } catch (cause) {
      fail(cause, 'Falha ao excluir a pasta.');
    } finally {
      setBusy(null);
    }
  }

  async function handleUpdateMedia(item: SignageMediaItem, patch: { fileName?: string; folderId?: string | null }) {
    try {
      setBusy('media');
      setError(null);
      const data = await request<{ item: SignageMediaItem }>(`/api/signage/media/${item.id}`, { method: 'PATCH', json: patch, fallbackError: 'Falha ao atualizar a mídia.' });
      setItems((prev) => prev.map((current) => current.id === item.id ? data.item : current));
      setRenaming(null);
    } catch (cause) {
      fail(cause, 'Falha ao atualizar a mídia.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteMedia(item: SignageMediaItem) {
    try {
      setBusy('media');
      setError(null);
      await request(`/api/signage/media/${item.id}`, { method: 'DELETE', fallbackError: 'Falha ao excluir a mídia.' });
      setItems((prev) => prev.filter((current) => current.id !== item.id));
      setSelectedId(null);
      setConfirm(null);
    } catch (cause) {
      fail(cause, 'Falha ao excluir a mídia.');
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    try {
      setBusy('import');
      setError(null);
      const data = await request<{ imported: number }>('/api/signage/media/import', { method: 'POST', fallbackError: 'Falha ao trazer as mídias dos slides.', timeoutMs: UPLOAD_TIMEOUT_MS });
      setNotice(data.imported ? `${data.imported} ${data.imported === 1 ? 'mídia trazida' : 'mídias trazidas'} dos slides.` : 'Nenhuma mídia nova para trazer.');
      await load();
    } catch (cause) {
      fail(cause, 'Falha ao trazer as mídias dos slides.');
    } finally {
      setBusy(null);
    }
  }

  const folderButtonClass = (active: boolean) => cn(
    'flex w-full items-center justify-between gap-2 rounded-ds-sm px-2.5 py-1.5 text-left text-[13px] font-bold transition-colors',
    active ? 'bg-ds-modal-soft text-ds-modal-ink' : 'text-ds-ink-2 hover:bg-ds-muted',
  );
  const countIn = (id: string | null) => items.filter((item) => (activeKind === 'all' || item.kind === activeKind) && (id === NO_FOLDER ? item.folderId === null : id === null || item.folderId === id)).length;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!upload) onOpenChange(nextOpen); }}>
      <DialogContent flush className="flex max-h-[calc(100vh-48px)] flex-col gap-0 overflow-hidden rounded-ds-modal border-0 bg-ds-input font-ds shadow-ds-modal sm:max-w-[1040px] sm:rounded-ds-modal">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ds-border-footer px-7 pb-[18px] pt-6 pr-12">
          <div>
            <DialogTitle className="text-[21px] font-extrabold tracking-[-0.02em] text-ds-ink">{pick ? `Escolher ${pick.kind === 'video' ? 'vídeo' : 'imagem'} da biblioteca` : 'Biblioteca de mídias'}</DialogTitle>
            <DialogDescription className="mt-0.5 text-[13px] text-ds-ink-muted">
              Envie uma vez e use em quantos slides e telas quiser. Imagens de até 2 MB e vídeos MP4 de até 30 MB.
            </DialogDescription>
          </div>
          {canManage && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                aria-label="Escolher arquivos"
                accept={pick ? (pick.kind === 'video' ? 'video/mp4' : 'image/webp,image/jpeg,image/png') : 'video/mp4,image/webp,image/jpeg,image/png'}
                onChange={(event) => void handleUpload(event.target.files)}
              />
              <Button
                type="button"
                variant="primary-modal"
                size="md"
                loading={Boolean(upload)}
                loadingLabel={upload ? `Enviando ${Math.min(upload.done + 1, upload.total)} de ${upload.total}…` : 'Enviando…'}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud aria-hidden="true" className="h-4 w-4" />
                Enviar mídias
              </Button>
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="shrink-0 border-b border-ds-border-footer bg-ds-surface p-4 md:w-[210px] md:overflow-y-auto md:border-b-0 md:border-r">
            <p className="px-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Pastas</p>
            <div className="mt-2 space-y-0.5">
              <button type="button" aria-pressed={folderId === null} className={folderButtonClass(folderId === null)} onClick={() => { setFolderId(null); setFolderForm(null); setConfirm(null); }}>
                Todas <span className="text-[11.5px] font-extrabold opacity-70">{countIn(null)}</span>
              </button>
              <button type="button" aria-pressed={folderId === NO_FOLDER} className={folderButtonClass(folderId === NO_FOLDER)} onClick={() => { setFolderId(NO_FOLDER); setFolderForm(null); setConfirm(null); }}>
                Sem pasta <span className="text-[11.5px] font-extrabold opacity-70">{countIn(NO_FOLDER)}</span>
              </button>
              {folders.map((folder) => (
                <button key={folder.id} type="button" aria-pressed={folderId === folder.id} className={folderButtonClass(folderId === folder.id)} onClick={() => { setFolderId(folder.id); setFolderForm(null); setConfirm(null); }}>
                  <span className="min-w-0 truncate">{folder.name}</span>
                  <span className="text-[11.5px] font-extrabold opacity-70">{countIn(folder.id)}</span>
                </button>
              ))}
            </div>

            {canManage && (
              folderForm ? (
                <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void handleSaveFolder(); }}>
                  <input
                    autoFocus
                    aria-label="Nome da pasta"
                    maxLength={60}
                    value={folderForm.name}
                    onChange={(event) => setFolderForm({ ...folderForm, name: event.target.value })}
                    className={fieldInputClass}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary-modal" size="xs" loading={busy === 'folder'}>{folderForm.mode === 'create' ? 'Criar pasta' : 'Salvar nome'}</Button>
                    <Button type="button" variant="ds-ghost" size="xs" onClick={() => setFolderForm(null)}>Cancelar</Button>
                  </div>
                </form>
              ) : confirm === 'folder' && currentFolder ? (
                <InlineConfirm
                  className="mt-3 flex-col items-stretch"
                  message={`Excluir a pasta ${currentFolder.name}? As mídias dela voltam para "Sem pasta".`}
                  confirmLabel="Excluir pasta"
                  loadingLabel="Excluindo…"
                  loading={busy === 'folder'}
                  onConfirm={() => void handleDeleteFolder()}
                  onCancel={() => setConfirm(null)}
                />
              ) : (
                <div className="mt-3 flex flex-col items-start gap-1.5 px-1">
                  <Button type="button" variant="ds-link" size="xs" className="h-auto p-0" onClick={() => setFolderForm({ mode: 'create', name: '' })}>
                    <FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />
                    Nova pasta
                  </Button>
                  {currentFolder && (
                    <>
                      <Button type="button" variant="ds-link" size="xs" className="h-auto p-0" onClick={() => setFolderForm({ mode: 'rename', name: currentFolder.name })}>Renomear pasta</Button>
                      <Button type="button" variant="danger-link" size="xs" className="h-auto p-0" onClick={() => setConfirm('folder')}>Excluir pasta</Button>
                    </>
                  )}
                </div>
              )
            )}
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-3 border-b border-ds-border-footer px-5 py-3">
              <label className="relative min-w-[180px] flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" />
                <input
                  type="search"
                  aria-label="Buscar mídia pelo nome"
                  placeholder="Buscar pelo nome"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className={cn(fieldInputClass, 'pl-9')}
                />
              </label>
              {!pick && (
                <Segmented<KindFilter>
                  aria-label="Tipo de mídia"
                  value={kind}
                  onChange={setKind}
                  options={[{ value: 'all', label: 'Tudo' }, { value: 'image', label: 'Imagens' }, { value: 'video', label: 'Vídeos' }]}
                />
              )}
              <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ds-ink-2">
                <input type="checkbox" checked={unusedOnly} onChange={(event) => setUnusedOnly(event.target.checked)} className="h-4 w-4 accent-[var(--ds-dark)]" />
                Só as sem uso
              </label>
            </div>

            <div className="min-h-[260px] flex-1 overflow-y-auto px-5 py-4">
              {error && <p role="alert" className="mb-3 text-xs font-semibold text-ds-danger">{error}</p>}
              {notice && <p role="status" className="mb-3 text-xs font-semibold text-ds-ink-2">{notice}</p>}
              {canManage && !loading && slidesWithUnlistedMedia > 0 && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2.5">
                  <p className="text-xs text-ds-ink-2">
                    {slidesWithUnlistedMedia === 1 ? 'Há 1 mídia de slide que ainda não está' : `Há ${slidesWithUnlistedMedia} mídias de slides que ainda não estão`} na biblioteca.
                  </p>
                  <Button type="button" variant="ds-secondary" size="xs" loading={busy === 'import'} loadingLabel="Trazendo…" onClick={() => void handleImport()}>Trazer para a biblioteca</Button>
                </div>
              )}

              {loading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="aspect-video w-full rounded-ds-sm" />)}
                </div>
              ) : visible.length === 0 ? (
                <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
                  <p className="text-[14px] font-bold text-ds-ink">{items.length ? 'Nenhuma mídia com estes filtros' : 'A biblioteca está vazia'}</p>
                  <p className="mt-1 text-[13px] text-ds-ink-muted">{items.length ? 'Mude a pasta, o tipo ou a busca.' : canManage ? 'Envie imagens e vídeos para usar nos slides.' : 'Peça a quem gerencia o signage para enviar as mídias.'}</p>
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {visible.map((item) => {
                    const isSelected = item.id === selectedId;
                    const uses = usageByPath.get(item.assetPath)?.length ?? 0;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => { setSelectedId(item.id); setRenaming(null); setConfirm(null); }}
                          onDoubleClick={() => { if (pick) { pick.onPick(item); onOpenChange(false); } }}
                          className={cn(
                            'relative block w-full rounded-ds-md border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ds-modal-soft',
                            isSelected ? 'border-ds-modal bg-ds-modal-soft' : 'border-ds-border bg-ds-surface hover:bg-ds-muted',
                          )}
                        >
                          <MediaThumb item={item} />
                          {isSelected && (
                            <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-ds-dark text-white">
                              <Check aria-hidden="true" className="h-3 w-3" />
                            </span>
                          )}
                          <span className="mt-1.5 block truncate text-[12.5px] font-bold text-ds-ink">{item.fileName}</span>
                          <span className="block text-[11.5px] text-ds-ink-muted">{formatSize(item.sizeBytes)} · {uses ? `${uses} ${uses === 1 ? 'slide' : 'slides'}` : 'sem uso'}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {truncated && <p className="mt-3 text-xs text-ds-ink-muted">Mostrando as 300 mídias mais recentes. Exclua as que não usa mais para ver as antigas.</p>}
            </div>
          </div>
        </div>

        <div className="border-t border-ds-border-footer bg-ds-surface px-7 py-4">
          {!selected ? (
            <div className="flex items-center gap-3">
              <Button type="button" variant="ds-ghost" size="md" onClick={() => onOpenChange(false)}>Fechar</Button>
              <p className="text-xs text-ds-ink-muted">{pick ? 'Escolha uma mídia para usar no slide.' : 'Selecione uma mídia para ver onde ela está em uso, mover ou excluir.'}</p>
            </div>
          ) : confirm === 'media' ? (
            <InlineConfirm
              message={`Excluir ${selected.fileName} da biblioteca? O arquivo é apagado e isso não pode ser desfeito.`}
              confirmLabel="Excluir mídia"
              loadingLabel="Excluindo…"
              loading={busy === 'media'}
              onConfirm={() => void handleDeleteMedia(selected)}
              onCancel={() => setConfirm(null)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="min-w-0 flex-1 basis-[240px]">
                {renaming !== null ? (
                  <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (renaming.trim()) void handleUpdateMedia(selected, { fileName: renaming.trim() }); }}>
                    <input autoFocus aria-label="Nome da mídia" maxLength={120} value={renaming} onChange={(event) => setRenaming(event.target.value)} className={fieldInputClass} />
                    <Button type="submit" variant="primary-modal" size="xs" loading={busy === 'media'}>Salvar</Button>
                    <Button type="button" variant="ds-ghost" size="xs" onClick={() => setRenaming(null)}>Cancelar</Button>
                  </form>
                ) : (
                  <>
                    <p className="truncate text-[13.5px] font-bold text-ds-ink">{selected.fileName}</p>
                    <p className="truncate text-xs text-ds-ink-muted">
                      {selected.kind === 'video' ? 'Vídeo' : 'Imagem'} · {formatSize(selected.sizeBytes)}
                      {selected.createdAt ? ` · enviada ${formatRelativeTime(selected.createdAt)}` : ''}
                      {' · '}
                      {selectedUsage.length ? `em uso em: ${selectedUsage.map((slide) => slide.title).join(', ')}` : 'sem uso nos slides que você vê'}
                    </p>
                  </>
                )}
              </div>
              {canManage && renaming === null && (
                <>
                  <select
                    aria-label="Pasta da mídia"
                    value={selected.folderId ?? ''}
                    disabled={busy === 'media'}
                    onChange={(event) => void handleUpdateMedia(selected, { folderId: event.target.value || null })}
                    className={cn(fieldInputClass, 'w-auto min-w-[150px]')}
                  >
                    <option value="">Sem pasta</option>
                    {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                  </select>
                  <Button type="button" variant="ds-secondary" size="md" onClick={() => setRenaming(selected.fileName)}>Renomear</Button>
                  <Button type="button" variant="danger-link" size="md" onClick={() => setConfirm('media')}>Excluir</Button>
                </>
              )}
              {pick ? (
                <Button type="button" variant="primary-modal" size="md" className="ml-auto" onClick={() => { pick.onPick(selected); onOpenChange(false); }}>Usar esta mídia</Button>
              ) : (
                <Button type="button" variant="ds-ghost" size="md" className="ml-auto" onClick={() => onOpenChange(false)}>Fechar</Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
