import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireProviderManager } from '@/features/service-portal/closure-route-security.server';
import { payslipReconciliationQuerySchema, payslipReconciliationPreviewSchema, payslipReconciliationSubmitSchema, reconciliationDocumentSchema } from '@/features/dp/time-adjustments/payslip-reconciliation';
import { readPayslipReconciliation, previewPayslipReconciliation, submitPayslipReconciliation, readReconciliationPayslip } from '@/features/dp/time-adjustments/payslip-reconciliation.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), input: payslipReconciliationPreviewSchema }).strict(),
  z.object({ action: z.literal('submit'), input: payslipReconciliationSubmitSchema }).strict(),
  z.object({ action: z.literal('download'), input: reconciliationDocumentSchema }).strict(),
]);
type Input = { query?: z.infer<typeof payslipReconciliationQuerySchema>; action?: z.infer<typeof actionSchema> };
const contract = (method: 'GET' | 'POST') => defineSecurityContract({
  schemaVersion: 1, id: 'dp.payslip-reconciliation.' + method.toLowerCase(), version: 1,
  surface: { method, path: '/api/dp/time-recording/payslip-reconciliation' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'time-closure' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.payslip-reconciliation', unknownFields: 'reject' },
  effects: { mode: method === 'GET' ? 'read' : 'write', audit: method === 'GET' ? 'none' : 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Input, { workspaceId: string }>({
  id: 'dp-payslip-reconciliation-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:time-closure', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireProviderManager(request);
    if (request.method === 'POST' && request.nextUrl.search) throw new AppError({ code: 'PTRP_RECONCILIATION_QUERY', kind: 'VALIDATION', safeMessage: 'Consulta inválida.' });
    const parsed = request.method === 'GET'
      ? payslipReconciliationQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
      : actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'PTRP_RECONCILIATION_INPUT', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Confira os dados informados.' });
    return { actor, input: request.method === 'GET' ? { query: parsed.data as Input['query'] } : { action: parsed.data as Input['action'] }, resource: { workspaceId: actor.workspace_id } };
  },
});
const headers = { 'Cache-Control': 'private, no-store' };
export const GET = secureRoute({ contract: contract('GET'), enforcer }, async ({ security }) =>
  NextResponse.json(await readPayslipReconciliation(security.actor, security.input.query!), { headers }));
export const POST = secureRoute({ contract: contract('POST'), enforcer }, async ({ security }) => {
  const action = security.input.action!;
  if (action.action === 'download') {
    const file = await readReconciliationPayslip(security.actor, action.input);
    return new NextResponse(new Uint8Array(file.bytes), { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file.filename}"`, 'X-Content-Type-Options': 'nosniff' } });
  }
  if (action.action === 'preview') return NextResponse.json(await previewPayslipReconciliation(security.actor, action.input), { headers });
  const revision = await submitPayslipReconciliation(security.actor, action.input);
  return NextResponse.json({ id: revision.id, comparison: revision.comparison, closureVersion: revision.closureVersion, createdAt: revision.createdAt }, { headers });
});
