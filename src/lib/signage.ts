import { z } from 'zod';

import { type Kiosk, type PublishedPlayerDocument, type PublishedPlayerSlide, type SignageSlide } from '@/types';

export const SIGNAGE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const SIGNAGE_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
export const SIGNAGE_MIN_DURATION_MS = 3 * 1000;
export const SIGNAGE_IMAGE_TEXT_MAX_DURATION_MS = 2 * 60 * 1000;
export const SIGNAGE_VIDEO_MAX_DURATION_MS = 30 * 60 * 1000;
export const PLAYER_DAILY_RELOAD_HOUR = 4;
export const PLAYER_WATCHDOG_MS = 90 * 1000;
export const PLAYER_HEARTBEAT_MS = 60 * 1000;
export const PLAYER_HEARTBEAT_STALE_MS = 2 * PLAYER_HEARTBEAT_MS + 30 * 1000;
export const SIGNAGE_FETCH_TIMEOUT_MS = 30 * 1000;
export const SIGNAGE_STORAGE_BUCKET = 'smart-converter-752gf.firebasestorage.app';

export const signageSlideSchema = z.object({
  title: z.string().trim().min(2).max(120),
  type: z.enum(['image', 'video', 'text']),
  durationMs: z.number().int().min(SIGNAGE_MIN_DURATION_MS).max(SIGNAGE_VIDEO_MAX_DURATION_MS),
  order: z.number().int().min(0).max(9999),
  kioskIds: z.array(z.string().trim().min(1)).min(1),
  isActive: z.boolean(),
  assetPath: z.string().trim().optional(),
  assetKind: z.enum(['image', 'video']).optional(),
  text: z.string().trim().max(1200).optional(),
  background: z.string().trim().max(32).optional(),
}).superRefine((value, ctx) => {
  if (value.type === 'text' && !value.text) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Slides de texto precisam de conteúdo.', path: ['text'] });
  }

  if ((value.type === 'image' || value.type === 'video') && !value.assetPath) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Slides de mídia precisam de um arquivo enviado.', path: ['assetPath'] });
  }

  if (value.type === 'image' && value.assetKind !== 'image') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Slides de imagem precisam de asset do tipo image.', path: ['assetKind'] });
  }

  if (value.type === 'video' && value.assetKind !== 'video') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Slides de vídeo precisam de asset do tipo video.', path: ['assetKind'] });
  }

  if ((value.type === 'image' || value.type === 'text') && value.durationMs > SIGNAGE_IMAGE_TEXT_MAX_DURATION_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Slides de imagem e texto podem ter no máximo 2 minutos.',
      path: ['durationMs'],
    });
  }
});

export type SignageSlideInput = z.infer<typeof signageSlideSchema>;

export function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function getSignageAssetUrl(assetPath?: string) {
  if (!assetPath) return undefined;
  const encoded = assetPath.split('/').map(encodeURIComponent).join('/');
  return `/api/signage/asset/${encoded}`;
}

export function getPublishedTimestamp(input?: { updatedAt?: string } | null) {
  return input?.updatedAt ? Date.parse(input.updatedAt) || 0 : 0;
}

export function sanitizeKioskIds(input: string[], allowedKioskIds: string[], isAdmin: boolean) {
  const unique = Array.from(new Set(input.filter(Boolean)));
  return isAdmin ? unique : unique.filter(kioskId => allowedKioskIds.includes(kioskId));
}

export function buildPublishedPlayerDocument(
  kiosk: Kiosk,
  slides: SignageSlide[],
  actor: { userId: string; username: string }
): PublishedPlayerDocument {
  const publishedSlides: PublishedPlayerSlide[] = slides
    .filter(slide => slide.isActive && slide.kioskIds.includes(kiosk.id))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    .map((slide) => stripUndefined({
      id: slide.id,
      title: slide.title,
      type: slide.type,
      durationMs: slide.durationMs,
      order: slide.order,
      assetUrl: getSignageAssetUrl(slide.assetPath),
      assetKind: slide.assetKind,
      text: slide.text,
      background: slide.background,
    }));

  return {
    kioskId: kiosk.id,
    kioskName: kiosk.name,
    updatedAt: new Date().toISOString(),
    generatedBy: actor,
    slides: publishedSlides,
  };
}
