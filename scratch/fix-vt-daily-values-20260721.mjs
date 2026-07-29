import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
const apply = process.argv.includes('--apply');
const actorId = 'system:codex-vt-currency-correction-20260721';
const now = new Date().toISOString();

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, 'utf8')));
  return applicationDefault();
}

function auditId(employeeId) {
  return createHash('sha256').update(`vt-daily-currency-correction:${employeeId}:2026-07-21`).digest('hex').slice(0, 32);
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, 'coala');
const hrDb = getFirestore(app, 'coala-rh');
const people = [
  { name: 'Sara Ferreira Coelho', employeeId: '18681052' },
  { name: 'Aliny Rodrigues da Silva Costa', employeeId: '18688727' },
  { name: 'Maria José de Sousa Pereira', employeeId: '18688741' },
];

const audit = [];
for (const person of people) {
  const employeeRef = hrDb.collection('employees').doc(person.employeeId);
  const employeeSnap = await employeeRef.get();
  const userId = employeeSnap.get('auth_uid') || employeeSnap.get('source_user_id') || null;
  const fieldRef = employeeRef.collection('field_values').doc('employee.vt_daily_value');
  const [fieldSnap, userSnap] = await Promise.all([
    fieldRef.get(),
    userId ? db.collection('users').doc(userId).get() : Promise.resolve(null),
  ]);
  const currentCents = fieldSnap.exists ? fieldSnap.get('value_number') : null;
  const hasVtField = employeeSnap.exists
    ? (await employeeRef.collection('field_values').doc('employee.has_vt').get()).get('value_boolean')
    : null;
  const topLevelReais = userSnap?.exists ? userSnap.get('transportVoucherValue') : null;
  const needsTransportVoucher = userSnap?.exists ? userSnap.get('needsTransportVoucher') : null;
  const transportVoucherHistory = userSnap?.exists && Array.isArray(userSnap.get('transportVoucherHistory'))
    ? userSnap.get('transportVoucherHistory')
    : [];
  const admissionDate = userSnap?.exists ? userSnap.get('admissionDate') : null;
  const expectedCents = typeof topLevelReais === 'number' && topLevelReais > 0
    ? Math.round(topLevelReais * 100)
    : 840;
  const shouldCorrect = hasVtField === true && needsTransportVoucher === true && currentCents !== expectedCents;

  audit.push({
    ...person,
    employeeExists: employeeSnap.exists,
    userId,
    hasVtField,
    currentFieldValueCents: currentCents,
    displayedValueReais: typeof currentCents === 'number' ? currentCents / 100 : null,
    topLevelTransportVoucherValueReais: topLevelReais,
    needsTransportVoucher,
    transportVoucherHistoryEntries: transportVoucherHistory.length,
    expectedFieldValueCents: expectedCents,
    action: shouldCorrect
      ? currentCents == null
        ? 'populate_currency_field_from_user_record'
        : 'correct_currency_scale'
      : 'no_change',
  });

  const shouldCreateHistory = Boolean(userId && needsTransportVoucher === true && expectedCents > 0 && transportVoucherHistory.length === 0);
  audit[audit.length - 1].historyAction = shouldCreateHistory ? 'create_initial_history_entry' : 'no_change';

  if (apply && shouldCreateHistory) {
    const effectiveDate = typeof admissionDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(admissionDate)
      ? admissionDate.slice(0, 10)
      : '2026-07-21';
    await db.collection('users').doc(userId).set({
      transportVoucherValue: expectedCents / 100,
      transportVoucherHistory: [{
        id: `vt-import-${person.employeeId}-20260721`,
        fromStatus: 'none',
        toStatus: 'active',
        effectiveDate,
        reason: 'Configuração inicial importada do termo de opção pelo vale-transporte.',
        value: expectedCents / 100,
        changedAt: now,
        changedBy: {
          userId: actorId,
          username: 'Codex',
        },
      }],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  if (!apply || !shouldCorrect) continue;

  const batch = hrDb.batch();
  batch.set(fieldRef, {
    field_key: 'employee.vt_daily_value',
    value_number: expectedCents,
    updated_at: FieldValue.serverTimestamp(),
    updated_by: actorId,
    source: fieldSnap.get('source') || 'user_record_reconciliation',
    correction: {
      reason: currentCents == null
        ? 'Campo monetário preenchido a partir do valor de vale-transporte do cadastro principal.'
        : 'Campo monetário armazena centavos; o valor em reais havia sido importado sem conversão.',
      previous_value_number: currentCents,
      corrected_value_number: expectedCents,
      corrected_at: now,
      corrected_by: actorId,
    },
  }, { merge: true });
  batch.set(hrDb.collection('audit_log').doc(auditId(person.employeeId)), {
    employee_id: person.employeeId,
    field_key: 'employee.vt_daily_value',
    old_value: currentCents,
    new_value: expectedCents,
    changed_by: actorId,
    changed_by_name: 'Codex',
    changed_at: now,
    source: 'currency_scale_correction',
    reason: currentCents == null
      ? 'Conciliação do perfil com o valor de vale-transporte do cadastro principal.'
      : 'Correção de escala monetária conforme termo de vale-transporte.',
  }, { merge: true });
  await batch.commit();
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry_run', audit }, null, 2));
