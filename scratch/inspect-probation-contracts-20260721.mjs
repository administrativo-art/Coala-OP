import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, 'utf8')));
  return applicationDefault();
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
  { name: 'Sara Ferreira Coelho', employeeId: '18681052' },
  { name: 'Aliny Rodrigues da Silva Costa', employeeId: '18688727' },
  { name: 'Maria José de Sousa Pereira', employeeId: '18688741' },
];

const output = [];
for (const person of people) {
  const employeeRef = hrDb.collection('employees').doc(person.employeeId);
  const employee = await employeeRef.get();
  const authUid = employee.get('auth_uid') || employee.get('source_user_id') || null;
  const ids = Array.from(new Set([person.employeeId, authUid].filter(Boolean)));
  const documents = [];
  for (const id of ids) {
    const snap = await hrDb.collection('employeeDocuments').where('employeeId', '==', id).get();
    for (const document of snap.docs) {
      const code = String(document.get('documentTypeCode') || '').toUpperCase();
      const haystack = `${document.get('documentType') || ''} ${document.get('displayName') || ''} ${document.get('originalName') || ''}`.toUpperCase();
      if (code.includes('CONTRACT') || code.includes('PROBATION') || haystack.includes('CONTRATO') || haystack.includes('EXPERI')) {
        documents.push({ id: document.id, ownerId: id, ...clean(document.data()) });
      }
    }
  }
  const fields = {};
  for (const key of ['employee.admission_date', 'employee.probation_eval_1', 'employee.probation_eval_2']) {
    const snap = await employeeRef.collection('field_values').doc(key).get();
    fields[key] = snap.exists ? clean(snap.data()) : null;
  }
  output.push({ ...person, authUid, employee: clean(employee.data()), fields, documents });
}

console.log(JSON.stringify(output, null, 2));
