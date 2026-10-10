import { createHash, randomInt } from 'crypto';

import { type NextRequest } from 'next/server';
import { getStorage } from 'firebase-admin/storage';

import { type Kiosk, type SignageMediaFolder, type SignageMediaItem, type SignageScreen, type SignageSlide } from '@/types';

import { adminApp, dbAdmin } from './firebase-admin';
import { signageDbAdmin } from './firebase-signage-admin';
import { AppError } from './observability/app-error';
import {
  getSignageAssetUrl,
  getSlideScreenIds,
  SIGNAGE_DEFAULT_SCREEN_NAME,
  SIGNAGE_STORAGE_BUCKET,
} from './signage';
import { assertSignageAccess, type SignageAccess } from './signage-auth';

const DEVICE_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type StaticRouteContext = { params: Promise<Record<string, never>> };

/** Autentica quem opera o editor; a mensagem interna da falha não chega ao cliente. */
export async function authenticateSignage(request: NextRequest, mode: 'view' | 'manage'): Promise<SignageAccess> {
  try {
    return await assertSignageAccess(request, mode);
  } catch (cause) {
    const forbidden = cause instanceof Error && cause.message.startsWith('Sem permissão');
    throw new AppError(forbidden
      ? { code: 'SIGNAGE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: mode === 'manage' ? 'Sem permissão para gerenciar o signage.' : 'Sem permissão para acessar o signage.', cause }
      : { code: 'SIGNAGE_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause });
  }
}

export function canAccessSignageKiosk(access: SignageAccess, kioskId: string) {
  return access.allUnits || access.allowedKioskIds.includes(kioskId);
}

export function assertSignageKioskAccess(access: SignageAccess, kioskIds: string[]) {
  if (kioskIds.some((kioskId) => !canAccessSignageKiosk(access, kioskId))) {
    throw new AppError({ code: 'SIGNAGE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Há telas de unidades fora do seu acesso.' });
  }
}

export function generateDeviceToken() {
  return Array.from({ length: 8 }, () => DEVICE_TOKEN_ALPHABET[randomInt(DEVICE_TOKEN_ALPHABET.length)]).join('');
}

function defaultScreen(kiosk: Kiosk, override?: FirebaseFirestore.DocumentData): SignageScreen {
  return {
    id: kiosk.id,
    kioskId: kiosk.id,
    kioskName: kiosk.name,
    name: typeof override?.name === 'string' && override.name ? override.name : SIGNAGE_DEFAULT_SCREEN_NAME,
    ...(kiosk.deviceToken ? { deviceToken: kiosk.deviceToken } : {}),
    isDefault: true,
  };
}

function extraScreen(id: string, data: FirebaseFirestore.DocumentData, kioskName: string): SignageScreen {
  return {
    id,
    kioskId: data.kioskId,
    kioskName,
    name: typeof data.name === 'string' && data.name ? data.name : 'Tela',
    ...(typeof data.deviceToken === 'string' && data.deviceToken ? { deviceToken: data.deviceToken } : {}),
    isDefault: false,
  };
}

/**
 * Todas as telas: a padrão de cada unidade (id igual ao da unidade, sem cadastro) e as
 * cadastradas em `screens`. Lê `kiosks` e `screens` inteiras; ambas crescem com o número
 * de unidades e de TVs, não com o uso.
 */
export async function listSignageScreens(): Promise<SignageScreen[]> {
  const [kiosksSnap, screensSnap] = await Promise.all([
    dbAdmin.collection('kiosks').get(),
    signageDbAdmin.collection('screens').get(),
  ]);
  const kiosks = kiosksSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Kiosk));
  const kioskById = new Map(kiosks.map((kiosk) => [kiosk.id, kiosk]));
  const screenDocs = new Map(screensSnap.docs.map((doc) => [doc.id, doc.data()]));

  const screens = kiosks.map((kiosk) => defaultScreen(kiosk, screenDocs.get(kiosk.id)));
  for (const [id, data] of screenDocs) {
    if (kioskById.has(id)) continue; // documento de mesmo id da unidade só renomeia a tela padrão
    const kiosk = kioskById.get(data.kioskId);
    if (kiosk) screens.push(extraScreen(id, data, kiosk.name));
  }
  return screens;
}

/** Uma tela pelo id, ou `null`. Duas leituras; três quando é uma tela adicional. */
export async function resolveSignageScreen(screenId: string): Promise<SignageScreen | null> {
  const [screenSnap, kioskSnap] = await Promise.all([
    signageDbAdmin.collection('screens').doc(screenId).get(),
    dbAdmin.collection('kiosks').doc(screenId).get(),
  ]);
  if (kioskSnap.exists) {
    return defaultScreen({ id: kioskSnap.id, ...kioskSnap.data() } as Kiosk, screenSnap.data());
  }
  const data = screenSnap.data();
  if (!screenSnap.exists || !data || typeof data.kioskId !== 'string') return null;
  const ownerSnap = await dbAdmin.collection('kiosks').doc(data.kioskId).get();
  if (!ownerSnap.exists) return null;
  return extraScreen(screenSnap.id, data, String(ownerSnap.data()?.name ?? ''));
}

/** Resolve as telas pedidas e recusa ids desconhecidos. */
export async function requireSignageScreens(screenIds: string[]): Promise<SignageScreen[]> {
  const uniqueIds = Array.from(new Set(screenIds));
  const screens = await Promise.all(uniqueIds.map((screenId) => resolveSignageScreen(screenId)));
  if (screens.some((screen) => !screen)) {
    throw new AppError({ code: 'SIGNAGE_SCREEN_NOT_FOUND', kind: 'VALIDATION', safeMessage: 'Uma das telas escolhidas não existe mais.' });
  }
  return screens as SignageScreen[];
}

/** Tela de um player público; o código só é exigido quando a tela tem um configurado. */
export async function requirePlayerScreen(screenId: string, deviceToken: string | null): Promise<SignageScreen> {
  const screen = await resolveSignageScreen(screenId);
  if (!screen) throw new AppError({ code: 'SIGNAGE_SCREEN_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Tela não encontrada.' });
  if (screen.deviceToken && deviceToken !== screen.deviceToken) {
    throw new AppError({ code: 'SIGNAGE_DEVICE_TOKEN_INVALID', kind: 'AUTHORIZATION', safeMessage: 'Código de acesso inválido.' });
  }
  return screen;
}

/**
 * Tela dona de um código de acesso, para o pareamento do app do monitor. Duas consultas por
 * igualdade com limite; código repetido em mais de uma tela não pareia nenhuma.
 */
export async function findSignageScreenByDeviceToken(deviceToken: string): Promise<SignageScreen | null> {
  const [kiosksSnap, screensSnap] = await Promise.all([
    dbAdmin.collection('kiosks').where('deviceToken', '==', deviceToken).limit(2).get(),
    signageDbAdmin.collection('screens').where('deviceToken', '==', deviceToken).limit(2).get(),
  ]);
  const matches = [...kiosksSnap.docs, ...screensSnap.docs];
  if (matches.length !== 1) return null;
  const screen = await resolveSignageScreen(matches[0].id);
  return screen?.deviceToken === deviceToken ? screen : null;
}

/**
 * O app do monitor roda em `file://`. As respostas das rotas públicas do player não usam
 * cookie nem sessão, então podem ser lidas de qualquer origem.
 */
export const SIGNAGE_PLAYER_CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' } as const;

export function normalizeSignageSlide(id: string, data: FirebaseFirestore.DocumentData): SignageSlide {
  return {
    id,
    title: data.title,
    type: data.type,
    durationMs: data.durationMs,
    order: data.order,
    kioskIds: data.kioskIds ?? [],
    screenIds: getSlideScreenIds(data),
    orderByScreen: data.orderByScreen,
    isActive: data.isActive === true,
    assetUrl: getSignageAssetUrl(data.assetPath),
    assetPath: data.assetPath,
    assetKind: data.assetKind,
    text: data.text,
    background: data.background,
    schedule: data.schedule,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdBy: data.createdBy,
    updatedBy: data.updatedBy,
  };
}

export async function deleteSignageAssetIfOrphaned(assetPath: string | undefined, excludingSlideId?: string) {
  if (!assetPath || !/^signage\/[^/]+$/.test(assetPath)) return;

  const references = await signageDbAdmin.collection('slides').where('assetPath', '==', assetPath).limit(2).get();
  if (references.docs.some((doc) => doc.id !== excludingSlideId)) return;
  // Mídia da biblioteca fica guardada mesmo sem slide: só sai quando é excluída de lá.
  const libraryItem = await signageDbAdmin.collection('mediaLibrary').doc(getSignageMediaId(assetPath)).get();
  if (libraryItem.exists) return;

  await getStorage(adminApp).bucket(SIGNAGE_STORAGE_BUCKET).file(assetPath).delete({ ignoreNotFound: true });
}

export function requireRouteId(value: string | undefined, label: string) {
  if (!value || value.includes('/') || value.length > 160) {
    throw new AppError({ code: 'SIGNAGE_ID_INVALID', kind: 'VALIDATION', safeMessage: `${label} inválido.` });
  }
  return value;
}

/** Id da mídia na biblioteca, derivado do arquivo: registrar o mesmo arquivo duas vezes cai no mesmo documento. */
export function getSignageMediaId(assetPath: string) {
  return createHash('sha1').update(assetPath).digest('hex').slice(0, 32);
}

export function detectSignageAsset(buffer: Buffer): { kind: 'image' | 'video'; contentType: string } | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { kind: 'image', contentType: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: 'image', contentType: 'image/jpeg' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { kind: 'image', contentType: 'image/webp' };
  }
  const ftypIndex = buffer.indexOf(Buffer.from('ftyp'));
  if (ftypIndex >= 0 && ftypIndex <= 16) return { kind: 'video', contentType: 'video/mp4' };
  return null;
}

export function serializeSignageMedia(id: string, data: FirebaseFirestore.DocumentData): SignageMediaItem {
  return {
    id,
    fileName: typeof data.fileName === 'string' && data.fileName ? data.fileName : 'mídia',
    kind: data.kind === 'video' ? 'video' : 'image',
    contentType: typeof data.contentType === 'string' ? data.contentType : 'application/octet-stream',
    sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : 0,
    assetPath: data.assetPath,
    assetUrl: getSignageAssetUrl(data.assetPath) ?? '',
    folderId: typeof data.folderId === 'string' ? data.folderId : null,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
  };
}

export function serializeSignageMediaFolder(id: string, data: FirebaseFirestore.DocumentData): SignageMediaFolder {
  return { id, name: typeof data.name === 'string' && data.name ? data.name : 'Pasta' };
}

/** Recusa pasta que não existe; `null` é a raiz ("Sem pasta"). */
export async function requireSignageMediaFolder(folderId: string | null) {
  if (folderId === null) return;
  const folder = await signageDbAdmin.collection('mediaFolders').doc(folderId).get();
  if (!folder.exists) throw new AppError({ code: 'SIGNAGE_MEDIA_FOLDER_NOT_FOUND', kind: 'VALIDATION', safeMessage: 'A pasta escolhida não existe mais.' });
}
