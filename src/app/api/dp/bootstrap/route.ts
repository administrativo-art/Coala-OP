import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { canAccessUnit, filterUnitsByAccess } from '@/lib/unit-access';

function serializeValue(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)]));
  }
  return value;
}

function canReadDPBootstrap(context: ServerUserContext) {
  return !!(
    context.isDefaultAdmin ||
    context.permissions.dp?.view ||
    context.permissions.settings?.view ||
    context.permissions.settings?.manageUsers ||
    context.permissions.settings?.manageKiosks ||
    context.permissions.dp?.settings?.manageUnits
  );
}

export async function GET(req: NextRequest) {
  try {
    const context = await requireUser(req);

    if (!canReadDPBootstrap(context)) {
      return NextResponse.json({ error: 'Sem permissão para carregar dados do DP.' }, { status: 403 });
    }

    try {
      const [unitsSnap, groupsSnap, organizationsSnap, shiftsSnap, schedulesSnap, vacationsSnap, calendarsSnap] = await Promise.all([
        dbAdmin.collection('dp_units').orderBy('name').get(),
        dbAdmin.collection('dp_unitGroups').orderBy('name').get(),
        dbAdmin.collection('dp_unitOrganizations').orderBy('name').get(),
        dbAdmin.collection('dp_shiftDefinitions').orderBy('name').get(),
        dbAdmin.collection('dp_schedules').orderBy('createdAt', 'desc').get(),
        dbAdmin.collection('dp_vacations').orderBy('createdAt', 'desc').get(),
        dbAdmin.collection('dp_calendars').orderBy('createdAt', 'desc').get(),
      ]);

      const units = filterUnitsByAccess(
        unitsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        context.userDoc,
        { isDefaultAdmin: context.isDefaultAdmin }
      );
      const schedules = schedulesSnap.docs
        .map(doc => ({ id: doc.id, ...serializeValue(doc.data()) }))
        .filter(schedule => canAccessUnit(context.userDoc, schedule.unitId, {
          isDefaultAdmin: context.isDefaultAdmin,
        }));

      return NextResponse.json({
        units,
        unitGroups: groupsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        unitOrganizations: organizationsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        shiftDefinitions: shiftsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        schedules,
        vacations: vacationsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        calendars: calendarsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        bootstrapMode: 'full',
      });
    } catch (dataError: any) {
      console.warn('[DP bootstrap] Falling back to empty payload after data read failure.', dataError);
      return NextResponse.json({
        units: [],
        unitGroups: [],
        unitOrganizations: [],
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
