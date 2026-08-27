import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { CompanyRegistrationService } from '@/lib/company/company-registration-service';
import { InternalCompanyRepository } from '@/lib/company/internal-company-repository';
import { canUpdateCompany, getCompanyUserContext } from '../_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userContext = await getCompanyUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!canUpdateCompany(userContext)) return jsonError('Sem permissão para atualizar empresa.', 403);

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const entity = body.entity ?? body;
  const service = new CompanyRegistrationService(new InternalCompanyRepository(dbAdmin));

  try {
    const result = await service.updateCompany({ id, entity, userId: userContext.decoded.uid });
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Falha ao atualizar empresa.', 400);
  }
}
