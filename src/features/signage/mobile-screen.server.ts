import 'server-only';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import {
  nextSignageScreenName,
  planNewSignageScreen,
  SIGNAGE_DEFAULT_SCREEN_NAME,
  SIGNAGE_MAX_SCREENS_PER_KIOSK,
  signageMobileScreenSchema,
  type SignageOrientation,
} from '@/lib/signage';
import { listSignageScreens, resolveSignageScreen } from '@/lib/signage-server';
import { canAccessUnit } from '@/lib/unit-access';
import type { SignageScreen } from '@/types';

function failure(code: string, safeMessage: string, kind: 'VALIDATION' | 'AUTHORIZATION' | 'NOT_FOUND' | 'CONFLICT' = 'CONFLICT'): never {
  throw new AppError({ code: `MOBILE_SIGNAGE_${code}`, kind, safeMessage });
}

/** Permissão da lista do aplicativo; gerenciar o Signage no sistema não a concede. */
export function assertCanManageMobileSignage(actor: ServerUserContext) {
  if (!actor.isDefaultAdmin && actor.permissions.app?.signage?.manage !== true) {
    failure('FORBIDDEN', 'Sua conta não possui permissão para adicionar telas pelo aplicativo.', 'AUTHORIZATION');
  }
}

const canUseUnit = (actor: ServerUserContext, unitId: string) => canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin });

function unitView(name: string, id: string, screens: SignageScreen[]) {
  const next = planNewSignageScreen(screens);
  return {
    id,
    name,
    // O código de acesso não sai daqui: o aplicativo só precisa saber se a tela já tem monitor.
    screens: screens
      .map((screen) => ({ id: screen.id, name: screen.name, orientation: screen.orientation ?? null, connected: Boolean(screen.deviceToken) }))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR', { numeric: true })),
    nextScreenName: next.name,
    full: next.full,
  };
}

/** Unidades do usuário, as telas de cada uma e o nome que a próxima vai receber. */
export async function loadMobileSignageUnits(actor: ServerUserContext) {
  assertCanManageMobileSignage(actor);
  const screens = (await listSignageScreens()).filter((screen) => canUseUnit(actor, screen.kioskId));
  const byUnit = new Map<string, { name: string; screens: SignageScreen[] }>();
  for (const screen of screens) {
    const unit = byUnit.get(screen.kioskId) ?? { name: screen.kioskName, screens: [] };
    unit.screens.push(screen);
    byUnit.set(screen.kioskId, unit);
  }
  return { units: [...byUnit.entries()].map(([id, unit]) => unitView(unit.name, id, unit.screens)).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')) };
}

async function codeInUse(code: string) {
  const [kiosks, screens] = await Promise.all([
    dbAdmin.collection('kiosks').where('deviceToken', '==', code).limit(1).get(),
    signageDbAdmin.collection('screens').where('deviceToken', '==', code).limit(1).get(),
  ]);
  return !kiosks.empty || !screens.empty;
}

type Author = { userId: string; username: string };

/** Tela padrão: o código mora no cadastro da unidade; o documento de mesmo id guarda só nome e posição. */
async function connectDefaultScreen(kioskId: string, code: string, orientation: SignageOrientation, now: string, author: Author) {
  const override = signageDbAdmin.collection('screens').doc(kioskId);
  await dbAdmin.collection('kiosks').doc(kioskId).update({ deviceToken: code });
  await override.set({ orientation, connectedAt: now, connectedBy: author, source: 'coala-one-app' }, { merge: true });
}

/**
 * Liga o monitor que mostrou o QR code a uma tela da unidade. Sem `screenId`, cria a próxima tela:
 * a primeira é a tela padrão ("Tela 1"), as seguintes são telas adicionais. Com `screenId`, o
 * monitor assume uma tela existente e o código anterior dela deixa de valer.
 * O monitor consulta o próprio código em `/api/signage/pair` e se conecta sozinho logo depois.
 */
export async function addMobileSignageScreen(raw: unknown, actor: ServerUserContext) {
  assertCanManageMobileSignage(actor);
  const parsed = signageMobileScreenSchema.safeParse(raw);
  if (!parsed.success) failure('INPUT_INVALID', 'QR code, unidade ou posição inválidos.', 'VALIDATION');
  const { kioskId, screenId, orientation, code } = parsed.data;
  if (!canUseUnit(actor, kioskId)) failure('UNIT_FORBIDDEN', 'A unidade não está no escopo da sua conta.', 'AUTHORIZATION');
  // O mesmo QR code lido duas vezes, ou um código já usado por outra tela, não cria nada.
  if (await codeInUse(code)) failure('CODE_IN_USE', 'Este monitor já foi adicionado. Para ligá-lo a outra tela, escolha "Trocar de tela" no monitor e leia o novo QR code.');

  const now = new Date().toISOString();
  const author: Author = { userId: actor.userDoc.id, username: String(actor.userDoc.username ?? '') };

  if (screenId) {
    const screen = await resolveSignageScreen(screenId);
    if (!screen || screen.kioskId !== kioskId) failure('SCREEN_NOT_FOUND', 'Tela não encontrada nesta unidade.', 'NOT_FOUND');
    if (screen.isDefault) await connectDefaultScreen(kioskId, code, orientation, now, author);
    else await signageDbAdmin.collection('screens').doc(screen.id).update({ deviceToken: code, orientation, connectedAt: now, connectedBy: author });
    return { screen: { id: screen.id, name: screen.name, kioskName: screen.kioskName, orientation }, created: false };
  }

  const kioskRef = dbAdmin.collection('kiosks').doc(kioskId);
  // Tela 1: o código vai para a unidade só se ela ainda não tiver monitor; a checagem e a gravação são atômicas.
  const kiosk = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(kioskRef);
    if (!snapshot.exists) failure('UNIT_NOT_FOUND', 'Unidade não encontrada.', 'NOT_FOUND');
    const usedDefault = !snapshot.get('deviceToken');
    if (usedDefault) transaction.update(kioskRef, { deviceToken: code });
    return { name: String(snapshot.get('name') ?? ''), usedDefault };
  });

  const collection = signageDbAdmin.collection('screens');
  if (kiosk.usedDefault) {
    const override = collection.doc(kioskId);
    await override.set({ orientation, connectedAt: now, connectedBy: author, source: 'coala-one-app' }, { merge: true });
    const name = String((await override.get()).get('name') || SIGNAGE_DEFAULT_SCREEN_NAME);
    return { screen: { id: kioskId, name, kioskName: kiosk.name, orientation }, created: true };
  }

  const ref = collection.doc();
  const name = await signageDbAdmin.runTransaction(async (transaction) => {
    const existing = await transaction.get(collection.where('kioskId', '==', kioskId).limit(SIGNAGE_MAX_SCREENS_PER_KIOSK + 1));
    const defaultOverride = await transaction.get(collection.doc(kioskId));
    const extras = existing.docs.filter((document) => document.id !== kioskId);
    if (extras.length + 1 >= SIGNAGE_MAX_SCREENS_PER_KIOSK) failure('SCREEN_LIMIT', `Cada unidade pode ter até ${SIGNAGE_MAX_SCREENS_PER_KIOSK} telas.`);
    const names = [String(defaultOverride.get('name') || SIGNAGE_DEFAULT_SCREEN_NAME), ...extras.map((document) => String(document.get('name') ?? ''))];
    const nextName = nextSignageScreenName(names);
    transaction.set(ref, { kioskId, name: nextName, deviceToken: code, orientation, createdAt: now, createdBy: author, connectedAt: now, connectedBy: author, source: 'coala-one-app' });
    return nextName;
  });
  return { screen: { id: ref.id, name, kioskName: kiosk.name, orientation }, created: true };
}
