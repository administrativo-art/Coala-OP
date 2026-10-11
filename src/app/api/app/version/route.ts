import { NextRequest, NextResponse } from 'next/server';

import { mobileReleaseForPackage, mobileReleaseQuerySchema } from '@/lib/mobile-app-release';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { type StaticRouteContext } from '@/lib/signage-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// O aplicativo consulta antes do login (a tela de atualização trava até quem não entrou). A resposta é só
// a versão publicada e o caminho do instalador, que já é público; nada é lido nem gravado.
const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'app.version.read',
  version: 3,
  surface: { method: 'GET', path: '/api/app/version' },
  exposure: 'public',
  identity: { kind: 'none' },
  authorization: { kind: 'none' },
  resourceScope: { kind: 'none' },
  input: { kind: 'schema', schema: 'app.version.package-query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, undefined, { packageName?: 'com.coalaone.notas' | 'coalaone.go' }, undefined>(contract, {
  parseInput({ request }) {
    const parsed = mobileReleaseQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: 'APP_VERSION_QUERY_INVALID', kind: 'VALIDATION', safeMessage: 'Aplicativo inválido.' });
    return parsed.data;
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  return NextResponse.json(
    mobileReleaseForPackage(security.input.packageName),
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
