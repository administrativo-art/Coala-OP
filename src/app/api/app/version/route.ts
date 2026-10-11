import { NextRequest, NextResponse } from 'next/server';

import { COALA_ONE_RELEASE } from '@/lib/coala-one-release';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { COALA_APP_INSTALLERS } from '@/lib/signage';
import { type StaticRouteContext } from '@/lib/signage-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// O aplicativo consulta antes do login (a tela de atualização trava até quem não entrou). A resposta é só
// a versão publicada e o caminho do instalador, que já é público; nada é lido nem gravado.
const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'app.version.read',
  version: 1,
  surface: { method: 'GET', path: '/api/app/version' },
  exposure: 'public',
  identity: { kind: 'none' },
  authorization: { kind: 'none' },
  resourceScope: { kind: 'none' },
  input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, undefined, undefined, undefined>(contract, {});

export const GET = secureRoute({ contract, enforcer }, async () => {
  return NextResponse.json(
    { ...COALA_ONE_RELEASE, packagePath: COALA_APP_INSTALLERS.mobile.packagePath },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
