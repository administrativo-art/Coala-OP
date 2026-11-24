import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { closureReleaseActionSchema, closureReleaseQuerySchema } from '@/features/service-portal/closure-schemas';
import { listClosureReleaseCandidates, previewClosureRelease, releaseClosureToProvider } from '@/features/service-portal/closure-server';
import { requireProviderManager } from '@/features/service-portal/closure-route-security.server';
import { closureStorage } from '@/features/service-portal/closure-storage.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Input = { query?: z.infer<typeof closureReleaseQuerySchema>; action?: z.infer<typeof closureReleaseActionSchema> };
const contract = (method: 'GET' | 'POST') => defineSecurityContract({
  schemaVersion: 1, id: 'dp.provider-closures.' + method.toLowerCase(), version: 1,
  surface: { method, path: '/api/dp/service-providers/closures' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.service-providers.manage' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'service-portal.closure-release', unknownFields: 'reject' },
  effects: { mode: method === 'GET' ? 'read' : 'write', audit: method === 'GET' ? 'none' : 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Input, { workspaceId: string }>({
  id: 'provider-closure-release-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireProviderManager(request);
    const parsed = request.method === 'GET'
      ? closureReleaseQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
      : closureReleaseActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'PROVIDER_RELEASE_INPUT', kind: 'VALIDATION', safeMessage: 'Confira o colaborador e a versão selecionados.' });
    return { actor, input: request.method === 'GET' ? { query: parsed.data as z.infer<typeof closureReleaseQuerySchema> } : { action: parsed.data as z.infer<typeof closureReleaseActionSchema> }, resource: { workspaceId: actor.workspace_id } };
  },
});
export const GET = secureRoute({ contract: contract('GET'), enforcer }, async ({ security }) =>
  NextResponse.json(await listClosureReleaseCandidates(security.actor, security.input.query!.grantId), { headers: { 'Cache-Control': 'private, no-store' } }));
export const POST = secureRoute({ contract: contract('POST'), enforcer }, async ({ security }) => {
  const input = security.input.action!;
  const result = input.action === 'preview'
    ? await previewClosureRelease(security.actor, input, closureStorage)
    : await releaseClosureToProvider(security.actor, input, closureStorage);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
