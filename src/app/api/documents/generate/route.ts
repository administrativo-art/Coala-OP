import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateDocumentFromTemplate } from '@/features/hr/documents/generate-document.server';
import { assertDocumentGenerationPermission } from '@/features/hr/documents/generation-access.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { hasFormalizationPermission } from '@/lib/hr-formalization-permissions';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
export const runtime = 'nodejs';
type Context = { params: Promise<Record<string, never>> };
const optionalId = z.string().trim().max(180).refine((id) => !id.includes('/')).transform((id) => id || null).nullish();
const schema = z.object({ templateId: z.string().trim().min(1).max(180).refine((id) => !id.includes('/')), employeeId: optionalId, onboardingId: optionalId,
  manualValues: z.record(z.unknown()).optional(), formValues: z.record(z.unknown()).optional(), lifecycle: z.enum(['draft', 'final']).default('draft'), revisionKey: z.string().trim().max(300).nullish(), output: z.enum(['json', 'docx']).optional() }).strict();
type Input = z.infer<typeof schema>;
const contract = defineSecurityContract({ schemaVersion: 1, id: 'documents.generate', version: 1, surface: { method: 'POST', path: '/api/documents/generate' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'hr.documents.generate' }, resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'documents.generate.body', unknownFields: 'reject' }, effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, { workspaceId: string }>(contract, {
  authenticate: ({ request }) => requireUser(request),
  async parseInput({ request }) { const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: 'DOCUMENT_GENERATION_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Dados de geração inválidos.' }); return parsed.data; },
  loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => assertDocumentGenerationPermission(actor),
  assertScope: ({ actor, resource }) => { if (resource.workspaceId !== actor.workspace_id) throw new AppError({ code: 'DOCUMENT_GENERATION_WORKSPACE_FORBIDDEN', kind: 'AUTHORIZATION' }); },
});
export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input } = security;
  const generated = await generateDocumentFromTemplate({ ...input, actorAccess: actor, includeSensitive: hasFormalizationPermission(actor.permissions, 'sensitiveData.view', actor.isDefaultAdmin), actorId: actor.decoded.uid, actorName: actor.userDoc.username ?? actor.decoded.uid });
  if (input.output === 'json') return NextResponse.json({ document: { id: generated.id, fileName: generated.fileName, status: generated.status, pdfAvailable: !!generated.pdfStoragePath, missingRequired: generated.missingRequired, templateVersion: generated.templateVersion } });
  return new NextResponse(new Uint8Array(generated.buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="${generated.fileName}"`, 'Cache-Control': 'private, no-store', 'X-Generated-Document-Id': generated.id, 'X-Missing-Variables': String(generated.missingRequired.length) } });
});
