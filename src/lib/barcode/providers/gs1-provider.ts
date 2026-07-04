import type { ProductLookupSourceResult } from '../product-lookup-types';
import { ProductNormalizer } from '../product-normalizer';
import { fetchJsonWithTimeout } from './provider-utils';

export class GS1Provider {
  async lookup(barcode: string): Promise<ProductLookupSourceResult> {
    const dataConsulta = new Date().toISOString();
    const template = process.env.GS1_LOOKUP_URL_TEMPLATE;
    const apiKey = process.env.GS1_API_KEY;

    if (!template || !apiKey) {
      return {
        fonte: 'gs1',
        status: 'skipped',
        mensagem: 'GS1 nao configurado. Defina GS1_LOOKUP_URL_TEMPLATE e GS1_API_KEY.',
        data_consulta: dataConsulta,
      };
    }

    const url = template.replace('{gtin}', encodeURIComponent(barcode)).replace('{codigo}', encodeURIComponent(barcode));
    const headerName = process.env.GS1_API_HEADER_NAME || 'Authorization';
    const headerValue = headerName.toLowerCase() === 'authorization' ? `Bearer ${apiKey}` : apiKey;
    const response = await fetchJsonWithTimeout<Record<string, unknown>>(
      url,
      { headers: { accept: 'application/json', [headerName]: headerValue } },
      Number(process.env.PRODUCT_LOOKUP_TIMEOUT_MS ?? 4500),
    );

    if (!response.ok) {
      return { fonte: 'gs1', status: 'error', mensagem: response.error, data_consulta: dataConsulta };
    }

    const product = ProductNormalizer.fromGs1(barcode, response.data);
    if (!product) {
      return {
        fonte: 'gs1',
        status: 'not_found',
        dados_brutos_json: response.data,
        data_consulta: dataConsulta,
      };
    }

    return {
      fonte: 'gs1',
      status: 'found',
      dados: product,
      dados_brutos_json: response.data,
      data_consulta: dataConsulta,
    };
  }
}
