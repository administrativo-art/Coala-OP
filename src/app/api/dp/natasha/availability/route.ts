import { NextResponse, type NextRequest } from 'next/server';
import { loadNatashaAvailability } from '@/features/dp/natasha-availability/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { natashaAvailabilityRequestSchema } from '@/lib/natasha-availability';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.natasha.availability', version: 2,
  surface: { method: 'GET', path: '/api/dp/natasha/availability' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'custom', strategy: 'natasha-team-and-unit-scope' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'natasha-availability-v2.query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, { params: Promise<Record<string, never>> }, unknown,
  ServerUserContext, { period: string; unitIds: string[] }, { workspaceId: string; unitIds: string[] }>({
  id: 'dp-natasha-availability-v2', guarantees: ['authenticated-user', 'active-user',
    'authorization:natasha-team-and-unit-scope', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((error) => rethrowServerAuthenticationFailure(error));
    const search = new URL(request.url).searchParams;
    if ([...search.keys()].some((key) => key !== 'period' && key !== 'unit') || search.getAll('period').length !== 1) {
      throw new AppError({ code: 'NATASHA_AVAILABILITY_QUERY_INVALID', kind: 'VALIDATION' });
    }
    const parsed = natashaAvailabilityRequestSchema.safeParse({ period: search.get('period'), unitIds: search.getAll('unit') });
    if (!parsed.success) throw new AppError({ code: 'NATASHA_AVAILABILITY_QUERY_INVALID', kind: 'VALIDATION',
      safeMessage: 'Informe a competência e de uma a cinco unidades distintas.' });
    // loadNatashaTeam revalidates both permissions and each unit before any business query.
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, unitIds: parsed.data.unitIds } };
  },
});
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => NextResponse.json(
  await loadNatashaAvailability({ context: security.actor, ...security.input }),
  { headers: { 'Cache-Control': 'private, no-store' } },
));
