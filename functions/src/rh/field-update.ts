/**
 * field-update.ts — CF onFieldUpdate
 *
 * Ponto central de escrita no módulo RH. Toda edição de campo passa por aqui.
 * Validações server-side: matriz de acesso, visibility vs rh_role.
 * Grava field_values, audit_log, recalcula profile_completion, dispara automations.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  type FieldMap,
  type FieldMapEntry,
  type EmployeeFieldValue,
  type AuditLogEntry,
  type AutomationTask,
  type RhAccessCache,
  type RhRole,
  type NormalizedFieldVisibility,
  type FieldAccessBinding,
  type ProfileAccessActor,
  type ProfileAccessMatrix,
  type ProfileAccessPermission,
  calcProfileCompletion,
} from './types.js';

const hrDb = getFirestore('coala-rh');

const internalAppCors = [
  /op\.coalashakes\.com$/,
  /smart-converter-752gf\.web\.app$/,
  /smart-converter-752gf\.firebaseapp\.com$/,
  /localhost(:\d+)?$/,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getFieldMap(): Promise<FieldMap> {
  const snap = await hrDb.collection('schema').doc('field_map').get();
  if (!snap.exists) throw new HttpsError('not-found', 'field_map não encontrado.');
  return snap.data() as FieldMap;
}

async function getRhCache(uid: string): Promise<RhAccessCache | null> {
  const snap = await hrDb.collection('rh_access_cache').doc(uid).get();
  return snap.exists ? (snap.data() as RhAccessCache) : null;
}

function normalizeAccessList(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map((value) => String(value).trim()).filter(Boolean)
    : [];
}

function normalizeAccessBinding(binding?: FieldAccessBinding | null): FieldAccessBinding | undefined {
  const roleIds = normalizeAccessList(binding?.roleIds);
  const functionIds = normalizeAccessList(binding?.functionIds);
  const userIds = normalizeAccessList(binding?.userIds);

  if (roleIds.length === 0 && functionIds.length === 0 && userIds.length === 0) return undefined;

  return {
    ...(roleIds.length ? { roleIds } : {}),
    ...(functionIds.length ? { functionIds } : {}),
    ...(userIds.length ? { userIds } : {}),
  };
}

function normalizeFieldVisibility(visibility?: string | null): NormalizedFieldVisibility {
  if (visibility === 'sensitive') return 'restricted_total';
  if (visibility === 'internal') return 'confidential';
  if (
    visibility === 'public' ||
    visibility === 'restricted_partial' ||
    visibility === 'restricted_total' ||
    visibility === 'confidential'
  ) {
    return visibility;
  }
  return 'confidential';
}

const DEFAULT_PROFILE_ACCESS_MATRIX: ProfileAccessMatrix = {
  version: 'coala-rh-access-v1',
  visibility: {
    public: { authenticated: 'view', owner: 'view', manager: 'edit', admin: 'edit', explicit: 'view' },
    restricted_partial: { authenticated: 'hidden', owner: 'view', manager: 'edit', admin: 'edit', explicit: 'view' },
    restricted_total: { authenticated: 'hidden', owner: 'hidden', manager: 'edit', admin: 'edit', explicit: 'view' },
    confidential: { authenticated: 'hidden', owner: 'hidden', manager: 'hidden', admin: 'edit', explicit: 'view' },
  },
};

const PROFILE_ACCESS_PERMISSION_RANK: Record<ProfileAccessPermission, number> = {
  hidden: 0,
  view: 1,
  edit: 2,
};

function normalizeProfileAccessPermission(value: unknown): ProfileAccessPermission {
  if (value === 'edit' || value === 'view' || value === 'hidden') return value;
  return 'hidden';
}

function normalizeProfileAccessMatrix(matrix?: ProfileAccessMatrix | null): ProfileAccessMatrix {
  const source = matrix?.visibility ?? {};
  const visibility = Object.fromEntries(
    (['public', 'restricted_partial', 'restricted_total', 'confidential'] as NormalizedFieldVisibility[]).map((key) => {
      const defaults = DEFAULT_PROFILE_ACCESS_MATRIX.visibility[key] ?? {};
      const current = source[key] ?? {};
      const bindings = normalizeAccessBinding(current.bindings);
      return [
        key,
        {
          authenticated: normalizeProfileAccessPermission(current.authenticated ?? defaults.authenticated),
          owner: normalizeProfileAccessPermission(current.owner ?? defaults.owner),
          manager: normalizeProfileAccessPermission(current.manager ?? defaults.manager),
          admin: normalizeProfileAccessPermission(current.admin ?? defaults.admin),
          explicit: normalizeProfileAccessPermission(current.explicit ?? defaults.explicit),
          ...(bindings ? { bindings } : {}),
        },
      ];
    })
  ) as Record<NormalizedFieldVisibility, Partial<Record<ProfileAccessActor, ProfileAccessPermission>>>;

  return {
    version: matrix?.version || DEFAULT_PROFILE_ACCESS_MATRIX.version,
    visibility,
  };
}

function hasExplicitAccessBinding(binding: FieldAccessBinding | undefined, cache: RhAccessCache, uid: string): boolean {
  if (!binding) return false;

  const userIds = normalizeAccessList(binding.userIds);
  const roleIds = normalizeAccessList(binding.roleIds);
  const functionIds = normalizeAccessList(binding.functionIds);
  const actorUserIds = [uid, cache.auth_uid, cache.user_id, cache.bizneo_employee_id]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  const actorRoleIds = [
    ...normalizeAccessList(cache.role_ids),
    ...normalizeAccessList(cache.job_role_ids),
    ...(cache.job_role_id ? [cache.job_role_id] : []),
  ];
  const actorFunctionIds = [
    ...normalizeAccessList(cache.function_ids),
    ...normalizeAccessList(cache.job_function_ids),
    ...(cache.job_function_id ? [cache.job_function_id] : []),
  ];

  return (
    actorUserIds.some((id) => userIds.includes(id)) ||
    actorRoleIds.some((id) => roleIds.includes(id)) ||
    actorFunctionIds.some((id) => functionIds.includes(id))
  );
}

function hasExplicitFieldAccess(entry: FieldMapEntry, cache: RhAccessCache, uid: string): boolean {
  return hasExplicitAccessBinding(entry.access?.allowed, cache, uid);
}

function resolveFieldAccessPermission(
  entry: FieldMapEntry,
  matrix: ProfileAccessMatrix | undefined,
  role: RhRole,
  isOwner: boolean,
  cache: RhAccessCache,
  uid: string,
): ProfileAccessPermission {
  if (!matrix) {
    if (entry.visibility === 'public') return role === 'admin' || role === 'manager' ? 'edit' : 'view';
    if (hasExplicitFieldAccess(entry, cache, uid)) return 'view';
    if (entry.visibility === 'restricted_partial') return role === 'manager' || role === 'admin' ? 'edit' : isOwner ? 'view' : 'hidden';
    if (entry.visibility === 'restricted_total') return role === 'manager' || role === 'admin' ? 'edit' : 'hidden';
    if (entry.visibility === 'confidential') return role === 'admin' ? 'edit' : 'hidden';
    if (entry.visibility === 'sensitive') return role === 'manager' || role === 'admin' ? 'edit' : 'hidden';
    if (entry.visibility === 'internal') return role === 'admin' ? 'edit' : 'hidden';
    return 'hidden';
  }

  const normalized = normalizeFieldVisibility(entry.visibility);
  const normalizedMatrix = normalizeProfileAccessMatrix(matrix);
  const rule = normalizedMatrix.visibility[normalized] ?? {};
  const actors: ProfileAccessActor[] = ['authenticated'];
  if (isOwner) actors.push('owner');
  if (role === 'manager') actors.push('manager');
  if (role === 'admin') actors.push('admin');
  if (hasExplicitAccessBinding(rule.bindings, cache, uid) || hasExplicitFieldAccess(entry, cache, uid)) actors.push('explicit');

  return actors.reduce<ProfileAccessPermission>((best, actor) => {
    const permission = normalizeProfileAccessPermission(rule[actor]);
    return PROFILE_ACCESS_PERMISSION_RANK[permission] > PROFILE_ACCESS_PERMISSION_RANK[best] ? permission : best;
  }, 'hidden');
}

function canReadField(entry: FieldMapEntry, matrix: ProfileAccessMatrix | undefined, role: RhRole, isOwner: boolean, cache: RhAccessCache, uid: string): boolean {
  if (matrix) return resolveFieldAccessPermission(entry, matrix, role, isOwner, cache, uid) !== 'hidden';
  if (entry.visibility === 'public') return true;
  if (hasExplicitFieldAccess(entry, cache, uid)) return true;
  if (entry.visibility === 'restricted_partial') return role === 'manager' || role === 'admin' || isOwner;
  if (entry.visibility === 'restricted_total') return role === 'manager' || role === 'admin';
  if (entry.visibility === 'confidential') return role === 'admin';
  if (entry.visibility === 'sensitive') return role === 'manager' || role === 'admin';
  if (entry.visibility === 'internal') return role === 'admin';
  return false;
}

function canWriteField(entry: FieldMapEntry, matrix: ProfileAccessMatrix | undefined, role: RhRole, isOwner: boolean, cache: RhAccessCache, uid: string): boolean {
  if (matrix) {
    const permission = resolveFieldAccessPermission(entry, matrix, role, isOwner, cache, uid);
    return permission === 'edit';
  }
  if (role === 'admin') return true;
  if (role === 'manager') return true;
  if (role === 'employee') return isOwner && entry.employee_editable && entry.employee_visible;
  return false;
}

function buildFieldValue(
  coalaKey: string,
  rawValue: unknown,
  type: string,
  uid: string
): EmployeeFieldValue {
  const base = { field_key: coalaKey, updated_at: Timestamp.now(), updated_by: uid };

  if (rawValue == null) return base as EmployeeFieldValue;
  if (typeof rawValue === 'object') return { ...base, value_json: rawValue };

  if (type === 'date') {
    const d = new Date(String(rawValue));
    if (!Number.isNaN(d.getTime())) return { ...base, value_date: Timestamp.fromDate(d) };
    return base as EmployeeFieldValue;
  }
  if (type === 'boolean')  return { ...base, value_boolean: Boolean(rawValue) };
  if (type === 'currency' || type === 'number') {
    const n = Number(rawValue);
    return Number.isNaN(n) ? (base as EmployeeFieldValue) : { ...base, value_number: n };
  }
  if (type === 'multi_select') {
    return { ...base, value_json: Array.isArray(rawValue) ? rawValue : [String(rawValue)] };
  }
  return { ...base, value_text: String(rawValue) };
}

async function ensureIdempotent(key: string): Promise<boolean> {
  const snap = await hrDb.collection('automation_tasks')
    .where('idempotency_key', '==', key)
    .where('status', 'in', ['pending', 'processing', 'done'])
    .limit(1)
    .get();
  return snap.empty;
}

async function dispatchAutomations(
  entry: FieldMapEntry,
  coalaKey: string,
  employeeId: string,
  employeeName: string,
  unitId: string,
  rawValue: unknown,
  prevValue: unknown
): Promise<void> {
  if (!entry.triggers) return;

  for (const trigger of entry.triggers) {
    const isSet    = rawValue != null && prevValue == null;
    const isChange = rawValue !== prevValue;
    const isClear  = rawValue == null && prevValue != null;

    if (trigger.event === 'on_set'    && !isSet)    continue;
    if (trigger.event === 'on_change' && !isChange) continue;
    if (trigger.event === 'on_clear'  && !isClear)  continue;

    const idempotencyKey = `${employeeId}_${coalaKey}_${String(rawValue)}`;
    const ok = await ensureIdempotent(idempotencyKey);
    if (!ok) {
      console.log(`[onFieldUpdate] Automação já existe: ${idempotencyKey} — skip`);
      continue;
    }

    const task: AutomationTask = {
      type:            trigger.action,
      payload:         { employee_id: employeeId, employee_name: employeeName, unit_id: unitId, field_key: coalaKey, value: rawValue, ...trigger.payload },
      status:          'pending',
      idempotency_key: idempotencyKey,
      created_at:      Timestamp.now(),
      retry_count:     0,
    };

    await hrDb.collection('automation_tasks').add(task);
    console.log(`[onFieldUpdate] Automação criada: ${trigger.action} para ${employeeId}`);
  }
}

// ─── CF onFieldUpdate ─────────────────────────────────────────────────────────

export type OnFieldUpdateRequest = {
  employee_id: string;
  field_key:   string;
  value:       unknown;
};

export const onFieldUpdate = onCall<OnFieldUpdateRequest>(
  { cors: internalAppCors },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado.');

    const uid = request.auth.uid;
    const { employee_id, field_key, value } = request.data;

    if (!employee_id || !field_key) {
      throw new HttpsError('invalid-argument', 'employee_id e field_key são obrigatórios.');
    }

    // 1. Buscar cache de permissões
    const cache = await getRhCache(uid);
    if (!cache?.rh_role) throw new HttpsError('permission-denied', 'Sem acesso ao módulo RH.');
    const role = cache.rh_role as RhRole;
    const isOwner = cache.bizneo_employee_id === employee_id;

    // 2. Verificar que o colaborador existe
    const empRef  = hrDb.collection('employees').doc(employee_id);
    const empSnap = await empRef.get();
    if (!empSnap.exists) throw new HttpsError('not-found', `Colaborador ${employee_id} não encontrado.`);
    const empData = empSnap.data()!;

    // Manager só edita colaboradores da mesma unit_id
    if (role === 'manager' && !isOwner && empData.unit_id !== cache.unit_id) {
      throw new HttpsError('permission-denied', 'Manager não tem acesso a este colaborador.');
    }

    // 3. Verificar field_map
    const fieldMap = await getFieldMap();
    const entry = fieldMap.fields[field_key] as FieldMapEntry | undefined;
    if (!entry) throw new HttpsError('not-found', `Campo ${field_key} não existe no field_map.`);

    // 4. Validações de visibilidade e edição (defense in depth)
    if (!canReadField(entry, fieldMap.access_matrix, role, isOwner, cache, uid)) {
      throw new HttpsError('permission-denied', `Campo ${field_key} não visível para role ${role}.`);
    }
    if (!canWriteField(entry, fieldMap.access_matrix, role, isOwner, cache, uid)) {
      throw new HttpsError('permission-denied', `Campo ${field_key} não editável para role ${role}.`);
    }

    // 5. Ler valor anterior para o audit_log
    const fieldValRef = empRef.collection('field_values').doc(field_key);
    const prevSnap    = await fieldValRef.get();
    const prevData    = prevSnap.data() as EmployeeFieldValue | undefined;
    const prevValue   =
      prevData?.value_text    ??
      prevData?.value_number  ??
      prevData?.value_date    ??
      prevData?.value_boolean ??
      prevData?.value_json    ??
      null;

    // 6. Gravar novo valor
    const newFieldValue = buildFieldValue(field_key, value, entry.type, uid);
    await fieldValRef.set(newFieldValue, { merge: true });

    // 7. Gravar audit_log
    const auditEntry: AuditLogEntry = {
      employee_id,
      field_key,
      old_value:  prevValue,
      new_value:  value,
      changed_by: uid,
      changed_at: Timestamp.now(),
      source:     'user_edit',
    };
    await hrDb.collection('audit_log').add(auditEntry);

    // 8. Recalcular profile_completion
    const allFvSnap = await empRef.collection('field_values').get();
    const fvMap: Record<string, EmployeeFieldValue> = {};
    allFvSnap.docs.forEach((d) => { fvMap[d.id] = d.data() as EmployeeFieldValue; });
    const completion = calcProfileCompletion(fvMap);
    await empRef.update({ profile_completion: completion });

    // 9. Disparar automações se o campo tem triggers
    await dispatchAutomations(
      entry,
      field_key,
      employee_id,
      empData.name ?? employee_id,
      empData.unit_id ?? '',
      value,
      prevValue
    );

    return { success: true, profile_completion: completion };
  }
);
