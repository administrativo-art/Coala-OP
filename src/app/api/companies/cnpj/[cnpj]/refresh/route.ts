import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { CompanyLookupService } from '@/lib/company/company-lookup-service';
import { CompanyRefreshService } from '@/lib/company/company-refresh-service';
import { InternalCompanyRepository } from '@/lib/company/internal-company-repository';
import { canLookupCompany, getCompanyUserContext } from '../../../_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest, context: { params: Promise<{ cnpj: string }> }) {
  const userContext = await getCompanyUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!canLookupCompany(userContext)) return jsonError('Sem permissão para atualizar dados do CNPJ.', 403);

  const { cnpj } = await context.params;
  const repository = new InternalCompanyRepository(dbAdmin);
  const service = new CompanyRefreshService(new CompanyLookupService(repository));
  const result = await service.refresh(cnpj, userContext.decoded.uid);
  if (!result.canManualRegister && !result.found) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
