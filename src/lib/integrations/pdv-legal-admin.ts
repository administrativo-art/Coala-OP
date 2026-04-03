import { dbAdmin } from '@/lib/firebase-admin';
import { type SalesReport, type SalesReportItem, type ConsumptionReport, type ConsumptionAnalysisItem, type ProductSimulation, type ProductSimulationItem, type BaseProduct } from '@/types';
import { convertValue } from '@/lib/conversion';

const COD_EMPRESA = process.env.PDVLEGAL_COD_EMPRESA || '14449';
const API_TOKEN = process.env.PDVLEGAL_TOKEN || 'NMCB-2700-8660-1072';
const USERNAME = process.env.PDVLEGAL_USERNAME || 'central@tabletcloud.com.br';
const PASSWORD = process.env.PDVLEGAL_PASSWORD || 'dtat-2123-5110-5504@1707212';

const BASE_URL = 'https://api.tabletcloud.com.br';

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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Auth failed (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Busca cupons exaustivamente (Paginado) no servidor.
 */
async function fetchAllCouponsForDay(accessToken: string, date: string, filialId: string) {
  console.log(`[PDV Legal] Iniciando coleta: ${date} (Filial: ${filialId})`);

  const url = `${BASE_URL}/cupom/get/${date}/${date}/${filialId}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'CodEmpresa': COD_EMPRESA,
      'Token': API_TOKEN,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[PDV Legal] Erro na API: ${response.status} - ${errorText}`);
    return [];
  }

  const data = await response.json();
  const coupons = Array.isArray(data) ? data : (data.links ? data.data : []);
  
  console.log(`[PDV Legal] ${date}: Recebidos ${coupons.length} cupons.`);
  return coupons || [];
}

function extractBrazilHour(dateStr: string): string {
  if (!dateStr) return '00';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '00';
  const brt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return brt.getHours().toString().padStart(2, '0');
}

export async function syncDayAdmin(dateStr: string, kioskId: string, pdvFilialId: string) {
  const token = await getAccessToken();
  const coupons = await fetchAllCouponsForDay(token, dateStr, pdvFilialId);

  if (!coupons || coupons.length === 0) return { success: true, count: 0 };

  const simsSnap = await dbAdmin.collection('productSimulations').get();
  const simulations = simsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  
  const itemsSnap = await dbAdmin.collection('productSimulationItems').get();
  const allSimItems = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  const bpSnap = await dbAdmin.collection('baseProducts').get();
  const baseProducts = bpSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  const date = new Date(dateStr + 'T12:00:00Z');
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const day = date.getDate();

  const productTotals: Record<string, any> = {};
  const hourlySales: Record<string, number> = {};
  const productHourlySales: Record<string, Record<string, number>> = {};
  const consumptionByBaseProduct: Record<string, any> = {};

  for (const coupon of coupons) {
    const rawItems = coupon.Itens || coupon.itens;
    if (!rawItems || !Array.isArray(rawItems)) continue;

    const isCupomCancelado = coupon.iscancelado || coupon.status === 'CANCELADO';
    
    // Verifica se é um "Cancelamento Total Preguiçoso" da API:
    // O cupom está cancelado, mas a API esqueceu de marcar os itens dentro dele como cancelados.
    const hasAnyItemExplicitlyCancelled = rawItems.some(item => item.iscancelado === true);
    
    if (isCupomCancelado && !hasAnyItemExplicitlyCancelled) {
       // Se o cupom está cancelado E NENHUM item dentro dele diz que foi cancelado,
       // assumimos que foi um cancelamento total da venda e ignoramos o cupom inteiro.
       continue;
    }

    const couponTime = coupon.dtrecebimento || coupon.dtabertura || rawItems.find((i: any) => i.dtmovimento)?.dtmovimento || '';
    const hour = extractBrazilHour(couponTime);
    hourlySales[hour] = (hourlySales[hour] || 0) + 1;

    for (const item of rawItems) {
      // IGNORA O ITEM APENAS SE ELE, INDIVIDUALMENTE, ESTIVER MARCADO COMO CANCELADO
      if (item.iscancelado) continue;

      const possibleSkus = [
          item.codigoVenda,
          item.codproduto,
          item.codProdutoExterno,
          item.CodRef,
          item.Codigo
        ].filter(Boolean).map(c => c.toString().trim());

        const qty = item.Quantidade || item.quantidade || 0;
        
        // Busca a simulação (Ficha Técnica) cujo SKU seja um dos códigos do PDV
        const sim = simulations.find(s => {
          const simSku = s.ppo?.sku?.toString().trim();
          return simSku && possibleSkus.includes(simSku);
        });

        const mainSku = possibleSkus[0] || 'SEM_SKU';

        if (!sim) {
          console.log(`[PDV Legal] ⚠️ SKU não encontrado nas Fichas Técnicas: "${mainSku}" (${item.Descricao || item.nomeProduto || 'Sem descrição'}) - Buscado por: ${possibleSkus.join(', ')}`);
          continue;
        }

        const sku = sim.ppo?.sku?.toString().trim() || mainSku;

        const itTime = coupon.dtrecebimento || coupon.dtabertura || item.dtmovimento;
        const itemTimestamp = itTime ? new Date(itTime).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : `${hour}:00`;
        const unitPrice = item.PrecoVenda || 0;

        if (!productTotals[sim.id]) {
          productTotals[sim.id] = { 
            sku, 
            productName: sim.name, 
            quantity: 0, 
            simulationId: sim.id,
            timestamp: itemTimestamp,
            unitPrice
          };
        }
        productTotals[sim.id].quantity += qty;

        if (!productHourlySales[sim.id]) productHourlySales[sim.id] = {};
        productHourlySales[sim.id][hour] = (productHourlySales[sim.id][hour] || 0) + qty;

        const itemsForSim = allSimItems.filter((i: any) => i.simulationId === sim.id);
        for (const simItem of itemsForSim) {
          const bp = baseProducts.find((b: any) => b.id === simItem.baseProductId);
          if (!bp) continue;
          try {
            const val = convertValue(simItem.quantity, simItem.overrideUnit || bp.unit, bp.unit, bp.category);
            const total = qty * val;
            if (!consumptionByBaseProduct[bp.id]) consumptionByBaseProduct[bp.id] = { name: bp.name, quantity: 0 };
            consumptionByBaseProduct[bp.id].quantity += total;
          } catch (e) {}
        }
    }

}
  const reportId = `sync_${kioskId}_${dateStr.replace(/-/g, '_')}`;
  
  await dbAdmin.collection('salesReports').doc(`sales_${reportId}`).set({
    reportName: `Sincronização PDV Legal ${dateStr}`,
    month, year, day, kioskId, createdAt: new Date().toISOString(),
    consumptionReportId: `cons_${reportId}`,
    items: Object.values(productTotals),
    hourlySales,
    productHourlySales
  });

  await dbAdmin.collection('consumptionReports').doc(`cons_${reportId}`).set({
    reportName: `Sincronização PDV Legal ${dateStr}`,
    month, year, kioskId, createdAt: new Date().toISOString(), status: 'completed',
    results: Object.entries(consumptionByBaseProduct).map(([id, data]) => ({
      productId: id, productName: data.name, consumedQuantity: data.quantity, baseProductId: id
    }))
  });

  return { success: true, count: coupons.length };
}
