import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { googleWorkspaceMigrationStatus, migrateCurrentUserToGoogleWorkspace } from '@/features/auth/google-workspace-migration.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { assertOfficialMobileApp } from '@/lib/security/mobile-app-attestation.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const path = '/api/mobile/auth/google-migration' as const;
const inputSchema = z.object({ googleIdToken: z.string().min(100).max(10_000) }).strict();

const getContract = defineSecurityContract({
  schemaVersion: 1, id: 'mobile.auth.google-migration.read-own', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' }, input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
  additionalGuarantees: ['control:mobile-app-attested'],
});
const postContract = defineSecurityContract({
  schemaVersion: 1, id: 'mobile.auth.google-migration.create-own', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'mobile.auth.google-migration', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
  additionalGuarantees: ['control:mobile-app-attested'],
});

async function actor(request: NextRequest) {
  const context = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  assertOfficialMobileApp(request, context.decoded.uid);
  if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'GOOGLE_MIGRATION_QUERY_INVALID', kind: 'VALIDATION' });
  return context;
}

const getEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, undefined, { userId: string }>({
  id: 'mobile-google-migration-read-own-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'workspace-scoped', 'control:mobile-app-attested'],
  async enforce({ request }) { const current = await actor(request); return { actor: current, input: undefined, resource: { userId: current.decoded.uid } }; },
});
const postEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, z.infer<typeof inputSchema>, { userId: string }>({
  id: 'mobile-google-migration-create-own-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted', 'control:mobile-app-attested'],
  async enforce({ request }) {
    const current = await actor(request);
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'GOOGLE_MIGRATION_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Confirmação Google inválida.' });
    return { actor: current, input: parsed.data, resource: { userId: current.decoded.uid } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json(await googleWorkspaceMigrationStatus(security.actor), { headers: { 'Cache-Control': 'private, no-store' } }));
export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) =>
  NextResponse.json(await migrateCurrentUserToGoogleWorkspace(security.actor, security.input), { headers: { 'Cache-Control': 'private, no-store' } }));
