import { NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FALLBACK_PUBLIC_UNITS = [
  'Tirirical',
  'João Paulo',
  'Tirimai',
  'Administrativo/CTA',
];

/**
 * Estatísticas públicas da empresa para a landing de vagas.
 * - Unidades ativas: coleções `dp_units` e `kiosks` (db "coala").
 * - Colaboradores ativos: `users` com isActive !== false.
 * Sem autenticação: expõe apenas contagens e nomes de unidades.
 */
function isActiveRecord(data: FirebaseFirestore.DocumentData) {
  return data.active !== false &&
    data.isActive !== false &&
    data.status !== 'inactive' &&
    data.status !== 'inativo' &&
    data.status !== 'terminated';
}

function normalizeUnitName(value: unknown) {
  if (typeof value !== 'string') return '';

  const normalized = value
      .trim()
      .replace(/^\s*(qui[oa]?sque|loja|unidade|coala)\s+/i, '')
      .replace(/\s+/g, ' ');

  if (/^tirircal$/i.test(normalized)) return 'Tirirical';
  return normalized;
}

export async function GET() {
  try {
    const [unitsSnap, kiosksSnap, usersSnap] = await Promise.all([
      dbAdmin.collection('dp_units').get(),
      dbAdmin.collection('kiosks').get(),
      dbAdmin.collection('users').get(),
    ]);

    const dpUnits = unitsSnap.docs
      .map((doc) => doc.data())
      .filter(isActiveRecord)
      .map((data) => normalizeUnitName(data.name));

    const kioskUnits = kiosksSnap.docs
      .map((doc) => doc.data())
      .filter(isActiveRecord)
      .map((data) => normalizeUnitName(data.name));

    const mergedUnits = Array.from(new Set([...dpUnits, ...kioskUnits].filter(Boolean)));
    const units = mergedUnits.length > 0
      ? mergedUnits.sort((a, b) => a.localeCompare(b, 'pt-BR'))
      : FALLBACK_PUBLIC_UNITS;

    const collaboratorCount = usersSnap.docs.filter((doc) => isActiveRecord(doc.data())).length;

    return NextResponse.json(
      {
        unitCount: units.length,
        units,
        collaboratorCount,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err) {
    console.error('[hr/public-stats] Erro ao buscar estatísticas:', err);
    return NextResponse.json(
      {
        unitCount: FALLBACK_PUBLIC_UNITS.length,
        units: FALLBACK_PUBLIC_UNITS,
        collaboratorCount: 0,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  }
}
