import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
const apply = process.argv.includes('--apply');
const actorId = 'system:codex-aso-summary-reconciliation-20260721';
const now = new Date().toISOString();

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, 'utf8')));
  return applicationDefault();
}

function auditId(employeeId) {
  return createHash('sha256').update(`aso-summary-reconciliation:${employeeId}:2026-07-21`).digest('hex').slice(0, 32);
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value?.toDate) return value.toDate().toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function addMonths(dateValue, months) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

function clean(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const hrDb = getFirestore(app, 'coala-rh');
const people = [
  { name: 'Sara Ferreira Coelho', employeeId: '18681052', defaultExamDate: '2026-07-08', defaultFitness: 'Apta' },
  { name: 'Aliny Rodrigues da Silva Costa', employeeId: '18688727', defaultExamDate: '2026-07-09', defaultFitness: 'Apta' },
  { name: 'Maria José de Sousa Pereira', employeeId: '18688741', defaultExamDate: '2026-07-09', defaultFitness: 'Apta' },
];

const audit = [];
for (const person of people) {
  const employeeRef = hrDb.collection('employees').doc(person.employeeId);
  const [employeeSnap, summarySnap, admissionSnap, documentsSnap] = await Promise.all([
    employeeRef.get(),
    employeeRef.collection('field_values').doc('system.aso.summary').get(),
    employeeRef.collection('field_values').doc('employee.aso_admission_date').get(),
    hrDb.collection('employeeDocuments').where('employeeId', '==', person.employeeId).get(),
  ]);
  const linkedUserId = employeeSnap.get('auth_uid') || employeeSnap.get('source_user_id') || null;
  const linkedDocumentsSnap = linkedUserId && linkedUserId !== person.employeeId
    ? await hrDb.collection('employeeDocuments').where('employeeId', '==', linkedUserId).get()
    : null;
  const allDocumentDocs = [
    ...documentsSnap.docs,
    ...(linkedDocumentsSnap?.docs || []),
  ].filter((document, index, documents) => documents.findIndex((candidate) => candidate.id === document.id) === index);

  const asoDocuments = allDocumentDocs
    .filter((document) => {
      const code = String(document.get('documentTypeCode') || '').toUpperCase();
      const label = `${document.get('documentType') || ''} ${document.get('category') || ''}`.toUpperCase();
      return code === 'ASO_ADMISSION' || label.includes('ASO') || label.includes('OCUPACIONAL');
    })
    .sort((left, right) => String(right.get('updatedAt')?.toDate?.()?.toISOString?.() || right.get('uploadedAt')?.toDate?.()?.toISOString?.() || '').localeCompare(String(left.get('updatedAt')?.toDate?.()?.toISOString?.() || left.get('uploadedAt')?.toDate?.()?.toISOString?.() || '')));
  const asoDocument = asoDocuments[0] || null;
  const extracted = asoDocument?.get('extractedFields') || {};
  const directDate = dateOnly(admissionSnap.get('value_date')) || dateOnly(admissionSnap.get('value_text'));
  const examDate = dateOnly(extracted.examDate) || directDate || person.defaultExamDate;
  const fitnessStatus = String(extracted.fitnessStatus || extracted.result || person.defaultFitness);
  const currentSummary = summarySnap.get('value_json') || null;
  const existingHasAdmission = Array.isArray(currentSummary?.records)
    && currentSummary.records.some((record) => record?.type === 'admission' && record?.examDate === examDate);
  const canReconcile = employeeSnap.exists && Boolean(asoDocument) && Boolean(examDate);

  audit.push({
    ...person,
    employeeExists: employeeSnap.exists,
    linkedUserId,
    directAdmissionDate: directDate,
    summaryStoredAsText: summarySnap.get('value_text') || null,
    currentSummary: clean(currentSummary),
    asoDocument: asoDocument ? {
      id: asoDocument.id,
      documentType: asoDocument.get('documentType'),
      documentTypeCode: asoDocument.get('documentTypeCode'),
      status: asoDocument.get('status'),
      extractedFields: clean(extracted),
    } : null,
    resolvedExamDate: examDate,
    action: canReconcile && !existingHasAdmission ? 'write_aso_control_summary' : 'no_change',
  });

  if (!apply || !canReconcile || existingHasAdmission) continue;

  const summary = {
    version: 1,
    records: [{
      type: 'admission',
      examDate,
      fitnessStatus,
      documentId: asoDocument.id,
      documentTypeCode: 'ASO_ADMISSION',
      source: 'document_upload',
      updatedAt: now,
    }],
    admissionMissing: false,
    lastValidExamDate: examDate,
    nextPeriodicDue: addMonths(examDate, 24),
    status: 'ok',
    periodicityMonths: 24,
    updatedAt: now,
  };

  const batch = hrDb.batch();
  batch.set(employeeRef.collection('field_values').doc('system.aso.summary'), {
    field_key: 'system.aso.summary',
    value_json: summary,
    value_text: FieldValue.delete(),
    updated_at: FieldValue.serverTimestamp(),
    updated_by: actorId,
    source: 'document_analysis_reconciliation',
    source_document_ids: [asoDocument.id],
  }, { merge: true });
  if (!directDate) {
    batch.set(employeeRef.collection('field_values').doc('employee.aso_admission_date'), {
      field_key: 'employee.aso_admission_date',
      value_date: Timestamp.fromDate(new Date(`${examDate}T12:00:00.000Z`)),
      updated_at: FieldValue.serverTimestamp(),
      updated_by: actorId,
      source: 'document_analysis_reconciliation',
      source_document_ids: [asoDocument.id],
    }, { merge: true });
  }
  batch.set(hrDb.collection('audit_log').doc(auditId(person.employeeId)), {
    employee_id: person.employeeId,
    field_key: 'system.aso.summary',
    old_value: currentSummary || summarySnap.get('value_text') || null,
    new_value: summary,
    changed_by: actorId,
    changed_by_name: 'Codex',
    changed_at: now,
    source: 'document_analysis_reconciliation',
    document_id: asoDocument.id,
    reason: 'Sincronização do Controle de ASOs com o ASO admissional analisado e arquivado.',
  }, { merge: true });
  await batch.commit();
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry_run', audit }, null, 2));
