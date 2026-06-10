/**
 * Diagnóstico de reconciliação de SKUs PDV Legal × Fichas Técnicas.
 *
 * Busca cupons reais da API do PDV Legal para um intervalo de datas, extrai os
 * SKUs/descrições dos itens e cruza com `productSimulations.ppo.sku` no Firestore.
 * Reporta o que casa e o que NÃO casa (causa provável do "não traz dados").
 *
 * Uso: node scripts/pdv-sku-reconcile.mjs [YYYY-MM-DD início] [YYYY-MM-DD fim]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ── Carrega .env.local manualmente ───────────────────────────────────────────
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const BASE_URL = 'https://api.tabletcloud.com.br';
const FILIAIS = { 'Tiririca (17343)': '17343', 'João Paulo (17344)': '17344' };

async function getToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', env.PDVLEGAL_USERNAME);
  params.append('password', env.PDVLEGAL_PASSWORD);
  const auth = Buffer.from(`${env.PDVLEGAL_COD_EMPRESA}:${env.PDVLEGAL_TOKEN}`).toString('base64');
  const r = await fetch(`${BASE_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}`, 'Token': env.PDVLEGAL_TOKEN },
    body: params.toString(),
  });
  if (!r.ok) throw new Error(`Auth HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  if (!d?.access_token) throw new Error('Token ausente na resposta');
  return d.access_token;
}

async function fetchCoupons(token, date, filial) {
  const r = await fetch(`${BASE_URL}/cupom/get/${date}/${date}/${filial}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'CodEmpresa': env.PDVLEGAL_COD_EMPRESA, 'Token': env.PDVLEGAL_TOKEN },
  });
  if (!r.ok) throw new Error(`Cupons HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const raw = await r.json();
  if (Array.isArray(raw)) return raw;
  if (raw && 'data' in raw) return Array.isArray(raw.data) ? raw.data : [];
  if (raw && Object.keys(raw).length === 0) return [];
  throw new Error(`Formato inesperado: ${JSON.stringify(raw).slice(0, 200)}`);
}

function eachDay(start, end) {
  const out = [];
  let c = new Date(start + 'T12:00:00Z');
  const e = new Date(end + 'T12:00:00Z');
  while (c <= e) { out.push(c.toISOString().split('T')[0]); c.setUTCDate(c.getUTCDate() + 1); }
  return out;
}

// ── Firestore ────────────────────────────────────────────────────────────────
const sa = JSON.parse(readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
const app = initializeApp({ credential: cert(sa), projectId: 'smart-converter-752gf' }, 'recon');
const db = getFirestore(app, 'coala');

const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().split('T')[0];
const startArg = process.argv[2] || today;
const endArg = process.argv[3] || startArg;
const dates = eachDay(startArg, endArg);

console.log(`\n🔎 Reconciliação PDV × Fichas Técnicas — ${startArg} a ${endArg}\n`);

// 1) Fichas técnicas
const simsSnap = await db.collection('productSimulations').get();
const fichaSkus = new Map(); // sku -> name
for (const d of simsSnap.docs) {
  const data = d.data();
  const sku = data.ppo?.sku?.toString().trim();
  if (sku) fichaSkus.set(sku, data.name);
}
console.log(`📋 Fichas técnicas com SKU cadastrado: ${fichaSkus.size} (de ${simsSnap.size} simulações)\n`);

// 2) PDV
const token = await getToken();
const pdvSkus = new Map(); // sku -> { name, count, filiais:Set }

for (const [label, filial] of Object.entries(FILIAIS)) {
  let totalCoupons = 0, totalItems = 0;
  for (const date of dates) {
    let coupons;
    try { coupons = await fetchCoupons(token, date, filial); }
    catch (e) { console.log(`  ⚠️ ${label} ${date}: ${e.message}`); continue; }
    totalCoupons += coupons.length;
    for (const c of coupons) {
      const items = c.Itens || c.itens || [];
      for (const it of items) {
        if (it.iscancelado) continue;
        totalItems++;
        const sku = [it.codigoVenda, it.codproduto, it.codProdutoExterno, it.CodRef, it.Codigo]
          .filter(Boolean).map(x => x.toString().trim())[0] || 'SEM_SKU';
        const name = it.Descricao || it.nomeProduto || it.descricao || '?';
        if (!pdvSkus.has(sku)) pdvSkus.set(sku, { name, count: 0, filiais: new Set() });
        pdvSkus.get(sku).count++;
        pdvSkus.get(sku).filiais.add(label.split(' ')[0]);
      }
    }
  }
  console.log(`🏪 ${label}: ${totalCoupons} cupons, ${totalItems} itens (período inteiro)`);
}

// 3) Cruzamento
const matched = [], unmatched = [];
for (const [sku, info] of pdvSkus) {
  if (fichaSkus.has(sku)) matched.push({ sku, ...info });
  else unmatched.push({ sku, ...info });
}
matched.sort((a, b) => b.count - a.count);
unmatched.sort((a, b) => b.count - a.count);

console.log(`\n✅ SKUs do PDV que CASAM com ficha técnica: ${matched.length}`);
console.log(`❌ SKUs do PDV SEM ficha técnica: ${unmatched.length}\n`);

if (unmatched.length) {
  console.log('── SKUs SEM FICHA (estes itens são descartados na sync) ──────────────');
  for (const u of unmatched) {
    console.log(`  ❌ ${u.sku.padEnd(16)} ${String(u.count).padStart(4)}× ${u.name}  [${[...u.filiais].join(',')}]`);
  }
}

console.log('\n── Amostra dos que casam ─────────────────────────────────────────────');
for (const m of matched.slice(0, 15)) {
  console.log(`  ✅ ${m.sku.padEnd(16)} ${String(m.count).padStart(4)}× ${m.name}`);
}

console.log('\nResumo:');
const totalPdvSku = pdvSkus.size;
console.log(`  ${totalPdvSku} SKUs distintos no PDV · ${matched.length} mapeados · ${unmatched.length} sem ficha`);
process.exit(0);
