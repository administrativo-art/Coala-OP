"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { Check, Copy, Eye, GripVertical, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { fieldInputClass } from '@/components/patterns/field';
import { FilterChips } from '@/components/patterns/filter-chips';
import { HeroChip } from '@/components/patterns/hero-chip';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { PageHero } from '@/components/patterns/page-hero';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { useKioskGroups } from '@/hooks/use-kiosk-groups';
import { useKiosks } from '@/hooks/use-kiosks';
import { useToast } from '@/hooks/use-toast';
import { authenticatedApiRequest } from '@/lib/authenticated-api-client';
import { signageDb } from '@/lib/firebase-signage';
import {
  formatSignageDuration,
  getPublicationState,
  getScreenSlides,
  getSlideOrder,
  isSlideScheduleActive,
  SIGNAGE_FETCH_TIMEOUT_MS,
  type SignagePublicationState,
} from '@/lib/signage';
import { canAccessUnit } from '@/lib/unit-access';
import { cn } from '@/lib/utils';
import { type Kiosk, type PlayerHeartbeat, type PublishedPlayerDocument, type SignageMediaItem, type SignageScreen, type SignageSlide } from '@/types';

import {
  DEFAULT_TEXT_BACKGROUND,
  describeSchedule,
  formatRelativeTime,
  getPlayerHealth,
  getScreenLabel,
  LiveDot,
  type ScreenOption,
  SLIDE_TYPE_LABEL,
  SlideThumb,
  toSlidePayload,
} from './signage-admin-shared';
import { SignageCopyDialog } from './signage-copy-dialog';
import { SignageMediaLibrary } from './signage-media-library';
import { SignageSlideDialog, type SignageApiRequest } from './signage-slide-dialog';

const HEALTH_REFRESH_MS = 30_000;
const SLIDE_ROW_GRID = 'grid grid-cols-[20px_20px_72px_minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-3 sm:grid-cols-[20px_20px_72px_minmax(0,1fr)_auto_auto]';

type SlideRowProps = {
  slide: SignageSlide;
  /** Posição na sequência exibida; slides pausados não têm. */
  position?: number;
  otherScreensCount: number;
  canManage: boolean;
  onEdit: (slide: SignageSlide) => void;
  onAskRemove: (slide: SignageSlide) => void;
  onToggleActive: (slide: SignageSlide, isActive: boolean) => void;
  onPreview: (slide: SignageSlide) => void;
  dragHandle?: React.ReactNode;
};

function SlideRowContent({ slide, position, otherScreensCount, canManage, onEdit, onAskRemove, onToggleActive, onPreview, dragHandle }: SlideRowProps) {
  const schedule = describeSchedule(slide.schedule);
  const outsideSchedule = slide.isActive && slide.schedule ? !isSlideScheduleActive(slide) : false;
  const meta = [
    SLIDE_TYPE_LABEL[slide.type],
    formatSignageDuration(slide.durationMs),
    schedule,
    otherScreensCount > 0 ? `também em ${otherScreensCount} ${otherScreensCount === 1 ? 'tela' : 'telas'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <div>{dragHandle}</div>
      <span className="text-center font-ds-mono text-[13px] font-bold tabular-nums text-ds-ink-muted" aria-label={position ? `Posição ${position}` : 'Fora da sequência'}>
        {position ?? '–'}
      </span>
      <SlideThumb slide={slide} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[13.5px] font-bold text-ds-ink">{slide.title}</p>
          {outsideSchedule && <StatusPill variant="neutral">Fora do horário</StatusPill>}
        </div>
        <p className="mt-0.5 truncate text-xs text-ds-ink-muted">{meta}</p>
      </div>
      <div className="hidden sm:block">
        {canManage ? (
          <Switch
            checked={slide.isActive}
            aria-label={slide.isActive ? `Pausar ${slide.title}` : `Ativar ${slide.title}`}
            onCheckedChange={(checked) => onToggleActive(slide, checked)}
          />
        ) : (
          <StatusPill variant={slide.isActive ? 'ok' : 'neutral'}>{slide.isActive ? 'Ativo' : 'Pausado'}</StatusPill>
        )}
      </div>
      <div className="flex justify-end gap-1">
        <Button type="button" size="icon" variant="ds-ghost" className="h-8 w-8" aria-label={`Visualizar ${slide.title}`} onClick={() => onPreview(slide)}>
          <Eye aria-hidden="true" className="h-4 w-4" />
        </Button>
        {canManage && (
          <>
            <Button type="button" size="icon" variant="ds-ghost" className="h-8 w-8" aria-label={`Editar ${slide.title}`} onClick={() => onEdit(slide)}>
              <Pencil aria-hidden="true" className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="ds-ghost" className="h-8 w-8 hover:text-ds-danger" aria-label={`Remover ${slide.title}`} onClick={() => onAskRemove(slide)}>
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function SortableSlideRow(props: SlideRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.slide.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(SLIDE_ROW_GRID, 'bg-ds-surface', isDragging && 'relative z-[2] rounded-ds-btn shadow-ds-lift')}
    >
      <SlideRowContent
        {...props}
        dragHandle={props.canManage ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none rounded-ds-sm p-0.5 text-ds-ink-faint hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink active:cursor-grabbing"
            aria-label={`Reordenar ${props.slide.title}`}
          >
            <GripVertical aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
      />
    </div>
  );
}

function PublicationSummary({ state, published, heartbeat }: {
  state: SignagePublicationState | 'unknown';
  published: PublishedPlayerDocument | null | undefined;
  heartbeat: PlayerHeartbeat | undefined;
}) {
  if (state === 'unknown') return <p className="text-[13px] text-ds-ink-muted">Verificando a última publicação…</p>;
  if (state === 'never' || !published) {
    return <p className="text-[13px] text-ds-ink-muted">Esta tela ainda não foi publicada. A TV só mostra o conteúdo depois da primeira publicação.</p>;
  }

  const playerOnline = getPlayerHealth(heartbeat).online;
  const playerHasVersion = heartbeat?.updatedAt === published.updatedAt;

  return (
    <div className="space-y-2">
      {state === 'outdated' ? (
        <div className="rounded-ds-btn-lg border border-ds-alert-border bg-ds-alert-bg px-3 py-2.5 text-ds-alert-ink">
          <p className="text-[13px] font-extrabold">Há alterações não publicadas</p>
          <p className="mt-0.5 text-[12.5px]">A tela continua com a versão anterior até você publicar.</p>
        </div>
      ) : (
        <StatusPill variant="ok">Publicação em dia</StatusPill>
      )}
      <p className="text-xs text-ds-ink-muted">
        Última publicação {formatRelativeTime(published.updatedAt)}
        {published.generatedBy?.username ? ` por ${published.generatedBy.username}` : ''}
        {' · '}{published.slides?.length ?? 0} {published.slides?.length === 1 ? 'slide' : 'slides'}
      </p>
      {playerOnline && (
        <p className="text-xs text-ds-ink-muted">
          {playerHasVersion ? 'A tela já exibe essa publicação.' : 'A tela ainda não confirmou essa publicação.'}
        </p>
      )}
    </div>
  );
}

export function SignageAdmin() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, firebaseUser, isAuthenticated, loading: authLoading, permissions, isDefaultAdmin } = useAuth();
  const { kiosks, loading: kiosksLoading, updateKiosk } = useKiosks();
  const { groups: kioskGroups, groupOf } = useKioskGroups();
  const [slides, setSlides] = useState<SignageSlide[]>([]);
  const [screens, setScreens] = useState<SignageScreen[]>([]);
  const [loadingSlides, setLoadingSlides] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playerHealth, setPlayerHealth] = useState<Record<string, PlayerHeartbeat>>({});
  const [publishedByScreen, setPublishedByScreen] = useState<Record<string, PublishedPlayerDocument | null>>({});
  const [selectedKioskId, setSelectedKioskId] = useState<string | null>(null);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [slideDialog, setSlideDialog] = useState<{ open: boolean; slide: SignageSlide | null }>({ open: false, slide: null });
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  // `pick` presente: a biblioteca foi aberta pelo slide, para escolher uma mídia.
  const [library, setLibrary] = useState<{ open: boolean; pick?: { kind: 'image' | 'video'; onPick: (item: SignageMediaItem) => void } }>({ open: false });
  const [unitsDialogOpen, setUnitsDialogOpen] = useState(false);
  const [previewingSlide, setPreviewingSlide] = useState<SignageSlide | null>(null);
  const [removingSlideId, setRemovingSlideId] = useState<string | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [publishingScreenIds, setPublishingScreenIds] = useState<string[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [updatingKioskId, setUpdatingKioskId] = useState<string | null>(null);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [screenForm, setScreenForm] = useState<{ mode: 'add' | 'rename'; name: string } | null>(null);
  const [screenAction, setScreenAction] = useState<'saving' | 'deleting' | 'token' | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [confirmNewToken, setConfirmNewToken] = useState(false);
  const [confirmDeleteScreen, setConfirmDeleteScreen] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const newTokenButtonRef = useRef<HTMLButtonElement>(null);
  const deleteScreenButtonRef = useRef<HTMLButtonElement>(null);

  const canManage = (permissions.signage?.manage ?? false) || permissions.settings.manageUsers;
  const canView = canManage || permissions.signage?.view === true;

  const request = useCallback<SignageApiRequest>(<T,>(input: string, init: Parameters<SignageApiRequest>[1] = {}) => {
    const { timeoutMs = SIGNAGE_FETCH_TIMEOUT_MS, ...rest } = init;
    return authenticatedApiRequest<T>(input, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
      getIdToken: async () => firebaseUser?.getIdToken(),
    });
  }, [firebaseUser]);

  const allowedKiosks = useMemo(() => {
    if (!user) return [];
    return kiosks.filter((kiosk) => canAccessUnit(user, kiosk.id, { isDefaultAdmin }));
  }, [isDefaultAdmin, kiosks, user]);

  const enabledKiosks = useMemo(() => allowedKiosks.filter((kiosk) => kiosk.signageEnabled !== false), [allowedKiosks]);

  // Telas das unidades com signage; a padrão de cada unidade vem primeiro.
  const enabledScreens = useMemo(() => {
    const enabledIds = new Set(enabledKiosks.map((kiosk) => kiosk.id));
    return screens
      .filter((screen) => enabledIds.has(screen.kioskId))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, 'pt-BR'));
  }, [enabledKiosks, screens]);
  const enabledScreenIdsKey = enabledScreens.map((screen) => screen.id).join(',');

  const screenStatuses = useMemo(() => enabledScreens.map((screen) => {
    const screenSlides = getScreenSlides(slides, screen.id);
    const activeSlides = screenSlides.filter((slide) => slide.isActive);
    const published = publishedByScreen[screen.id];
    const publication: SignagePublicationState | 'unknown' =
      published === undefined || loadingSlides ? 'unknown' : getPublicationState(screen.id, slides, published);

    return {
      screen,
      slideCount: screenSlides.length,
      activeSlideCount: activeSlides.length,
      cycleMs: activeSlides.reduce((total, slide) => total + slide.durationMs, 0),
      health: getPlayerHealth(playerHealth[screen.id]),
      lastSeenAt: playerHealth[screen.id]?.lastSeenAt ?? null,
      publication,
    };
  }), [enabledScreens, loadingSlides, playerHealth, publishedByScreen, slides]);

  const kioskStatuses = useMemo(() => allowedKiosks.map((kiosk) => {
    const unitScreens = screenStatuses.filter(({ screen }) => screen.kioskId === kiosk.id);
    return {
      kiosk,
      signageEnabled: kiosk.signageEnabled !== false,
      screens: unitScreens,
      onlineCount: unitScreens.filter(({ health }) => health.online).length,
      slideCount: unitScreens.reduce((total, status) => total + status.slideCount, 0),
      activeSlideCount: unitScreens.reduce((total, status) => total + status.activeSlideCount, 0),
      pendingPublication: unitScreens.some(({ publication }) => publication === 'outdated' || publication === 'never'),
    };
  }), [allowedKiosks, screenStatuses]);

  const enabledStatuses = kioskStatuses.filter(({ signageEnabled }) => signageEnabled);
  // Grupos de unidades do DP, contando só as unidades com tela; o filtro some quando há um grupo só.
  const groupChips = kioskGroups
    .map((group) => ({ value: group.id, label: group.name, count: enabledKiosks.filter((kiosk) => groupOf(kiosk.id).id === group.id).length }))
    .filter((chip) => chip.count > 0);
  const activeGroupId = groupChips.length > 1 && groupChips.some((chip) => chip.value === selectedGroupId) ? selectedGroupId : null;
  const visibleStatuses = activeGroupId ? enabledStatuses.filter(({ kiosk }) => groupOf(kiosk.id).id === activeGroupId) : enabledStatuses;
  const visibleKioskIdsKey = visibleStatuses.map(({ kiosk }) => kiosk.id).join(',');
  const visibleScreenStatuses = visibleStatuses.flatMap((status) => status.screens);
  const onlineScreensCount = visibleScreenStatuses.filter(({ health }) => health.online).length;
  const offlineScreensCount = visibleScreenStatuses.length - onlineScreensCount;
  const pendingPublicationCount = visibleScreenStatuses.filter(({ publication }) => publication === 'outdated' || publication === 'never').length;
  const totalActiveSlides = slides.filter((slide) => slide.isActive).length;

  const selectedKiosk = enabledKiosks.find((kiosk) => kiosk.id === selectedKioskId) ?? null;
  const unitScreenStatuses = screenStatuses.filter(({ screen }) => screen.kioskId === selectedKioskId);
  const unitScreenIdsKey = unitScreenStatuses.map(({ screen }) => screen.id).join(',');
  const selectedStatus = unitScreenStatuses.find(({ screen }) => screen.id === selectedScreenId) ?? null;
  const selectedScreen = selectedStatus?.screen ?? null;

  const screensPerKiosk = useMemo(() => {
    const counts = new Map<string, number>();
    enabledScreens.forEach((screen) => counts.set(screen.kioskId, (counts.get(screen.kioskId) ?? 0) + 1));
    return counts;
  }, [enabledScreens]);
  const screenOptions: ScreenOption[] = useMemo(
    () => enabledScreens
      .map((screen) => ({ id: screen.id, label: getScreenLabel(screen, screensPerKiosk.get(screen.kioskId) ?? 1) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    [enabledScreens, screensPerKiosk]
  );
  const nextOrderByScreen = useMemo(() => Object.fromEntries(enabledScreens.map((screen) => [
    screen.id,
    getScreenSlides(slides, screen.id).reduce((max, slide) => Math.max(max, getSlideOrder(slide, screen.id) + 1), 0),
  ])), [enabledScreens, slides]);

  const visibleSlides = useMemo(() => (selectedScreenId ? getScreenSlides(slides, selectedScreenId) : []), [selectedScreenId, slides]);
  const activeVisibleSlides = visibleSlides.filter((slide) => slide.isActive);
  const pausedVisibleSlides = visibleSlides.filter((slide) => !slide.isActive);
  const copyTargets = screenOptions.filter((option) => option.id !== selectedScreenId);
  const unitHasManyScreens = unitScreenStatuses.length > 1;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  // Abre direto na primeira unidade visível; troca quando a selecionada sai do filtro ou perde o signage.
  useEffect(() => {
    const ids = visibleKioskIdsKey ? visibleKioskIdsKey.split(',') : [];
    setSelectedKioskId((current) => (current && ids.includes(current) ? current : ids[0] ?? null));
  }, [visibleKioskIdsKey]);

  // Dentro da unidade, mantém a tela escolhida enquanto ela existir; senão vai para a primeira.
  useEffect(() => {
    const ids = unitScreenIdsKey ? unitScreenIdsKey.split(',') : [];
    setSelectedScreenId((current) => (current && ids.includes(current) ? current : ids[0] ?? null));
  }, [unitScreenIdsKey]);

  useEffect(() => {
    setRemovingSlideId(null);
    setRemoveError(null);
    setPublishError(null);
    setScreenForm(null);
    setScreenError(null);
    setConfirmNewToken(false);
    setConfirmDeleteScreen(false);
    setUrlCopied(false);
  }, [selectedScreenId]);

  const loadSlides = useCallback(async () => {
    if (!firebaseUser || !canView) {
      setLoadingSlides(false);
      return;
    }

    try {
      setLoadError(null);
      const [slidesData, screensData] = await Promise.all([
        request<{ slides: SignageSlide[] }>('/api/signage/slides', { fallbackError: 'Falha ao carregar os slides.' }),
        request<{ screens: SignageScreen[] }>('/api/signage/screens', { fallbackError: 'Falha ao carregar as telas.' }),
      ]);
      setSlides(slidesData.slides);
      setScreens(screensData.screens);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Falha ao carregar os slides.');
    } finally {
      setLoadingSlides(false);
    }
  }, [canView, firebaseUser, request]);

  const loadPlayerHealth = useCallback(async () => {
    if (!firebaseUser || !canView) return;

    try {
      const data = await request<{ heartbeats: PlayerHeartbeat[] }>('/api/signage/heartbeat');
      setPlayerHealth(Object.fromEntries(data.heartbeats.map((heartbeat) => [heartbeat.screenId ?? heartbeat.kioskId, heartbeat])));
    } catch {
      // keep health as best-effort; do not block admin usage
    }
  }, [canView, firebaseUser, request]);

  // Uma leitura por tela, ao abrir e depois de publicar; não há polling.
  const loadPublished = useCallback(async (screenIds: string[]) => {
    const entries = await Promise.all(screenIds.map(async (screenId) => {
      try {
        const snapshot = await getDoc(doc(signageDb, 'publishedPlayers', screenId));
        return [screenId, snapshot.exists() ? (snapshot.data() as PublishedPlayerDocument) : null] as const;
      } catch {
        return null;
      }
    }));
    const loaded = entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (loaded.length) setPublishedByScreen((prev) => ({ ...prev, ...Object.fromEntries(loaded) }));
  }, []);

  useEffect(() => {
    void loadSlides();
    void loadPlayerHealth();
  }, [loadPlayerHealth, loadSlides]);

  useEffect(() => {
    if (!firebaseUser || !canView) return;
    const interval = setInterval(() => {
      void loadPlayerHealth();
    }, HEALTH_REFRESH_MS);

    return () => clearInterval(interval);
  }, [canView, firebaseUser, loadPlayerHealth]);

  useEffect(() => {
    if (!canView || !enabledScreenIdsKey) return;
    void loadPublished(enabledScreenIdsKey.split(','));
  }, [canView, enabledScreenIdsKey, loadPublished]);

  async function handleRefresh() {
    setLoadingSlides(true);
    await Promise.all([loadSlides(), loadPlayerHealth(), loadPublished(enabledScreens.map((screen) => screen.id))]);
  }

  async function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!selectedScreenId || !over || active.id === over.id) return;

    const oldIndex = activeVisibleSlides.findIndex((slide) => slide.id === active.id);
    const newIndex = activeVisibleSlides.findIndex((slide) => slide.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    // A posição é desta tela; as outras telas que exibem o slide não mudam.
    const changed = [...arrayMove(activeVisibleSlides, oldIndex, newIndex), ...pausedVisibleSlides]
      .map((slide, index) => ({ slide, index }))
      .filter(({ slide, index }) => slide.orderByScreen?.[selectedScreenId] !== index)
      .map(({ slide, index }) => ({ ...slide, orderByScreen: { ...slide.orderByScreen, [selectedScreenId]: index } }));

    const nextById = new Map(changed.map((slide) => [slide.id, slide]));
    setSlides((prev) => prev.map((slide) => nextById.get(slide.id) ?? slide));

    try {
      await Promise.all(changed.map((slide) => request(`/api/signage/slides/${slide.id}`, {
        method: 'PUT',
        json: toSlidePayload(slide),
        fallbackError: 'Falha ao salvar a ordem.',
      })));
    } catch (error) {
      toast({
        title: 'A nova ordem não foi salva',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
      await loadSlides();
    }
  }

  async function handleToggleActive(slide: SignageSlide, isActive: boolean) {
    setSlides((prev) => prev.map((item) => item.id === slide.id ? { ...item, isActive } : item));
    try {
      await request(`/api/signage/slides/${slide.id}`, {
        method: 'PUT',
        json: toSlidePayload(slide, { isActive }),
        fallbackError: 'Falha ao atualizar o slide.',
      });
    } catch (error) {
      setSlides((prev) => prev.map((item) => item.id === slide.id ? { ...item, isActive: slide.isActive } : item));
      toast({
        title: isActive ? 'O slide não foi ativado' : 'O slide não foi pausado',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
    }
  }

  // Slide exibido em mais de uma tela só sai desta; o último vínculo exclui o slide e a mídia.
  async function handleRemove(slide: SignageSlide) {
    if (!selectedScreenId) return;
    const remainingScreenIds = slide.screenIds.filter((screenId) => screenId !== selectedScreenId);

    try {
      setRemoveLoading(true);
      setRemoveError(null);
      if (remainingScreenIds.length) {
        await request(`/api/signage/slides/${slide.id}`, {
          method: 'PUT',
          json: toSlidePayload(slide, { screenIds: remainingScreenIds }),
          fallbackError: 'Falha ao remover o slide desta tela.',
        });
      } else {
        await request(`/api/signage/slides/${slide.id}`, { method: 'DELETE', fallbackError: 'Falha ao excluir o slide.' });
      }
      setRemovingSlideId(null);
      await loadSlides();
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : 'Falha ao remover o slide.');
    } finally {
      setRemoveLoading(false);
    }
  }

  async function publishScreens(screenIds: string[]) {
    try {
      setPublishError(null);
      setPublishingScreenIds(screenIds);
      const data = await request<{ publishedScreenIds: string[] }>('/api/signage/publish', {
        method: 'POST',
        json: { screenIds },
        fallbackError: 'Falha ao publicar.',
      });
      await loadPublished(data.publishedScreenIds);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : 'Falha ao publicar.');
    } finally {
      setPublishingScreenIds([]);
    }
  }

  async function handleToggleSignage(kiosk: Kiosk, checked: boolean) {
    try {
      setUnitsError(null);
      setUpdatingKioskId(kiosk.id);
      await updateKiosk({ ...kiosk, signageEnabled: checked });
    } catch (error) {
      setUnitsError(error instanceof Error ? error.message : `Não foi possível atualizar ${kiosk.name}.`);
    } finally {
      setUpdatingKioskId(null);
    }
  }

  async function handleSaveScreen() {
    if (!screenForm || !selectedKiosk) return;
    const name = screenForm.name.trim();
    if (!name) {
      setScreenError('Dê um nome para a tela, como "Vitrine" ou "Balcão".');
      return;
    }

    try {
      setScreenError(null);
      setScreenAction('saving');
      if (screenForm.mode === 'add') {
        const data = await request<{ screen: SignageScreen }>('/api/signage/screens', {
          method: 'POST',
          json: { kioskId: selectedKiosk.id, name },
          fallbackError: 'Falha ao adicionar a tela.',
        });
        setScreens((prev) => [...prev, data.screen]);
        setSelectedScreenId(data.screen.id);
      } else if (selectedScreen) {
        const data = await request<{ screen: SignageScreen }>(`/api/signage/screens/${selectedScreen.id}`, {
          method: 'PATCH',
          json: { name },
          fallbackError: 'Falha ao renomear a tela.',
        });
        setScreens((prev) => prev.map((screen) => screen.id === data.screen.id ? data.screen : screen));
      }
      setScreenForm(null);
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : 'Falha ao salvar a tela.');
    } finally {
      setScreenAction(null);
    }
  }

  async function handleScreenToken(screen: SignageScreen, token: 'rotate' | 'clear') {
    try {
      setScreenError(null);
      setScreenAction('token');
      const data = await request<{ screen: SignageScreen }>(`/api/signage/screens/${screen.id}`, {
        method: 'PATCH',
        json: { token },
        fallbackError: 'Falha ao salvar o código de acesso.',
      });
      setScreens((prev) => prev.map((item) => item.id === data.screen.id ? data.screen : item));
      setConfirmNewToken(false);
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : 'Falha ao salvar o código de acesso.');
    } finally {
      setScreenAction(null);
    }
  }

  async function handleDeleteScreen(screen: SignageScreen) {
    try {
      setScreenError(null);
      setScreenAction('deleting');
      await request(`/api/signage/screens/${screen.id}`, { method: 'DELETE', fallbackError: 'Falha ao excluir a tela.' });
      setConfirmDeleteScreen(false);
      await loadSlides();
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : 'Falha ao excluir a tela.');
    } finally {
      setScreenAction(null);
    }
  }

  if (authLoading || kiosksLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-36 w-full rounded-ds-panel" />
        <Skeleton className="h-96 w-full rounded-ds-card" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (!canView) {
    return (
      <div className="rounded-ds-card border border-ds-border bg-ds-surface p-8 text-center font-ds">
        <p className="text-[15px] font-extrabold text-ds-ink">Acesso bloqueado</p>
        <p className="mt-1 text-[13px] text-ds-ink-muted">Seu perfil não tem permissão para acessar o Coala Signage.</p>
      </div>
    );
  }

  const tvPath = selectedScreen ? `/tv/${selectedScreen.id}${selectedScreen.deviceToken ? `?token=${selectedScreen.deviceToken}` : ''}` : '';
  const tvUrl = typeof window !== 'undefined' ? `${window.location.origin}${tvPath}` : tvPath;
  // Pasta com o `sssp_config.xml` e o `.wgt` gerados por `scripts/build-signage-tizen-app.mjs`.
  const signageAppUrl = typeof window !== 'undefined' ? `${window.location.origin}/app` : '/app';
  const publishingAll = publishingScreenIds.length > 1;
  const removingSlide = visibleSlides.find((slide) => slide.id === removingSlideId) ?? null;
  const publishIsPrimary = selectedStatus?.publication === 'outdated' || selectedStatus?.publication === 'never';
  const selectedScreenLabel = selectedScreen && selectedKiosk
    ? (unitHasManyScreens ? `${selectedKiosk.name} · ${selectedScreen.name}` : selectedKiosk.name)
    : '';
  const exclusiveSlideCount = visibleSlides.filter((slide) => slide.screenIds.length === 1).length;

  const rowProps = (slide: SignageSlide, position?: number) => ({
    slide,
    position,
    otherScreensCount: slide.screenIds.filter((screenId) => screenId !== selectedScreenId).length,
    canManage,
    onEdit: (target: SignageSlide) => setSlideDialog({ open: true, slide: target }),
    onAskRemove: (target: SignageSlide) => { setRemoveError(null); setRemovingSlideId(target.id); },
    onToggleActive: (target: SignageSlide, checked: boolean) => void handleToggleActive(target, checked),
    onPreview: setPreviewingSlide,
  });

  const removeConfirm = removingSlide && selectedScreen ? (
    <div className="space-y-1.5 px-[18px] pb-3">
      <InlineConfirm
        message={removingSlide.screenIds.length > 1
          ? `Remover "${removingSlide.title}" de ${selectedScreenLabel}? Ele continua nas outras telas.`
          : `Excluir "${removingSlide.title}"? O slide e a mídia são apagados e isso não pode ser desfeito.`}
        confirmLabel={removingSlide.screenIds.length > 1 ? 'Remover' : 'Excluir'}
        loadingLabel={removingSlide.screenIds.length > 1 ? 'Removendo…' : 'Excluindo…'}
        loading={removeLoading}
        onConfirm={() => void handleRemove(removingSlide)}
        onCancel={() => setRemovingSlideId(null)}
      />
      {removeError && <p role="alert" className="text-xs font-semibold text-ds-danger">{removeError}</p>}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-6 font-ds">
      <PageHero
        kicker="Marketing"
        title="Coala Signage"
        subtitle="Monte a playlist de cada tela e publique quando estiver pronta."
        actions={
          <>
            <Button type="button" variant="on-dark-secondary" size="sm" onClick={() => void handleRefresh()}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Atualizar dados
            </Button>
            <Button type="button" variant="on-dark-secondary" size="sm" onClick={() => setLibrary({ open: true })}>
              Biblioteca
            </Button>
            {canManage && (
              <Button type="button" variant="on-dark-secondary" size="sm" onClick={() => { setUnitsError(null); setUnitsDialogOpen(true); }}>
                Gerenciar unidades
              </Button>
            )}
            {canManage && visibleScreenStatuses.length > 1 && (
              <Button
                type="button"
                variant="on-dark-secondary"
                size="sm"
                loading={publishingAll}
                loadingLabel="Publicando…"
                disabled={publishingScreenIds.length > 0}
                onClick={() => void publishScreens(visibleScreenStatuses.map(({ screen }) => screen.id))}
              >
                {activeGroupId ? 'Publicar o grupo' : 'Publicar todas'}
              </Button>
            )}
          </>
        }
        chips={
          <>
            <HeroChip value={visibleScreenStatuses.length} label={visibleScreenStatuses.length === 1 ? 'tela' : 'telas'} />
            <HeroChip value={onlineScreensCount} label="no ar" tone="info" />
            <HeroChip value={offlineScreensCount} label="sem resposta" tone="danger" />
            <HeroChip value={pendingPublicationCount} label="aguardando publicação" tone="warning" />
            <HeroChip value={totalActiveSlides} label="slides ativos" />
          </>
        }
      >
        {groupChips.length > 1 && (
          <div>
            <p className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Grupo</p>
            <FilterChips value={activeGroupId} onChange={setSelectedGroupId} allLabel="Todos os grupos" allCount={enabledKiosks.length} chips={groupChips} />
          </div>
        )}
      </PageHero>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-ds-btn-lg border border-ds-confirm-border bg-ds-confirm-bg px-4 py-3">
          <p className="text-[13px] font-semibold text-ds-confirm-ink">{loadError}</p>
          <Button type="button" variant="ds-secondary" size="xs" onClick={() => void handleRefresh()}>Tentar de novo</Button>
        </div>
      )}

      {enabledKiosks.length === 0 ? (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-8 text-center">
          <p className="text-[15px] font-extrabold text-ds-ink">Nenhuma unidade com tela</p>
          <p className="mt-1 text-[13px] text-ds-ink-muted">Ative o signage nas unidades que têm TV para começar a montar as playlists.</p>
          {canManage && (
            <Button type="button" variant="primary-page" size="md" className="mt-4" onClick={() => setUnitsDialogOpen(true)}>
              Ativar unidades
            </Button>
          )}
        </div>
      ) : (
        <div role="group" aria-label="Unidades com tela" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleStatuses.map(({ kiosk, screens: unitScreens, onlineCount, slideCount, activeSlideCount, pendingPublication }) => {
            const isSelected = kiosk.id === selectedKioskId;
            const single = unitScreens.length === 1 ? unitScreens[0] : null;
            const unitVariant = single
              ? single.health.variant
              : onlineCount === unitScreens.length ? 'ok' : onlineCount > 0 ? 'warn' : unitScreens.some(({ lastSeenAt }) => lastSeenAt) ? 'danger' : 'neutral';
            const unitLabel = single ? single.health.label : `${onlineCount} de ${unitScreens.length} no ar`;
            return (
              <button
                key={kiosk.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedKioskId(kiosk.id)}
                className={cn(
                  'rounded-ds-card border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2',
                  isSelected ? 'border-ds-accent-ink bg-ds-accent-row shadow-[inset_3px_0_0_var(--ds-accent-ink)]' : 'border-ds-border bg-ds-surface hover:bg-ds-muted',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-extrabold text-ds-ink">{kiosk.name}</p>
                  <StatusPill variant={unitVariant} className="gap-1.5"><LiveDot variant={unitVariant} />{unitLabel}</StatusPill>
                </div>
                <p className="mt-2 text-[13px] font-semibold text-ds-ink-2">
                  {single
                    ? (slideCount === 0
                      ? 'Sem slides'
                      : `${activeSlideCount} de ${slideCount} ${slideCount === 1 ? 'slide ativo' : 'slides ativos'} · ciclo de ${formatSignageDuration(single.cycleMs)}`)
                    : `${unitScreens.length} telas · ${activeSlideCount} ${activeSlideCount === 1 ? 'slide ativo' : 'slides ativos'}`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {pendingPublication && <StatusPill variant="warn">Publicação pendente</StatusPill>}
                  {single && (
                    <span className="text-xs text-ds-ink-muted">
                      {single.lastSeenAt ? `Último sinal ${formatRelativeTime(single.lastSeenAt)}` : 'A tela ainda não se conectou'}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedKiosk && (unitHasManyScreens || canManage) && unitScreenStatuses.length > 0 && (
        <section aria-label={`Telas de ${selectedKiosk.name}`} className="rounded-ds-card border border-ds-border bg-ds-surface px-[18px] py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-1 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Telas de {selectedKiosk.name}</h2>
            {unitScreenStatuses.map(({ screen, health }) => {
              const active = screen.id === selectedScreenId;
              return (
                <button
                  key={screen.id}
                  type="button"
                  aria-pressed={active}
                  title={health.label}
                  onClick={() => setSelectedScreenId(screen.id)}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-ds-pill border px-3.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2',
                    active ? 'border-ds-accent-ink bg-ds-accent-soft text-ds-accent-ink' : 'border-ds-border-input bg-ds-surface text-ds-ink-2 hover:bg-ds-muted',
                  )}
                >
                  <LiveDot variant={health.variant} />
                  {screen.name}
                  <span className="sr-only">, {health.label}</span>
                </button>
              );
            })}
            {canManage && screenForm?.mode !== 'add' && (
              <Button type="button" variant="ds-link" size="xs" onClick={() => { setScreenError(null); setScreenForm({ mode: 'add', name: '' }); }}>
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                Adicionar tela
              </Button>
            )}
          </div>
          {screenForm?.mode === 'add' && (
            <form className="mt-3 flex flex-wrap items-start gap-2" onSubmit={(event) => { event.preventDefault(); void handleSaveScreen(); }}>
              <div className="min-w-[220px] flex-1 sm:max-w-xs">
                <input
                  autoFocus
                  aria-label="Nome da nova tela"
                  placeholder="Nome da tela, como Vitrine ou Balcão"
                  maxLength={60}
                  value={screenForm.name}
                  aria-invalid={Boolean(screenError)}
                  onChange={(event) => { setScreenError(null); setScreenForm({ mode: 'add', name: event.target.value }); }}
                  className={fieldInputClass}
                />
                {screenError && <p role="alert" className="mt-1.5 text-xs font-semibold text-ds-danger">{screenError}</p>}
              </div>
              <Button type="submit" variant="primary-modal" size="sm" loading={screenAction === 'saving'}>Adicionar tela</Button>
              <Button type="button" variant="ds-ghost" size="sm" onClick={() => { setScreenForm(null); setScreenError(null); }}>Cancelar</Button>
            </form>
          )}
        </section>
      )}

      {selectedKiosk && selectedScreen && selectedStatus && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-label={`Playlist de ${selectedScreenLabel}`} className="rounded-ds-card border border-ds-border bg-ds-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ds-divider px-[18px] py-4">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="truncate text-[17px] font-extrabold text-ds-ink">Playlist de {selectedScreenLabel}</h2>
                  <StatusPill variant={selectedStatus.health.variant} className="gap-1.5">
                    <LiveDot variant={selectedStatus.health.variant} />
                    {selectedStatus.health.label}
                  </StatusPill>
                </div>
                <p className="mt-0.5 text-xs text-ds-ink-muted">
                  {activeVisibleSlides.length > 0
                    ? `${activeVisibleSlides.length} ${activeVisibleSlides.length === 1 ? 'slide' : 'slides'} em sequência · a tela repete a cada ${formatSignageDuration(selectedStatus.cycleMs)}`
                    : 'Nenhum slide ativo nesta tela'}
                </p>
              </div>
              {canManage && (
                <Button type="button" variant="primary-page" size="sm" onClick={() => setSlideDialog({ open: true, slide: null })}>
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  Adicionar slide
                </Button>
              )}
            </div>

            {loadingSlides ? (
              <div className="space-y-2 p-[18px]">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : visibleSlides.length === 0 ? (
              <div className="px-[18px] py-10 text-center">
                <p className="text-[14px] font-bold text-ds-ink">Esta tela ainda não tem slides</p>
                <p className="mx-auto mt-1 max-w-md text-[13px] text-ds-ink-muted">
                  {canManage
                    ? 'Adicione o primeiro slide ou abra uma tela que já tem conteúdo e use "Copiar playlist" para trazer os slides para cá.'
                    : 'Quando alguém montar a playlist desta tela, ela aparece aqui.'}
                </p>
              </div>
            ) : (
              <>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleReorder(event)}>
                  <SortableContext items={activeVisibleSlides.map((slide) => slide.id)} strategy={verticalListSortingStrategy}>
                    {activeVisibleSlides.map((slide, index) => (
                      <div key={slide.id} className="border-b border-ds-divider last:border-b-0">
                        <SortableSlideRow {...rowProps(slide, index + 1)} />
                        {removingSlideId === slide.id && removeConfirm}
                      </div>
                    ))}
                  </SortableContext>
                </DndContext>

                {pausedVisibleSlides.length > 0 && (
                  <>
                    <p className="border-y border-dashed border-ds-border bg-ds-muted px-[18px] py-2 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">
                      Pausados · fora da tela
                    </p>
                    {pausedVisibleSlides.map((slide) => (
                      <div key={slide.id} className="border-b border-ds-divider last:border-b-0">
                        <div className={cn(SLIDE_ROW_GRID, 'opacity-70')}>
                          <SlideRowContent {...rowProps(slide)} />
                        </div>
                        {removingSlideId === slide.id && removeConfirm}
                      </div>
                    ))}
                  </>
                )}

                {canManage && activeVisibleSlides.length > 1 && (
                  <p className="border-t border-ds-divider px-[18px] py-2.5 text-xs text-ds-ink-muted">
                    Arraste pela alça para mudar a ordem. A sequência é salva na hora e vale só para esta tela.
                  </p>
                )}
              </>
            )}
          </section>

          <aside className="flex flex-col gap-4">
            <section className="rounded-ds-card border border-ds-border bg-ds-surface p-4">
              <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Publicação</h3>
              <div className="mt-3">
                <PublicationSummary state={selectedStatus.publication} published={publishedByScreen[selectedScreen.id]} heartbeat={playerHealth[selectedScreen.id]} />
              </div>
              {canManage && (
                <Button
                  type="button"
                  variant={publishIsPrimary ? 'primary-page' : 'ds-secondary'}
                  size="md"
                  className="mt-4 w-full"
                  loading={publishingScreenIds.includes(selectedScreen.id)}
                  loadingLabel="Publicando…"
                  disabled={publishingScreenIds.length > 0}
                  onClick={() => void publishScreens([selectedScreen.id])}
                >
                  {publishIsPrimary ? 'Publicar na tela' : 'Publicar de novo'}
                </Button>
              )}
              {publishError && <p role="alert" className="mt-2 text-xs font-semibold text-ds-danger">{publishError}</p>}
            </section>

            {canManage && copyTargets.length > 0 && (
              <section className="rounded-ds-card border border-ds-border bg-ds-surface p-4">
                <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Replicar</h3>
                <p className="mt-3 text-[13px] text-ds-ink-muted">Leve os slides de uma tela para outras sem cadastrar tudo de novo. Você escolhe a origem e os destinos.</p>
                <Button
                  type="button"
                  variant="ds-secondary"
                  size="md"
                  className="mt-3 w-full"
                  onClick={() => setCopyDialogOpen(true)}
                >
                  <Copy aria-hidden="true" className="h-4 w-4" />
                  Copiar playlist
                </Button>
              </section>
            )}

            <section className="rounded-ds-card border border-ds-border bg-ds-surface p-4">
              <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Conectar a tela</h3>

              <p className="mt-3 text-xs font-bold text-ds-ink-2">Nome da tela</p>
              {screenForm?.mode === 'rename' ? (
                <form className="mt-1.5 space-y-2" onSubmit={(event) => { event.preventDefault(); void handleSaveScreen(); }}>
                  <input
                    autoFocus
                    aria-label="Nome da tela"
                    maxLength={60}
                    value={screenForm.name}
                    onChange={(event) => { setScreenError(null); setScreenForm({ mode: 'rename', name: event.target.value }); }}
                    className={fieldInputClass}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary-modal" size="xs" loading={screenAction === 'saving'}>Salvar nome</Button>
                    <Button type="button" variant="ds-ghost" size="xs" onClick={() => { setScreenForm(null); setScreenError(null); }}>Cancelar</Button>
                  </div>
                </form>
              ) : (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-[13.5px] font-bold text-ds-ink">{selectedScreen.name}</p>
                  {canManage && (
                    <Button type="button" variant="ds-link" size="xs" className="h-auto p-0" onClick={() => { setScreenError(null); setScreenForm({ mode: 'rename', name: selectedScreen.name }); }}>
                      Renomear
                    </Button>
                  )}
                </div>
              )}

              <p className="mt-4 text-xs font-bold text-ds-ink-2">Endereço do player</p>
              <div className="mt-1.5 flex items-start gap-2">
                <a
                  href={tvPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 break-all font-ds-mono text-[11.5px] text-ds-accent-ink underline underline-offset-2 hover:text-ds-accent-ink-hover"
                >
                  {tvUrl}
                </a>
                <Button
                  type="button"
                  variant="ds-secondary"
                  size="xs"
                  className="shrink-0"
                  onClick={() => void navigator.clipboard.writeText(tvUrl).then(() => setUrlCopied(true)).catch(() => setUrlCopied(false))}
                >
                  {urlCopied ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
                  {urlCopied ? 'Copiado' : 'Copiar'}
                </Button>
              </div>

              <p className="mt-4 text-xs font-bold text-ds-ink-2">Código de acesso</p>
              {selectedScreen.deviceToken ? (
                <p className="mt-1 font-ds-mono text-[17px] font-bold tracking-[0.18em] text-ds-ink">{selectedScreen.deviceToken}</p>
              ) : (
                <p className="mt-1 text-[13px] text-ds-ink-muted">Sem código: qualquer pessoa com o endereço abre o player.</p>
              )}
              {canManage && (
                confirmNewToken ? (
                  <InlineConfirm
                    className="mt-3 flex-col items-stretch"
                    message="Gerar um novo código? A TV conectada com o código atual para de atualizar até receber o novo endereço."
                    confirmLabel="Gerar código"
                    loadingLabel="Gerando…"
                    loading={screenAction === 'token'}
                    returnFocusRef={newTokenButtonRef}
                    onConfirm={() => void handleScreenToken(selectedScreen, 'rotate')}
                    onCancel={() => setConfirmNewToken(false)}
                  />
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      ref={newTokenButtonRef}
                      type="button"
                      variant="ds-secondary"
                      size="xs"
                      disabled={screenAction === 'token'}
                      onClick={() => {
                        if (selectedScreen.deviceToken) setConfirmNewToken(true);
                        else void handleScreenToken(selectedScreen, 'rotate');
                      }}
                    >
                      {selectedScreen.deviceToken ? 'Gerar novo código' : 'Proteger com código'}
                    </Button>
                    {selectedScreen.deviceToken && (
                      <Button type="button" variant="ds-ghost" size="xs" disabled={screenAction === 'token'} onClick={() => void handleScreenToken(selectedScreen, 'clear')}>
                        Remover código
                      </Button>
                    )}
                  </div>
                )
              )}

              <div className="mt-4 border-t border-ds-divider pt-3">
                <p className="text-xs font-bold text-ds-ink-2">App da tela</p>
                <p className="mt-1 text-xs text-ds-ink-muted">
                  No monitor Samsung, abra URL Launcher e informe o endereço abaixo. O app instala, pede o código de acesso desta tela e passa a tocar mesmo sem internet.
                </p>
                <p className="mt-1.5 break-all font-ds-mono text-[11.5px] text-ds-ink">{signageAppUrl}</p>
                <a
                  href="/app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-block text-xs font-bold text-ds-accent-ink underline-offset-2 hover:text-ds-accent-ink-hover hover:underline"
                >
                  Abrir a página de aplicativos
                </a>
                {!selectedScreen.deviceToken && (
                  <p className="mt-1.5 text-xs font-semibold text-ds-warn">Esta tela ainda não tem código de acesso; o app precisa de um para conectar.</p>
                )}
              </div>

              {canManage && !selectedScreen.isDefault && (
                <div className="mt-4 border-t border-ds-divider pt-3">
                  {confirmDeleteScreen ? (
                    <InlineConfirm
                      className="flex-col items-stretch"
                      message={exclusiveSlideCount > 0
                        ? `Excluir a tela ${selectedScreen.name}? ${exclusiveSlideCount} ${exclusiveSlideCount === 1 ? 'slide que só existe nela é apagado' : 'slides que só existem nela são apagados'} e isso não pode ser desfeito.`
                        : `Excluir a tela ${selectedScreen.name}? Os slides dela continuam nas outras telas.`}
                      confirmLabel="Excluir tela"
                      loading={screenAction === 'deleting'}
                      returnFocusRef={deleteScreenButtonRef}
                      onConfirm={() => void handleDeleteScreen(selectedScreen)}
                      onCancel={() => setConfirmDeleteScreen(false)}
                    />
                  ) : (
                    <Button ref={deleteScreenButtonRef} type="button" variant="danger-link" size="xs" className="h-auto p-0" onClick={() => { setScreenError(null); setConfirmDeleteScreen(true); }}>
                      Excluir tela
                    </Button>
                  )}
                </div>
              )}
              {screenError && screenForm?.mode !== 'add' && <p role="alert" className="mt-2 text-xs font-semibold text-ds-danger">{screenError}</p>}
            </section>
          </aside>
        </div>
      )}

      <Dialog open={!!previewingSlide} onOpenChange={(open) => { if (!open) setPreviewingSlide(null); }}>
        <DialogContent flush className="max-w-4xl gap-0 overflow-hidden rounded-ds-modal border-0 bg-ds-dark font-ds text-ds-on-dark shadow-ds-modal sm:max-w-4xl sm:rounded-ds-modal [&>button]:text-ds-on-dark">
          <div className="flex items-center justify-between gap-3 px-5 py-4 pr-12">
            <DialogTitle className="min-w-0 truncate text-sm font-bold text-ds-on-dark">{previewingSlide?.title}</DialogTitle>
            <span className="shrink-0 text-xs text-ds-on-dark-2">
              {previewingSlide ? `${SLIDE_TYPE_LABEL[previewingSlide.type]} · ${formatSignageDuration(previewingSlide.durationMs)}` : ''}
            </span>
          </div>
          <DialogDescription className="sr-only">Prévia do slide em proporção de tela 16:9</DialogDescription>
          <div
            className="aspect-video w-full overflow-hidden bg-black"
            style={previewingSlide?.type === 'text' ? { background: previewingSlide.background || DEFAULT_TEXT_BACKGROUND } : undefined}
          >
            {previewingSlide?.type === 'text' ? (
              <div className="flex h-full items-center justify-center p-10 text-center">
                <p className="font-semibold leading-tight text-white" style={{ fontSize: 'clamp(1.5rem, 5vw, 3.5rem)' }}>{previewingSlide.text}</p>
              </div>
            ) : previewingSlide?.assetUrl ? (
              previewingSlide.type === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- mídia servida pela rota de assets do signage
                <img src={previewingSlide.assetUrl} alt={previewingSlide.title} className="h-full w-full object-contain" />
              ) : (
                <video src={previewingSlide.assetUrl} className="h-full w-full object-contain" autoPlay muted loop playsInline controls />
              )
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ds-on-dark-2">Nenhuma mídia carregada</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <SignageSlideDialog
        open={slideDialog.open}
        onOpenChange={(open) => setSlideDialog((prev) => ({ ...prev, open }))}
        slide={slideDialog.slide}
        defaultScreenIds={selectedScreenId ? [selectedScreenId] : []}
        nextOrderByScreen={nextOrderByScreen}
        screens={screenOptions}
        onOpenLibrary={(kind, onPick) => setLibrary({ open: true, pick: { kind, onPick } })}
        request={request}
        onSaved={loadSlides}
      />

      <SignageMediaLibrary
        open={library.open}
        onOpenChange={(open) => setLibrary((prev) => ({ ...prev, open }))}
        request={request}
        canManage={canManage}
        slides={slides}
        pick={library.pick}
      />

      {selectedScreen && (
        <SignageCopyDialog
          open={copyDialogOpen}
          onOpenChange={setCopyDialogOpen}
          screens={screenOptions}
          initialSourceId={selectedScreen.id}
          allSlides={slides}
          nextOrderByScreen={nextOrderByScreen}
          request={request}
          onCopied={loadSlides}
        />
      )}

      <Dialog open={unitsDialogOpen} onOpenChange={setUnitsDialogOpen}>
        <DialogContent flush className="max-h-[calc(100vh-48px)] gap-0 overflow-hidden rounded-ds-modal border-0 bg-ds-input font-ds shadow-ds-modal sm:max-w-[520px] sm:rounded-ds-modal">
          <div className="border-b border-ds-border-footer px-7 pb-[18px] pt-6 pr-12">
            <DialogTitle className="text-[21px] font-extrabold tracking-[-0.02em] text-ds-ink">Unidades com tela</DialogTitle>
            <DialogDescription className="mt-0.5 text-[13px] text-ds-ink-muted">
              Ative só as unidades que têm TV. As demais ficam fora do painel e das publicações.
            </DialogDescription>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-7 py-2">
            {kioskStatuses.map(({ kiosk, signageEnabled, screens: unitScreens, onlineCount, slideCount }) => (
              <label key={kiosk.id} className="flex cursor-pointer items-center justify-between gap-4 border-b border-ds-divider py-3 last:border-b-0">
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-bold text-ds-ink">{kiosk.name}</span>
                  {signageEnabled && (
                    <span className="mt-0.5 block text-xs text-ds-ink-muted">
                      {unitScreens.length} {unitScreens.length === 1 ? 'tela' : 'telas'} · {onlineCount} no ar · {slideCount} {slideCount === 1 ? 'slide' : 'slides'}
                    </span>
                  )}
                </span>
                <Switch
                  checked={signageEnabled}
                  disabled={!canManage || updatingKioskId === kiosk.id}
                  aria-label={signageEnabled ? `Desativar signage de ${kiosk.name}` : `Ativar signage de ${kiosk.name}`}
                  onCheckedChange={(checked) => void handleToggleSignage(kiosk, checked)}
                />
              </label>
            ))}
          </div>
          {unitsError && <p role="alert" className="px-7 pb-2 text-xs font-semibold text-ds-danger">{unitsError}</p>}
          <div className="flex justify-end border-t border-ds-border-footer bg-ds-surface px-7 py-4">
            <Button type="button" variant="primary-modal" size="md" onClick={() => setUnitsDialogOpen(false)}>Concluir</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
