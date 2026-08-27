import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
const apply = process.argv.includes('--apply');
const actorId = 'system:codex-probation-contract-sync-20260721';
const now = Timestamp.now();

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, 'utf8')));
  return applicationDefault();
}

function dateTimestamp(value) {
  return Timestamp.fromDate(new Date(`${value}T12:00:00.000Z`));
}

function auditId(employeeId, fieldKey) {
  return createHash('sha256').update(`probation-contract-sync:${employeeId}:${fieldKey}:2026-07-21`).digest('hex').slice(0, 32);
}

function readValue(snapshot) {
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  const value = data.value_date || data.value_text || null;
  return value?.toDate ? value.toDate().toISOString().slice(0, 10) : value;
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, 'coala');
const hrDb = getFirestore(app, 'coala-rh');
const people = [
  {
    name: 'Sara Ferreira Coelho', employeeId: '18681052', userId: 'FzliQXBLykURpu9CxL8EzoAe4Xq1', documentId: '6208a4dadcc23e46144c761e18a50f64',
    admissionDate: '2026-07-08', firstEndDate: '2026-08-22', finalEndDate: '2026-10-06', initialDays: 45, extensionDays: 45,
  },
  {
    name: 'Aliny Rodrigues da Silva Costa', employeeId: '18688727', userId: 'kjveCeNGKwbY9C4c4ji86JJbXQz2', documentId: '67becd9234d3f9d2d032648cce340240',
    admissionDate: '2026-07-10', firstEndDate: '2026-08-24', finalEndDate: '2026-10-08', initialDays: 45, extensionDays: 45,
  },
  {
    name: 'Maria José de Sousa Pereira', employeeId: '18688741', userId: 'F1qc5teL3XXEEk6Ym4LEc9JvEv53', documentId: '2711f2746807208ca82dc1dcd7eb802f',
    admissionDate: '2026-07-10', firstEndDate: '2026-08-24', finalEndDate: '2026-10-08', initialDays: 45, extensionDays: 45,
  },
];

const audit = [];
for (const person of people) {
  const employeeRef = hrDb.collection('employees').doc(person.employeeId);
  const documentRef = hrDb.collection('employeeDocuments').doc(person.documentId);
  const fields = {
    'employee.admission_date': person.admissionDate,
    'employee.probation_eval_1': person.firstEndDate,
    'employee.probation_eval_2': person.finalEndDate,
  };
  const current = {};
  for (const fieldKey of Object.keys(fields)) {
    current[fieldKey] = readValue(await employeeRef.collection('field_values').doc(fieldKey).get());
  }
  const document = await documentRef.get();
  const user = await db.collection('users').doc(person.userId).get();
  const actions = Object.entries(fields).filter(([key, value]) => current[key] !== value).map(([key]) => key);
  audit.push({
    ...person,
    employeeExists: (await employeeRef.get()).exists,
    documentExists: document.exists,
    userExists: user.exists,
    current,
    userAdmissionDate: user.get('admissionDate')?.toDate?.()?.toISOString?.().slice(0, 10) || user.get('admissionDate') || null,
    actions,
  });
  if (!apply || !document.exists || actions.length === 0) continue;

  const batch = hrDb.batch();
  for (const [fieldKey, value] of Object.entries(fields)) {
    if (current[fieldKey] === value) continue;
    batch.set(employeeRef.collection('field_values').doc(fieldKey), {
      field_key: fieldKey,
      value_date: dateTimestamp(value),
      updated_at: now,
      updated_by: actorId,
      source: 'validated_probation_contract',
      source_document_ids: [person.documentId],
      data_contract_version: 1,
    }, { merge: true });
    batch.set(hrDb.collection('audit_log').doc(auditId(person.employeeId, fieldKey)), {
      employee_id: person.employeeId,
      field_key: fieldKey,
      old_value: current[fieldKey],
      new_value: value,
      changed_by: actorId,
      changed_by_name: 'Codex',
      changed_at: now,
      source: 'validated_probation_contract',
      document_id: person.documentId,
      reason: 'Data extraída da cláusula de prazo do contrato de experiência assinado.',
    }, { merge: true });
  }
  batch.update(documentRef, {
    'extractedFields.admissionDate': person.admissionDate,
    'extractedFields.startDate': person.admissionDate,
    'extractedFields.probationFirstEndDate': person.firstEndDate,
    'extractedFields.probationFinalEndDate': person.finalEndDate,
    'extractedFields.probationInitialDays': person.initialDays,
    'extractedFields.probationExtensionDays': person.extensionDays,
    'fieldConfidences.admissionDate': 1,
    'fieldConfidences.probationFirstEndDate': 1,
    'fieldConfidences.probationFinalEndDate': 1,
    'fieldConfidences.probationInitialDays': 1,
    'fieldConfidences.probationExtensionDays': 1,
    extractionGuideVersion: 1,
    updatedAt: now,
  });
  await batch.commit();
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry_run', audit }, null, 2));
