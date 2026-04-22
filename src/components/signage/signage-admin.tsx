"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ImageIcon, Loader2, Maximize2, MonitorPlay, Pencil, PlayCircle, Plus, Save, Trash2, UploadCloud, VideoIcon, Type, RefreshCw, ShieldAlert } from 'lucide-react';

import { fetchWithTimeout } from '@/lib/fetch-utils';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useToast } from '@/hooks/use-toast';
import { type PlayerHeartbeat, type SignageSlide, type SignageSlideType } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
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
    if (!selectedKioskId) return slides;
    return slides.filter((slide) => slide.kioskIds.includes(selectedKioskId));
  }, [selectedKioskId, slides]);

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
      const payload = {
        ...form,
        durationMs: Number(form.durationMs),
        order: Number(form.order),
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
    <div className="min-h-screen">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
        <Card className="overflow-hidden border shadow-sm">
          <CardHeader className="border-b border-white/10 bg-gradient-to-br from-slate-900 via-slate-800 to-rose-900 text-white">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <Badge variant="secondary" className="w-fit bg-white/10 text-white">Coala Signage</Badge>
                <CardTitle className="text-3xl">Painel de unidades com signage</CardTitle>
                <CardDescription className="max-w-2xl text-slate-200">
                  Ative somente as unidades que possuem tela, acompanhe a saúde do player e organize a programação por unidade.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-3">
                {canManage && (
                  <Button
                    variant="outline"
                    className="border-white/30 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => setUnitsDialogOpen(true)}
                  >
                    <Building2 className="h-4 w-4" />
                    Gerenciar unidades
                  </Button>
                )}
                <Button variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10" onClick={() => void loadSlides()}>
                  <RefreshCw className="h-4 w-4" />
                  Atualizar
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid p-0 divide-y md:divide-y-0 md:divide-x divide-border md:grid-cols-3">
            <div className="space-y-1 p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unidades com signage</p>
              <p className="text-4xl font-bold tabular-nums">{enabledKiosks.length}</p>
            </div>
            <div className="space-y-1 p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unidades online</p>
              <p className="text-4xl font-bold tabular-nums text-success">{onlineUnitsCount}</p>
            </div>
            <div className="space-y-1 p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sem resposta</p>
              <p className="text-4xl font-bold tabular-nums text-destructive">{offlineUnitsCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Resumo geral</CardTitle>
            <CardDescription>
              Visão consolidada do signage em todas as unidades ativas. Clique em uma unidade para abrir os detalhes e a programação.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border bg-muted p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unidades ativas</div>
              <div className="mt-2 text-3xl font-bold tabular-nums">{enabledKiosks.length}</div>
            </div>
            <div className="rounded-2xl border bg-muted p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Slides cadastrados</div>
              <div className="mt-2 text-3xl font-bold tabular-nums">{slides.length}</div>
            </div>
            <div className="rounded-2xl border bg-muted p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Slides ativos</div>
              <div className="mt-2 text-3xl font-bold tabular-nums">{totalActiveSlides}</div>
            </div>
            <div className="rounded-2xl border bg-muted p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unidade selecionada</div>
              <div className="mt-2 text-lg font-bold truncate">
                {selectedKiosk?.name ?? 'Nenhuma'}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Unidades</CardTitle>
            <CardDescription>
              Aqui aparecem apenas as unidades com signage ativo. A ativacao e desativacao fica no modal de gerenciamento.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {kioskStatuses
              .filter(({ signageEnabled }) => signageEnabled)
              .map(({ kiosk, slideCount, activeSlideCount, health, lastSeenAt }) => {
              const isSelected = kiosk.id === selectedKioskId;

              return (
                <div
                  key={kiosk.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedKioskId(kiosk.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedKioskId(kiosk.id);
                    }
                  }}
                  className={`rounded-2xl border p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-ring ${
                    isSelected
                      ? 'border-2 border-primary/50 bg-primary/5 shadow-sm shadow-primary/10'
                      : 'border-border bg-card hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <div className="font-medium">{kiosk.name}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{kiosk.id}</div>
                    </div>
                    <StatusDot variant={health.variant} label={health.label} />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-muted p-3">
                      <div className="text-xs text-muted-foreground">Slides</div>
                      <div className="mt-1 font-semibold">{slideCount}</div>
                    </div>
                    <div className="rounded-xl bg-muted p-3">
                      <div className="text-xs text-muted-foreground">Ativos</div>
                      <div className="mt-1 font-semibold">{activeSlideCount}</div>
                    </div>
                  </div>

                  <div className="mt-4 text-xs text-muted-foreground">
                    {lastSeenAt
                      ? `Último sinal ${formatRelativeTime(lastSeenAt)}`
                      : 'A TV desta unidade ainda não enviou status.'}
                  </div>
                </div>
              );
            })}

            {enabledKiosks.length === 0 && (
              <Alert className="md:col-span-2 xl:col-span-3">
                <MonitorPlay className="h-4 w-4" />
                <AlertTitle>Nenhuma unidade ativa</AlertTitle>
                <AlertDescription>
                  Abra “Gerenciar unidades” para ativar as unidades que possuem tela.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {selectedKiosk && selectedKioskStatus ? (
          <div className="grid gap-6 lg:grid-cols-[1.45fr_0.95fr]">
            <Card className="border shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <CardTitle>Slides de {selectedKiosk.name}</CardTitle>
                    <CardDescription>
                      A lista abaixo mostra apenas os slides vinculados a unidade selecionada. A ordem final publicada segue o campo de ordem.
                    </CardDescription>
                  </div>
                  {canManage && (
                    <Button onClick={openCreateDialog}>
                      <Plus className="h-4 w-4" />
                      Novo slide
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loadingSlides ? (
                  <Skeleton className="h-72 w-full" />
                ) : visibleSlides.length === 0 ? (
                  <Alert>
                    <MonitorPlay className="h-4 w-4" />
                    <AlertTitle>Nenhum slide nesta unidade</AlertTitle>
                    <AlertDescription>
                      Crie o primeiro slide desta unidade para começar a programar o conteudo da TV.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Slide</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Quiosques</TableHead>
                        <TableHead>Duração</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleSlides.map((slide) => (
                        <TableRow key={slide.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="font-medium text-slate-900">{slide.title}</div>
                              <div className="text-xs text-slate-500">Ordem {slide.order}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="inline-flex gap-1">
                              {getTypeIcon(slide.type)}
                              {slide.type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1.5">
                      {slide.kioskIds.map((kioskId) => (
                                <Badge key={kioskId} variant="secondary">
                                  {kioskMap.get(kioskId)?.name ?? kioskId}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>{formatDuration(slide.durationMs)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {canManage ? (
                                <Switch
                                  checked={slide.isActive}
                                  onCheckedChange={(checked) => void handleToggleActive(slide, checked)}
                                />
                              ) : (
                                <Badge variant={slide.isActive ? 'default' : 'outline'}>
                                  {slide.isActive ? 'Ativo' : 'Pausado'}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {canManage && (
                                <>
                                  <Button size="icon" variant="outline" onClick={() => openEditDialog(slide)}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button size="icon" variant="outline" onClick={() => void handleDelete(slide)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="border shadow-sm">
              <CardHeader>
                <CardTitle>Publicação da unidade</CardTitle>
                <CardDescription>
                  O player publico consome apenas `publishedPlayers/{'{kioskId}'}`. Publique sempre apos alterar os slides da unidade selecionada.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">{selectedKiosk.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {kioskSlideCount.get(selectedKiosk.id) ?? 0} slide(s) vinculado(s)
                      </div>
                      <div className="mt-2">
                        <StatusDot variant={selectedKioskStatus.health.variant} label={selectedKioskStatus.health.label} />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void publishForKiosks([selectedKiosk.id])}
                      disabled={!canManage || publishingKioskIds.includes(selectedKiosk.id)}
                    >
                      {publishingKioskIds.includes(selectedKiosk.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Publicar unidade
                    </Button>
                  </div>
                  <div className="mt-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                    TV URL: <span className="font-mono text-foreground">/tv/{selectedKiosk.id}</span>
                  </div>
                </div>

                {enabledKiosks.length > 1 && (
                  <Button
                    className="w-full"
                    disabled={!canManage || publishingKioskIds.length > 0}
                    onClick={() => void publishForKiosks(enabledKiosks.map(kiosk => kiosk.id))}
                  >
                    {publishingKioskIds.length > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Publicar todas as unidades com signage
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="border shadow-sm">
            <CardContent className="flex min-h-52 items-center justify-center p-6">
              <Alert className="max-w-2xl">
                <MonitorPlay className="h-4 w-4" />
                <AlertTitle>Escolha uma unidade para continuar</AlertTitle>
                <AlertDescription>
                  A tela inicial mostra apenas o resumo geral. Clique em uma unidade acima para abrir seus slides, publicacoes e detalhes da TV.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingSlide ? 'Editar slide' : 'Novo slide'}</DialogTitle>
            <DialogDescription>
              Configure o conteúdo, vincule os quiosques e publique quando estiver pronto.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input id="title" value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={form.type} onValueChange={(value: SignageSlideType) => setForm(prev => ({
                    ...prev,
                    type: value,
                    assetKind: value === 'video' ? 'video' : value === 'image' ? 'image' : undefined,
                    assetUrl: value === 'text' ? '' : prev.assetUrl,
                    assetPath: value === 'text' ? '' : prev.assetPath,
                  }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="image">Imagem</SelectItem>
                      <SelectItem value="video">Vídeo</SelectItem>
                      <SelectItem value="text">Texto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Duração</Label>
                  <div className="space-y-2">
                    <Input
                      id="durationMs"
                      type="number"
                      min={1}
                      max={getMaxDurationValue(form.type, durationParts.unit)}
                      value={durationParts.value}
                      onChange={e => {
                        const nextValue = Math.max(1, Number(e.target.value) || 1);
                        setForm(prev => ({ ...prev, durationMs: toDurationMs(nextValue, durationParts.unit) }));
                      }}
                    />
                    <Select
                      value={durationParts.unit}
                      onValueChange={(value: DurationUnit) => {
                        setForm(prev => {
                          const current = getDurationParts(prev.durationMs);
                          return {
                            ...prev,
                            durationMs: toDurationMs(current.value, value),
                          };
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seconds">Segundos</SelectItem>
                        <SelectItem value="minutes">Minutos</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">
                      {form.type === 'video'
                        ? 'Videos usam a duracao real do arquivo e podem chegar a 30 minutos.'
                        : 'Imagens e textos podem ficar no ar por ate 2 minutos.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="order">Ordem</Label>
                  <Input
                    id="order"
                    type="number"
                    min={0}
                    value={form.order}
                    onChange={e => setForm(prev => ({ ...prev, order: Number(e.target.value) }))}
                  />
                </div>

                <div className="rounded-lg border bg-muted p-3 text-sm text-muted-foreground">
                  O status ativo/pausado é controlado diretamente na lista do painel.
                </div>
              </div>

              {form.type === 'text' ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="text">Texto</Label>
                    <Textarea
                      id="text"
                      value={form.text ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, text: e.target.value }))}
                      placeholder="Mensagem que a TV vai exibir."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="background">Cor de fundo</Label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        id="background-picker"
                        value={form.background ?? '#0f172a'}
                        onChange={e => setForm(prev => ({ ...prev, background: e.target.value }))}
                        className="h-10 w-12 cursor-pointer rounded-lg border bg-transparent p-1"
                      />
                      <Input
                        id="background"
                        value={form.background ?? '#0f172a'}
                        onChange={e => setForm(prev => ({ ...prev, background: e.target.value }))}
                        className="font-mono"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-3 rounded-xl border border-dashed p-4">
                  <div className="space-y-1">
                    <Label htmlFor="asset">Mídia</Label>
                    <p className="text-xs text-slate-500">
                      Imagens até 2 MB. Vídeos MP4/H.264 até 30 MB.
                    </p>
                  </div>
                  <Input
                    id="asset"
                    type="file"
                    accept={form.type === 'video' ? 'video/mp4,video/*' : 'image/webp,image/jpeg,image/png,image/*'}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      try {
                        await handleUpload(file);
                      } catch (error) {
                        setUploadProgress(null);
                        toast({
                          title: 'Falha no upload',
                          description: error instanceof Error ? error.message : 'Erro inesperado.',
                          variant: 'destructive',
                        });
                      } finally {
                        event.target.value = '';
                      }
                    }}
                  />
                  {uploadProgress !== null && <Progress value={uploadProgress} />}
                  {form.assetUrl && (
                    <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <UploadCloud className="h-4 w-4 text-success" />
                        Arquivo enviado com sucesso
                      </div>
                      <p className="mt-1">Mídia pronta para publicação.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border p-4">
                <div className="mb-3">
                  <h3 className="font-medium">Quiosques</h3>
                  <p className="text-xs text-muted-foreground">Selecione onde esse slide poderá ser publicado.</p>
                </div>
                <div className="space-y-3">
                  {allowedKiosks.map((kiosk) => {
                    const checked = form.kioskIds.includes(kiosk.id);
                    const signageEnabled = kiosk.signageEnabled !== false;
                    return (
                      <label key={kiosk.id} className={`flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 ${checked ? 'border-primary/30 bg-primary/5' : ''} ${!signageEnabled ? 'opacity-60' : ''}`}>
                        <Checkbox
                          checked={checked}
                          disabled={!signageEnabled}
                          onCheckedChange={(nextChecked) => {
                            setForm(prev => ({
                              ...prev,
                              kioskIds: nextChecked
                                ? [...prev.kioskIds, kiosk.id]
                                : prev.kioskIds.filter(id => id !== kiosk.id),
                            }));
                          }}
                        />
                        <div>
                          <div className="font-medium">{kiosk.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {kiosk.id}
                            {!signageEnabled ? ' · signage desativado' : ''}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="mb-3">
                  <h3 className="font-medium">Preview do player</h3>
                  <p className="text-xs text-muted-foreground">Prévia rápida do que será publicado.</p>
                </div>
                <button
                  type="button"
                  onClick={() => form.assetUrl && setPreviewOpen(true)}
                  className="group relative block aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 shadow-inner"
                  style={{ background: form.type === 'text' ? (form.background || '#0f172a') : '#0f172a' }}
                >
                  <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2">
                    <Badge variant="secondary" className="bg-black/45 text-white backdrop-blur">
                      {form.type === 'video' ? 'Video' : form.type === 'image' ? 'Imagem' : 'Texto'}
                    </Badge>
                    {form.assetUrl && (
                      <span className="rounded-full bg-black/45 p-2 text-white backdrop-blur transition-opacity group-hover:opacity-100 md:opacity-70">
                        {form.type === 'video' ? <PlayCircle className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                      </span>
                    )}
                  </div>
                  {form.type === 'text' ? (
                    <div className="flex h-full items-center justify-center p-8 text-center text-2xl font-semibold text-white">
                      {form.text || 'Seu texto aparecerá aqui'}
                    </div>
                  ) : form.assetUrl ? (
                    form.type === 'image' ? (
                      <img src={form.assetUrl} alt="" className="h-full w-full rounded-2xl object-cover" />
                    ) : (
                      <video
                        src={form.assetUrl}
                        className="h-full w-full rounded-2xl object-cover"
                        muted
                        loop
                        playsInline
                        autoPlay
                      />
                    )
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-300">
                      Envie uma mídia para visualizar.
                    </div>
                  )}
                </button>
                {form.assetUrl && (
                  <p className="mt-3 text-xs text-slate-500">
                    Clique na prévia para ampliar {form.type === 'video' ? 'e ver os controles do vídeo' : 'o conteúdo'}.
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !canManage}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar slide
            </Button>
          </DialogFooter>
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
