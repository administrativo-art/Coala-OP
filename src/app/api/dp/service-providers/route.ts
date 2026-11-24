import { NextResponse, type NextRequest } from 'next/server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { dbAdmin } from '@/lib/firebase-admin';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { AppError } from '@/lib/observability/app-error';
import { resolveUnitAccess } from '@/lib/unit-access';
import { canReview } from '@/features/dp/time-adjustments/service.server';
import { portalManagementSchema, type PortalManagementInput } from '@/features/service-portal/schemas';
import { managePortal, listPortalManagement } from '@/features/service-portal/management.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const contract = (method: 'GET' | 'POST') => defineSecurityContract({
  schemaVersion: 1, id: 'dp.service-providers.' + method.toLowerCase(), version: 1,
  surface: { method, path: '/api/dp/service-providers' },
  exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.service-providers.manage' }, resourceScope: { kind: 'workspace' },
  input: method === 'GET' ? { kind: 'none' } : { kind: 'schema', schema: 'service-portal.management', unknownFields: 'reject' },
  effects: { mode: method === 'GET' ? 'read' : 'write', audit: method === 'GET' ? 'none' : 'server-authoritative' },
  errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, PortalManagementInput | undefined, { workspaceId: string }>({
  id: 'dp-service-providers-manage-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (actor.viewAs || (!actor.isDefaultAdmin && (actor.permissions.dp?.timeClosure?.close !== true || !canReview(actor)))
      || !resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin }).allUnits) {
      throw new AppError({ code: 'PROVIDER_MANAGEMENT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'A gestão de prestadores exige revisão e fechamento do RH com acesso a todas as unidades.' });
    }
    let input: PortalManagementInput | undefined;
    if (request.method === 'POST') {
      const parsed = portalManagementSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) throw new AppError({ code: 'PROVIDER_MANAGEMENT_INPUT', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Dados inválidos.' });
      input = parsed.data;
      if (input.action === 'grant') {
        const unit = await dbAdmin.collection('dp_units').doc(input.employerUnitId).get();
        if (!unit.exists || unit.get('isArchived') === true || !CnpjValidator.validate(String(unit.get('cnpj') ?? '')).valid) {
          throw new AppError({ code: 'PROVIDER_EMPLOYER_INVALID', kind: 'VALIDATION', safeMessage: 'Escolha uma empresa ativa com CNPJ válido.' });
        }
      }
    }
    return { actor, input, resource: { workspaceId: actor.workspace_id } };
  },
});
export const GET = secureRoute({ contract: contract('GET'), enforcer }, async ({ security }) => {
  const [overview, units] = await Promise.all([
    listPortalManagement(security.actor.workspace_id),
    dbAdmin.collection('dp_units').select('name', 'cnpj', 'isArchived').limit(201).get(),
  ]);
  if (units.size > 200) throw new AppError({ code: 'PROVIDER_EMPLOYERS_LIMIT', kind: 'CONFLICT', safeMessage: 'O cadastro de empresas excedeu o limite de consulta. Fale com o desenvolvimento.' });
  return NextResponse.json({
    ...overview,
    employers: units.docs.filter((doc) => doc.get('isArchived') !== true && CnpjValidator.validate(String(doc.get('cnpj') ?? '')).valid)
      .map((doc) => ({ id: doc.id, name: String(doc.get('name') ?? ''), cnpj: String(doc.get('cnpj')) })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
});
export const POST = secureRoute({ contract: contract('POST'), enforcer }, async ({ security }) =>
  NextResponse.json(await managePortal({ uid: security.actor.decoded.uid, workspaceId: security.actor.workspace_id }, security.input!), { headers: { 'Cache-Control': 'private, no-store' } }));
