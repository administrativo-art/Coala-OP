import { NextRequest, NextResponse } from 'next/server';

import { assertFormalizationAccess } from '@/features/hr/lib/server-access';
import { dbAdmin } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export async function GET(request: NextRequest) {
  const access = await assertFormalizationAccess(request, 'onboarding.manage').catch(() => null);
  if (!access) return NextResponse.json({ error: 'Sem permissão para configurar acessos.' }, { status: 403 });

  const [profilesSnapshot, unitsSnapshot] = await Promise.all([
    dbAdmin.collection('profiles').get(),
    dbAdmin.collection('dp_units').get(),
  ]);
  const profiles = profilesSnapshot.docs
    .filter(document => document.get('isDefaultAdmin') !== true && document.get('isActive') !== false)
    .map(document => ({
      id: document.id,
      name: text(document.get('name'), document.get('profileName'), document.get('title'), document.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const units = unitsSnapshot.docs
    .filter(document => document.get('isArchived') !== true)
    .map(document => ({
      id: document.id,
      name: text(document.get('name'), document.id),
      pdvFilialId: text(document.get('pdvFilialId'), document.get('externalId')) || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return NextResponse.json({ profiles, units });
}
