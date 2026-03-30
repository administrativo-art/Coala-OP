import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { type SalesReport, type SalesReportItem, type ConsumptionReport, type ConsumptionAnalysisItem, type ProductSimulation, type ProductSimulationItem, type BaseProduct } from '@/types';
import { convertValue } from '@/lib/conversion';

const COD_EMPRESA = process.env.NEXT_PUBLIC_PDVLEGAL_COD_EMPRESA || '14449';
const API_TOKEN = process.env.NEXT_PUBLIC_PDVLEGAL_TOKEN || 'NMCB-2700-8660-1072';
const USERNAME = process.env.NEXT_PUBLIC_PDVLEGAL_USERNAME || 'central@tabletcloud.com.br';
const PASSWORD = process.env.NEXT_PUBLIC_PDVLEGAL_PASSWORD || 'dtat-2123-5110-5504@1707212';

const BASE_URL = 'https://api.tabletcloud.com.br';

async function getAccessToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', USERNAME);
  params.append('password', PASSWORD);

  const authString = btoa(`${COD_EMPRESA}:${API_TOKEN}`);

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
 * Busca cupons exaustivamente (Paginado) para um dia e filial.
 */
async function fetchAllCouponsForDay(accessToken: string, date: string, filialId: string) {
  console.log(`[PDV Legal Client] Coletando: ${date} (Filial: ${filialId})`);

  // A API do PDV Legal para a rota /cupom/get/{date}/{date} retorna o dia completo.
  // Ela IGNORA o parâmetro offset nesta rota e gera loop infinito se tentarmos paginar.
  // Fazemos apenas 1 requisição.
  const url = `${BASE_URL}/cupom/get/${date}/${date}/${filialId}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'CodEmpresa': COD_EMPRESA,
      'Token': API_TOKEN,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Erro na API do PDV Legal (${response.status}): ${error}`);
  }

  const data = await response.json();
  const coupons = Array.isArray(data) ? data : (data.links ? data.data : []);
  
  console.log(`[PDV Legal Client] ${date}: ${coupons.length} cupons recebidos.`);
  return coupons || [];
}

export async function syncDayClient(dateStr: string, kioskId: string, pdvFilialId: string) {
  const token = await getAccessToken();
  const coupons = await fetchAllCouponsForDay(token, dateStr, pdvFilialId);

  if (!coupons || coupons.length === 0) return { success: true, count: 0, unmapped: [] };

  const simsSnap = await getDocs(collection(db, 'productSimulations'));
  const simulations = simsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductSimulation));
  
  const itemsSnap = await getDocs(collection(db, 'productSimulationItems'));
  const allSimItems = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductSimulationItem));

  const bpSnap = await getDocs(collection(db, 'baseProducts'));
  const baseProducts = bpSnap.docs.map(d => ({ id: d.id, ...d.data() } as BaseProduct));

  const date = new Date(dateStr + 'T12:00:00Z');
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const day = date.getDate();

  const productTotals: Record<string, any> = {};
  const hourlySales: Record<string, number> = {};
  const productHourlySales: Record<string, Record<string, number>> = {};
  const consumptionByBaseProduct: Record<string, any> = {};
  const unmappedSKUs = new Map<string, string>();
  const comboCounts: Record<string, number> = {};

  for (const coupon of coupons) {
    const rawItems = coupon.itens || coupon.Itens;
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

    const hour = coupon.DataHora ? new Date(coupon.DataHora).getHours().toString().padStart(2, '0') : '00';
    hourlySales[hour] = (hourlySales[hour] || 0) + 1; 

    const validMappedItemsForCombo: { name: string, qty: number }[] = [];

    for (const item of rawItems) {
      // IGNORA O ITEM APENAS SE ELE, INDIVIDUALMENTE, ESTIVER MARCADO COMO CANCELADO
      if (item.iscancelado) continue;

      // O SKU do Estoque corresponde estritamente ao codigoVenda do PDV.
      const sku = (item.codigoVenda || item.CodRef || '').toString().trim();
      const qty = item.quantidade || item.Quantidade || 0;
      
      if (!sku) continue;

      // Busca a simulação (Ficha Técnica) pelo SKU exato
      const sim = simulations.find(s => s.ppo?.sku?.toString().trim() === sku);

      if (!sim) {
        // Log visível no Console do Navegador (F12) para conferência
        console.warn(`[PDV Legal] ⚠️ SKU "${sku}" não encontrado no sistema (${item.nomeProduto || item.Descricao || 'Sem descrição'})`);
        unmappedSKUs.set(sku, item.nomeProduto || item.Descricao || 'Sem descrição');
        continue;
      }

      // Adiciona ao mapeamento de combos do cupom
      const existingComboItem = validMappedItemsForCombo.find(i => i.name === sim.name);
      if (existingComboItem) {
        existingComboItem.qty += qty;
      } else {
        validMappedItemsForCombo.push({ name: sim.name, qty });
      }

      const itTime = item.DataHora || item.dtmovimento || coupon.DataHora || coupon.dtmovimento;
      const itemHour = itTime ? new Date(itTime).getHours().toString().padStart(2, '0') : hour;
      const itemTimestamp = itTime ? new Date(itTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : `${itemHour}:00`;
      const unitPrice = item.valorUnitario || item.valorvenda || item.PrecoVenda || 0;

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
      productHourlySales[sim.id][itemHour] = (productHourlySales[sim.id][itemHour] || 0) + qty;

      const itemsForSim = allSimItems.filter(i => i.simulationId === sim.id);
      for (const simItem of itemsForSim) {
        const bp = baseProducts.find(b => b.id === simItem.baseProductId);
        if (!bp) continue;
        try {
          const val = convertValue(simItem.quantity, simItem.overrideUnit || bp.unit, bp.unit, bp.category);
          const total = qty * val;
          if (!consumptionByBaseProduct[bp.id]) consumptionByBaseProduct[bp.id] = { name: bp.name, quantity: 0 };
          consumptionByBaseProduct[bp.id].quantity += total;
        } catch (e) {}
      }
    }

    // Após processar todos os itens do cupom, gera a string do combo e contabiliza
    if (validMappedItemsForCombo.length > 0) {
      const comboString = validMappedItemsForCombo
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(i => `${i.qty}x ${i.name}`)
        .join(' + ');
      comboCounts[comboString] = (comboCounts[comboString] || 0) + 1;
    }
  }

  const reportId = `sync_${kioskId}_${dateStr.replace(/-/g, '_')}`;
  const consumptionReport: any = {
    reportName: `Sincronização PDV Legal ${dateStr}`,
    month, year, kioskId, createdAt: new Date().toISOString(), status: 'completed',
    results: Object.entries(consumptionByBaseProduct).map(([id, data]) => ({
      productId: id, productName: data.name, consumedQuantity: data.quantity, baseProductId: id
    }))
  };

  const salesReport: any = {
    reportName: `Sincronização PDV Legal ${dateStr}`,
    month, year, day, kioskId, createdAt: new Date().toISOString(),
    consumptionReportId: `cons_${reportId}`,
    items: Object.values(productTotals),
    hourlySales,
    productHourlySales,
    unmappedCount: unmappedSKUs.size,
    unmappedList: Array.from(unmappedSKUs.entries()).map(([sku, name]) => ({ sku, name })),
    combos: Object.entries(comboCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  };

  await setDoc(doc(db, 'consumptionReports', `cons_${reportId}`), consumptionReport);
  await setDoc(doc(db, 'salesReports', `sales_${reportId}`), salesReport);

  return { 
    success: true, 
    count: coupons.length, 
    unmapped: Array.from(unmappedSKUs.entries()).map(([sku, name]) => ({ sku, name })) 
  };
}
