/**
 * Re-data os lançamentos de inventário de abertura (sourceType opening_count_2026-04-01)
 * para 01/04 02:59:30Z (= 31/03 23:59:30 BRT), dentro da janela do AUDIT_CUTOFF,
 * para aparecerem como "Inicial" quando o período começa em 01/04.
 * Uso: node scripts/redatar-abertura.mjs [--apply]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = {};
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const sa = JSON.parse(readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
const app = initializeApp({ credential: cert(sa), projectId: 'smart-converter-752gf' }, 'redt');
const db = getFirestore(app, 'coala');
const APPLY = process.argv.includes('--apply');
const NEW_TS = '2026-04-01T02:59:30.000Z';
const snap = await db.collection('movementHistory').where('sourceType', '==', 'opening_count_2026-04-01').get();
console.log(`Lançamentos de abertura: ${snap.size} | nova data: ${NEW_TS} | modo: ${APPLY ? 'APPLY ✍️' : 'DRY-RUN 👀'}`);
if (snap.size) console.log(`Data atual de exemplo: ${snap.docs[0].data().timestamp}`);
if (APPLY) {
  const b = db.batch();
  for (const d of snap.docs) b.update(d.ref, { timestamp: NEW_TS });
  await b.commit();
  console.log(`✅ ${snap.size} re-datados para ${NEW_TS}.`);
} else {
  console.log('👀 DRY-RUN. Rode com --apply para re-datar.');
}
process.exit(0);
