import { NextRequest, NextResponse } from 'next/server';
import { type z } from 'zod';

import { dbAdmin } from '@/lib/firebase-admin';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { SIGNAGE_MAX_SCREENS_PER_KIOSK, signageScreenCreateSchema } from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import {
  assertSignageKioskAccess,
  authenticateSignage,
  canAccessSignageKiosk,
  listSignageScreens,
  type StaticRouteContext,
} from '@/lib/signage-server';
import { type SignageScreen } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateInput = z.infer<typeof signageScreenCreateSchema>;
type KioskResource = { id: string; name: string };

const listContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.screen.list',
  version: 1,
  surface: { method: 'GET', path: '/api/signage/screens' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.view' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const createContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.screen.create',
  version: 1,
  surface: { method: 'POST', path: '/api/signage/screens' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'signage.screen.create-input', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
});

// A permissão é conferida em `authenticateSignage`; `authorize` existe para o contrato exigir a etapa.
const listEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, SignageAccess, undefined, SignageAccess>(listContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'view'),
  loadResource: ({ actor }) => actor,
  authorize: () => undefined,
  // Listagem: o escopo é aplicado como filtro no handler.
  assertScope: () => undefined,
});

const createEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, SignageAccess, CreateInput, KioskResource>(createContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  async parseInput({ request }) {
    const parsed = signageScreenCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_SCREEN_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Informe a unidade e um nome de até 60 caracteres.' });
    }
    return parsed.data;
  },
  async loadResource({ input }) {
    const snapshot = await dbAdmin.collection('kiosks').doc(input.kioskId).get();
    if (!snapshot.exists) throw new AppError({ code: 'SIGNAGE_KIOSK_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Unidade não encontrada.' });
    return { id: snapshot.id, name: String(snapshot.data()?.name ?? '') };
  },
  authorize: () => undefined,
  assertScope: ({ actor, resource }) => assertSignageKioskAccess(actor, [resource.id]),
});

export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async ({ security }) => {
  const screens = (await listSignageScreens()).filter((screen) => canAccessSignageKiosk(security.resource, screen.kioskId));
  return NextResponse.json({ screens });
});

export const POST = secureRoute({ contract: createContract, enforcer: createEnforcer }, async ({ security }) => {
  const { actor, input, resource: kiosk } = security;
  const collection = signageDbAdmin.collection('screens');
  const ref = collection.doc();

  // A contagem e a criação ficam na mesma transação para o limite por unidade valer com cliques simultâneos.
  await signageDbAdmin.runTransaction(async (transaction) => {
    const existing = await transaction.get(collection.where('kioskId', '==', kiosk.id).limit(SIGNAGE_MAX_SCREENS_PER_KIOSK + 1));
    const extraCount = existing.docs.filter((doc) => doc.id !== kiosk.id).length;
    if (extraCount + 1 >= SIGNAGE_MAX_SCREENS_PER_KIOSK) {
      throw new AppError({ code: 'SIGNAGE_SCREEN_LIMIT', kind: 'CONFLICT', safeMessage: `Cada unidade pode ter até ${SIGNAGE_MAX_SCREENS_PER_KIOSK} telas.` });
    }
    transaction.set(ref, {
      kioskId: kiosk.id,
      name: input.name,
      createdAt: new Date().toISOString(),
      createdBy: { userId: actor.user.id, username: actor.user.username },
    });
  });

  const screen: SignageScreen = { id: ref.id, kioskId: kiosk.id, kioskName: kiosk.name, name: input.name, isDefault: false };
  return NextResponse.json({ screen }, { status: 201 });
});
