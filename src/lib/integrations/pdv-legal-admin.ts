import { dbAdmin } from '@/lib/firebase-admin';
import { type SalesReport, type SalesReportItem, type ConsumptionReport, type ConsumptionAnalysisItem, type ProductSimulation, type ProductSimulationItem, type BaseProduct } from '@/types';
import { convertValue } from '@/lib/conversion';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`[PDV Legal Admin] Variável de ambiente ${name} não configurada.`);
  return val;
}

// Lazy getters — evaluated at request time, never at module load / build time.
function getEnv() {
  return {
    COD_EMPRESA: requireEnv('PDVLEGAL_COD_EMPRESA'),
    API_TOKEN:   requireEnv('PDVLEGAL_TOKEN'),
    USERNAME:    requireEnv('PDVLEGAL_USERNAME'),
    PASSWORD:    requireEnv('PDVLEGAL_PASSWORD'),
  };
}

const BASE_URL = 'https://api.tabletcloud.com.br';

/**
 * Erro estruturado para falhas de comunicação/formato com a API do PDV Legal.
 * O `code` permite à UI distinguir "sem vendas" de "integração quebrada".
 */
export class PdvApiError extends Error {
  constructor(message: string, public code: string, public detail?: string) {
    super(message);
    this.name = 'PdvApiError';
  }
}

export type SyncDiagnostics = {
  couponsReceived: number;
  couponsCancelled: number;
  couponsWithoutItems: number;
  itemsSeen: number;
  itemsCancelled: number;
  itemsMapped: number;
  itemsUnmapped: number;
  itemsZeroValue: number;
  unmappedSkus: { sku: string; name: string; count: number }[];
};

/**
 * Detecta e valida o formato da resposta de cupons. Array direto, paginado
 * `{ data }` ou objeto vazio são aceitos; qualquer outro formato lança erro
 * estrutural em vez de virar silenciosamente uma lista vazia.
 */
function parseCouponsResponse(raw: unknown): { coupons: any[]; format: string } {
  if (Array.isArray(raw)) return { coupons: raw, format: 'array' };

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, any>;
    if ('data' in obj) {
      return { coupons: Array.isArray(obj.data) ? obj.data : [], format: 'paginated' };
    }
    const apiMsg = obj.Message || obj.message || obj.Error || obj.error;
    if (apiMsg) {
      throw new PdvApiError(`API do PDV Legal retornou erro: ${apiMsg}`, 'API_ERROR_PAYLOAD', JSON.stringify(obj).slice(0, 300));
    }
    if (Object.keys(obj).length === 0) return { coupons: [], format: 'empty-object' };
    throw new PdvApiError('Estrutura inesperada na resposta de cupons do PDV Legal.', 'UNEXPECTED_STRUCTURE', JSON.stringify(obj).slice(0, 300));
  }

  throw new PdvApiError('Resposta de cupons em formato não reconhecido.', 'UNEXPECTED_TYPE', String(raw).slice(0, 100));
}

export async function getAccessToken() {
  const { COD_EMPRESA, API_TOKEN, USERNAME, PASSWORD } = getEnv();

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
    const error = await response.text().catch(() => '');
    throw new PdvApiError(`Falha na autenticação com o PDV Legal (HTTP ${response.status}).`, 'AUTH_FAILED', error.slice(0, 300));
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new PdvApiError('Resposta de autenticação do PDV Legal não é JSON válido.', 'AUTH_BAD_JSON');
  }
  if (!data?.access_token) {
    throw new PdvApiError('Token de acesso ausente na resposta do PDV Legal.', 'AUTH_NO_TOKEN');
  }
  return data.access_token as string;
}

/**
 * Busca cupons exaustivamente (Paginado) no servidor.
 */
async function fetchAllCouponsForDay(accessToken: string, date: string, filialId: string) {
  const { COD_EMPRESA, API_TOKEN } = getEnv();
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
    const errorText = await response.text().catch(() => '');
    console.error(`[PDV Legal] Erro na API: ${response.status} - ${errorText}`);
    // Antes retornava [] silenciosamente → erro de API virava "0 cupons".
    throw new PdvApiError(`Falha ao buscar cupons da filial ${filialId} (HTTP ${response.status}).`, 'FETCH_FAILED', errorText.slice(0, 300));
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new PdvApiError(`Resposta de cupons (${date}) não é JSON válido.`, 'COUPONS_BAD_JSON');
  }
  const { coupons, format } = parseCouponsResponse(raw);
  console.log(`[PDV Legal] ${date}: Recebidos ${coupons.length} cupons (formato: ${format}).`);
  return coupons;
}

function extractPdvTime(dateStr: string): string {
  if (!dateStr) return '00:00';
  const match = dateStr.trim().match(/[T ](\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '00:00';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function extractBrazilHour(dateStr: string): string {
  return extractPdvTime(dateStr).split(':')[0];
}

function emptyDiagnostics(): SyncDiagnostics {
  return {
    couponsReceived: 0, couponsCancelled: 0, couponsWithoutItems: 0,
    itemsSeen: 0, itemsCancelled: 0, itemsMapped: 0, itemsUnmapped: 0,
    itemsZeroValue: 0, unmappedSkus: [],
  };
}

export async function syncDayAdmin(dateStr: string, kioskId: string, pdvFilialId: string) {
  const token = await getAccessToken();
  const coupons = await fetchAllCouponsForDay(token, dateStr, pdvFilialId);

  if (!coupons || coupons.length === 0) {
    return { success: true, count: 0, unmapped: [] as { sku: string; name: string }[], diagnostics: emptyDiagnostics(), warnings: [] as string[] };
  }

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

  // Diagnóstico — saber se a sync trouxe dados reais ou só "sucesso vazio"
  const diag = emptyDiagnostics();
  diag.couponsReceived = coupons.length;
  const unmappedSkuMap: Record<string, { sku: string; name: string; count: number }> = {};

  for (const coupon of coupons) {
    const rawItems = coupon.Itens || coupon.itens;
    if (!rawItems || !Array.isArray(rawItems)) { diag.couponsWithoutItems++; continue; }

    const isCupomCancelado = coupon.iscancelado || coupon.status === 'CANCELADO';

    // Verifica se é um "Cancelamento Total Preguiçoso" da API:
    // O cupom está cancelado, mas a API esqueceu de marcar os itens dentro dele como cancelados.
    const hasAnyItemExplicitlyCancelled = rawItems.some(item => item.iscancelado === true);

    if (isCupomCancelado && !hasAnyItemExplicitlyCancelled) {
       // Se o cupom está cancelado E NENHUM item dentro dele diz que foi cancelado,
       // assumimos que foi um cancelamento total da venda e ignoramos o cupom inteiro.
       diag.couponsCancelled++;
       continue;
    }

    const couponTime = coupon.dtrecebimento || coupon.dtabertura || rawItems.find((i: any) => i.dtmovimento)?.dtmovimento || '';
    const hour = extractBrazilHour(couponTime);
    hourlySales[hour] = (hourlySales[hour] || 0) + 1;

    for (const item of rawItems) {
      diag.itemsSeen++;
      // IGNORA O ITEM APENAS SE ELE, INDIVIDUALMENTE, ESTIVER MARCADO COMO CANCELADO
      if (item.iscancelado) { diag.itemsCancelled++; continue; }

      const possibleSkus = [
          item.codigoVenda,
          item.codproduto,
          item.codProdutoExterno,
          item.CodRef,
          item.Codigo
        ].filter(Boolean).map(c => c.toString().trim());

        const qty = item.Quantidade || item.quantidade || 0;
        const itemTotal = item.valortotal || item.ValorTotal || 0;
        if (!itemTotal) diag.itemsZeroValue++;

        // Busca a simulação (Ficha Técnica) cujo SKU seja um dos códigos do PDV
        const sim = simulations.find(s => {
          const simSku = s.ppo?.sku?.toString().trim();
          return simSku && possibleSkus.includes(simSku);
        });

        const mainSku = possibleSkus[0] || 'SEM_SKU';

        if (!sim) {
          diag.itemsUnmapped++;
          if (!unmappedSkuMap[mainSku]) {
            unmappedSkuMap[mainSku] = { sku: mainSku, name: item.Descricao || item.nomeProduto || item.descricao || 'Sem descrição', count: 0 };
          }
          unmappedSkuMap[mainSku].count++;
          console.log(`[PDV Legal] ⚠️ SKU não encontrado nas Fichas Técnicas: "${mainSku}" (${item.Descricao || item.nomeProduto || 'Sem descrição'}) - Buscado por: ${possibleSkus.join(', ')}`);
          continue;
        }
        diag.itemsMapped++;

        const sku = sim.ppo?.sku?.toString().trim() || mainSku;

        const itTime = coupon.dtrecebimento || coupon.dtabertura || item.dtmovimento;
        const itemTimestamp = extractPdvTime(itTime || '') || `${hour}:00`;
        const unitPrice = item.PrecoVenda || item.precoVenda || (qty > 0 ? itemTotal / qty : 0);

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
  // Amostra dos SKUs sem ficha técnica (top 20 por frequência)
  diag.unmappedSkus = Object.values(unmappedSkuMap).sort((a, b) => b.count - a.count).slice(0, 20);

  // ── Checagens de integridade — sinalizam quando "sucesso" não trouxe dados ──
  const warnings: string[] = [];
  if (diag.couponsReceived > 0 && diag.itemsMapped === 0) {
    warnings.push('Cupons recebidos, mas nenhum item bateu com as fichas técnicas (SKUs não mapeados).');
  }
  if (diag.itemsSeen > 0 && diag.itemsUnmapped / diag.itemsSeen > 0.5) {
    warnings.push(`Mais da metade dos itens (${diag.itemsUnmapped}/${diag.itemsSeen}) sem ficha técnica.`);
  }
  if (warnings.length > 0) {
    console.warn(`[PDV Legal] ${dateStr} ${kioskId}: ⚠️ ${warnings.join(' | ')}`, JSON.stringify(diag));
  }

  const reportId = `sync_${kioskId}_${dateStr.replace(/-/g, '_')}`;

  await dbAdmin.collection('salesReports').doc(`sales_${reportId}`).set({
    reportName: `Sincronização PDV Legal ${dateStr}`,
    month, year, day, kioskId, createdAt: new Date().toISOString(),
    consumptionReportId: `cons_${reportId}`,
    items: Object.values(productTotals),
    hourlySales,
    productHourlySales,
    syncDiagnostics: diag,
  });

  await dbAdmin.collection('consumptionReports').doc(`cons_${reportId}`).set({
    reportName: `Sincronização PDV Legal ${dateStr}`,
    month, year, day, kioskId, createdAt: new Date().toISOString(), status: 'completed',
    results: Object.entries(consumptionByBaseProduct).map(([id, data]) => ({
      productId: id, productName: data.name, consumedQuantity: data.quantity, baseProductId: id
    }))
  });

  return { success: true, count: coupons.length, unmapped: diag.unmappedSkus.map(u => ({ sku: u.sku, name: u.name })), diagnostics: diag, warnings };
}
