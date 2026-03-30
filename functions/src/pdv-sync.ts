const COD_EMPRESA = process.env.PDVLEGAL_COD_EMPRESA || '14449';
const API_TOKEN = process.env.PDVLEGAL_TOKEN || 'NMCB-2700-8660-1072';
const USERNAME = process.env.PDVLEGAL_USERNAME || 'central@tabletcloud.com.br';
const PASSWORD = process.env.PDVLEGAL_PASSWORD || 'dtat-2123-5110-5504@1707212';
const BASE_URL = 'https://api.tabletcloud.com.br';

function extractBrazilHour(dateStr: string): string {
  if (!dateStr) return '00';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '00';
  const brt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return brt.getHours().toString().padStart(2, '0');
}

export async function getAccessToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', USERNAME);
  params.append('password', PASSWORD);
  const authString = Buffer.from(`${COD_EMPRESA}:${API_TOKEN}`).toString('base64');
  const response = await fetch(`${BASE_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${authString}`,
      'Token': API_TOKEN,
    },
    body: params.toString(),
  });
  if (!response.ok) throw new Error(`Auth failed`);
  const data = await response.json();
  return data.access_token;
}

async function fetchAllCouponsForDay(accessToken: string, date: string, filialId: string) {
  const response = await fetch(`${BASE_URL}/cupom/get/${date}/${date}/${filialId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'CodEmpresa': COD_EMPRESA, 'Token': API_TOKEN },
  });
  if (!response.ok) return [];
  const data = await response.json();
  const coupons = Array.isArray(data) ? data : (data.links ? data.data : []);
  return coupons || [];
}

export async function syncDayAdmin(dateStr: string, kioskId: string, pdvFilialId: string, db: FirebaseFirestore.Firestore) {
  const token = await getAccessToken();
  const coupons = await fetchAllCouponsForDay(token, dateStr, pdvFilialId);
  if (!coupons || coupons.length === 0) return { success: true, count: 0 };
  const simsSnap = await db.collection('productSimulations').get();
  const simulations = simsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const date = new Date(dateStr + 'T12:00:00Z');
  const productTotals: Record<string, any> = {};
  const hourlySales: Record<string, number> = {};
  const productHourlySales: Record<string, Record<string, number>> = {};
  const comboCounts: Record<string, number> = {};

  for (const coupon of coupons) {
    const rawItems = coupon.Itens || coupon.itens;
    if (!rawItems || !Array.isArray(rawItems)) continue;
    const isCupomCancelado = coupon.iscancelado || coupon.status === 'CANCELADO';
    const hasAnyItemExplicitlyCancelled = rawItems.some((item: any) => item.iscancelado === true);
    if (isCupomCancelado && !hasAnyItemExplicitlyCancelled) continue;
    const couponTime = coupon.DataHora || rawItems.find((i: any) => i.DataHora)?.DataHora || '';
    const hour = extractBrazilHour(couponTime);
    hourlySales[hour] = (hourlySales[hour] || 0) + 1;
    const validMappedItemsForCombo: { name: string, qty: number }[] = [];

    for (const item of rawItems) {
      if (item.iscancelado) continue;
      const possibleSkus = [item.codigoVenda, item.codproduto, item.codProdutoExterno, item.CodRef, item.Codigo].filter(Boolean).map(c => c.toString().trim());
      const qty = item.Quantidade || item.quantidade || 0;
      const sim = simulations.find(s => {
        const simSku = s.ppo?.sku?.toString().trim();
        return simSku && possibleSkus.includes(simSku);
      });
      if (!sim) continue;
      const sku = sim.ppo?.sku?.toString().trim() || possibleSkus[0];
      const existingComboItem = validMappedItemsForCombo.find(i => i.name === sim.name);
      if (existingComboItem) existingComboItem.qty += qty;
      else validMappedItemsForCombo.push({ name: sim.name, qty });

      if (!productTotals[sim.id]) {
        productTotals[sim.id] = { sku, productName: sim.name, quantity: 0, simulationId: sim.id, timestamp: `${hour}:00`, unitPrice: item.PrecoVenda || item.valorvenda || 0 };
      }
      productTotals[sim.id].quantity += qty;
      if (!productHourlySales[sim.id]) productHourlySales[sim.id] = {};
      productHourlySales[sim.id][hour] = (productHourlySales[sim.id][hour] || 0) + qty;
    }

    if (validMappedItemsForCombo.length > 0) {
      const comboString = validMappedItemsForCombo.sort((a, b) => a.name.localeCompare(b.name)).map(i => `${i.qty}x ${i.name}`).join(' + ');
      comboCounts[comboString] = (comboCounts[comboString] || 0) + 1;
    }
  }

  const reportId = `sync_${kioskId}_${dateStr.replace(/-/g, '_')}`;
  await db.collection('salesReports').doc(`sales_${reportId}`).set({
    reportName: `Sincronização Automática ${dateStr}`,
    month: date.getMonth() + 1, year: date.getFullYear(), day: date.getDate(), kioskId, createdAt: new Date().toISOString(),
    items: Object.values(productTotals), hourlySales, productHourlySales,
    combos: Object.entries(comboCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  });
  return { success: true };
}