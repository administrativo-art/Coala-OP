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
import {
  canEditRhProfilesFromPermissions,
  resolveRhRoleFromPermissions,
} from './access-policy.js';
import { assertActiveSession } from '../active-session.js';

const db = getFirestore('coala');
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

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

async function resolveCurrentRhAccess(
  uid: string,
  token: Record<string, unknown>,
): Promise<{
  cache: RhAccessCache;
  canEditOtherProfiles: boolean;
  unitIds: string[];
} | null> {
  const [cached, userSnap] = await Promise.all([
    getRhCache(uid),
    db.collection('users').doc(uid).get(),
  ]);
  if (!userSnap.exists) return null;

  const userData = userSnap.data() ?? {};
  const profileId = typeof userData.profileId === 'string' && userData.profileId.trim()
    ? userData.profileId.trim()
    : typeof token.profileId === 'string' && token.profileId.trim()
      ? token.profileId.trim()
      : null;
  const profileSnap = profileId
    ? await db.collection('profiles').doc(profileId).get()
    : null;
  const profileData = profileSnap?.data() ?? {};
  const permissionContext = {
    tokenIsDefaultAdmin: token.isDefaultAdmin === true,
    profileIsDefaultAdmin: profileData.isDefaultAdmin === true,
    userPermissions: userData.permissions as Record<string, unknown> | undefined,
    profilePermissions: profileData.permissions as Record<string, unknown> | undefined,
  };
  const role = resolveRhRoleFromPermissions(permissionContext);
  if (!role) return null;

  const currentUnitIds = stringList(userData.unitIds);
  const legacyUnitIds = stringList(userData.assignedKioskIds);
  const unitIds = Array.from(new Set([...currentUnitIds, ...legacyUnitIds]));
  const managerUnitId = unitIds[0] ?? cached?.unit_id;
  const bizneoEmployeeId = userData.registrationIdBizneo != null
    ? String(userData.registrationIdBizneo).trim()
    : cached?.bizneo_employee_id;
  const access: RhAccessCache = {
    ...cached,
    auth_uid: uid,
    user_id: uid,
    rh_role: role,
    ...(bizneoEmployeeId ? { bizneo_employee_id: bizneoEmployeeId } : {}),
    ...(role === 'manager' && managerUnitId ? { unit_id: managerUnitId } : {}),
    ...(typeof userData.jobRoleId === 'string' ? { job_role_id: userData.jobRoleId } : {}),
    job_role_ids: stringList(userData.jobRoleIds),
    role_ids: stringList(userData.roleIds),
    job_function_ids: stringList(userData.jobFunctionIds),
    function_ids: stringList(userData.functionIds),
    updated_at: Timestamp.now(),
  };

  await hrDb.collection('rh_access_cache').doc(uid).set(access, { merge: true });
  return {
    cache: access,
    canEditOtherProfiles: canEditRhProfilesFromPermissions(permissionContext),
    unitIds,
  };
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

export type ReviewFieldChangeRequest = {
  request_id: string;
  decision: 'approved' | 'rejected';
  reason?: string;
};

export const onFieldUpdate = onCall<OnFieldUpdateRequest>(
  { cors: internalAppCors },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado.');
    await assertActiveSession(db, request.auth);

    const uid = request.auth.uid;
    const { employee_id, field_key, value } = request.data;

    if (!employee_id || !field_key) {
      throw new HttpsError('invalid-argument', 'employee_id e field_key são obrigatórios.');
    }

    // 1. Buscar cache de permissões
    const currentAccess = await resolveCurrentRhAccess(uid, request.auth.token);
    if (!currentAccess?.cache.rh_role) throw new HttpsError('permission-denied', 'Sem acesso ao módulo RH.');
    if (['employee.employer_cnpj', 'employee.employer_name', 'employee.job_role_id', 'employee.probation_eval_1', 'employee.probation_eval_2'].includes(field_key)) {
      throw new HttpsError('failed-precondition', 'Altere os dados contratuais em Editar colaborador. As datas de experiência vêm do processo de admissão.');
    }
    const cache = currentAccess.cache;
    const isOwner = cache.bizneo_employee_id === employee_id;
    if (!currentAccess.canEditOtherProfiles && !isOwner) {
      throw new HttpsError('permission-denied', 'Sem permissão para editar este perfil.');
    }
    // Um usuário que só pode editar o próprio perfil deve passar pela matriz como employee.
    const role: RhRole = currentAccess.canEditOtherProfiles ? cache.rh_role as RhRole : 'employee';

    // 2. Verificar que o colaborador existe
    const empRef  = hrDb.collection('employees').doc(employee_id);
    const empSnap = await empRef.get();
    if (!empSnap.exists) throw new HttpsError('not-found', `Colaborador ${employee_id} não encontrado.`);
    const empData = empSnap.data()!;

    // Manager só edita colaboradores da mesma unit_id
    const managerUnitIds = new Set([
      ...currentAccess.unitIds,
      ...(cache.unit_id ? [cache.unit_id] : []),
    ]);
    if (role === 'manager' && !isOwner && !managerUnitIds.has(empData.unit_id)) {
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
    const selfServicePolicy = entry.self_service_policy ?? 'inherit';
    const isOwnerEmployee = role === 'employee' && isOwner;
    const createsApprovalRequest = isOwnerEmployee && selfServicePolicy === 'approval';
    const allowsDirectOwnerEdit = isOwnerEmployee && selfServicePolicy === 'direct';
    if (isOwnerEmployee && selfServicePolicy === 'blocked') {
      throw new HttpsError('permission-denied', `Campo ${field_key} é somente leitura para o titular.`);
    }
    if (!createsApprovalRequest && !allowsDirectOwnerEdit && !canWriteField(entry, fieldMap.access_matrix, role, isOwner, cache, uid)) {
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

    if (createsApprovalRequest) {
      const requestId = `${employee_id}__${field_key}__${uid}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 900);
      const now = Timestamp.now();
      await hrDb.collection('hrProfileUpdateRequests').doc(requestId).set({
        type: 'self_service_profile_update',
        status: 'pending_approval',
        employeeId: employee_id,
        employeeName: empData.name ?? employee_id,
        fieldKey: field_key,
        fieldLabel: entry.label,
        oldValue: prevValue,
        proposedValue: value,
        requestedBy: uid,
        requestedAt: now,
        updatedAt: now,
      });
      return {
        success: true,
        pending_approval: true,
        request_id: requestId,
        profile_completion: Number(empData.profile_completion ?? 0),
      };
    }

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

export const reviewFieldChangeRequest = onCall<ReviewFieldChangeRequest>(
  { cors: internalAppCors },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado.');
    await assertActiveSession(db, request.auth);

    const uid = request.auth.uid;
    const requestId = String(request.data?.request_id ?? '').trim();
    const decision = request.data?.decision;
    const reason = String(request.data?.reason ?? '').trim().slice(0, 1000);
    if (!requestId || (decision !== 'approved' && decision !== 'rejected')) {
      throw new HttpsError('invalid-argument', 'Solicitação e decisão são obrigatórias.');
    }

    const currentAccess = await resolveCurrentRhAccess(uid, request.auth.token);
    if (!currentAccess?.canEditOtherProfiles) {
      throw new HttpsError('permission-denied', 'Sem permissão para revisar alterações de perfil.');
    }

    const requestRef = hrDb.collection('hrProfileUpdateRequests').doc(requestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) throw new HttpsError('not-found', 'Solicitação não encontrada.');
    const change = requestSnap.data() ?? {};
    if (change.type !== 'self_service_profile_update' || change.status !== 'pending_approval') {
      throw new HttpsError('failed-precondition', 'Esta solicitação já foi revisada ou não pertence ao perfil do colaborador.');
    }

    const employeeId = String(change.employeeId ?? '').trim();
    const fieldKey = String(change.fieldKey ?? '').trim();
    if (decision === 'approved' && ['employee.employer_cnpj', 'employee.employer_name', 'employee.job_role_id', 'employee.probation_eval_1', 'employee.probation_eval_2'].includes(fieldKey)) {
      throw new HttpsError('failed-precondition', 'Faça a alteração contratual em Editar colaborador, com data e justificativa.');
    }
    const employeeRef = hrDb.collection('employees').doc(employeeId);
    const [employeeSnap, fieldMap] = await Promise.all([employeeRef.get(), getFieldMap()]);
    if (!employeeSnap.exists) throw new HttpsError('not-found', 'Colaborador não encontrado.');
    const employeeData = employeeSnap.data() ?? {};
    const entry = fieldMap.fields[fieldKey] as FieldMapEntry | undefined;
    if (!entry) throw new HttpsError('not-found', 'Campo não encontrado na configuração atual.');

    const reviewerRole = currentAccess.cache.rh_role;
    const reviewerUnitIds = new Set([
      ...currentAccess.unitIds,
      ...(currentAccess.cache.unit_id ? [currentAccess.cache.unit_id] : []),
    ]);
    if (reviewerRole === 'manager' && !reviewerUnitIds.has(String(employeeData.unit_id ?? ''))) {
      throw new HttpsError('permission-denied', 'Sem acesso à unidade deste colaborador.');
    }
    if (!canWriteField(entry, fieldMap.access_matrix, reviewerRole, false, currentAccess.cache, uid)) {
      throw new HttpsError('permission-denied', 'Sem permissão para aprovar este campo.');
    }

    if (decision === 'rejected') {
      await requestRef.update({
        status: 'rejected',
        reviewedBy: uid,
        reviewedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        ...(reason ? { reviewReason: reason } : {}),
      });
      return { success: true, status: 'rejected' };
    }

    const fieldValueRef = employeeRef.collection('field_values').doc(fieldKey);
    const currentValueSnap = await fieldValueRef.get();
    const currentValueData = currentValueSnap.data() as EmployeeFieldValue | undefined;
    const currentValue =
      currentValueData?.value_text ??
      currentValueData?.value_number ??
      currentValueData?.value_date ??
      currentValueData?.value_boolean ??
      currentValueData?.value_json ??
      null;
    const comparable = (value: unknown) => JSON.stringify(value && typeof value === 'object' && 'toDate' in value
      ? (value as { toDate: () => Date }).toDate().toISOString()
      : value);
    if (comparable(currentValue) !== comparable(change.oldValue ?? null)) {
      throw new HttpsError('aborted', 'O valor do campo mudou depois da solicitação. Rejeite esta proposta e peça uma nova alteração.');
    }

    const proposedValue = change.proposedValue;
    const newFieldValue = buildFieldValue(fieldKey, proposedValue, entry.type, uid);
    const now = Timestamp.now();
    const auditRef = hrDb.collection('audit_log').doc();
    await hrDb.runTransaction(async (transaction) => {
      const latestRequest = await transaction.get(requestRef);
      if (latestRequest.get('status') !== 'pending_approval') {
        throw new HttpsError('aborted', 'A solicitação já foi revisada.');
      }
      transaction.set(fieldValueRef, newFieldValue, { merge: true });
      transaction.set(auditRef, {
        employee_id: employeeId,
        field_key: fieldKey,
        old_value: currentValue,
        new_value: proposedValue,
        changed_by: uid,
        changed_at: now,
        source: 'approved_self_service',
        request_id: requestId,
      });
      transaction.update(requestRef, {
        status: 'approved',
        reviewedBy: uid,
        reviewedAt: now,
        updatedAt: now,
        ...(reason ? { reviewReason: reason } : {}),
      });
    });

    const allFvSnap = await employeeRef.collection('field_values').get();
    const fvMap: Record<string, EmployeeFieldValue> = {};
    allFvSnap.docs.forEach((document) => { fvMap[document.id] = document.data() as EmployeeFieldValue; });
    const completion = calcProfileCompletion(fvMap);
    await employeeRef.update({ profile_completion: completion });
    await dispatchAutomations(
      entry,
      fieldKey,
      employeeId,
      String(employeeData.name ?? employeeId),
      String(employeeData.unit_id ?? ''),
      proposedValue,
      currentValue,
    );

    return { success: true, status: 'approved', profile_completion: completion };
  },
);
