import { NextRequest, NextResponse } from 'next/server';

import { requireOperationalUnitManager } from '@/app/api/dp/_unit-structure';
import { fetchPdvLegalFiliais } from '@/lib/integrations/pdv-legal-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireOperationalUnitManager(request);
    const filiais = await fetchPdvLegalFiliais();
    return NextResponse.json({
      filiais,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Não foi possível consultar as filiais do PDV Legal.';
    const status = message.includes('permissão') || message.includes('autoriz') ? 403 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
