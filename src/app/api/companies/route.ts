import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { CompanyRegistrationService } from '@/lib/company/company-registration-service';
import { InternalCompanyRepository } from '@/lib/company/internal-company-repository';
import { canCreateCompany, getCompanyUserContext } from './_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const userContext = await getCompanyUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!canCreateCompany(userContext)) return jsonError('Sem permissão para cadastrar empresa.', 403);

  const body = await request.json().catch(() => ({}));
  const service = new CompanyRegistrationService(new InternalCompanyRepository(dbAdmin));
  const company = body.company ?? CompanyRegistrationService.normalizedCompanyFromEntityPayload(body.entity ?? body);

  try {
    const result = await service.saveConfirmedCompany({
      company,
      entity: body.entity,
      sourceResults: body.sourceResults ?? body.sources ?? [],
      userId: userContext.decoded.uid,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Falha ao cadastrar empresa.', 400);
  }
}
