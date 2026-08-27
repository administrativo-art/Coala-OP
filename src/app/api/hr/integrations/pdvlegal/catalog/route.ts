import { NextRequest, NextResponse } from 'next/server';

import { assertHrAccess } from '@/features/hr/lib/server-access';
import { dbAdmin } from '@/lib/firebase-admin';
import { fetchPdvLegalFiliais, fetchPdvLegalProfiles } from '@/lib/integrations/pdv-legal-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_DOC = dbAdmin.collection('integrationCatalogs').doc('pdvlegal');
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const access = await assertHrAccess(request, 'view').catch(() => null);
  if (!access) return NextResponse.json({ error: 'Sem permissão para consultar o PDV Legal.' }, { status: 403 });

  const force = request.nextUrl.searchParams.get('refresh') === '1';
  const cached = await CACHE_DOC.get();
  const data = cached.data() ?? {};
  const syncedAt = typeof data.syncedAt === 'string' ? data.syncedAt : null;
  const fresh = syncedAt && Date.now() - new Date(syncedAt).getTime() < MAX_AGE_MS;
  if (!force && fresh && Array.isArray(data.profiles) && Array.isArray(data.filiais)) {
    return NextResponse.json({ profiles: data.profiles, filiais: data.filiais, syncedAt, source: 'cache' });
  }

  try {
    const [profiles, filiais] = await Promise.all([fetchPdvLegalProfiles(), fetchPdvLegalFiliais()]);
    const next = { profiles, filiais, syncedAt: new Date().toISOString() };
    await CACHE_DOC.set(next, { merge: true });
    return NextResponse.json({ ...next, source: 'api' });
  } catch (error) {
    if (Array.isArray(data.profiles) && Array.isArray(data.filiais)) {
      return NextResponse.json({
        profiles: data.profiles,
        filiais: data.filiais,
        syncedAt,
        source: 'stale_cache',
        warning: error instanceof Error ? error.message : 'Falha ao atualizar catálogo.',
      });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao consultar catálogo do PDV Legal.' },
      { status: 502 },
    );
  }
}
