/**
 * Backfill de consumptionReports (Vendas API / consumo teórico).
 *
 * A sync automática antiga não gerava consumptionReports, então a coluna
 * "Vendas (API)" ficou zerada. Este script reprocessa os salesReports já
 * existentes (que têm simulationId + quantity por produto) e gera os
 * consumptionReports faltantes, cruzando productSimulationItems + baseProducts.
 *
 * Não re-bate na API do PDV nem altera metas. Idempotente.
 *
 * Uso:
 *   node scripts/backfill-consumption-reports.mjs                 # dry-run, desde 2026-05-01
 *   node scripts/backfill-consumption-reports.mjs --apply         # aplica
 *   node scripts/backfill-consumption-reports.mjs --apply 2026-01-01  # desde outra data
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// convertValue — espelho de functions/src/conversion.ts
const UNITS = {
  Volume: { l: 1, ml: 0.001, bag: 1 },
  Massa: { kg: 1, g: 0.001, mg: 0.000001 },
  Unidade: { un: 1, unidade: 1, pacote: 1, bag: 1, caixa: 1 },
  Embalagem: { un: 1, unidade: 1, pacote: 1, bag: 1, caixa: 1 },
  Vestimenta: { 'peça': 1, un: 1, unidade: 1 },
};
function convertValue(value, fromUnit, toUnit, category) {
  if (value === 0) return 0;
  if (!value || !fromUnit || !toUnit || !category) return 0;
  if (String(fromUnit).toLowerCase() === String(toUnit).toLowerCase()) return value;
  const cu = UNITS[category];
  if (!cu) throw new Error(`Categoria inválida: ${category}`);
  const find = (u) => { if (!u) return undefined; const l = u.toLowerCase(); if (cu[u] !== undefined) return u; return Object.keys(cu).find(k => k.toLowerCase() === l); };
  const fk = find(fromUnit), tk = find(toUnit);
  if (!fk || !tk) throw new Error(`Unidade inválida ${category}: ${fromUnit}→${toUnit}`);
  return (value * cu[fk]) / cu[tk];
}

const APPLY = process.argv.includes('--apply');
const sinceArg = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '2026-05-01';
const [sy, sm, sd] = sinceArg.split('-').map(Number);

const sa = JSON.parse(readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
const app = initializeApp({ credential: cert(sa), projectId: 'smart-converter-752gf' }, 'backfill');
const db = getFirestore(app, 'coala');

console.log(`\n🔧 Backfill consumptionReports · desde ${sinceArg} · modo: ${APPLY ? 'APPLY ✍️' : 'DRY-RUN 👀'}\n`);

// Mapas de fichas técnicas
const [siSnap, bpSnap] = await Promise.all([
  db.collection('productSimulationItems').get(),
  db.collection('baseProducts').get(),
]);
const simItemsBySim = {};
for (const d of siSnap.docs) { const si = d.data(); (simItemsBySim[si.simulationId] ??= []).push(si); }
const bpById = {};
for (const d of bpSnap.docs) bpById[d.id] = { id: d.id, ...d.data() };

// salesReports de sync no período
const salesSnap = await db.collection('salesReports').get();
const targets = salesSnap.docs.filter(d => {
  if (!d.id.startsWith('sales_sync_')) return false;
  const r = d.data();
  const y = r.year, mo = r.month, da = r.day ?? 1;
  if (y == null || mo == null) return false;
  // >= sinceArg
  if (y !== sy) return y > sy;
  if (mo !== sm) return mo > sm;
  return da >= sd;
});
console.log(`salesReports de sync no período: ${targets.length}`);

let created = 0, skippedExisting = 0, empty = 0;
let totalLinhas = 0;
const sample = [];

for (const doc of targets) {
  const r = doc.data();
  const consId = doc.id.replace(/^sales_/, 'cons_');

  // pula se já existe consumptionReport com dados
  const existing = await db.collection('consumptionReports').doc(consId).get();
  if (existing.exists && (existing.data().results || []).length > 0) { skippedExisting++; continue; }

  const consumption = {}; // bpId -> {name, quantity}
  for (const item of r.items || []) {
    const qty = Number(item.quantity) || 0;
    const simId = item.simulationId;
    if (!simId || !qty) continue;
    for (const si of simItemsBySim[simId] ?? []) {
      const bp = bpById[si.baseProductId];
      if (!bp) continue;
      try {
        const val = convertValue(si.quantity, si.overrideUnit || bp.unit, bp.unit, bp.category);
        consumption[bp.id] ??= { name: bp.name, quantity: 0 };
        consumption[bp.id].quantity += qty * val;
      } catch { /* ignora unidade incompatível */ }
    }
  }

  const results = Object.entries(consumption).map(([id, d]) => ({
    productId: id, productName: d.name, consumedQuantity: d.quantity, baseProductId: id,
  }));
  if (results.length === 0) { empty++; continue; }
  totalLinhas += results.length;
  if (sample.length < 5) sample.push({ id: consId, kioskId: r.kioskId, day: `${r.year}-${r.month}-${r.day}`, linhas: results.length });

  if (APPLY) {
    await db.collection('consumptionReports').doc(consId).set({
      reportName: `Sincronização Automática (backfill) ${r.year}-${String(r.month).padStart(2,'0')}-${String(r.day).padStart(2,'0')}`,
      month: r.month, year: r.year, day: r.day, kioskId: r.kioskId,
      createdAt: new Date().toISOString(), status: 'completed', results,
    });
  }
  created++;
}

console.log(`\nResumo:`);
console.log(`  A criar/atualizar: ${created}  (já existiam com dados: ${skippedExisting}, sem consumo: ${empty})`);
console.log(`  Total de linhas de consumo: ${totalLinhas}`);
console.log(`\nAmostra:`);
for (const s of sample) console.log(`  ${s.id}  kiosk=${s.kioskId}  ${s.day}  ${s.linhas} insumos`);
if (!APPLY) console.log(`\n👀 DRY-RUN. Nada gravado. Rode com --apply para criar ${created} relatórios.`);
else console.log(`\n✅ ${created} consumptionReports gravados.`);
process.exit(0);
