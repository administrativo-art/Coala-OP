import { NextRequest, NextResponse } from 'next/server';
import { type z } from 'zod';

import { AppError } from '@/lib/observability/app-error';
import { createInMemoryRateLimiter } from '@/lib/observability/rate-limit';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { signagePairSchema } from '@/lib/signage';
import { findSignageScreenByDeviceToken, SIGNAGE_PLAYER_CORS_HEADERS, type StaticRouteContext } from '@/lib/signage-server';
import { type SignageScreen } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PairInput = z.infer<typeof signagePairSchema>;

// Freio contra adivinhação do código (32^8 combinações). Vale por instância do servidor.
const limiter = createInMemoryRateLimiter({ limit: 10, windowMs: 60_000 });

// O app do monitor não tem login: quem digita o código de acesso da tela recebe o id dela.
const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.player.pair',
  version: 1,
  surface: { method: 'POST', path: '/api/signage/pair' },
  exposure: 'public',
  identity: { kind: 'none' },
  authorization: { kind: 'custom', strategy: 'signage.device-token-lookup' },
  resourceScope: { kind: 'custom', strategy: 'signage.screen' },
  input: { kind: 'schema', schema: 'signage.pair.input', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, undefined, PairInput, SignageScreen | null>(contract, {
  async parseInput({ request }) {
    const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!limiter.check(client).allowed) {
      throw new AppError({
        code: 'SIGNAGE_PAIR_RATE_LIMITED',
        kind: 'EXPECTED_BUSINESS',
        httpStatus: 429,
        safeMessage: 'Muitas tentativas. Aguarde um minuto.',
        reportable: false,
        retryable: true,
      });
    }
    const parsed = signagePairSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_PAIR_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Código inválido.' });
    }
    return parsed.data;
  },
  // O código é a credencial: só a tela que o tem configurado é devolvida.
  loadResource: ({ input }) => findSignageScreenByDeviceToken(input.code),
  authorize: () => undefined,
  assertScope: () => undefined,
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const screen = security.resource;
  // Código desconhecido responde 200: o app distingue "não encontrado" de "sem internet" pelo corpo.
  return NextResponse.json(
    screen
      ? { found: true, screenId: screen.id, screenName: screen.name, kioskName: screen.kioskName }
      : { found: false },
    { headers: SIGNAGE_PLAYER_CORS_HEADERS },
  );
});
