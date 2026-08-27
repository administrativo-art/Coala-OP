import type { ProductLookupSourceResult } from '../product-lookup-types';
import { ProductNormalizer } from '../product-normalizer';
import { fetchJsonWithTimeout } from './provider-utils';

export class BrazilianProductProvider {
  async lookup(barcode: string): Promise<ProductLookupSourceResult> {
    const dataConsulta = new Date().toISOString();
    const cosmosToken = process.env.COSMOS_API_TOKEN;
    const template =
      process.env.BRAZILIAN_PRODUCT_API_URL_TEMPLATE ||
      (cosmosToken ? 'https://api.cosmos.bluesoft.com.br/gtins/{gtin}.json' : '');
    const apiKey = process.env.BRAZILIAN_PRODUCT_API_KEY || cosmosToken;

    if (!template || !apiKey) {
      return {
        fonte: 'brazilian_commercial',
        status: 'skipped',
        mensagem: 'API brasileira de produtos nao configurada.',
        data_consulta: dataConsulta,
      };
    }

    const url = template.replace('{gtin}', encodeURIComponent(barcode)).replace('{codigo}', encodeURIComponent(barcode));
    const headerName = process.env.BRAZILIAN_PRODUCT_API_HEADER_NAME || (cosmosToken ? 'X-Cosmos-Token' : 'Authorization');
    const headerValue = headerName.toLowerCase() === 'authorization' ? `Bearer ${apiKey}` : apiKey;
    const response = await fetchJsonWithTimeout<Record<string, unknown>>(
      url,
      { headers: { accept: 'application/json', [headerName]: headerValue } },
      Number(process.env.PRODUCT_LOOKUP_TIMEOUT_MS ?? 4500),
    );

    if (!response.ok) {
      return {
        fonte: 'brazilian_commercial',
        status: response.status === 404 ? 'not_found' : 'error',
        mensagem: response.error,
        data_consulta: dataConsulta,
      };
    }

    const product = ProductNormalizer.fromBrazilianProvider(barcode, response.data);
    if (!product) {
      return {
        fonte: 'brazilian_commercial',
        status: 'not_found',
        dados_brutos_json: response.data,
        data_consulta: dataConsulta,
      };
    }

    return {
      fonte: 'brazilian_commercial',
      status: 'found',
      dados: product,
      dados_brutos_json: response.data,
      data_consulta: dataConsulta,
    };
  }
}
