import { NextRequest, NextResponse } from 'next/server';
import { type z } from 'zod';

import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { signageAppDownloadSchema } from '@/lib/signage';
import { type StaticRouteContext } from '@/lib/signage-server';
import { verifyAuthWithUser } from '@/lib/verify-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LogInput = z.infer<typeof signageAppDownloadSchema>;
type LoggedUser = { userId: string; username: string };

// Qualquer pessoa com login pode instalar uma tela; o registro diz quem foi.
const logContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.app-download.log',
  version: 1,
  surface: { method: 'POST', path: '/api/signage/app/downloads' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'none' },
  resourceScope: { kind: 'none' },
  input: { kind: 'schema', schema: 'signage.app-download.input', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
});

const logEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, LoggedUser, LogInput, undefined>(logContract, {
  async authenticate({ request }) {
    try {
      const { decoded, userSnap } = await verifyAuthWithUser(request, { enforceProfileCompliance: false });
      const username = userSnap.data()?.username;
      return {
        userId: decoded.uid,
        username: typeof username === 'string' && username ? username : (typeof decoded.name === 'string' && decoded.name) || decoded.email || decoded.uid,
      };
    } catch (cause) {
      throw new AppError({ code: 'SIGNAGE_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause });
    }
  },
  async parseInput({ request }) {
    const parsed = signageAppDownloadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_APP_DOWNLOAD_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Registro inválido.' });
    }
    return parsed.data;
  },
});

export const POST = secureRoute({ contract: logContract, enforcer: logEnforcer }, async ({ request, security }) => {
  await signageDbAdmin.collection('appDownloads').add({
    userId: security.actor.userId,
    username: security.actor.username,
    platform: security.input.platform,
    event: security.input.event,
    at: new Date().toISOString(),
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300),
  });
  return NextResponse.json({ success: true });
});
