import { createHash } from 'node:crypto';

import { dbAdmin } from '../src/lib/firebase-admin';
import { hrDbAdmin } from '../src/lib/firebase-rh-admin';

const apply = process.argv.includes('--apply');
if (apply) {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (projectId !== 'demo-coala-repository' || !host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error('Apply permitido somente no emulador demo-coala-repository.');
  }
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') return { timestampMillis: (value as { toMillis(): number }).toMillis() };
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonical(nested)]));
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
let compared = 0;
let copied = 0;
const hashes: string[] = [];
while (true) {
  let query = dbAdmin.collection('dp_absenceTypes').orderBy('__name__').limit(50);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;
  const target = await hrDbAdmin.getAll(...page.docs.map((doc) => hrDbAdmin.collection('dp_absenceTypes').doc(doc.id)));
  for (let index = 0; index < page.docs.length; index += 1) {
    const source = page.docs[index];
    const destination = target[index];
    const sourceHash = digest(source.data());
    if (destination.exists && digest(destination.data()) !== sourceHash) throw new Error(`Conflito no ID ${source.id}; nenhum documento sobrescrito.`);
    hashes.push(`${source.id}:${sourceHash}`);
    compared += 1;
    if (apply && !destination.exists) {
      await destination.ref.create(source.data());
      copied += 1;
    }
  }
  cursor = page.docs.at(-1);
  if (page.size < 50) break;
}
const catalogHash = digest(hashes);
if (apply) {
  const receipt = hrDbAdmin.collection('dp_absenceCatalogMigrations').doc('active');
  const previous = await receipt.get();
  if (previous.exists && previous.get('catalogHash') !== catalogHash) throw new Error('Recibo anterior divergente; revisar antes de ativar.');
  await receipt.set({ state: 'ready', catalogDatabase: 'coala-rh', catalogHash, documentCount: compared, completedAt: new Date(), sourceDatabase: 'coala' });
}
process.stdout.write(JSON.stringify({ mode: apply ? 'emulator-apply' : 'dry-run', compared, copied, catalogHash }) + '\n');
