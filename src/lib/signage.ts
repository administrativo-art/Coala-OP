import { z } from 'zod';

import { type PublishedPlayerDocument, type PublishedPlayerSlide, type SignageSchedule, type SignageScreen, type SignageSlide } from '@/types';

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
/**
 * Aplicativos do Coala, servidos de `public/app/` e listados em `/app`. São dois produtos:
 * o Coala Signage APP (vai nas telas) e o Coala Mobile APP (smartphones e tablets Android).
 * `packagePath: null` é instalador que ainda não existe: a página mostra o botão desativado.
 */
export const COALA_APP_INSTALLERS: {
  signage: { launcherPath: string; packagePath: string };
  mobile: { packagePath: string | null };
} = {
  signage: { launcherPath: '/app', packagePath: '/app/CoalaSignage.wgt' },
  // APK do aplicativo Coala One, gerado por `apps/coala-notas/scripts/build-apk.sh`.
  mobile: { packagePath: '/app/CoalaMobile.apk' },
};
/** Registro de quem abriu a página de aplicativos e de quem baixou cada um. */
export const signageAppDownloadSchema = z.object({
  platform: z.enum(['signage', 'mobile', 'page']),
  event: z.enum(['view', 'download']),
}).strict();
export const SIGNAGE_DEFAULT_SCREEN_NAME = 'Tela 1';
export const SIGNAGE_MAX_SCREENS_PER_KIOSK = 12;
export const SIGNAGE_DEVICE_TOKEN_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const signageIdSchema = z.string().trim().min(1).max(160).refine((value) => !value.includes('/'), 'Identificador inválido.');

export const signageScheduleSchema = z.object({
  startTime: z.string().regex(timeRegex).optional(),
  endTime: z.string().regex(timeRegex).optional(),
  startDate: z.string().regex(dateRegex).optional(),
  endDate: z.string().regex(dateRegex).optional(),
}).strict().optional();

export const signageSlideSchema = z.object({
  title: z.string().trim().min(2).max(120),
  type: z.enum(['image', 'video', 'text']),
  durationMs: z.number().int().min(SIGNAGE_MIN_DURATION_MS).max(SIGNAGE_VIDEO_MAX_DURATION_MS),
  order: z.number().int().min(0).max(9999),
  screenIds: z.array(signageIdSchema).min(1).max(200),
  orderByScreen: z.record(signageIdSchema, z.number().int().min(0).max(9999)).optional(),
  isActive: z.boolean(),
  // A mídia só pode apontar para a pasta do signage: o servidor apaga o arquivo quando o slide o abandona.
  assetPath: z.string().trim().max(400).regex(/^signage\/[^/]+$/, 'Mídia inválida.').optional(),
  assetKind: z.enum(['image', 'video']).optional(),
  text: z.string().trim().max(1200).optional(),
  background: z.string().trim().max(32).optional(),
  schedule: signageScheduleSchema,
}).strict().superRefine((value, ctx) => {
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

export const signagePublishSchema = z.object({
  screenIds: z.array(signageIdSchema).min(1).max(200),
}).strict();

export const signageScreenCreateSchema = z.object({
  kioskId: signageIdSchema,
  name: z.string().trim().min(1).max(60),
}).strict();

export const signageScreenUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  token: z.enum(['rotate', 'clear']).optional(),
}).strict().refine((value) => value.name !== undefined || value.token !== undefined, 'Nada para alterar.');

export const SIGNAGE_MEDIA_LIST_LIMIT = 300;
export const SIGNAGE_MEDIA_FOLDER_MAX = 50;

export const signageMediaUpdateSchema = z.object({
  fileName: z.string().trim().min(1).max(120).optional(),
  // `null` devolve a mídia para "Sem pasta".
  folderId: signageIdSchema.nullable().optional(),
}).strict().refine((value) => value.fileName !== undefined || value.folderId !== undefined, 'Nada para alterar.');

export const signageMediaFolderSchema = z.object({
  name: z.string().trim().min(1).max(60),
}).strict();

export const signageHeartbeatSchema = z.object({
  // `kioskId` é o nome histórico do parâmetro do player; hoje carrega o id da tela.
  kioskId: signageIdSchema.optional(),
  screenId: signageIdSchema.optional(),
  currentSlideId: z.string().trim().max(160).optional(),
  updatedAt: z.string().trim().max(40).optional(),
  status: z.enum(['cache', 'realtime', 'app']).optional(),
  // O app do monitor manda o código no corpo para o POST seguir como requisição simples (sem preflight).
  token: z.string().trim().max(40).optional(),
  appVersion: z.string().trim().max(20).optional(),
}).refine((value) => Boolean(value.screenId ?? value.kioskId), 'Tela não informada.');

/** Pareamento do app do monitor: o código de acesso da tela, como aparece no editor. */
export const signagePairSchema = z.object({
  code: z.string().trim().toUpperCase().regex(SIGNAGE_DEVICE_TOKEN_PATTERN),
}).strict();

export const signageOrientationSchema = z.enum(['landscape', 'portrait']);
export type SignageOrientation = z.infer<typeof signageOrientationSchema>;
export const SIGNAGE_ORIENTATION_LABEL: Record<SignageOrientation, string> = { landscape: 'Horizontal', portrait: 'Vertical' };
export function isSignageOrientation(value: unknown): value is SignageOrientation {
  return value === 'landscape' || value === 'portrait';
}

/**
 * Cadastro de tela pelo aplicativo: o monitor sorteia um código e o mostra em QR code; quem lê
 * o QR code informa a unidade e a posição, e o código passa a ser o da tela. Com `screenId`, o
 * monitor assume uma tela que já existe (troca de aparelho) em vez de criar outra.
 */
export const signageMobileScreenSchema = z.object({
  kioskId: signageIdSchema,
  screenId: signageIdSchema.optional(),
  orientation: signageOrientationSchema,
  code: z.string().trim().toUpperCase().regex(SIGNAGE_DEVICE_TOKEN_PATTERN),
}).strict();

/** O que o QR code do monitor carrega: o endereço da página de aplicativos com o código da tela. */
export function signagePairingUrl(origin: string, code: string) {
  return `${origin.replace(/\/+$/, '')}/app?tela=${code}`;
}

/** Código lido de um QR code de pareamento; `null` quando o QR code não é de uma tela do Coala Signage. */
export function parseSignagePairingCode(scanned: string) {
  const match = /[?&]tela=([A-Za-z0-9]{8})(?:[&#]|$)/.exec(scanned.trim());
  const code = match?.[1]?.toUpperCase() ?? '';
  return SIGNAGE_DEVICE_TOKEN_PATTERN.test(code) ? code : null;
}

/**
 * A tela que "Adicionar tela" vai criar na unidade: enquanto a tela padrão não tem monitor, é ela
 * (a "Tela 1"); depois, uma tela adicional com o próximo nome livre.
 */
export function planNewSignageScreen(screens: { name: string; isDefault: boolean; deviceToken?: string }[]) {
  const first = screens.find((screen) => screen.isDefault);
  if (first && !first.deviceToken) return { name: first.name, usesDefault: true, full: false };
  return {
    name: nextSignageScreenName(screens.map((screen) => screen.name)),
    usesDefault: false,
    full: screens.length >= SIGNAGE_MAX_SCREENS_PER_KIOSK,
  };
}

/**
 * Nome automático da próxima tela da unidade: a primeira é a "Tela 1" (a tela padrão); as demais
 * recebem o menor número ainda livre, para um nome apagado poder ser reaproveitado sem repetir outro.
 */
export function nextSignageScreenName(existingNames: string[]) {
  const taken = new Set(existingNames.map((name) => name.trim().toLocaleLowerCase('pt-BR')));
  for (let number = 1; number <= SIGNAGE_MAX_SCREENS_PER_KIOSK + 1; number += 1) {
    if (!taken.has(`tela ${number}`)) return `Tela ${number}`;
  }
  return `Tela ${existingNames.length + 1}`;
}

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

/** Telas que exibem o slide; slides anteriores às telas só têm `kioskIds`, que são as telas padrão. */
export function getSlideScreenIds(slide: { screenIds?: string[]; kioskIds?: string[] }): string[] {
  return slide.screenIds?.length ? slide.screenIds : slide.kioskIds ?? [];
}

export function getSlideOrder(slide: { order: number; orderByScreen?: Record<string, number> }, screenId: string): number {
  return slide.orderByScreen?.[screenId] ?? slide.order;
}

/** Slides de uma tela, na sequência dela. */
export function getScreenSlides<T extends Pick<SignageSlide, 'title' | 'order' | 'orderByScreen'> & { screenIds?: string[]; kioskIds?: string[] }>(
  slides: T[],
  screenId: string
): T[] {
  return slides
    .filter((slide) => getSlideScreenIds(slide).includes(screenId))
    .sort((a, b) => getSlideOrder(a, screenId) - getSlideOrder(b, screenId) || a.title.localeCompare(b.title));
}

/**
 * Telas finais de um slide editado: as pedidas mais as que já estavam e quem edita não enxerga.
 * `forbidden` lista telas novas fora do escopo de quem edita; o servidor recusa o pedido.
 */
export function mergeSlideScreenIds(input: {
  requested: string[];
  current: string[];
  canAccess: (screenId: string) => boolean;
}): { screenIds: string[]; forbidden: string[] } {
  const requested = Array.from(new Set(input.requested));
  const preserved = input.current.filter((screenId) => !input.canAccess(screenId));
  const forbidden = requested.filter((screenId) => !input.canAccess(screenId) && !input.current.includes(screenId));
  return { screenIds: Array.from(new Set([...requested, ...preserved])), forbidden };
}

/** Mantém só as posições de telas que continuam exibindo o slide. */
export function pruneOrderByScreen(orderByScreen: Record<string, number> | undefined, screenIds: string[]) {
  const entries = Object.entries(orderByScreen ?? {}).filter(([screenId]) => screenIds.includes(screenId));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Data local "YYYY-MM-DD"; o agendamento é digitado no horário da unidade, não em UTC. */
export function getLocalDateKey(now: Date) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function isSlideScheduleActive(slide: { schedule?: SignageSchedule }, now: Date = new Date()): boolean {
  const s = slide.schedule;
  if (!s) return true;

  const currentDate = getLocalDateKey(now);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hh}:${mm}`;

  if (s.startDate && currentDate < s.startDate) return false;
  if (s.endDate && currentDate > s.endDate) return false;

  if (s.startTime && s.endTime) {
    if (s.startTime < s.endTime) {
      if (currentTime < s.startTime || currentTime >= s.endTime) return false;
    } else {
      // overnight range e.g. 22:00 → 06:00
      if (currentTime < s.startTime && currentTime >= s.endTime) return false;
    }
  } else if (s.startTime && currentTime < s.startTime) {
    return false;
  } else if (s.endTime && currentTime >= s.endTime) {
    return false;
  }

  return true;
}

/**
 * Slide em exibição: o mesmo de antes enquanto ele continuar na lista; senão, o primeiro.
 * A posição é guardada pelo id para que reavaliar o agendamento não reinicie a playlist.
 */
export function resolveActiveSlide<T extends { id: string }>(slides: T[], activeSlideId: string | null): T | null {
  if (!slides.length) return null;
  return slides.find(slide => slide.id === activeSlideId) ?? slides[0];
}

/** Próximo slide da rotação, voltando ao início depois do último. */
export function getNextSlide<T extends { id: string }>(slides: T[], activeSlideId: string | null): T | null {
  if (!slides.length) return null;
  const currentIndex = slides.findIndex(slide => slide.id === activeSlideId);
  return slides[(currentIndex + 1) % slides.length];
}

export function formatSignageDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Slides que entram na publicação de uma tela, na ordem em que ela exibe. */
export function buildPublishedSlides(screenId: string, slides: SignageSlide[]): PublishedPlayerSlide[] {
  return getScreenSlides(slides.filter((slide) => slide.isActive), screenId)
    .map((slide, index) => stripUndefined({
      id: slide.id,
      title: slide.title,
      type: slide.type,
      durationMs: slide.durationMs,
      order: index,
      assetUrl: getSignageAssetUrl(slide.assetPath),
      assetKind: slide.assetKind,
      text: slide.text,
      background: slide.background,
      schedule: slide.schedule,
    }));
}

function publishedSlideSignature(slide: PublishedPlayerSlide) {
  return JSON.stringify([
    slide.id,
    slide.title,
    slide.type,
    slide.durationMs,
    slide.assetUrl ?? null,
    slide.text ?? null,
    slide.background ?? null,
    slide.schedule?.startTime ?? null,
    slide.schedule?.endTime ?? null,
    slide.schedule?.startDate ?? null,
    slide.schedule?.endDate ?? null,
  ]);
}

export type SignagePublicationState = 'never' | 'outdated' | 'current';

/**
 * Compara o que a tela recebeu na última publicação com o que o editor tem agora.
 * `order` fica fora da assinatura: só a sequência resultante importa para a tela.
 */
export function getPublicationState(
  screenId: string,
  slides: SignageSlide[],
  published: Pick<PublishedPlayerDocument, 'slides'> | null | undefined
): SignagePublicationState {
  if (!published) return 'never';
  const expected = buildPublishedSlides(screenId, slides).map(publishedSlideSignature);
  const current = (published.slides ?? []).map(publishedSlideSignature);
  if (expected.length !== current.length) return 'outdated';
  return expected.every((signature, index) => signature === current[index]) ? 'current' : 'outdated';
}

export function buildPublishedPlayerDocument(
  screen: SignageScreen,
  slides: SignageSlide[],
  actor: { userId: string; username: string }
): PublishedPlayerDocument {
  return {
    kioskId: screen.kioskId,
    kioskName: screen.kioskName,
    screenId: screen.id,
    screenName: screen.name,
    updatedAt: new Date().toISOString(),
    generatedBy: actor,
    slides: buildPublishedSlides(screen.id, slides),
  };
}
