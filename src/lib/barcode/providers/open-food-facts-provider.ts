import type { ProductLookupSourceResult } from '../product-lookup-types';
import { ProductNormalizer } from '../product-normalizer';
import { appUserAgent, fetchJsonWithTimeout } from './provider-utils';

export class OpenFoodFactsProvider {
  async lookup(barcode: string): Promise<ProductLookupSourceResult> {
    const dataConsulta = new Date().toISOString();
    const fields = [
      'code',
      'product_name',
      'product_name_pt',
      'generic_name',
      'brands',
      'quantity',
      'product_quantity',
      'product_quantity_unit',
      'categories',
      'ingredients_text',
      'nutriments',
      'image_url',
      'countries',
    ].join(',');
    const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}.json?fields=${encodeURIComponent(fields)}`;
    const response = await fetchJsonWithTimeout<Record<string, unknown>>(
      url,
      {
        headers: {
          accept: 'application/json',
          'user-agent': appUserAgent(),
        },
      },
      Number(process.env.PRODUCT_LOOKUP_TIMEOUT_MS ?? 4500),
    );

    if (!response.ok) {
      return {
        fonte: 'open_food_facts',
        status: 'error',
        mensagem: response.error,
        data_consulta: dataConsulta,
      };
    }

    const status = String(response.data.status ?? '');
    const product = ProductNormalizer.fromOpenFoodFacts(barcode, response.data);
    if (!product || (status && status !== 'success')) {
      return {
        fonte: 'open_food_facts',
        status: 'not_found',
        dados_brutos_json: response.data,
        data_consulta: dataConsulta,
      };
    }

    return {
      fonte: 'open_food_facts',
      status: 'found',
      dados: product,
      dados_brutos_json: response.data,
      data_consulta: dataConsulta,
    };
  }
}
