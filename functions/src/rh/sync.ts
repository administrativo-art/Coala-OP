/**
 * sync.ts — CFs de sincronização do módulo RH.
 *
 * syncRhAccessCache: espelha PermissionSet.dp.rh_role → coala-rh/rh_access_cache
 * syncFromBizneo:    sync diário Bizneo → coala-rh/employees (substitui syncBizneoUsersMonthly na Fase 3A)
 * manualSyncFromBizneo: trigger manual via onCall (admin only)
 */

import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  listUsers,
  getUserDetail,
  getUserCustomFields,
  resolveAdmissionDate,
  bizneoIdStr,
  type BizneoUser,
  type BizneoCustomField,
} from './bizneo-client.js';
import { calcProfileCompletion, type FieldMap, type EmployeeFieldValue } from './types.js';

const db    = getFirestore('coala');
const hrDb  = getFirestore('coala-rh');
const BRT   = 'America/Sao_Paulo';
const BIZNEO_COLLABORATOR_IMPORT_ENABLED = false;

const internalAppCors = [
  /op\.coalashakes\.com$/,
  /smart-converter-752gf\.web\.app$/,
  /smart-converter-752gf\.firebaseapp\.com$/,
  /localhost(:\d+)?$/,
];

// ─── syncRhAccessCache ────────────────────────────────────────────────────────

export const syncRhAccessCache = onDocumentWritten(
  { database: 'coala', document: 'users/{uid}' },
  async (event) => {
    const uid  = event.params.uid;
    const after = event.data?.after;
    if (!after?.exists) {
      // Usuário deletado — limpar o cache
      await hrDb.collection('rh_access_cache').doc(uid).delete().catch(() => null);
      return;
    }

    const userData = after.data() ?? {};
    const rhRole: string | undefined = userData.permissions?.dp?.rh_role;

    if (!rhRole || !['employee', 'manager', 'admin'].includes(rhRole)) {
      await hrDb.collection('rh_access_cache').doc(uid).delete().catch(() => null);
      console.log(`[syncRhAccessCache] uid=${uid} sem rh_role válido — cache RH removido`);
      return;
    }

    const bizneoId: string | undefined = userData.registrationIdBizneo
      ? String(userData.registrationIdBizneo)
      : undefined;

    // unit_id para manager: pega da primeira unidade atribuída ou unitIds[0]
    let unitId: string | undefined;
    if (rhRole === 'manager') {
      const unitIds: string[] = userData.unitIds ?? userData.assignedKioskIds ?? [];
      unitId = unitIds[0];
      // Se o colaborador tem um documento employees, usa o unit_id dele
      if (bizneoId) {
        try {
          const empSnap = await hrDb.collection('employees').doc(bizneoId).get();
          if (empSnap.exists) unitId = empSnap.data()?.unit_id ?? unitId;
        } catch (_) { /* ignora */ }
      }
    }

    await hrDb.collection('rh_access_cache').doc(uid).set({
      auth_uid:             uid,
      rh_role:              rhRole,
      bizneo_employee_id:   bizneoId ?? null,
      unit_id:              unitId   ?? null,
      updated_at:           FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[syncRhAccessCache] uid=${uid} rh_role=${rhRole} bizneoId=${bizneoId ?? 'none'}`);
  }
);

// ─── bizneoFieldsToFieldValues ────────────────────────────────────────────────

async function getFieldMap(): Promise<FieldMap | null> {
  const snap = await hrDb.collection('schema').doc('field_map').get();
  return snap.exists ? (snap.data() as FieldMap) : null;
}

function buildBizneoIdToCoalaKeyMap(fieldMap: FieldMap): Map<string, string> {
  const m = new Map<string, string>();
  for (const [coalaKey, entry] of Object.entries(fieldMap.fields)) {
    if (entry.bizneo_id && entry.bizneo_id !== 'PENDING_DISCOVERY') {
      m.set(entry.bizneo_id, coalaKey);
    }
  }
  return m;
}

function customFieldToValue(
  cf: BizneoCustomField,
  fieldType: string
): Partial<EmployeeFieldValue> {
  const raw = cf.value;
  if (raw == null) return {};

  if (fieldType === 'date') {
    const d = new Date(String(raw) + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? {} : { value_date: Timestamp.fromDate(d) };
  }
  if (fieldType === 'boolean') return { value_boolean: Boolean(raw) };
  if (fieldType === 'currency' || fieldType === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? {} : { value_number: n };
  }
  if (fieldType === 'multi_select') {
    return { value_json: Array.isArray(raw) ? raw : [String(raw)] };
  }
  return { value_text: String(raw) };
}

// ─── upsertEmployee ───────────────────────────────────────────────────────────

async function upsertEmployee(
  user: BizneoUser,
  customFields: BizneoCustomField[],
  fieldMap: FieldMap,
  bizneoIdToCoalaKey: Map<string, string>,
  systemUid: string
): Promise<void> {
  const bizneoId = bizneoIdStr(user);
  const now = Timestamp.now();
  const admissionDateStr = resolveAdmissionDate(user);

  // ── Campos básicos do documento employees ───────────────────────────────
  const empRef  = hrDb.collection('employees').doc(bizneoId);
  const empSnap = await empRef.get();

  const empData = {
    bizneo_employee_id: bizneoId,
    name:    [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
    email:   user.email,
    status:  'active' as const,
    synced_at: now,
  };

  if (!empSnap.exists) {
    await empRef.set({ ...empData, profile_completion: 0, created_at: now });
  } else {
    await empRef.update(empData);
  }

  // ── Campos customizados → field_values ──────────────────────────────────
  const fieldValuesRef = empRef.collection('field_values');
  const batch = hrDb.batch();

  // Campos básicos mapeáveis diretamente
  const directMappings: Record<string, Partial<EmployeeFieldValue>> = {
    'employee.personal_email': { value_text: user.email },
    'employee.name':           { value_text: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email },
  };
  if (user.birthday) {
    const d = new Date(user.birthday + 'T12:00:00');
    if (!Number.isNaN(d.getTime())) {
      directMappings['employee.birth_date'] = { value_date: Timestamp.fromDate(d) };
    }
  }
  if (admissionDateStr) {
    const d = new Date(admissionDateStr + 'T12:00:00');
    if (!Number.isNaN(d.getTime())) {
      directMappings['employee.aso_admission_date'] = { value_date: Timestamp.fromDate(d) };
    }
  }

  for (const [coalaKey, partial] of Object.entries(directMappings)) {
    batch.set(fieldValuesRef.doc(coalaKey), {
      field_key: coalaKey,
      ...partial,
      updated_at: now,
      updated_by: systemUid,
    }, { merge: true });
  }

  // Campos customizados descobertos via API
  for (const cf of customFields) {
    const cfIdStr = String(cf.id);
    const coalaKey = bizneoIdToCoalaKey.get(cfIdStr) ?? bizneoIdToCoalaKey.get(cf.name);
    if (!coalaKey) continue;

    const entry = fieldMap.fields[coalaKey];
    if (!entry) continue;

    const partial = customFieldToValue(cf, entry.type);
    if (Object.keys(partial).length === 0) continue;

    batch.set(fieldValuesRef.doc(coalaKey), {
      field_key: coalaKey,
      ...partial,
      updated_at: now,
      updated_by: systemUid,
    }, { merge: true });
  }

  await batch.commit();

  // ── Recalcular profile_completion ──────────────────────────────────────
  const allFieldValues = await fieldValuesRef.get();
  const fvMap: Record<string, EmployeeFieldValue> = {};
  allFieldValues.docs.forEach((d) => { fvMap[d.id] = d.data() as EmployeeFieldValue; });
  const completion = calcProfileCompletion(fvMap);
  await empRef.update({ profile_completion: completion });
}

// ─── syncFromBizneo ───────────────────────────────────────────────────────────

async function runSync(source: 'scheduled' | 'manual'): Promise<{
  employee_count: number;
  updated_count: number;
  error_count: number;
  errors: string[];
}> {
  const startedAt = Timestamp.now();
  const logRef = hrDb.collection('sync_log').doc();

  // Última sync bem-sucedida para sync incremental
  let updatedSince: string | undefined;
  try {
    const lastSuccessSnap = await hrDb.collection('sync_log')
      .where('status', '==', 'success')
      .orderBy('started_at', 'desc')
      .limit(1)
      .get();
    if (!lastSuccessSnap.empty) {
      const lastData = lastSuccessSnap.docs[0].data();
      const lastDate = lastData.started_at?.toDate?.() ?? new Date(0);
      updatedSince = lastDate.toISOString().slice(0, 10);
    }
  } catch (_) { /* sync completo */ }

  const fieldMap = await getFieldMap();
  if (!fieldMap) {
    const err = 'field_map não encontrado em coala-rh/schema/field_map';
    await logRef.set({
      status: 'failed', started_at: startedAt,
      finished_at: Timestamp.now(), duration_ms: 0,
      employee_count: 0, updated_count: 0, error_count: 1, errors: [err], source,
    });
    throw new Error(err);
  }

  const bizneoIdToCoalaKey = buildBizneoIdToCoalaKeyMap(fieldMap);
  const systemUid = 'cf_sync_system';

  const users = await listUsers(updatedSince);
  let updated = 0;
  const errors: string[] = [];

  for (const user of users) {
    try {
      const [detail, customFields] = await Promise.all([
        getUserDetail(user.id),
        getUserCustomFields(user.id),
      ]);
      const merged = { ...user, ...detail };
      await upsertEmployee(merged, customFields, fieldMap, bizneoIdToCoalaKey, systemUid);
      updated += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[syncFromBizneo] Erro ao processar usuário ${user.id}:`, msg);
      errors.push(`user ${user.id}: ${msg}`);
    }
  }

  const status = errors.length === 0 ? 'success' : errors.length < users.length ? 'partial' : 'failed';
  const finishedAt = Timestamp.now();

  await logRef.set({
    status,
    started_at:    startedAt,
    finished_at:   finishedAt,
    duration_ms:   finishedAt.toMillis() - startedAt.toMillis(),
    employee_count: users.length,
    updated_count:  updated,
    error_count:    errors.length,
    errors:         errors.slice(0, 50),
    source,
  });

  if (status === 'failed') {
    // Notificar admin via automation_tasks (consumida pelo scheduledDateAlerts)
    await hrDb.collection('automation_tasks').add({
      type:            'sync_failed_alert',
      payload:         { errors: errors.slice(0, 5), source },
      status:          'pending',
      idempotency_key: `sync_failed_${startedAt.toMillis()}`,
      created_at:      startedAt,
      retry_count:     0,
    });
  }

  return { employee_count: users.length, updated_count: updated, error_count: errors.length, errors };
}

export const syncFromBizneo = onSchedule(
  { schedule: '0 3 * * *', timeZone: BRT, secrets: ['BIZNEO_TOKEN'] },
  async () => {
    if (!BIZNEO_COLLABORATOR_IMPORT_ENABLED) {
      console.log('[syncFromBizneo] Importação de colaboradores do Bizneo desativada por política operacional.');
      return;
    }
    const result = await runSync('scheduled');
    console.log(`[syncFromBizneo] ${result.employee_count} usuários · ${result.updated_count} atualizados · ${result.error_count} erros`);
  }
);

export const manualSyncFromBizneo = onCall(
  { cors: internalAppCors, secrets: ['BIZNEO_TOKEN'] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado.');

    if (!BIZNEO_COLLABORATOR_IMPORT_ENABLED) {
      throw new HttpsError(
        'failed-precondition',
        'A importação de colaboradores do Bizneo está desativada. Cadastros devem ser feitos no Coala One.',
      );
    }

    // Verificar se é admin (token claim ou rh_role)
    const isDefaultAdmin = request.auth.token.isDefaultAdmin === true;
    if (!isDefaultAdmin) {
      const cacheSnap = await hrDb.collection('rh_access_cache').doc(request.auth.uid).get();
      const rhRole = cacheSnap.data()?.rh_role;
      if (rhRole !== 'admin') throw new HttpsError('permission-denied', 'Somente administradores podem forçar re-sync.');
    }

    const result = await runSync('manual');
    return result;
  }
);

// ─── Exportar db para uso nos outros módulos RH ───────────────────────────────

export { db, hrDb, BRT, internalAppCors };
