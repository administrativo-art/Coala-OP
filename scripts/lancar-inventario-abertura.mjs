/**
 * Inventário de abertura — lança a contagem de 01/04/2026 como saldo inicial.
 *
 * Para cada item das contagens da madrugada de 01/04 (Tiririca 00:00 e
 * João Paulo 00:37), cria uma ENTRADA_CORRECAO no movementHistory com a
 * quantidade CONTADA (finalQuantity), datada em 01/04 00:00:01 BRT — logo
 * após o corte de auditoria (AUDIT_ZERO_DATE), para virar o "Inicial" da
 * Conferência de Estoque ancorado na contagem física.
 *
 * Idempotente: pula lotes que já receberam o lançamento de abertura.
 *
 * Uso:
 *   node scripts/lancar-inventario-abertura.mjs            # dry-run
 *   node scripts/lancar-inventario-abertura.mjs --apply    # aplica
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
const app = initializeApp({ credential: cert(sa), projectId: 'smart-converter-752gf' }, 'abertura');
const db = getFirestore(app, 'coala');

// Sessões escolhidas (madrugada de 01/04)
const SESSIONS = [
  { id: '1U7BBQC9A8dV28vR3k5i', kioskId: 'tirirical' },   // 01/04 00:00
  { id: 'zUKoAL4iNjB48VrZoESu', kioskId: 'joao-paulo' },  // 01/04 00:37
];
const OPENING_TS = '2026-04-01T03:00:01.000Z'; // 00:00:01 BRT de 01/04 — após o corte
const SOURCE = 'opening_count_2026-04-01';

console.log(`\n📦 Inventário de abertura (contagem 01/04/2026) · modo: ${APPLY ? 'APPLY ✍️' : 'DRY-RUN 👀'}\n`);

// lotes que já têm lançamento de abertura (idempotência)
const existingSnap = await db.collection('movementHistory').where('sourceType', '==', SOURCE).get();
const doneLots = new Set(existingSnap.docs.map(d => d.data().lotId));
if (doneLots.size) console.log(`(${doneLots.size} lotes já tinham abertura — serão pulados)\n`);

let toCreate = 0, skippedDone = 0, skippedZero = 0;
const batch = db.batch();

for (const { id, kioskId } of SESSIONS) {
  const snap = await db.collection('stockAuditSessions').doc(id).get();
  if (!snap.exists) { console.log(`⚠️ sessão ${id} não encontrada`); continue; }
  const s = snap.data();
  const items = s.items || [];
  console.log(`══ ${s.kioskName || kioskId} (sessão ${id}) · ${items.length} itens contados ══`);

  for (const it of items) {
    const qty = Number(it.finalQuantity) || 0;
    if (qty <= 0) { skippedZero++; continue; }
    if (doneLots.has(it.lotId)) { skippedDone++; continue; }

    console.log(`  + ${String(qty).padStart(5)} ${(it.displayUnit || 'un').padEnd(8)} ${it.productName}`);

    if (APPLY) {
      const ref = db.collection('movementHistory').doc();
      batch.set(ref, {
        lotId: it.lotId,
        productId: it.productId,
        productName: it.productName,
        lotNumber: it.lotNumber || '-',
        type: 'ENTRADA_CORRECAO',
        quantityChange: qty,
        toKioskId: kioskId,
        toKioskName: s.kioskName || kioskId,
        userId: 'system',
        username: 'Inventário de abertura',
        timestamp: OPENING_TS,
        notes: 'Inventário de abertura — contagem física de 01/04/2026.',
        sourceType: SOURCE,
        sourceId: id,
      });
    }
    toCreate++;
  }
}

console.log(`\nResumo:`);
console.log(`  A lançar: ${toCreate}  (já feitos: ${skippedDone}, contados zerados pulados: ${skippedZero})`);

if (APPLY) {
  await batch.commit();
  console.log(`\n✅ ${toCreate} lançamentos de abertura criados (ENTRADA_CORRECAO em ${OPENING_TS}).`);
} else {
  console.log(`\n👀 DRY-RUN. Nada gravado. Rode com --apply para lançar.`);
}
process.exit(0);
