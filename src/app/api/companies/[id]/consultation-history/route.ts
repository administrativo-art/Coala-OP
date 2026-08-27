import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { InternalCompanyRepository } from '@/lib/company/internal-company-repository';
import { canLookupCompany, getCompanyUserContext } from '../../_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userContext = await getCompanyUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!canLookupCompany(userContext)) return jsonError('Sem permissão para consultar histórico de CNPJ.', 403);

  const { id } = await context.params;
  const repository = new InternalCompanyRepository(dbAdmin);
  const history = await repository.getConsultationHistoryByEntityId(id);
  return NextResponse.json({ history });
}
