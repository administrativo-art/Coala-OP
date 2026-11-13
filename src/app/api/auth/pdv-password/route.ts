import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { updatePdvLegalUserAccess } from '@/lib/integrations/pdv-legal-admin';
import { AppError } from '@/lib/observability/app-error';
import { activePdvPasswordAccesses } from '@/lib/pdv-password-access';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<Record<string, never>> };
type Resource = { ownerId: string };

const inputSchema = z.object({
  accessId: z.string().regex(/^\d+$/),
  newPassword: z.string().regex(/^[1-9]\d{3}$/),
}).strict();

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'auth.pdv-password.update',
  version: 1,
  surface: { method: 'POST', path: '/api/auth/pdv-password' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'owner' },
  resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'auth.pdv-password.input', unknownFields: 'reject' },
  effects: { mode: 'external', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = createStandardSecurityEnforcer<
  NextRequest, RouteContext, unknown, ServerUserContext, z.infer<typeof inputSchema>, Resource
>(contract, {
  authenticate: ({ request }) => requireUser(request).catch(() => {
    throw new AppError({ code: 'PDV_PASSWORD_AUTH_REQUIRED', kind: 'AUTHENTICATION' });
  }),
  loadResource: ({ actor }) => ({ ownerId: actor.decoded.uid }),
  authorize: ({ actor, resource }) => {
    if (resource.ownerId !== actor.decoded.uid) {
      throw new AppError({ code: 'PDV_PASSWORD_OWNER_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    const authTime = actor.decoded.auth_time;
    if (typeof authTime !== 'number' || Math.floor(Date.now() / 1000) - authTime > 300) {
      throw new AppError({ code: 'PDV_PASSWORD_RECENT_LOGIN_REQUIRED', kind: 'AUTHENTICATION', safeMessage: 'Confirme sua identidade novamente antes de alterar a senha do PDV.' });
    }
  },
  assertScope: ({ actor, resource }) => {
    if (resource.ownerId !== actor.decoded.uid) {
      throw new AppError({ code: 'PDV_PASSWORD_SCOPE_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
  },
  async parseInput({ request }) {
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'PDV_PASSWORD_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Informe um acesso válido e uma senha de 4 números que não comece com zero.' });
    }
    return parsed.data;
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const user = security.actor.userDoc;
  const { accessId, newPassword } = security.input;
  const access = activePdvPasswordAccesses(user).find((entry) => entry.externalUserId === accessId);
  if (!access?.filialId) {
    throw new AppError({ code: 'PDV_PASSWORD_ACCESS_NOT_FOUND', kind: 'AUTHORIZATION', safeMessage: 'Acesso ativo ao PDV não encontrado para sua conta.' });
  }

  try {
    await updatePdvLegalUserAccess({ userId: accessId, filialId: access.filialId, newPassword });
  } catch {
    throw new AppError({ code: 'PDV_PASSWORD_UPDATE_FAILED', kind: 'PERMANENT_EXTERNAL', safeMessage: 'O PDV Legal não confirmou a troca de senha. Confira o acesso antes de tentar novamente.' });
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
});
