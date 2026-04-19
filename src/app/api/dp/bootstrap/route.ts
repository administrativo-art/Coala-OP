import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verify-auth';
import { dbAdmin } from '@/lib/firebase-admin';

function serializeValue(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)]));
  }
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const decoded = await verifyAuth(req);

    if (!decoded.uid) {
      return NextResponse.json({ error: 'Usuário inválido.' }, { status: 401 });
    }

    const profileId = typeof decoded.profileId === 'string' && decoded.profileId
      ? decoded.profileId
      : (await dbAdmin.collection('users').doc(decoded.uid).get()).data()?.profileId;

    if (!decoded.isDefaultAdmin) {
      if (!profileId) {
        return NextResponse.json({ error: 'Sem perfil vinculado.' }, { status: 403 });
      }

      const profileDoc = await dbAdmin.collection('profiles').doc(profileId).get();
      const perms = profileDoc.data()?.permissions;
      if (!perms?.dp?.view) {
        return NextResponse.json({ error: 'Sem permissão para DP.' }, { status: 403 });
      }
    }

    try {
      const [unitsSnap, groupsSnap, shiftsSnap, schedulesSnap, vacationsSnap, calendarsSnap] = await Promise.all([
        dbAdmin.collection('dp_units').orderBy('name').get(),
        dbAdmin.collection('dp_unitGroups').orderBy('name').get(),
        dbAdmin.collection('dp_shiftDefinitions').orderBy('name').get(),
        dbAdmin.collection('dp_schedules').orderBy('createdAt', 'desc').get(),
        dbAdmin.collection('dp_vacations').orderBy('createdAt', 'desc').get(),
        dbAdmin.collection('dp_calendars').orderBy('createdAt', 'desc').get(),
      ]);

      return NextResponse.json({
        units: unitsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        unitGroups: groupsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        shiftDefinitions: shiftsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        schedules: schedulesSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        vacations: vacationsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        calendars: calendarsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        bootstrapMode: 'full',
      });
    } catch (dataError: any) {
      console.warn('[DP bootstrap] Falling back to empty payload after data read failure.', dataError);
      return NextResponse.json({
        units: [],
        unitGroups: [],
        shiftDefinitions: [],
        schedules: [],
        vacations: [],
        calendars: [],
        bootstrapMode: 'fallback',
        error: dataError?.message ?? 'Falha ao carregar dados do DP.',
      });
    }
  } catch (error: any) {
    console.error('[DP bootstrap] Failed to load bootstrap data.', error);
    return NextResponse.json({ error: error?.message ?? 'Erro ao carregar bootstrap do DP.' }, { status: 500 });
  }
}
