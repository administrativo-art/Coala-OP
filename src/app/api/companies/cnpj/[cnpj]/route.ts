import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { CompanyLookupService } from '@/lib/company/company-lookup-service';
import { InternalCompanyRepository } from '@/lib/company/internal-company-repository';
import { canLookupCompany, getCompanyUserContext } from '../../_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: { params: Promise<{ cnpj: string }> }) {
  const userContext = await getCompanyUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!canLookupCompany(userContext)) return jsonError('Sem permissão para consultar CNPJ.', 403);

  const { cnpj } = await context.params;
  const service = new CompanyLookupService(new InternalCompanyRepository(dbAdmin));
  const result = await service.lookup(cnpj, userContext.decoded.uid);
  if (!result.canManualRegister && !result.found) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
