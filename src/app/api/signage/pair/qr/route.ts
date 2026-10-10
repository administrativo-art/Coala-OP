import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

import { AppError } from '@/lib/observability/app-error';
import { createInMemoryRateLimiter } from '@/lib/observability/rate-limit';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { SIGNAGE_DEVICE_TOKEN_PATTERN, signagePairingUrl } from '@/lib/signage';
import { type StaticRouteContext } from '@/lib/signage-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// O monitor pede a imagem uma vez por pareamento; o freio existe só para a rota não virar gerador de QR code aberto.
const limiter = createInMemoryRateLimiter({ limit: 30, windowMs: 60_000 });

// O app do monitor não tem biblioteca de QR code: ele sorteia o código e pede aqui a imagem pronta.
// A rota não lê nem grava nada; o código só vira tela quando alguém autorizado o lê pelo aplicativo.
const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.player.pair-qr',
  version: 1,
  surface: { method: 'GET', path: '/api/signage/pair/qr' },
  exposure: 'public',
  identity: { kind: 'none' },
  authorization: { kind: 'none' },
  resourceScope: { kind: 'none' },
  input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, undefined, undefined, undefined>(contract, {});

export const GET = secureRoute({ contract, enforcer }, async ({ request }) => {
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!limiter.check(client).allowed) {
    throw new AppError({ code: 'SIGNAGE_PAIR_QR_RATE_LIMITED', kind: 'EXPECTED_BUSINESS', httpStatus: 429, safeMessage: 'Muitas tentativas. Aguarde um minuto.', reportable: false, retryable: true });
  }
  const code = (request.nextUrl.searchParams.get('code') ?? '').toUpperCase();
  if (!SIGNAGE_DEVICE_TOKEN_PATTERN.test(code)) {
    throw new AppError({ code: 'SIGNAGE_PAIR_QR_INVALID', kind: 'VALIDATION', safeMessage: 'Código inválido.' });
  }
  const svg = await QRCode.toString(signagePairingUrl(request.nextUrl.origin, code), { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  return new NextResponse(svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400, immutable' } });
});
