/**
 * Migração one-shot: converte movementHistory.quantityChange gravado como
 * STRING para NUMBER. Roda UMA única vez; depois do deploy da coerção na
 * gravação (use-expiry-products.tsx) não há mais geração de dado novo errado.
 *
 * Uso:
 *   node scripts/fix-movement-quantity-types.mjs            # dry-run (só relata)
 *   node scripts/fix-movement-quantity-types.mjs --apply    # aplica as correções
 *
 * Seguro: só toca em docs cujo quantityChange é string; ignora o resto.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
const app = initializeApp({ credential: cert(sa), projectId: 'smart-converter-752gf' }, 'fixqty');
const db = getFirestore(app, 'coala');

console.log(`\n🔧 Correção de quantityChange (string → number) · modo: ${APPLY ? 'APPLY ✍️' : 'DRY-RUN 👀'}\n`);

const snap = await db.collection('movementHistory').get();
console.log(`Total de registros: ${snap.size}`);

const toFix = [];
const problematic = []; // string que não vira número limpo
for (const doc of snap.docs) {
  const q = doc.data().quantityChange;
  if (typeof q === 'string') {
    const n = Number(q);
    if (isNaN(n)) problematic.push({ id: doc.id, value: q });
    else toFix.push({ id: doc.id, from: q, to: n });
  }
}

console.log(`Registros com quantityChange string: ${toFix.length + problematic.length}`);
console.log(`  → convertíveis: ${toFix.length}`);
console.log(`  → NÃO numéricos (serão pulados): ${problematic.length}`);
if (problematic.length) {
  console.log('\n⚠️ Valores não numéricos (revisar manualmente):');
  for (const p of problematic.slice(0, 20)) console.log(`    ${p.id}: "${p.value}"`);
}

// Amostra
console.log('\nAmostra da conversão:');
for (const f of toFix.slice(0, 10)) console.log(`  ${f.id}: "${f.from}" → ${f.to}`);

if (!APPLY) {
  console.log(`\n👀 DRY-RUN. Nada foi gravado. Rode com --apply para corrigir ${toFix.length} registros.`);
  process.exit(0);
}

// Aplica em lotes de 400 (limite do batch é 500)
let done = 0;
for (let i = 0; i < toFix.length; i += 400) {
  const chunk = toFix.slice(i, i + 400);
  const batch = db.batch();
  for (const f of chunk) {
    batch.update(db.collection('movementHistory').doc(f.id), { quantityChange: f.to });
  }
  await batch.commit();
  done += chunk.length;
  console.log(`  ✅ ${done}/${toFix.length} corrigidos...`);
}

console.log(`\n✅ Concluído. ${done} registros convertidos para número.`);
if (problematic.length) console.log(`⚠️ ${problematic.length} registros não numéricos foram pulados.`);
process.exit(0);
