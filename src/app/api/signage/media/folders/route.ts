import { NextRequest, NextResponse } from 'next/server';
import { type z } from 'zod';

import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { SIGNAGE_MEDIA_FOLDER_MAX, signageMediaFolderSchema } from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import { authenticateSignage, type StaticRouteContext } from '@/lib/signage-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FolderInput = z.infer<typeof signageMediaFolderSchema>;

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.media-folder.create',
  version: 1,
  surface: { method: 'POST', path: '/api/signage/media/folders' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'none' },
  input: { kind: 'schema', schema: 'signage.media-folder.input', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, SignageAccess, FolderInput, undefined>(contract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  async parseInput({ request }) {
    const parsed = signageMediaFolderSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_MEDIA_FOLDER_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Informe um nome de até 60 caracteres.' });
    }
    return parsed.data;
  },
  authorize: () => undefined,
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { name } = security.input;
  const folders = signageDbAdmin.collection('mediaFolders');
  const ref = folders.doc();

  // Limite e nome repetido são conferidos junto com a criação.
  await signageDbAdmin.runTransaction(async (transaction) => {
    const existing = await transaction.get(folders.limit(SIGNAGE_MEDIA_FOLDER_MAX + 1));
    if (existing.size >= SIGNAGE_MEDIA_FOLDER_MAX) {
      throw new AppError({ code: 'SIGNAGE_MEDIA_FOLDER_LIMIT', kind: 'CONFLICT', safeMessage: `A biblioteca aceita até ${SIGNAGE_MEDIA_FOLDER_MAX} pastas.` });
    }
    const key = name.toLocaleLowerCase('pt-BR');
    if (existing.docs.some((doc) => String(doc.data().name ?? '').toLocaleLowerCase('pt-BR') === key)) {
      throw new AppError({ code: 'SIGNAGE_MEDIA_FOLDER_DUPLICATE', kind: 'CONFLICT', safeMessage: 'Já existe uma pasta com este nome.' });
    }
    transaction.create(ref, {
      name,
      createdAt: new Date().toISOString(),
      createdBy: { userId: security.actor.user.id, username: security.actor.user.username },
    });
  });

  return NextResponse.json({ folder: { id: ref.id, name } });
});
