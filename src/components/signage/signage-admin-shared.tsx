import { ImageIcon, Type, VideoIcon } from 'lucide-react';

import { type StatusPillVariant } from '@/components/ui/status-pill';
import { PLAYER_HEARTBEAT_STALE_MS } from '@/lib/signage';
import { cn } from '@/lib/utils';
import { type PlayerHeartbeat, type SignageSchedule, type SignageScreen, type SignageSlide, type SignageSlideType } from '@/types';

export const SLIDE_TYPE_LABEL: Record<SignageSlideType, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  text: 'Texto',
};

export const DEFAULT_TEXT_BACKGROUND = '#0f172a';

export function SlideTypeIcon({ type, className }: { type: SignageSlideType; className?: string }) {
  const Icon = type === 'video' ? VideoIcon : type === 'text' ? Type : ImageIcon;
  return <Icon aria-hidden="true" className={cn('h-4 w-4', className)} />;
}

/** Miniatura 16:9 da linha: imagem real, cor do slide de texto ou ícone para vídeo. */
export function SlideThumb({ slide, className }: { slide: Pick<SignageSlide, 'type' | 'assetUrl' | 'background' | 'title'>; className?: string }) {
  const base = cn('flex aspect-video w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-ds-sm bg-ds-dark text-ds-on-dark-2', className);

  if (slide.type === 'image' && slide.assetUrl) {
    return (
      <span className={base}>
        {/* eslint-disable-next-line @next/next/no-img-element -- mídia servida pela rota de assets do signage */}
        <img src={slide.assetUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      </span>
    );
  }

  if (slide.type === 'text') {
    return (
      <span className={base} style={{ background: slide.background || DEFAULT_TEXT_BACKGROUND }}>
        <Type aria-hidden="true" className="h-4 w-4 text-white/80" />
      </span>
    );
  }

  return (
    <span className={base}>
      <SlideTypeIcon type={slide.type} />
    </span>
  );
}

const LIVE_DOT_COLOR: Record<StatusPillVariant, string> = {
  ok: 'bg-ds-ok',
  warn: 'bg-ds-warn',
  danger: 'bg-ds-danger',
  neutral: 'bg-ds-neutral',
  info: 'bg-ds-info',
};

/** Ponto que pulsa na cor do status da tela; o rótulo ao lado continua sendo o sinal principal. */
export function LiveDot({ variant }: { variant: StatusPillVariant }) {
  return (
    <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
      {variant !== 'neutral' && (
        <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-70 motion-safe:animate-ping', LIVE_DOT_COLOR[variant])} />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', LIVE_DOT_COLOR[variant])} />
    </span>
  );
}

export type PlayerHealth = { label: string; variant: StatusPillVariant; online: boolean };

export function getPlayerHealth(heartbeat: PlayerHeartbeat | undefined, now = Date.now()): PlayerHealth {
  if (!heartbeat) return { label: 'Sem sinal', variant: 'neutral', online: false };
  const age = now - Date.parse(heartbeat.lastSeenAt);
  if (Number.isNaN(age) || age > PLAYER_HEARTBEAT_STALE_MS) return { label: 'Offline', variant: 'danger', online: false };
  // O app do monitor toca do disco: não depende do tempo real para estar saudável.
  return heartbeat.status === 'realtime' || heartbeat.status === 'app'
    ? { label: 'No ar', variant: 'ok', online: true }
    : { label: 'No ar · sem tempo real', variant: 'warn', online: true };
}

export function formatRelativeTime(dateStr: string): string {
  const ms = Date.now() - Date.parse(dateStr);
  if (Number.isNaN(ms)) return 'data desconhecida';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'agora mesmo';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

function formatDateBr(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year.slice(2)}`;
}

/** Resumo curto do agendamento para a linha da playlist; `null` quando o slide passa sempre. */
export function describeSchedule(schedule?: SignageSchedule): string | null {
  if (!schedule) return null;
  const parts: string[] = [];
  if (schedule.startTime && schedule.endTime) parts.push(`${schedule.startTime}–${schedule.endTime}`);
  else if (schedule.startTime) parts.push(`a partir de ${schedule.startTime}`);
  else if (schedule.endTime) parts.push(`até ${schedule.endTime}`);

  if (schedule.startDate && schedule.endDate) parts.push(`${formatDateBr(schedule.startDate)} a ${formatDateBr(schedule.endDate)}`);
  else if (schedule.startDate) parts.push(`desde ${formatDateBr(schedule.startDate)}`);
  else if (schedule.endDate) parts.push(`até ${formatDateBr(schedule.endDate)}`);

  return parts.length ? parts.join(' · ') : null;
}

/** Opção de tela nos seletores: unidade sozinha quando ela tem uma tela só. */
export type ScreenOption = { id: string; label: string };

export function getScreenLabel(screen: Pick<SignageScreen, 'kioskName' | 'name'>, screensInUnit: number) {
  return screensInUnit > 1 ? `${screen.kioskName} · ${screen.name}` : screen.kioskName;
}

/**
 * Corpo do PUT de um slide. A rota regrava o documento inteiro e recusa campos desconhecidos,
 * então todo campo que não for enviado aqui (inclusive o agendamento) é apagado.
 */
export function toSlidePayload(slide: SignageSlide, overrides: Partial<Pick<SignageSlide, 'screenIds' | 'orderByScreen' | 'isActive'>> = {}) {
  return {
    title: slide.title,
    type: slide.type,
    durationMs: slide.durationMs,
    order: slide.order,
    screenIds: slide.screenIds,
    orderByScreen: slide.orderByScreen,
    isActive: slide.isActive,
    assetPath: slide.assetPath || undefined,
    assetKind: slide.assetKind || undefined,
    text: slide.text || undefined,
    background: slide.background || undefined,
    schedule: slide.schedule,
    ...overrides,
  };
}
