/**
 * Auditoria de faturamento PDV Legal × cálculo da sync (multi-dia).
 * Compara: Σ item.valortotal (método atual) vs Σ cupom.valortotal vs variações
 * tratando estorno / entrega, para localizar a fonte da divergência.
 *
 * Uso: node scripts/pdv-revenue-audit.mjs YYYY-MM-DD-inicio YYYY-MM-DD-fim [filial]
 */
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const BASE_URL = 'https://api.tabletcloud.com.br';

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
  return (await r.json()).access_token;
}

async function fetchCoupons(token, date, filial) {
  const r = await fetch(`${BASE_URL}/cupom/get/${date}/${date}/${filial}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'CodEmpresa': env.PDVLEGAL_COD_EMPRESA, 'Token': env.PDVLEGAL_TOKEN },
  });
  const raw = await r.json();
  if (Array.isArray(raw)) return raw;
  if (raw && 'data' in raw) return Array.isArray(raw.data) ? raw.data : [];
  return [];
}

function eachDay(start, end) {
  const out = []; let c = new Date(start + 'T12:00:00Z'); const e = new Date(end + 'T12:00:00Z');
  while (c <= e) { out.push(c.toISOString().split('T')[0]); c.setUTCDate(c.getUTCDate() + 1); }
  return out;
}

const start = process.argv[2] || '2026-05-12';
const end = process.argv[3] || '2026-06-09';
const filial = process.argv[4] || '17343';
const dates = eachDay(start, end);

const token = await getToken();

// Totais globais
let A_syncAtual = 0;       // Σ item.valortotal de itens não-cancelados em cupons não-totalmente-cancelados (IGUAL À SYNC)
let B_cupomTotal = 0;      // Σ cupom.valortotal (cupons não totalmente cancelados)
let C_semEstorno = 0;      // B, mas excluindo cupons isestornado
let D_semEntrega = 0;      // C menos valorentrega
let estornoValor = 0, estornoQtd = 0, entregaValor = 0, descontoValor = 0, acrescimoValor = 0;
let cancelQtd = 0, totalCupons = 0;
const perDay = [];

for (const date of dates) {
  let coupons;
  try { coupons = await fetchCoupons(token, date, filial); } catch { continue; }
  if (!coupons.length) continue;
  totalCupons += coupons.length;

  let dA = 0, dB = 0, dC = 0;
  for (const c of coupons) {
    const items = c.Itens || c.itens || [];
    const isCancel = c.iscancelado || c.status === 'CANCELADO';
    const anyItemCancel = items.some(i => i.iscancelado === true);
    if (isCancel && !anyItemCancel) { cancelQtd++; continue; }

    // A — método atual da sync
    for (const it of items) { if (!it.iscancelado) dA += (it.valortotal || 0); }

    // B — total do cupom
    const cTot = c.valortotal || 0;
    dB += cTot;
    descontoValor += c.valordesconto || 0;
    acrescimoValor += c.valoracrescimo || 0;
    entregaValor += c.valorentrega || 0;

    // C — excluindo estornos
    if (c.isestornado) { estornoValor += cTot; estornoQtd++; }
    else { dC += cTot; D_semEntrega += cTot - (c.valorentrega || 0); }
  }
  A_syncAtual += dA; B_cupomTotal += dB; C_semEstorno += dC;
  perDay.push({ date, A: dA, B: dB, diff: dA - dB });
}

console.log(`\n📊 Auditoria de faturamento · filial ${filial} · ${start} a ${end}`);
console.log(`Cupons: ${totalCupons} · cancelados ignorados: ${cancelQtd} · estornados: ${estornoQtd} (R$ ${estornoValor.toFixed(2)})\n`);

console.log('Σ DE CADA MÉTODO no período:');
console.log(`  A) Σ item.valortotal      (MÉTODO ATUAL DA SYNC) = R$ ${A_syncAtual.toFixed(2)}`);
console.log(`  B) Σ cupom.valortotal     (total do cupom)       = R$ ${B_cupomTotal.toFixed(2)}`);
console.log(`  C) B − estornos                                   = R$ ${C_semEstorno.toFixed(2)}`);
console.log(`  D) C − valorentrega                               = R$ ${D_semEntrega.toFixed(2)}`);
console.log(`\nComponentes do período:`);
console.log(`  Σ valordesconto = R$ ${descontoValor.toFixed(2)} · Σ valoracrescimo = R$ ${acrescimoValor.toFixed(2)} · Σ valorentrega = R$ ${entregaValor.toFixed(2)}`);

const divergentDays = perDay.filter(d => Math.abs(d.diff) > 0.01);
console.log(`\nDias em que A (itens) ≠ B (cupom): ${divergentDays.length}`);
for (const d of divergentDays.slice(0, 15)) {
  console.log(`  ${d.date}: itens R$ ${d.A.toFixed(2)} vs cupom R$ ${d.B.toFixed(2)}  (Δ ${ (d.diff).toFixed(2)})`);
}
process.exit(0);
