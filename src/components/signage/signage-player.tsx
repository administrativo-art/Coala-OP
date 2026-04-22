"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import { AlertTriangle, Expand, Loader2, Wifi, WifiOff } from 'lucide-react';

import { fetchWithTimeout } from '@/lib/fetch-utils';
import { signageDb } from '@/lib/firebase-signage';
import { getPublishedTimestamp, PLAYER_DAILY_RELOAD_HOUR, PLAYER_HEARTBEAT_MS, PLAYER_WATCHDOG_MS, SIGNAGE_FETCH_TIMEOUT_MS } from '@/lib/signage';
import { type PublishedPlayerDocument, type PublishedPlayerSlide } from '@/types';

const cacheKeyPrefix = 'coala-signage-player:';

function getCacheKey(kioskId: string) {
  return `${cacheKeyPrefix}${kioskId}`;
}

export function SignagePlayer() {
  const searchParams = useSearchParams();
  const kioskId = searchParams.get('kiosk')?.trim() ?? '';
  const isDebug = searchParams.get('debug') === '1';
  const [published, setPublished] = useState<PublishedPlayerDocument | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number>(Date.now());
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenReady, setFullscreenReady] = useState(false);
  const rotationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dailyReloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  function applyPublishedDocument(nextValue: PublishedPlayerDocument, source: 'cache' | 'http' | 'realtime') {
    setPublished((current) => {
      const currentTimestamp = getPublishedTimestamp(current);
      const nextTimestamp = getPublishedTimestamp(nextValue);
      if (current && nextTimestamp < currentTimestamp) {
        return current;
      }

      localStorage.setItem(getCacheKey(nextValue.kioskId), JSON.stringify(nextValue));
      return nextValue;
    });

    setError(null);
    setStatus('online');
    setLastSyncAt(Date.now());
    if (source === 'realtime') {
      setRealtimeConnected(true);
    }
  }

  async function sendHeartbeat(targetKioskId: string, currentSlideId?: string, updatedAt?: string) {
    try {
      await fetchWithTimeout('/api/signage/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kioskId: targetKioskId,
          currentSlideId,
          updatedAt,
          status: realtimeConnected ? 'realtime' : 'cache',
        }),
      }, SIGNAGE_FETCH_TIMEOUT_MS);
    } catch {
      // heartbeat is best-effort; player rendering should not depend on it
    }
  }

  async function loadPublishedFromHttp(targetKioskId: string) {
    const response = await fetchWithTimeout(`/api/signage/public/${targetKioskId}`, { cache: 'no-store' }, SIGNAGE_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error('Nenhum conteúdo publicado para este quiosque.');
    }

    const nextValue = await response.json() as PublishedPlayerDocument;
    applyPublishedDocument(nextValue, 'http');
  }

  async function requestFullscreen() {
    const element = rootRef.current;
    if (!element || typeof element.requestFullscreen !== 'function') {
      setFullscreenReady(true);
      return;
    }

    try {
      await element.requestFullscreen();
    } catch {
      // browsers may require an explicit user gesture; keep CTA visible
    } finally {
      setFullscreenReady(true);
    }
  }

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    void requestFullscreen();

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    if (!kioskId) {
      setError('O player precisa do parâmetro `kiosk` na URL.');
      setBooting(false);
      return;
    }

    const cached = localStorage.getItem(getCacheKey(kioskId));
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as PublishedPlayerDocument;
        applyPublishedDocument(parsed, 'cache');
        setStatus('offline');
      } catch {
        localStorage.removeItem(getCacheKey(kioskId));
      }
    }

    void loadPublishedFromHttp(kioskId)
      .catch(() => {
        setStatus(cached ? 'offline' : 'connecting');
      })
      .finally(() => {
        setBooting(false);
      });

    const unsubscribe = onSnapshot(
      doc(signageDb, 'publishedPlayers', kioskId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setError('Nenhum conteúdo publicado para este quiosque.');
          setStatus('offline');
          return;
        }

        const nextValue = snapshot.data() as PublishedPlayerDocument;
        applyPublishedDocument(nextValue, 'realtime');
      },
      () => {
        setRealtimeConnected(false);
        setStatus('offline');
      }
    );

    return () => unsubscribe();
  }, [kioskId]);

  const slides = published?.slides ?? [];
  const activeSlide = slides[activeIndex] ?? null;

  useEffect(() => {
    setActiveIndex(0);
  }, [published?.updatedAt, slides.length]);

  useEffect(() => {
    if (rotationTimeoutRef.current) clearTimeout(rotationTimeoutRef.current);
    if (!slides.length) return;

    const duration = Math.max(activeSlide?.durationMs ?? 10000, 3000);
    rotationTimeoutRef.current = setTimeout(() => {
      setActiveIndex(prev => (prev + 1) % slides.length);
    }, duration);

    return () => {
      if (rotationTimeoutRef.current) clearTimeout(rotationTimeoutRef.current);
    };
  }, [activeSlide?.id, activeSlide?.durationMs, slides.length]);

  useEffect(() => {
    if (!slides.length) return;
    const nextSlide = slides[(activeIndex + 1) % slides.length];
    if (!nextSlide) return;

    if (nextSlide.type === 'image' && nextSlide.assetUrl) {
      const img = new Image();
      img.src = nextSlide.assetUrl;
    }

    if (nextSlide.type === 'video' && nextSlide.assetUrl) {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.src = nextSlide.assetUrl;
    }
  }, [activeIndex, slides]);

  useEffect(() => {
    if (dailyReloadTimeoutRef.current) clearTimeout(dailyReloadTimeoutRef.current);
    const now = new Date();
    const reloadAt = new Date(now);
    reloadAt.setHours(PLAYER_DAILY_RELOAD_HOUR, 0, 0, 0);
    if (reloadAt <= now) reloadAt.setDate(reloadAt.getDate() + 1);

    dailyReloadTimeoutRef.current = setTimeout(() => {
      window.location.reload();
    }, reloadAt.getTime() - now.getTime());

    return () => {
      if (dailyReloadTimeoutRef.current) clearTimeout(dailyReloadTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
    if (!kioskId) return;
    watchdogIntervalRef.current = setInterval(() => {
      if (Date.now() - lastSyncAt > PLAYER_WATCHDOG_MS) {
        void loadPublishedFromHttp(kioskId).catch(() => {
          window.location.reload();
        });
      }
    }, 15000);

    return () => {
      if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
    };
  }, [kioskId, lastSyncAt]);

  useEffect(() => {
    if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    if (!kioskId) return;

    void sendHeartbeat(kioskId, activeSlide?.id, published?.updatedAt);
    heartbeatIntervalRef.current = setInterval(() => {
      void sendHeartbeat(kioskId, activeSlide?.id, published?.updatedAt);
    }, PLAYER_HEARTBEAT_MS);

    return () => {
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    };
  }, [activeSlide?.id, kioskId, published?.updatedAt, realtimeConnected]);

  const statusBadge = useMemo(() => {
    if (status === 'online' && realtimeConnected) {
      return (
        <div className="flex items-center gap-2 rounded-full bg-success/15 px-4 py-2 text-sm text-emerald-200 backdrop-blur-sm">
          <Wifi className="h-4 w-4" />
          Tempo real
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 rounded-full bg-warning/15 px-4 py-2 text-sm text-amber-200 backdrop-blur-sm">
        <WifiOff className="h-4 w-4" />
        Cache local
      </div>
    );
  }, [realtimeConnected, status]);

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617] text-white">
        <div className="flex items-center gap-3 text-lg">
          <Loader2 className="h-6 w-6 animate-spin" />
          Carregando player do quiosque...
        </div>
      </div>
    );
  }

  if (!kioskId || (!published && error)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617] p-8 text-white">
        <div className="max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-amber-300" />
          <h1 className="text-2xl font-semibold">Player indisponível</h1>
          <p className="mt-3 text-white/70">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <main
      ref={rootRef}
      className="relative min-h-screen overflow-hidden bg-[#020617] text-white"
      onClick={() => {
        if (!isFullscreen) {
          void requestFullscreen();
        }
      }}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(circle at top left, hsl(var(--primary) / 0.2) 0%, transparent 32%), radial-gradient(circle at bottom right, hsl(var(--accent) / 0.15) 0%, transparent 32%)' }}
      />

      {isDebug && (
        <div className="absolute left-6 top-6 z-20 flex items-center gap-3">
          {statusBadge}
          <div className="rounded-full bg-black/35 px-4 py-2 text-sm text-white/70 backdrop-blur">
            {published?.kioskName ?? kioskId}
          </div>
        </div>
      )}

      {fullscreenReady && !isFullscreen && (
        <div className="absolute inset-x-0 top-24 z-20 flex justify-center px-6">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void requestFullscreen();
            }}
            className="inline-flex items-center gap-3 rounded-full bg-white/14 px-5 py-3 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
          >
            <Expand className="h-4 w-4" />
            Entrar em tela cheia
          </button>
        </div>
      )}

      <div className="relative z-10 flex min-h-screen items-center justify-center p-8">
        {!activeSlide ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur">
            <p className="text-2xl font-semibold">Nenhum slide publicado</p>
            <p className="mt-2 text-white/70">Publique conteúdo no painel `/signage` para este quiosque.</p>
          </div>
        ) : activeSlide.type === 'image' ? (
          <img
            key={activeSlide.id}
            src={activeSlide.assetUrl}
            alt={activeSlide.title}
            className="max-h-[92vh] w-full rounded-[2rem] object-contain shadow-2xl shadow-black/40"
          />
        ) : activeSlide.type === 'video' ? (
          <video
            key={activeSlide.id}
            src={activeSlide.assetUrl}
            autoPlay
            muted
            loop
            playsInline
            className="max-h-[92vh] w-full rounded-[2rem] object-contain shadow-2xl shadow-black/40"
          />
        ) : (
          <div
            key={activeSlide.id}
            className="flex min-h-[70vh] w-full max-w-6xl items-center justify-center rounded-[2.5rem] border border-white/10 p-14 text-center shadow-2xl shadow-black/40"
            style={{ background: activeSlide.background || '#0f172a' }}
          >
            <div className="max-w-4xl font-semibold leading-tight" style={{ fontSize: 'clamp(2rem, 6vw, 5rem)' }}>
              {activeSlide.text}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
