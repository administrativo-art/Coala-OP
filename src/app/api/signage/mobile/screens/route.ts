import { NextRequest, NextResponse } from 'next/server';
import { type z } from 'zod';

import { addMobileSignageScreen, assertCanManageMobileSignage } from '@/features/signage/mobile-screen.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { assertMobileAppAttested } from '@/lib/security/mobile-app-attestation.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { signageMobileScreenSchema } from '@/lib/signage';
import { canAccessUnit } from '@/lib/unit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaticRouteContext = { params: Promise<Record<string, never>> };
type ScreenInput = z.infer<typeof signageMobileScreenSchema>;

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.mobile.screen.add',
  version: 1,
  surface: { method: 'POST', path: '/api/signage/mobile/screens' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'app.signage.manage' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'signage.mobile.screen-input', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
  additionalGuarantees: ['replay-protected'],
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, ScreenInput, { workspaceId: string; unitId: string }>({
  id: 'signage-mobile-screen-add-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'unit-scoped', 'input-validated', 'fields-allowlisted', 'replay-protected'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'MOBILE_SIGNAGE_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    assertCanManageMobileSignage(actor);
    const parsed = signageMobileScreenSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'MOBILE_SIGNAGE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'QR code, unidade ou posição inválidos.' });
    }
    if (!canAccessUnit(actor.userDoc, parsed.data.kioskId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'MOBILE_SIGNAGE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'A unidade não está no escopo da sua conta.' });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, unitId: parsed.data.kioskId } };
  },
});

// Sem repetição: o código do monitor só pode virar tela uma vez; ler o mesmo QR code de novo é recusado.
export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await addMobileSignageScreen(security.input, security.actor), { status: 201, headers: { 'Cache-Control': 'private, no-store' } }));
