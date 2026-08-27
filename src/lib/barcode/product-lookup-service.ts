import type { NormalizedProductData, ProductLookupResponse, ProductLookupSourceResult } from './product-lookup-types';
import { BarcodeValidator } from './barcode-validator';
import { ProductConfidenceResolver } from './product-confidence-resolver';
import { InternalProductRepository } from './internal-product-repository';
import { OpenFoodFactsProvider } from './providers/open-food-facts-provider';
import { GS1Provider } from './providers/gs1-provider';
import { BrazilianProductProvider } from './providers/brazilian-product-provider';

type LookupProvider = {
  lookup(barcode: string): Promise<ProductLookupSourceResult>;
};

export class ProductLookupService {
  private readonly providers: LookupProvider[];

  constructor(
    private readonly repository: InternalProductRepository,
    providers?: LookupProvider[],
  ) {
    this.providers =
      providers ??
      [
        new OpenFoodFactsProvider(),
        new GS1Provider(),
        new BrazilianProductProvider(),
      ];
  }

  async lookup(rawBarcode: string, userId: string): Promise<ProductLookupResponse> {
    const validation = BarcodeValidator.validate(rawBarcode);
    if (!validation.ok) {
      await this.repository.logLookup({
        barcode: validation.code || rawBarcode,
        userId,
        sources: [],
        resultado: 'invalid',
        erro: validation.error,
      });
      return {
        found: false,
        source: 'manual',
        cacheHit: false,
        sources: [],
        conflitos: [],
        fontes_consultadas: [],
        mensagem: validation.error,
      };
    }

    const barcode = validation.code;
    const internalProduct = await this.repository.findByBarcode(barcode);
    if (internalProduct) {
      const produto = InternalProductRepository.normalizedFromProduct(internalProduct);
      const response: ProductLookupResponse = {
        found: true,
        source: 'internal',
        cacheHit: false,
        produto,
        internalProduct,
        sources: [
          {
            fonte: 'internal',
            status: 'found',
            dados: produto,
            data_consulta: new Date().toISOString(),
          },
        ],
        conflitos: [],
        fontes_consultadas: ['internal'],
      };
      await this.repository.logLookup({
        barcode,
        userId,
        sources: response.sources,
        resultado: 'found',
      });
      return response;
    }

    const cacheTtlHours = Number(process.env.BARCODE_LOOKUP_CACHE_TTL_HOURS ?? 24);
    const cached = await this.repository.readCache(barcode, cacheTtlHours);
    if (cached) {
      await this.repository.logLookup({
        barcode,
        userId,
        sources: cached.sources,
        resultado: cached.found ? 'found' : 'not_found',
      });
      return cached;
    }

    const sources: ProductLookupSourceResult[] = [];
    for (const provider of this.providers) {
      const result = await provider.lookup(barcode).catch((error) => ({
        fonte: 'open_food_facts' as const,
        status: 'error' as const,
        mensagem: error instanceof Error ? error.message : 'Erro inesperado no provedor.',
        data_consulta: new Date().toISOString(),
      }));
      sources.push(result);
      if (result.status === 'error') {
        console.error('[ProductLookupService] provider error', result.fonte, result.mensagem);
      }
    }

    const produto = ProductConfidenceResolver.chooseBest(sources);
    const response: ProductLookupResponse = {
      found: Boolean(produto),
      source: (produto?.origem_dados as NormalizedProductData['origem_dados']) ?? 'manual',
      cacheHit: false,
      produto,
      sources,
      conflitos: ProductConfidenceResolver.conflicts(sources),
      fontes_consultadas: sources.map((source) => source.fonte),
      mensagem: produto ? undefined : 'Produto não encontrado nas bases consultadas.',
    };

    await this.repository.writeCache(barcode, response);
    await this.repository.logLookup({
      barcode,
      userId,
      sources,
      resultado: produto ? 'found' : 'not_found',
      erro: sources.find((source) => source.status === 'error')?.mensagem,
    });

    return response;
  }
}
