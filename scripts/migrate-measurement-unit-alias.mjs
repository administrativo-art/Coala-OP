import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
const DATABASE_ID = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || 'coala';
const BACKUP_ID = 'measurement-unit-unidade-to-un-v1-20260814';
const APPLY = process.argv.includes('--apply');

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) {
    return cert(JSON.parse(readFileSync(path, 'utf8')));
  }
  return applicationDefault();
}

function isLegacyUnit(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'unidade';
}

function displayName(document) {
  return document.get('name')
    ?? document.get('baseName')
    ?? document.get('brand')
    ?? '—';
}

const app = getApps().find((item) => item.name === 'measurement-unit-alias-migration')
  ?? initializeApp(
    { credential: credential(), projectId: PROJECT_ID },
    'measurement-unit-alias-migration',
  );
const db = getFirestore(app, DATABASE_ID);

const [baseProductsSnapshot, productsSnapshot] = await Promise.all([
  db.collection('baseProducts').get(),
  db.collectionGroup('products').get(),
]);

const documentsByPath = new Map();
for (const document of [...baseProductsSnapshot.docs, ...productsSnapshot.docs]) {
  documentsByPath.set(document.ref.path, document);
}

const changes = [...documentsByPath.values()]
  .filter((document) => isLegacyUnit(document.get('unit')))
  .map((document) => ({
    ref: document.ref,
    path: document.ref.path,
    name: displayName(document),
    category: document.get('category') ?? '—',
    previousUnit: document.get('unit'),
  }))
  .sort((left, right) => left.path.localeCompare(right.path));

console.table(changes.map((change) => ({
  caminho: change.path,
  insumo: change.name,
  categoria: change.category,
  unidadeAtual: change.previousUnit,
  unidadeDestino: 'un',
})));

if (!APPLY) {
  console.log(`DRY-RUN: ${changes.length} insumo(s) seriam atualizados. Use --apply para gravar.`);
  process.exit(0);
}

if (changes.length === 0) {
  console.log('APLICADO: nenhum registro precisava de alteração.');
  process.exit(0);
}

if (changes.length > 498) {
  throw new Error(`A migração encontrou ${changes.length} registros; revise o particionamento antes de aplicar.`);
}

const backupRef = db.collection('system_migration_backups').doc(BACKUP_ID);
if ((await backupRef.get()).exists) {
  throw new Error(`Backup ${BACKUP_ID} já existe; aplicação duplicada bloqueada.`);
}

const batch = db.batch();
batch.create(backupRef, {
  migration: 'measurement-unit-unidade-to-un-v1',
  createdAt: FieldValue.serverTimestamp(),
  records: changes.map((change) => ({
    path: change.path,
    name: change.name,
    category: change.category,
    previousUnit: change.previousUnit,
  })),
});

for (const change of changes) {
  batch.update(change.ref, { unit: 'un' });
}

await batch.commit();

const verification = await Promise.all(changes.map((change) => change.ref.get()));
const remaining = verification.filter((document) => isLegacyUnit(document.get('unit')));
if (remaining.length > 0) {
  throw new Error(`Falha na verificação: ${remaining.length} registro(s) ainda usam unidade.`);
}

console.log(`APLICADO: ${changes.length} insumo(s) migrados para un; backup ${BACKUP_ID} criado.`);
