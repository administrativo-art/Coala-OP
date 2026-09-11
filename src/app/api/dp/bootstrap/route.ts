import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { canAccessUnit, canAccessUserByUnit, filterUnitsByAccess } from '@/lib/unit-access';

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
    context.permissions.dp?.settings?.manageUnits ||
    context.permissions.dp?.vacation?.request ||
    context.permissions.dp?.vacation?.approve ||
    context.permissions.dp?.vacation?.viewAll
  );
}

function canReadVacations(context: ServerUserContext) {
  return context.isDefaultAdmin
    || context.permissions.dp?.vacation?.viewAll === true
    || context.permissions.dp?.vacation?.approve === true
    || context.permissions.dp?.vacation?.request === true;
}

function canReadAllVacations(context: ServerUserContext) {
  return context.isDefaultAdmin || context.permissions.dp?.vacation?.viewAll === true;
}

export async function GET(req: NextRequest) {
  try {
    const context = await requireUser(req);

    if (!canReadDPBootstrap(context)) {
      return NextResponse.json({ error: 'Sem permissão para carregar dados do DP.' }, { status: 403 });
    }

    try {
      const [unitsSnap, groupsSnap, organizationsSnap, shiftsSnap, schedulesSnap, vacationsSnap, calendarsSnap] = await Promise.all([
        dbAdmin.collection('dp_units').orderBy('name').limit(500).get(),
        dbAdmin.collection('dp_unitGroups').orderBy('name').limit(200).get(),
        dbAdmin.collection('dp_unitOrganizations').orderBy('name').limit(200).get(),
        dbAdmin.collection('dp_shiftDefinitions').orderBy('name').limit(500).get(),
        dbAdmin.collection('dp_schedules').orderBy('createdAt', 'desc').limit(60).get(),
        canReadVacations(context)
          ? dbAdmin.collection('dp_vacations').orderBy('createdAt', 'desc').limit(200).get()
          : Promise.resolve(null),
        dbAdmin.collection('dp_calendars').orderBy('createdAt', 'desc').limit(200).get(),
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
      let vacationDocuments = vacationsSnap?.docs ?? [];
      if (vacationDocuments.length && !canReadAllVacations(context)) {
        const userIds = [...new Set(vacationDocuments.flatMap((document) => {
          const userId = document.get('userId');
          return typeof userId === 'string' && userId ? [userId] : [];
        }))];
        const users = userIds.length
          ? await dbAdmin.getAll(...userIds.map((userId) => dbAdmin.collection('users').doc(userId)))
          : [];
        const accessibleUserIds = new Set(users.flatMap((user) => (
          user.exists && canAccessUserByUnit(context.userDoc, user.data() ?? {}, {
            isDefaultAdmin: context.isDefaultAdmin,
          }) ? [user.id] : []
        )));
        vacationDocuments = vacationDocuments.filter((document) => accessibleUserIds.has(String(document.get('userId') ?? '')));
      }

      return NextResponse.json({
        units,
        unitGroups: groupsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        unitOrganizations: organizationsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        shiftDefinitions: shiftsSnap.docs.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
        schedules,
        vacations: vacationDocuments.map(doc => ({ id: doc.id, ...serializeValue(doc.data()) })),
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
        error: 'Falha ao carregar dados do DP.',
      });
    }
  } catch (error: any) {
    console.error('[DP bootstrap] Failed to load bootstrap data.', error);
    return NextResponse.json({ error: 'Erro ao carregar bootstrap do DP.' }, { status: 500 });
  }
}
