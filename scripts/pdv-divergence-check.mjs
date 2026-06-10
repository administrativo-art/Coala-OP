/**
 * Localiza a divergência: compara, por dia, três fontes de faturamento:
 *   1. API PDV     = Σ item.valortotal (verdade)
 *   2. salesReports = Σ (item.quantity × item.unitPrice) gravado no Firestore
 *   3. goalPeriods  = dailyProgress[date] (o que a dashboard exibe)
 *
 * Uso: node scripts/pdv-divergence-check.mjs YYYY-MM-DD-ini YYYY-MM-DD-fim
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const BASE_URL = 'https://api.tabletcloud.com.br';
const KIOSKS = [
  { id: 'tirirical', filial: '17343', name: 'Tiririca' },
  { id: 'joao-paulo', filial: '17344', name: 'João Paulo' },
];

async function getToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', env.PDVLEGAL_USERNAME);
  params.append('password', env.PDVLEGAL_PASSWORD);
  const auth = Buffer.from(`${env.PDVLEGAL_COD_EMPRESA}:${env.PDVLEGAL_TOKEN}`).toString('base64');
  const r = await fetch(`${BASE_URL}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}`, 'Token': env.PDVLEGAL_TOKEN },
    body: params.toString(),
  });
  return (await r.json()).access_token;
}
async function fetchCoupons(token, date, filial) {
  const r = await fetch(`${BASE_URL}/cupom/get/${date}/${date}/${filial}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'CodEmpresa': env.PDVLEGAL_COD_EMPRESA, 'Token': env.PDVLEGAL_TOKEN } });
  const raw = await r.json();
  if (Array.isArray(raw)) return raw;
  if (raw && 'data' in raw) return Array.isArray(raw.data) ? raw.data : [];
  return [];
}
function apiTotal(coupons) {
  let t = 0;
  for (const c of coupons) {
    const items = c.Itens || c.itens || [];
    const isCancel = c.iscancelado || c.status === 'CANCELADO';
    if (isCancel && !items.some(i => i.iscancelado === true)) continue;
    for (const it of items) if (!it.iscancelado) t += (it.valortotal || 0);
  }
  return t;
}
function eachDay(s, e) { const o = []; let c = new Date(s + 'T12:00:00Z'); const end = new Date(e + 'T12:00:00Z'); while (c <= end) { o.push(c.toISOString().split('T')[0]); c.setUTCDate(c.getUTCDate() + 1); } return o; }

const sa = JSON.parse(readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
const app = initializeApp({ credential: cert(sa), projectId: 'smart-converter-752gf' }, 'div');
const db = getFirestore(app, 'coala');

const dates = eachDay(process.argv[2] || '2026-06-01', process.argv[3] || '2026-06-09');
const token = await getToken();

// goalPeriods dailyProgress por kiosk
const periodsSnap = await db.collection('goalPeriods').get();
const progressByKiosk = {}; // kioskId -> date -> amount (dedup: primeiro período)
for (const d of periodsSnap.docs) {
  const p = d.data();
  if (!p.dailyProgress) continue;
  progressByKiosk[p.kioskId] ??= {};
  for (const [date, amt] of Object.entries(p.dailyProgress)) {
    if (progressByKiosk[p.kioskId][date] === undefined) progressByKiosk[p.kioskId][date] = amt;
  }
}

for (const k of KIOSKS) {
  console.log(`\n══════ ${k.name} (${k.id} / filial ${k.filial}) ══════`);
  console.log('Data        API(valortotal)   salesReport(qty×preço)   goalProgress     status');
  let sumApi = 0, sumReport = 0, sumGoal = 0;
  for (const date of dates) {
    const coupons = await fetchCoupons(token, date, k.filial);
    const api = apiTotal(coupons);

    const repDoc = await db.collection('salesReports').doc(`sales_sync_${k.id}_${date.replace(/-/g, '_')}`).get();
    let report = null;
    if (repDoc.exists) {
      const items = repDoc.data().items || [];
      report = items.reduce((s, it) => s + (it.quantity || 0) * (it.unitPrice || 0), 0);
    }
    const goal = progressByKiosk[k.id]?.[date];

    sumApi += api; sumReport += report || 0; sumGoal += goal || 0;
    const flag = (report != null && Math.abs(report - api) > 0.01) || (goal != null && Math.abs(goal - api) > 0.01) ? ' ⚠️' : (api > 0 ? ' ok' : '');
    if (api > 0 || report || goal) {
      console.log(`${date}   ${('R$ ' + api.toFixed(2)).padEnd(16)}  ${(report == null ? '—' : 'R$ ' + report.toFixed(2)).padEnd(22)}  ${(goal == null ? '—' : 'R$ ' + goal.toFixed(2)).padEnd(14)}${flag}`);
    }
  }
  console.log(`TOTAL       R$ ${sumApi.toFixed(2).padEnd(13)}  R$ ${sumReport.toFixed(2).padEnd(19)}  R$ ${sumGoal.toFixed(2)}`);
}
process.exit(0);
