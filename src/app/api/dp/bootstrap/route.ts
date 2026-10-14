import { NextRequest, NextResponse } from 'next/server';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { canAccessUserByUnit, resolveUnitAccess } from '@/lib/unit-access';

const MAX_SCHEDULES_PER_SCOPE_CHUNK = 300;
const SCHEDULE_RESPONSE_LIMIT = 60;

async function loadAccessibleSchedules(context: ServerUserContext, dpUnitIds: string[]) {
  const access = resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin });
  if (access.allUnits) {
    return dbAdmin.collection('dp_schedules').orderBy('createdAt', 'desc').limit(SCHEDULE_RESPONSE_LIMIT).get();
  }
  if (dpUnitIds.length === 0) return [];

  const documents: QueryDocumentSnapshot[] = [];
  for (let index = 0; index < dpUnitIds.length; index += 30) {
    const chunk = dpUnitIds.slice(index, index + 30);
    const snapshot = await dbAdmin.collection('dp_schedules')
      .where('unitId', 'in', chunk)
      .limit(MAX_SCHEDULES_PER_SCOPE_CHUNK + 1)
      .get();
    if (snapshot.size > MAX_SCHEDULES_PER_SCOPE_CHUNK) {
      throw new Error('Há escalas demais no escopo para carregar com segurança.');
    }
    documents.push(...snapshot.docs);
  }
  return documents
    .sort((left, right) => Number(right.get('createdAt')?.toMillis?.() ?? 0) - Number(left.get('createdAt')?.toMillis?.() ?? 0))
    .slice(0, SCHEDULE_RESPONSE_LIMIT);
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serializeValue(entry)]));
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
    context.permissions.dp?.schedules?.view ||
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

type StaticContext = { params: Promise<Record<string, never>> };
type Resource = { workspaceId: string };
const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'dp.bootstrap.get',
  version: 1,
  surface: { method: 'GET', path: '/api/dp/bootstrap' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.view' },
  resourceScope: { kind: 'workspace' },
  input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, StaticContext, unknown, ServerUserContext, null, Resource>({
  id: 'dp-bootstrap-get-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'DP_BOOTSTRAP_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!canReadDPBootstrap(actor)) {
      throw new AppError({ code: 'DP_BOOTSTRAP_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para carregar dados do DP.' });
    }
    return { actor, input: null, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const context = security.actor;
  try {
    if (!canReadDPBootstrap(context)) {
      throw new AppError({ code: 'DP_BOOTSTRAP_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para carregar dados do DP.' });
    }

    const unitsSnap = await dbAdmin.collection('dp_units').orderBy('name').limit(500).get();
      const access = resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin });
      const allowedIds = new Set(access.unitIds);
      const accessibleUnitDocuments = access.allUnits
        ? unitsSnap.docs
        : unitsSnap.docs.filter((document) => (
            allowedIds.has(document.id)
            || allowedIds.has(String(document.get('externalId') ?? ''))
          ));
      const [groupsSnap, organizationsSnap, shiftsSnap, schedulesSnap, vacationsSnap, calendarsSnap] = await Promise.all([
        dbAdmin.collection('dp_unitGroups').orderBy('name').limit(200).get(),
        dbAdmin.collection('dp_unitOrganizations').orderBy('name').limit(200).get(),
        dbAdmin.collection('dp_shiftDefinitions').orderBy('name').limit(500).get(),
        loadAccessibleSchedules(context, accessibleUnitDocuments.map((document) => document.id)),
        canReadVacations(context)
          ? dbAdmin.collection('dp_vacations').orderBy('createdAt', 'desc').limit(200).get()
          : Promise.resolve(null),
        dbAdmin.collection('dp_calendars').orderBy('createdAt', 'desc').limit(200).get(),
      ]);

      const units = accessibleUnitDocuments.map(doc => ({ id: doc.id, ...(serializeValue(doc.data()) as Record<string, unknown>) }));
      const scheduleDocuments = Array.isArray(schedulesSnap) ? schedulesSnap : schedulesSnap.docs;
      const schedules = scheduleDocuments
        .map(doc => ({ id: doc.id, ...(serializeValue(doc.data()) as Record<string, unknown>) }));
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
        unitGroups: groupsSnap.docs.map(doc => ({ id: doc.id, ...(serializeValue(doc.data()) as Record<string, unknown>) })),
        unitOrganizations: organizationsSnap.docs.map(doc => ({ id: doc.id, ...(serializeValue(doc.data()) as Record<string, unknown>) })),
        shiftDefinitions: shiftsSnap.docs.map(doc => ({ id: doc.id, ...(serializeValue(doc.data()) as Record<string, unknown>) })),
        schedules,
        vacations: vacationDocuments.map(doc => ({ id: doc.id, ...(serializeValue(doc.data()) as Record<string, unknown>) })),
        calendars: calendarsSnap.docs.map(doc => ({ id: doc.id, ...(serializeValue(doc.data()) as Record<string, unknown>) })),
        bootstrapMode: 'full',
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (cause) {
    console.error('[DP bootstrap] Failed to load scoped data.', cause);
    if (cause instanceof AppError) throw cause;
    throw new AppError({ code: 'DP_BOOTSTRAP_READ_FAILED', kind: 'UNEXPECTED_APPLICATION', safeMessage: 'Falha ao carregar dados do DP.', cause });
  }
});
