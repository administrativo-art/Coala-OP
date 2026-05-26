/**
 * field-update.ts — CF onFieldUpdate
 *
 * Ponto central de escrita no módulo RH. Toda edição de campo passa por aqui.
 * Validações server-side: employee_editable, employee_visible, visibility vs rh_role.
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

function canWriteField(entry: FieldMapEntry, role: RhRole, isOwner: boolean): boolean {
  if (role === 'admin') return true;
  if (role === 'manager') {
    // manager pode editar campos operacionais (employee_editable=false) de sua equipe
    return true;
  }
  if (role === 'employee') {
    return isOwner && entry.employee_editable && entry.employee_visible;
  }
  return false;
}

function canReadField(entry: FieldMapEntry, role: RhRole): boolean {
  if (entry.visibility === 'public')    return true;
  if (entry.visibility === 'sensitive') return role === 'manager' || role === 'admin';
  if (entry.visibility === 'internal')  return role === 'admin';
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
    if (!canReadField(entry, role)) {
      throw new HttpsError('permission-denied', `Campo ${field_key} não visível para role ${role}.`);
    }
    if (!canWriteField(entry, role, isOwner)) {
      throw new HttpsError('permission-denied', `Campo ${field_key} não editável para role ${role}.`);
    }

    // Segurança extra: employee não pode editar campos employee_visible=false
    if (role === 'employee' && !entry.employee_visible) {
      throw new HttpsError('permission-denied', 'Campo não visível para o colaborador.');
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
