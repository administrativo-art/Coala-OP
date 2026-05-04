"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2, Clock, Copy, GripVertical, ImageIcon, KeyRound, Loader2, MonitorPlay, Pencil, Plus, Save, Trash2, UploadCloud, VideoIcon, Type, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { fetchWithTimeout } from '@/lib/fetch-utils';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useToast } from '@/hooks/use-toast';
import { type Kiosk, type PlayerHeartbeat, type SignageSlide, type SignageSlideType } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  isSlideScheduleActive,
  PLAYER_HEARTBEAT_STALE_MS,
  SIGNAGE_FETCH_TIMEOUT_MS,
  SIGNAGE_IMAGE_TEXT_MAX_DURATION_MS,
  SIGNAGE_VIDEO_MAX_DURATION_MS,
} from '@/lib/signage';

type SlideFormState = {
  title: string;
  type: SignageSlideType;
  durationMs: number;
  order: number;
  kioskIds: string[];
  isActive: boolean;
  assetUrl?: string;
  assetPath?: string;
  assetKind?: 'image' | 'video';
  text?: string;
  background?: string;
  scheduleEnabled: boolean;
  scheduleTimeEnabled: boolean;
  scheduleStartTime: string;
  scheduleEndTime: string;
  scheduleDateEnabled: boolean;
  scheduleStartDate: string;
  scheduleEndDate: string;
};

type DurationUnit = 'seconds' | 'minutes';

function getDurationParts(durationMs: number) {
  if (durationMs % 60000 === 0) {
    return { value: durationMs / 60000, unit: 'minutes' as DurationUnit };
  }

  return { value: Math.max(1, Math.round(durationMs / 1000)), unit: 'seconds' as DurationUnit };
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getMaxDurationValue(type: SignageSlideType, unit: DurationUnit) {
  const durationMs = type === 'video' ? SIGNAGE_VIDEO_MAX_DURATION_MS : SIGNAGE_IMAGE_TEXT_MAX_DURATION_MS;
  return unit === 'minutes' ? durationMs / 60000 : durationMs / 1000;
}

function toDurationMs(value: number, unit: DurationUnit) {
  return unit === 'minutes' ? value * 60000 : value * 1000;
}

function getVideoDurationMs(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const durationSeconds = Number.isFinite(video.duration) ? video.duration : 0;
      URL.revokeObjectURL(url);
      resolve(Math.max(3000, Math.round(durationSeconds * 1000)));
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a duração do vídeo.'));
    };
    video.src = url;
  });
}

const defaultFormState: SlideFormState = {
  title: '',
  type: 'image',
  durationMs: 10000,
  order: 0,
  kioskIds: [],
  isActive: true,
  assetUrl: '',
  assetPath: '',
  assetKind: 'image',
  text: '',
  background: '#0f172a',
  scheduleEnabled: false,
  scheduleTimeEnabled: false,
  scheduleStartTime: '08:00',
  scheduleEndTime: '18:00',
  scheduleDateEnabled: false,
  scheduleStartDate: '',
  scheduleEndDate: '',
};

function getTypeIcon(type: SignageSlideType) {
  if (type === 'video') return <VideoIcon className="h-4 w-4" />;
  if (type === 'text') return <Type className="h-4 w-4" />;
  return <ImageIcon className="h-4 w-4" />;
}

function formatRelativeTime(dateStr: string): string {
  const ms = Date.now() - Date.parse(dateStr);
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'agora mesmo';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

function StatusDot({ label, variant }: { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }) {
  const dotClass = {
    default: 'bg-success shadow-[0_0_0_3px_hsl(var(--success)/0.2)]',
    secondary: 'bg-warning shadow-[0_0_0_3px_hsl(var(--warning)/0.2)]',
    destructive: 'bg-destructive shadow-[0_0_0_3px_hsl(var(--destructive)/0.2)]',
    outline: 'bg-muted-foreground/40',
  }[variant] ?? 'bg-muted-foreground/40';

  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

type SortableSlideRowProps = {
  slide: SignageSlide;
  position: number;
  kioskMap: Map<string, Kiosk>;
  canManage: boolean;
  onEdit: (slide: SignageSlide) => void;
  onDelete: (slide: SignageSlide) => void;
  onToggleActive: (slide: SignageSlide, isActive: boolean) => void;
};

const SLIDE_ROW_GRID = 'grid grid-cols-[20px_minmax(0,1fr)_72px_72px_52px_64px] items-center gap-3 border-b px-4 py-2.5 last:border-b-0';

function SortableSlideRow({ slide, position, kioskMap: _kioskMap, canManage, onEdit, onDelete, onToggleActive }: SortableSlideRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const scheduleActive = slide.schedule ? isSlideScheduleActive(slide) : null;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={SLIDE_ROW_GRID}
    >
      <div>
        {canManage && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
            aria-label="Reordenar"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          {slide.title}
          {scheduleActive !== null && (
            <span title={scheduleActive ? 'Agendado — ativo agora' : 'Agendado — fora do horário'}>
              <Clock className={`h-3 w-3 ${scheduleActive ? 'text-success' : 'text-muted-foreground'}`} />
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">Posição {position + 1}</div>
      </div>
      <div>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {getTypeIcon(slide.type)}
          {slide.type}
        </span>
      </div>
      <div className="text-[13px] text-muted-foreground">{formatDuration(slide.durationMs)}</div>
      <div>
        {canManage ? (
          <Switch checked={slide.isActive} onCheckedChange={(checked) => onToggleActive(slide, checked)} />
        ) : (
          <Badge variant="default">Ativo</Badge>
        )}
      </div>
      <div className="flex justify-end gap-1">
        {canManage && (
          <>
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onEdit(slide)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onDelete(slide)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function StaticSlideRow({ slide, position, kioskMap: _kioskMap, canManage, onEdit, onDelete, onToggleActive }: SortableSlideRowProps) {
  return (
    <div className={`${SLIDE_ROW_GRID} opacity-60`}>
      <div />
      <div>
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          {slide.title}
          {slide.schedule && (
            <span title="Agendado">
              <Clock className="h-3 w-3 text-muted-foreground" />
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">Posição {position + 1}</div>
      </div>
      <div>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {getTypeIcon(slide.type)}
          {slide.type}
        </span>
      </div>
      <div className="text-[13px] text-muted-foreground">{formatDuration(slide.durationMs)}</div>
      <div>
        {canManage ? (
          <Switch checked={slide.isActive} onCheckedChange={(checked) => onToggleActive(slide, checked)} />
        ) : (
          <Badge variant="outline">Pausado</Badge>
        )}
      </div>
      <div className="flex justify-end gap-1">
        {canManage && (
          <>
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onEdit(slide)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onDelete(slide)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function SignageAdmin() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, firebaseUser, isAuthenticated, loading: authLoading, permissions } = useAuth();
  const { kiosks, loading: kiosksLoading, updateKiosk } = useKiosks();
  const [slides, setSlides] = useState<SignageSlide[]>([]);
  const [playerHealth, setPlayerHealth] = useState<Record<string, PlayerHeartbeat>>({});
  const [loadingSlides, setLoadingSlides] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingKioskId, setUpdatingKioskId] = useState<string | null>(null);
  const [publishingKioskIds, setPublishingKioskIds] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [unitsDialogOpen, setUnitsDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingSlide, setEditingSlide] = useState<SignageSlide | null>(null);
  const [selectedKioskId, setSelectedKioskId] = useState<string | null>(null);
  const [form, setForm] = useState<SlideFormState>(defaultFormState);
  const durationParts = getDurationParts(form.durationMs);

  const canManage = (permissions.signage?.manage ?? false) || permissions.settings.manageUsers;
  const canView = canManage || permissions.signage?.view === true;
  const isAdmin = permissions.settings.manageUsers;

  const allowedKiosks = useMemo(() => {
    if (isAdmin) return kiosks;
    return kiosks.filter(kiosk => user?.assignedKioskIds?.includes(kiosk.id));
  }, [isAdmin, kiosks, user?.assignedKioskIds]);

  const kioskStatuses = useMemo(() => {
    return allowedKiosks.map((kiosk) => {
      const heartbeat = playerHealth[kiosk.id];
      const age = heartbeat ? Date.now() - Date.parse(heartbeat.lastSeenAt) : Number.POSITIVE_INFINITY;
      const health = !heartbeat
        ? { label: 'Sem sinal', variant: 'outline' as const }
        : Number.isNaN(age) || age > PLAYER_HEARTBEAT_STALE_MS
          ? { label: 'Offline', variant: 'destructive' as const }
          : {
              label: heartbeat.status === 'realtime' ? 'Tempo real' : 'Cache local',
              variant: heartbeat.status === 'realtime' ? 'default' as const : 'secondary' as const,
            };

      return {
        kiosk,
        signageEnabled: kiosk.signageEnabled !== false,
        slideCount: slides.filter((slide) => slide.kioskIds.includes(kiosk.id)).length,
        activeSlideCount: slides.filter((slide) => slide.isActive && slide.kioskIds.includes(kiosk.id)).length,
        health,
        lastSeenAt: heartbeat?.lastSeenAt ?? null,
      };
    });
  }, [allowedKiosks, playerHealth, slides]);

  const enabledKiosks = useMemo(
    () => kioskStatuses.filter(({ signageEnabled }) => signageEnabled).map(({ kiosk }) => kiosk),
    [kioskStatuses]
  );

  useEffect(() => {
    if (enabledKiosks.length === 0) {
      setSelectedKioskId(null);
      return;
    }

    if (selectedKioskId && !enabledKiosks.some((kiosk) => kiosk.id === selectedKioskId)) {
      setSelectedKioskId(null);
    }
  }, [enabledKiosks, selectedKioskId]);

  const selectedKiosk = useMemo(
    () => allowedKiosks.find((kiosk) => kiosk.id === selectedKioskId) ?? null,
    [allowedKiosks, selectedKioskId]
  );

  const selectedKioskStatus = useMemo(
    () => kioskStatuses.find(({ kiosk }) => kiosk.id === selectedKioskId) ?? null,
    [kioskStatuses, selectedKioskId]
  );

  const visibleSlides = useMemo(() => {
    const filtered = selectedKioskId
      ? slides.filter((slide) => slide.kioskIds.includes(selectedKioskId))
      : slides;
    return [...filtered].sort((a, b) => a.order - b.order);
  }, [selectedKioskId, slides]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = visibleSlides.findIndex((s) => s.id === active.id);
    const newIndex = visibleSlides.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(visibleSlides, oldIndex, newIndex).map((slide, i) => ({ ...slide, order: i }));

    setSlides((prev) => {
      const map = new Map(reordered.map((s) => [s.id, s]));
      return prev.map((s) => map.get(s.id) ?? s);
    });

    try {
      await Promise.all(
        reordered.map((slide) =>
          authedFetch(`/api/signage/slides/${slide.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: slide.title,
              type: slide.type,
              durationMs: slide.durationMs,
              order: slide.order,
              kioskIds: slide.kioskIds,
              isActive: slide.isActive,
              assetPath: slide.assetPath,
              assetKind: slide.assetKind,
              text: slide.text,
              background: slide.background,
            }),
          })
        )
      );
    } catch {
      toast({ title: 'Falha ao salvar ordem', variant: 'destructive' });
      await loadSlides();
    }
  }

  const onlineUnitsCount = useMemo(
    () => kioskStatuses.filter(({ signageEnabled, health }) => signageEnabled && health.label !== 'Offline' && health.label !== 'Sem sinal').length,
    [kioskStatuses]
  );

  const offlineUnitsCount = useMemo(
    () => kioskStatuses.filter(({ signageEnabled, health }) => signageEnabled && (health.label === 'Offline' || health.label === 'Sem sinal')).length,
    [kioskStatuses]
  );

  const totalActiveSlides = useMemo(
    () => slides.filter((slide) => slide.isActive).length,
    [slides]
  );

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  async function authedFetch(input: RequestInfo, init?: RequestInit) {
    const token = await firebaseUser?.getIdToken();
    if (!token) {
      throw new Error('Sessão não encontrada.');
    }
    return fetchWithTimeout(input, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    }, SIGNAGE_FETCH_TIMEOUT_MS);
  }

  async function loadSlides() {
    if (!firebaseUser || !canView) {
      setLoadingSlides(false);
      return;
    }

    try {
      setLoadingSlides(true);
      const response = await authedFetch('/api/signage/slides');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Falha ao carregar slides.');
      setSlides(data.slides);
    } catch (error) {
      toast({
        title: 'Falha ao carregar signage',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
    } finally {
      setLoadingSlides(false);
    }
  }

  async function loadPlayerHealth() {
    if (!firebaseUser || !canView) return;

    try {
      const response = await authedFetch('/api/signage/heartbeat');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Falha ao carregar heartbeat dos players.');
      setPlayerHealth(
        Object.fromEntries((data.heartbeats as PlayerHeartbeat[]).map((heartbeat) => [heartbeat.kioskId, heartbeat]))
      );
    } catch {
      // keep health as best-effort; do not block admin usage
    }
  }

  useEffect(() => {
    void loadSlides();
    void loadPlayerHealth();
  }, [firebaseUser, canView]);

  useEffect(() => {
    if (!firebaseUser || !canView) return;
    const interval = setInterval(() => {
      void loadPlayerHealth();
    }, 30000);

    return () => clearInterval(interval);
  }, [firebaseUser, canView]);

  function openCreateDialog() {
    setEditingSlide(null);
    setForm({
      ...defaultFormState,
      kioskIds: selectedKioskId
        ? [selectedKioskId]
        : enabledKiosks.slice(0, 1).map((kiosk) => kiosk.id),
    });
    setDialogOpen(true);
  }

  function openEditDialog(slide: SignageSlide) {
    setEditingSlide(slide);
    setForm({
      title: slide.title,
      type: slide.type,
      durationMs: slide.durationMs,
      order: slide.order,
      kioskIds: slide.kioskIds,
      isActive: slide.isActive,
      assetUrl: slide.assetUrl,
      assetPath: slide.assetPath,
      assetKind: slide.assetKind,
      text: slide.text,
      background: slide.background ?? '#0f172a',
      scheduleEnabled: !!slide.schedule,
      scheduleTimeEnabled: !!(slide.schedule?.startTime || slide.schedule?.endTime),
      scheduleStartTime: slide.schedule?.startTime ?? '08:00',
      scheduleEndTime: slide.schedule?.endTime ?? '18:00',
      scheduleDateEnabled: !!(slide.schedule?.startDate || slide.schedule?.endDate),
      scheduleStartDate: slide.schedule?.startDate ?? '',
      scheduleEndDate: slide.schedule?.endDate ?? '',
    });
    setDialogOpen(true);
  }

  async function handleUpload(file: File) {
    setUploadProgress(15);
    const token = await firebaseUser?.getIdToken();
    if (!token) throw new Error('Sessão não encontrada.');

    const detectedVideoDurationMs =
      file.type.startsWith('video/') ? await getVideoDurationMs(file).catch(() => null) : null;

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetchWithTimeout('/api/signage/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    }, SIGNAGE_FETCH_TIMEOUT_MS);
    setUploadProgress(80);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? 'Falha no upload.');
    }
    setUploadProgress(100);
    setTimeout(() => setUploadProgress(null), 400);
    setForm(prev => ({
      ...prev,
      assetUrl: data.assetUrl,
      assetPath: data.assetPath,
      assetKind: data.assetKind,
      durationMs: data.assetKind === 'video' && detectedVideoDurationMs ? detectedVideoDurationMs : prev.durationMs,
    }));
    toast({
      title: 'Arquivo enviado',
      description: data.assetKind === 'video' && detectedVideoDurationMs
        ? 'A mídia foi enviada e a duração do slide foi ajustada automaticamente.'
        : 'A mídia já está pronta para publicação.',
    });
  }

  async function handleSave() {
    try {
      setSaving(true);
      const schedule = form.scheduleEnabled
        ? Object.fromEntries(Object.entries({
            startTime: form.scheduleTimeEnabled ? form.scheduleStartTime || undefined : undefined,
            endTime: form.scheduleTimeEnabled ? form.scheduleEndTime || undefined : undefined,
            startDate: form.scheduleDateEnabled ? form.scheduleStartDate || undefined : undefined,
            endDate: form.scheduleDateEnabled ? form.scheduleEndDate || undefined : undefined,
          }).filter(([, v]) => v !== undefined))
        : undefined;

      const payload = {
        ...form,
        durationMs: Number(form.durationMs),
        order: Number(form.order),
        schedule,
      };

      const response = await authedFetch(
        editingSlide ? `/api/signage/slides/${editingSlide.id}` : '/api/signage/slides',
        {
          method: editingSlide ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Falha ao salvar slide.');

      toast({
        title: editingSlide ? 'Slide atualizado' : 'Slide criado',
        description: 'As alterações foram salvas no signage.',
      });
      setDialogOpen(false);
      setEditingSlide(null);
      setForm(defaultFormState);
      await loadSlides();
    } catch (error) {
      toast({
        title: 'Não foi possível salvar',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(slide: SignageSlide, isActive: boolean) {
    try {
      const response = await authedFetch(`/api/signage/slides/${slide.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: slide.title,
          type: slide.type,
          durationMs: slide.durationMs,
          order: slide.order,
          kioskIds: slide.kioskIds,
          isActive,
          assetPath: slide.assetPath,
          assetKind: slide.assetKind,
          text: slide.text,
          background: slide.background,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Falha ao atualizar status do slide.');
      setSlides(prev => prev.map(item => item.id === slide.id ? { ...item, isActive } : item));
      toast({
        title: isActive ? 'Slide ativado' : 'Slide pausado',
        description: 'O status do slide foi atualizado.',
      });
    } catch (error) {
      toast({
        title: 'Falha ao atualizar status',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
    }
  }

  async function handleDelete(slide: SignageSlide) {
    if (!window.confirm(`Excluir o slide "${slide.title}"?`)) return;
    try {
      const response = await authedFetch(`/api/signage/slides/${slide.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Falha ao excluir slide.');
      toast({ title: 'Slide removido', description: 'O slide foi excluído do signage.' });
      await loadSlides();
    } catch (error) {
      toast({
        title: 'Falha ao excluir',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
    }
  }

  async function publishForKiosks(kioskIds: string[]) {
    try {
      setPublishingKioskIds(kioskIds);
      const response = await authedFetch('/api/signage/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kioskIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Falha ao publicar signage.');
      toast({
        title: 'Publicação concluída',
        description: `Quiosques publicados: ${data.publishedKioskIds.join(', ')}.`,
      });
    } catch (error) {
      toast({
        title: 'Falha ao publicar',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
    } finally {
      setPublishingKioskIds([]);
    }
  }

  async function handleToggleSignage(kioskId: string, checked: boolean) {
    const kiosk = kiosks.find((item) => item.id === kioskId);
    if (!kiosk) return;

    try {
      setUpdatingKioskId(kioskId);
      await updateKiosk({
        ...kiosk,
        signageEnabled: checked,
      });
      toast({
        title: checked ? 'Signage ativado' : 'Signage desativado',
        description: `${kiosk.name} foi ${checked ? 'incluido' : 'removido'} do painel de TVs.`,
      });
    } catch (error) {
      toast({
        title: 'Falha ao atualizar unidade',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
    } finally {
      setUpdatingKioskId(null);
    }
  }

  function generateDeviceToken(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  async function handleSetToken(kioskId: string) {
    const kiosk = kiosks.find((k) => k.id === kioskId);
    if (!kiosk) return;
    const token = generateDeviceToken();
    try {
      await updateKiosk({ ...kiosk, deviceToken: token });
      toast({ title: 'Código gerado', description: `Código de acesso definido para ${kiosk.name}.` });
    } catch {
      toast({ title: 'Falha ao salvar código', variant: 'destructive' });
    }
  }

  async function handleClearToken(kioskId: string) {
    const kiosk = kiosks.find((k) => k.id === kioskId);
    if (!kiosk) return;
    try {
      await updateKiosk({ ...kiosk, deviceToken: undefined });
      toast({ title: 'Código removido', description: `${kiosk.name} voltou a ser de acesso livre.` });
    } catch {
      toast({ title: 'Falha ao remover código', variant: 'destructive' });
    }
  }

  const kioskMap = useMemo(() => new Map(kiosks.map(kiosk => [kiosk.id, kiosk])), [kiosks]);
  const kioskSlideCount = useMemo(() => {
    const counts = new Map<string, number>();
    slides.forEach((slide) => {
      slide.kioskIds.forEach((kioskId) => {
        counts.set(kioskId, (counts.get(kioskId) ?? 0) + 1);
      });
    });
    return counts;
  }, [slides]);

  const activeVisibleSlides = useMemo(() => visibleSlides.filter(s => s.isActive), [visibleSlides]);
  const inactiveVisibleSlides = useMemo(() => visibleSlides.filter(s => !s.isActive), [visibleSlides]);

  if (authLoading || kiosksLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (!canView) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Acesso bloqueado</AlertTitle>
          <AlertDescription>
            Seu perfil não tem permissão para acessar o Coala Signage.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <MonitorPlay className="h-3.5 w-3.5" />
              Coala Signage
            </div>
            <p className="text-xl font-medium text-foreground">Painel de unidades</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Gerencie a programação e monitore o status das TVs.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Button>
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setUnitsDialogOpen(true)}>
                <Building2 className="h-4 w-4" />
                Gerenciar unidades
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void loadSlides()}>
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
            {process.env.NODE_ENV === 'development' && enabledKiosks.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                className="border-amber-300 text-amber-700 hover:bg-amber-50"
                disabled={!canManage || publishingKioskIds.length > 0}
                onClick={() => void publishForKiosks(enabledKiosks.map(kiosk => kiosk.id))}
              >
                {publishingKioskIds.length > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Publicar todas [DEV]
              </Button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-muted p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Com signage</p>
            <p className="mt-1.5 text-[26px] font-medium tabular-nums">{enabledKiosks.length}</p>
          </div>
          <div className="rounded-xl bg-muted p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Online</p>
            <p className="mt-1.5 text-[26px] font-medium tabular-nums text-success">{onlineUnitsCount}</p>
          </div>
          <div className="rounded-xl bg-muted p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Sem resposta</p>
            <p className="mt-1.5 text-[26px] font-medium tabular-nums text-destructive">{offlineUnitsCount}</p>
          </div>
          <div className="rounded-xl bg-muted p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Slides ativos</p>
            <p className="mt-1.5 text-[26px] font-medium tabular-nums">{totalActiveSlides}</p>
          </div>
        </div>

        {/* Units */}
        <div>
          <p className="mb-3 text-[13px] font-medium text-foreground">Unidades</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {kioskStatuses
              .filter(({ signageEnabled }) => signageEnabled)
              .map(({ kiosk, slideCount, activeSlideCount, health, lastSeenAt }) => {
                const isSelected = kiosk.id === selectedKioskId;
                const badgeClass = health.variant === 'default'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : health.variant === 'destructive'
                    ? 'bg-red-50 text-red-800 border-red-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200';
                const dotClass = health.variant === 'default' ? 'bg-emerald-500' : health.variant === 'destructive' ? 'bg-red-500' : 'bg-amber-500';

                return (
                  <div
                    key={kiosk.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedKioskId(kiosk.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedKioskId(kiosk.id); } }}
                    className={`cursor-pointer rounded-xl border p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-ring ${
                      isSelected ? 'border-[1.5px] border-primary bg-primary/5' : 'border-border bg-card hover:border-border/80'
                    }`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-medium text-foreground">{kiosk.name}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{kiosk.id}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                        {health.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-muted p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Slides</p>
                        <p className="mt-0.5 text-lg font-medium">{slideCount}</p>
                      </div>
                      <div className="rounded-lg bg-muted p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ativos</p>
                        <p className="mt-0.5 text-lg font-medium">{activeSlideCount}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      {lastSeenAt ? `Último sinal ${formatRelativeTime(lastSeenAt)}` : 'A TV desta unidade ainda não enviou status.'}
                    </p>
                  </div>
                );
              })}

            {enabledKiosks.length === 0 && (
              <Alert className="md:col-span-2 xl:col-span-3">
                <MonitorPlay className="h-4 w-4" />
                <AlertTitle>Nenhuma unidade ativa</AlertTitle>
                <AlertDescription>Abra "Gerenciar unidades" para ativar as unidades que possuem tela.</AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        {/* Slides + sidebar */}
        {selectedKiosk && selectedKioskStatus ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_200px]">

            {/* Slides panel */}
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between gap-4 border-b px-4 py-3.5">
                <div>
                  <p className="text-[14px] font-medium text-foreground">Slides — {selectedKiosk.name}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">Reordene arrastando. A ordem é salva automaticamente.</p>
                </div>
                {canManage && (
                  <Button size="sm" onClick={openCreateDialog}>
                    <Plus className="h-4 w-4" />
                    Novo slide
                  </Button>
                )}
              </div>

              {loadingSlides ? (
                <div className="p-4">
                  <Skeleton className="h-56 w-full" />
                </div>
              ) : visibleSlides.length === 0 ? (
                <div className="p-4">
                  <Alert>
                    <MonitorPlay className="h-4 w-4" />
                    <AlertTitle>Nenhum slide nesta unidade</AlertTitle>
                    <AlertDescription>Crie o primeiro slide desta unidade para começar a programar o conteúdo da TV.</AlertDescription>
                  </Alert>
                </div>
              ) : (
                <>
                  {/* Header row */}
                  <div className="grid grid-cols-[20px_minmax(0,1fr)_72px_72px_52px_64px] items-center gap-3 border-b px-4 py-2">
                    <span />
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Slide</span>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tipo</span>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Duração</span>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</span>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Ações</span>
                  </div>

                  {/* Active slides with drag & drop */}
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleReorder(e)}>
                    <SortableContext items={activeVisibleSlides.map(s => s.id)} strategy={verticalListSortingStrategy}>
                      {activeVisibleSlides.map((slide, i) => (
                        <SortableSlideRow
                          key={slide.id}
                          slide={slide}
                          position={visibleSlides.indexOf(slide)}
                          kioskMap={kioskMap}
                          canManage={canManage}
                          onEdit={openEditDialog}
                          onDelete={(s) => void handleDelete(s)}
                          onToggleActive={(s, checked) => void handleToggleActive(s, checked)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>

                  {/* Inactive slides */}
                  {inactiveVisibleSlides.length > 0 && (
                    <>
                      <div className="border-t border-dashed px-4 py-2">
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Pausados</span>
                      </div>
                      {inactiveVisibleSlides.map((slide) => (
                        <StaticSlideRow
                          key={slide.id}
                          slide={slide}
                          position={visibleSlides.indexOf(slide)}
                          kioskMap={kioskMap}
                          canManage={canManage}
                          onEdit={openEditDialog}
                          onDelete={(s) => void handleDelete(s)}
                          onToggleActive={(s, checked) => void handleToggleActive(s, checked)}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Right sidebar */}
            <div className="flex flex-col gap-3">
              {/* Publish */}
              <div className="rounded-xl border bg-card p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Publicação</p>
                <p className="text-[14px] font-medium text-foreground">{selectedKiosk.name}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{kioskSlideCount.get(selectedKiosk.id) ?? 0} slide(s) vinculado(s)</p>
                <div className="my-3 flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${selectedKioskStatus.health.variant === 'default' ? 'bg-emerald-500' : selectedKioskStatus.health.variant === 'destructive' ? 'bg-red-500' : 'bg-amber-500'}`} />
                  <span className="text-[12px] text-muted-foreground">{selectedKioskStatus.health.label}</span>
                </div>
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => void publishForKiosks([selectedKiosk.id])}
                  disabled={!canManage || publishingKioskIds.includes(selectedKiosk.id)}
                >
                  {publishingKioskIds.includes(selectedKiosk.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Publicar unidade
                </Button>
              </div>

              {/* Access code + URL */}
              <div className="rounded-xl bg-muted p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <KeyRound className="mr-1 inline-block h-3 w-3" />
                    Código de acesso
                  </p>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="Gerar novo código" onClick={() => void handleSetToken(selectedKiosk.id)}>
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                      {selectedKiosk.deviceToken && (
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" title="Remover código" onClick={() => void handleClearToken(selectedKiosk.id)}>
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {selectedKiosk.deviceToken ? (
                  <span className="font-mono text-base font-bold tracking-widest text-foreground">{selectedKiosk.deviceToken}</span>
                ) : (
                  <span className="text-[12px] italic text-muted-foreground">Sem código — acesso livre</span>
                )}

                <p className="mb-1.5 mt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">TV URL</p>
                {(() => {
                  const origin = typeof window !== 'undefined' ? window.location.origin : '';
                  const token = selectedKiosk.deviceToken;
                  const href = `/tv/${selectedKiosk.id}${token ? `?token=${token}` : ''}`;
                  const fullUrl = `${origin}${href}`;
                  return (
                    <div className="flex items-start gap-1">
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all font-mono text-[11px] text-primary underline underline-offset-2"
                      >
                        {fullUrl}
                      </a>
                      <button
                        type="button"
                        title="Copiar URL"
                        className="mt-0.5 flex-shrink-0 rounded p-0.5 hover:bg-accent"
                        onClick={() => void navigator.clipboard.writeText(fullUrl).then(() => toast({ title: 'URL copiada' }))}
                      >
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-52 items-center justify-center rounded-xl border bg-card p-6">
            <Alert className="max-w-2xl">
              <MonitorPlay className="h-4 w-4" />
              <AlertTitle>Escolha uma unidade para continuar</AlertTitle>
              <AlertDescription>Clique em uma unidade acima para abrir seus slides e opções de publicação.</AlertDescription>
            </Alert>
          </div>
        )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-[660px]">
          {/* Header */}
          <div className="flex items-start justify-between border-b px-6 py-5">
            <div>
              <DialogTitle className="text-base font-medium">{editingSlide ? 'Editar slide' : 'Novo slide'}</DialogTitle>
              <DialogDescription className="mt-0.5 text-[13px]">Configure, vincule e publique o conteúdo.</DialogDescription>
            </div>
          </div>

          {/* Body */}
          <div className="grid max-h-[calc(92vh-130px)] grid-cols-2 divide-x overflow-y-auto">
            {/* Left column */}
            <div className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Título</label>
                <Input value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tipo</label>
                  <Select value={form.type} onValueChange={(value: SignageSlideType) => setForm(prev => ({
                    ...prev,
                    type: value,
                    assetKind: value === 'video' ? 'video' : value === 'image' ? 'image' : undefined,
                    assetUrl: value === 'text' ? '' : prev.assetUrl,
                    assetPath: value === 'text' ? '' : prev.assetPath,
                  }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="image">Imagem</SelectItem>
                      <SelectItem value="video">Vídeo</SelectItem>
                      <SelectItem value="text">Texto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Duração</label>
                  <div className="flex gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={getMaxDurationValue(form.type, durationParts.unit)}
                      value={durationParts.value}
                      onChange={e => {
                        const nextValue = Math.max(1, Number(e.target.value) || 1);
                        setForm(prev => ({ ...prev, durationMs: toDurationMs(nextValue, durationParts.unit) }));
                      }}
                      className="w-16"
                    />
                    <Select
                      value={durationParts.unit}
                      onValueChange={(value: DurationUnit) => {
                        setForm(prev => ({ ...prev, durationMs: toDurationMs(getDurationParts(prev.durationMs).value, value) }));
                      }}
                    >
                      <SelectTrigger className="flex-1 text-[13px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seconds">seg</SelectItem>
                        <SelectItem value="minutes">min</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {form.type === 'text' ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Texto</label>
                    <Textarea
                      rows={3}
                      value={form.text ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, text: e.target.value }))}
                      placeholder="Mensagem que a TV vai exibir."
                      className="resize-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Cor de fundo</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={form.background ?? '#0f172a'}
                        onChange={e => setForm(prev => ({ ...prev, background: e.target.value }))}
                        className="h-8 w-8 cursor-pointer rounded-md border bg-transparent p-0.5"
                      />
                      <Input
                        value={form.background ?? '#0f172a'}
                        onChange={e => setForm(prev => ({ ...prev, background: e.target.value }))}
                        className="font-mono text-[13px]"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-2 rounded-lg border border-dashed p-4">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Mídia <span className="normal-case font-normal text-muted-foreground/70">— imagens até 2 MB, vídeos até 30 MB</span>
                  </label>
                  <Input
                    type="file"
                    accept={form.type === 'video' ? 'video/mp4,video/*' : 'image/webp,image/jpeg,image/png,image/*'}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      try {
                        await handleUpload(file);
                      } catch (error) {
                        setUploadProgress(null);
                        toast({ title: 'Falha no upload', description: error instanceof Error ? error.message : 'Erro inesperado.', variant: 'destructive' });
                      } finally {
                        event.target.value = '';
                      }
                    }}
                  />
                  {uploadProgress !== null && <Progress value={uploadProgress} />}
                  {form.assetUrl && (
                    <div className="flex items-center gap-2 text-[13px] text-success">
                      <UploadCloud className="h-4 w-4" />
                      Arquivo enviado com sucesso
                    </div>
                  )}
                </div>
              )}

              {/* Schedule */}
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2.5">
                <div>
                  <p className="text-[13px] font-medium">Agendamento</p>
                  <p className="text-[12px] text-muted-foreground">Controlar quando este slide aparece</p>
                </div>
                <Switch
                  checked={form.scheduleEnabled}
                  onCheckedChange={(checked) => setForm(prev => ({ ...prev, scheduleEnabled: checked }))}
                />
              </div>

              {form.scheduleEnabled && (
                <div className="space-y-3 rounded-lg border p-3">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <Checkbox
                      checked={form.scheduleTimeEnabled}
                      onCheckedChange={(checked) => setForm(prev => ({ ...prev, scheduleTimeEnabled: !!checked }))}
                    />
                    <span className="text-[13px] font-medium">Limitar por horário</span>
                  </label>
                  {form.scheduleTimeEnabled && (
                    <div className="space-y-1 pl-6">
                      <div className="flex items-center gap-2">
                        <Input type="time" value={form.scheduleStartTime} onChange={e => setForm(prev => ({ ...prev, scheduleStartTime: e.target.value }))} />
                        <span className="flex-shrink-0 text-[13px] text-muted-foreground">até</span>
                        <Input type="time" value={form.scheduleEndTime} onChange={e => setForm(prev => ({ ...prev, scheduleEndTime: e.target.value }))} />
                      </div>
                      {form.scheduleEndTime && form.scheduleStartTime && form.scheduleEndTime < form.scheduleStartTime && (
                        <p className="text-[11px] text-muted-foreground">Intervalo noturno — vai até {form.scheduleEndTime} do dia seguinte.</p>
                      )}
                    </div>
                  )}
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <Checkbox
                      checked={form.scheduleDateEnabled}
                      onCheckedChange={(checked) => setForm(prev => ({ ...prev, scheduleDateEnabled: !!checked }))}
                    />
                    <span className="text-[13px] font-medium">Limitar por período</span>
                  </label>
                  {form.scheduleDateEnabled && (
                    <div className="flex gap-2 pl-6">
                      <div className="flex-1 space-y-1">
                        <label className="text-[11px] text-muted-foreground">De</label>
                        <Input type="date" value={form.scheduleStartDate} onChange={e => setForm(prev => ({ ...prev, scheduleStartDate: e.target.value }))} />
                      </div>
                      <div className="flex-1 space-y-1">
                        <label className="text-[11px] text-muted-foreground">Até</label>
                        <Input type="date" value={form.scheduleEndDate} onChange={e => setForm(prev => ({ ...prev, scheduleEndDate: e.target.value }))} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-4 p-6">
              {/* Preview */}
              <div className="space-y-2">
                <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Preview</label>
                <button
                  type="button"
                  onClick={() => form.assetUrl && setPreviewOpen(true)}
                  className="relative block w-full overflow-hidden rounded-lg"
                  style={{ aspectRatio: '16/9', background: form.type === 'text' ? (form.background || '#0f172a') : '#0f172a' }}
                >
                  <span className="absolute left-3 top-3 text-[9px] font-medium uppercase tracking-widest text-white/40">
                    {form.type === 'video' ? 'Vídeo' : form.type === 'image' ? 'Imagem' : 'Texto'}
                  </span>
                  {form.type === 'text' ? (
                    <span className="absolute bottom-3 left-3 right-3 text-[18px] font-medium leading-tight text-white">
                      {form.text || 'Seu texto aqui'}
                    </span>
                  ) : form.assetUrl ? (
                    form.type === 'image' ? (
                      <img src={form.assetUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <video src={form.assetUrl} className="h-full w-full object-cover" muted loop playsInline autoPlay />
                    )
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-[13px] text-white/30">
                      Envie uma mídia para visualizar
                    </span>
                  )}
                </button>
              </div>

              {/* Kiosques — only show picker when multiple kiosks exist */}
              {allowedKiosks.length > 1 ? (
                <div className="space-y-2">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Quiosques</label>
                  <div className="flex flex-col gap-1.5">
                    {allowedKiosks.map((kiosk) => {
                      const checked = form.kioskIds.includes(kiosk.id);
                      const signageEnabled = kiosk.signageEnabled !== false;
                      return (
                        <button
                          key={kiosk.id}
                          type="button"
                          disabled={!signageEnabled}
                          onClick={() => {
                            if (!signageEnabled) return;
                            setForm(prev => ({
                              ...prev,
                              kioskIds: checked
                                ? prev.kioskIds.filter(id => id !== kiosk.id)
                                : [...prev.kioskIds, kiosk.id],
                            }));
                          }}
                          className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                            checked
                              ? 'border-primary bg-primary/5'
                              : 'border-border bg-background hover:bg-muted/50'
                          } ${!signageEnabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                        >
                          <div className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${checked ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}>
                            {checked && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                          </div>
                          <div>
                            <p className={`text-[13px] font-medium ${checked ? 'text-primary' : 'text-foreground'}`}>{kiosk.name}</p>
                            <p className={`text-[11px] ${checked ? 'text-primary/70' : 'text-muted-foreground'}`}>
                              {kiosk.id}{!signageEnabled ? ' · signage desativado' : ''}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
                  Unidade: <span className="font-medium text-foreground">{allowedKiosks[0]?.name ?? '—'}</span>
                </div>
              )}

              {/* Ordem */}
              <div className="mt-auto flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                <span className="text-[12px] text-muted-foreground">Posição</span>
                <span className="font-mono text-[13px] font-medium tabular-nums">{form.order + 1}</span>
                <span className="text-[11px] text-muted-foreground/70">Ajuste pela lista com drag & drop</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t px-6 py-3.5">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving || !canManage}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar slide
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={unitsDialogOpen} onOpenChange={setUnitsDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Gerenciar unidades com signage</DialogTitle>
            <DialogDescription>
              Ative somente as unidades que realmente possuem TV. So unidades ativas aparecem no painel principal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {kioskStatuses.map(({ kiosk, signageEnabled, slideCount, activeSlideCount, health, lastSeenAt }) => {
              const isUpdating = updatingKioskId === kiosk.id;

              return (
                <div key={kiosk.id} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="font-medium">{kiosk.name}</div>
                      <div className="text-xs text-muted-foreground">{kiosk.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isUpdating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      <Switch
                        checked={signageEnabled}
                        disabled={!canManage || isUpdating}
                        onCheckedChange={(checked) => void handleToggleSignage(kiosk.id, checked)}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <span className={`text-sm font-medium ${signageEnabled ? 'text-success' : 'text-muted-foreground'}`}>
                      {signageEnabled ? 'Signage ativo' : 'Signage desativado'}
                    </span>
                    <StatusDot variant={health.variant} label={health.label} />
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-muted p-3 text-sm">
                      <div className="text-xs text-muted-foreground">Slides</div>
                      <div className="mt-1 font-semibold">{slideCount}</div>
                    </div>
                    <div className="rounded-lg bg-muted p-3 text-sm">
                      <div className="text-xs text-muted-foreground">Ativos</div>
                      <div className="mt-1 font-semibold">{activeSlideCount}</div>
                    </div>
                    <div className="rounded-lg bg-muted p-3 text-sm">
                      <div className="text-xs text-muted-foreground">Último sinal</div>
                      <div className="mt-1 font-semibold">
                        {lastSeenAt ? formatRelativeTime(lastSeenAt) : 'Sem sinal'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl bg-slate-950 p-3 text-white">
          <DialogHeader className="px-3 pt-2">
            <DialogTitle className="text-white">Preview ampliado</DialogTitle>
            <DialogDescription className="text-slate-300">
              {form.title || 'Slide sem titulo'}
            </DialogDescription>
          </DialogHeader>
          <div
            className="aspect-video overflow-hidden rounded-2xl border border-white/10"
            style={{ background: form.type === 'text' ? (form.background || '#0f172a') : '#020617' }}
          >
            {form.type === 'text' ? (
              <div className="flex h-full items-center justify-center p-12 text-center text-4xl font-semibold text-white">
                {form.text || 'Seu texto aparecera aqui'}
              </div>
            ) : form.assetUrl ? (
              form.type === 'image' ? (
                <img src={form.assetUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <video
                  src={form.assetUrl}
                  className="h-full w-full object-contain"
                  muted
                  loop
                  playsInline
                  autoPlay
                  controls
                />
              )
            ) : (
              <div className="flex h-full items-center justify-center text-slate-400">
                Nenhuma midia carregada.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
