import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { Product, UnitCategory } from '@/types';
import type { NormalizedProductData, ProductDataSource, ProductLookupResponse, ProductLookupSourceResult, ProductSavePayload } from './product-lookup-types';
import { ProductNormalizer } from './product-normalizer';

const WORKSPACE_ID = process.env.NEXT_PUBLIC_WORKSPACE_ID ?? 'coala';

function cleanUndefined<T extends Record<string, any>>(value: T): T {
  const clone: Record<string, any> = Array.isArray(value) ? [...value] : { ...value };
  for (const key of Object.keys(clone)) {
    if (clone[key] === undefined) delete clone[key];
    else if (
      clone[key] &&
      typeof clone[key] === 'object' &&
      !Array.isArray(clone[key]) &&
      Object.getPrototypeOf(clone[key]) === Object.prototype
    ) {
      clone[key] = cleanUndefined(clone[key]);
    }
  }
  return clone as T;
}

function inferUnitCategory(unit?: string): UnitCategory {
  const normalized = String(unit ?? '').toLowerCase();
  if (['g', 'kg', 'mg'].includes(normalized)) return 'Massa';
  if (['ml', 'l'].includes(normalized)) return 'Volume';
  return 'Unidade';
}

function normalizeDataSource(value?: string): ProductDataSource {
  if (value === 'internal' || value === 'open_food_facts' || value === 'gs1' || value === 'brazilian_commercial' || value === 'cache') {
    return value;
  }
  return 'manual';
}

function productPayloadFromLookup(lookup: NormalizedProductData, overrides: Partial<Product> = {}) {
  const now = new Date().toISOString();
  const unit = overrides.unit ?? lookup.unidade_medida ?? 'un';
  const packageSize = Number(overrides.packageSize ?? lookup.quantidade ?? 1);
  const category = overrides.category ?? lookup.unitCategory ?? inferUnitCategory(unit);

  return cleanUndefined({
    workspaceId: WORKSPACE_ID,
    operationalCategoryId: overrides.operationalCategoryId ?? lookup.categoria_id ?? '',
    operationalCategoryName: overrides.operationalCategoryName,
    operationalDestination: overrides.operationalDestination,
    baseName: overrides.baseName ?? lookup.nome,
    brand: overrides.brand ?? lookup.marca ?? '',
    aliases: overrides.aliases,
    barcode: overrides.barcode ?? lookup.codigo_barras,
    gtin: overrides.gtin ?? lookup.gtin,
    imageUrl: overrides.imageUrl ?? lookup.imagem_url ?? '',
    description: overrides.description ?? lookup.descricao ?? '',
    externalCategory: overrides.externalCategory ?? lookup.categoria ?? '',
    ingredients: overrides.ingredients ?? lookup.ingredientes ?? '',
    nutritionFacts: overrides.nutritionFacts ?? lookup.informacoes_nutricionais,
    ncm: overrides.ncm ?? lookup.ncm ?? '',
    cest: overrides.cest ?? lookup.cest ?? '',
    dataSource: overrides.dataSource ?? lookup.origem_dados,
    confidence: overrides.confidence ?? lookup.confianca,
    lastBarcodeLookupAt: overrides.lastBarcodeLookupAt ?? lookup.data_consulta ?? now,
    codigo_barras: overrides.codigo_barras ?? lookup.codigo_barras,
    nome: overrides.nome ?? overrides.baseName ?? lookup.nome,
    marca: overrides.marca ?? overrides.brand ?? lookup.marca ?? '',
    descricao: overrides.descricao ?? overrides.description ?? lookup.descricao ?? '',
    categoria_id: overrides.categoria_id ?? overrides.operationalCategoryId ?? lookup.categoria_id ?? '',
    quantidade: overrides.quantidade ?? packageSize,
    unidade_medida: overrides.unidade_medida ?? unit,
    imagem_url: overrides.imagem_url ?? overrides.imageUrl ?? lookup.imagem_url ?? '',
    ingredientes: overrides.ingredientes ?? overrides.ingredients ?? lookup.ingredientes ?? '',
    informacoes_nutricionais: overrides.informacoes_nutricionais ?? overrides.nutritionFacts ?? lookup.informacoes_nutricionais,
    origem_dados: overrides.origem_dados ?? overrides.dataSource ?? lookup.origem_dados,
    confianca: overrides.confianca ?? overrides.confidence ?? lookup.confianca,
    data_consulta: overrides.data_consulta ?? overrides.lastBarcodeLookupAt ?? lookup.data_consulta ?? now,
    packageType: overrides.packageType ?? 'Unidade',
    category,
    packageSize,
    unit,
    notes: overrides.notes,
    baseProductId: overrides.baseProductId ?? '',
    defaultCountingUnit: overrides.defaultCountingUnit ?? 'package',
    nutritionalTableImageUrl: overrides.nutritionalTableImageUrl,
    compositionImageUrl: overrides.compositionImageUrl,
    compositionText: overrides.compositionText ?? lookup.ingredientes,
    nutritionalData: overrides.nutritionalData,
    detectedAllergens: overrides.detectedAllergens,
    isArchived: overrides.isArchived ?? false,
    updatedAt: now,
  });
}

export class InternalProductRepository {
  constructor(private readonly db: Firestore) {}

  async findByBarcode(barcode: string): Promise<Product | null> {
    const direct = await this.db.collection('products').where('barcode', '==', barcode).limit(1).get();
    if (!direct.empty) return { id: direct.docs[0].id, ...direct.docs[0].data() } as Product;

    const normalized = await this.db.collection('products').where('codigo_barras', '==', barcode).limit(1).get();
    if (!normalized.empty) return { id: normalized.docs[0].id, ...normalized.docs[0].data() } as Product;

    return null;
  }

  async readCache(barcode: string, ttlHours: number): Promise<ProductLookupResponse | null> {
    const snap = await this.db.collection('barcodeLookupCache').doc(barcode).get();
    if (!snap.exists) return null;
    const data = snap.data() as ProductLookupResponse & { updatedAt?: string };
    const updatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
    if (!updatedAt || Date.now() - updatedAt > ttlHours * 60 * 60 * 1000) return null;
    return { ...data, cacheHit: true };
  }

  async writeCache(barcode: string, response: ProductLookupResponse) {
    await this.db.collection('barcodeLookupCache').doc(barcode).set(
      cleanUndefined({
        ...response,
        cacheHit: false,
        updatedAt: new Date().toISOString(),
      }),
      { merge: true },
    );
  }

  async logLookup(params: {
    barcode: string;
    userId: string;
    sources: ProductLookupSourceResult[];
    resultado: 'found' | 'not_found' | 'invalid' | 'error';
    erro?: string;
  }) {
    await this.db.collection('consultas_codigo_barras').add(
      cleanUndefined({
        workspaceId: WORKSPACE_ID,
        codigo_barras: params.barcode,
        usuario_id: params.userId,
        fontes_consultadas: params.sources.map((source) => source.fonte),
        resultado: params.resultado,
        erro: params.erro ?? null,
        criado_em: new Date().toISOString(),
        createdAt: FieldValue.serverTimestamp(),
      }),
    );
  }

  async saveProduct(payload: ProductSavePayload, userId: string) {
    const lookup = payload.lookupProduct;
    const productOverrides = payload.product ?? {};
    if (!lookup && !productOverrides.baseName) throw new Error('Dados do produto insuficientes.');

    const now = new Date().toISOString();
    const baseLookup: NormalizedProductData =
      lookup ?? {
        codigo_barras: productOverrides.barcode ?? productOverrides.codigo_barras ?? '',
        gtin: productOverrides.gtin ?? productOverrides.barcode ?? productOverrides.codigo_barras ?? '',
        nome: productOverrides.baseName ?? productOverrides.nome ?? '',
        marca: productOverrides.brand ?? productOverrides.marca,
        descricao: productOverrides.description ?? productOverrides.descricao,
        categoria_id: productOverrides.operationalCategoryId ?? productOverrides.categoria_id,
        quantidade: productOverrides.packageSize ?? productOverrides.quantidade,
        unidade_medida: productOverrides.unit ?? productOverrides.unidade_medida,
        imagem_url: productOverrides.imageUrl ?? productOverrides.imagem_url,
        ingredientes: productOverrides.ingredients ?? productOverrides.ingredientes,
        informacoes_nutricionais: productOverrides.nutritionFacts ?? productOverrides.informacoes_nutricionais,
        ncm: productOverrides.ncm,
        cest: productOverrides.cest,
        origem_dados: normalizeDataSource(productOverrides.dataSource ?? productOverrides.origem_dados),
        confianca: productOverrides.confidence ?? productOverrides.confianca ?? 0.4,
        data_consulta: productOverrides.lastBarcodeLookupAt ?? productOverrides.data_consulta ?? now,
        unitCategory: productOverrides.category,
      };

    const productData = productPayloadFromLookup(baseLookup, productOverrides);
    const id = productOverrides.id;
    const ref = id ? this.db.collection('products').doc(id) : this.db.collection('products').doc();

    if (id) {
      await ref.set(cleanUndefined({ ...productData, updatedAt: now, updatedBy: userId }), { merge: true });
    } else {
      await ref.set(cleanUndefined({ ...productData, createdAt: now, createdBy: userId }));
    }

    await this.saveSources(ref.id, baseLookup.codigo_barras, payload.sources ?? []);
    return { id: ref.id };
  }

  async updateProduct(id: string, product: Partial<Product>, userId: string) {
    await this.db.collection('products').doc(id).set(
      cleanUndefined({
        ...product,
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      }),
      { merge: true },
    );
    return { id };
  }

  async saveSources(productId: string, barcode: string, sources: ProductLookupSourceResult[]) {
    const batch = this.db.batch();
    for (const source of sources.filter((item) => item.dados_brutos_json || item.dados)) {
      const ref = this.db.collection('fontes_produto').doc();
      batch.set(ref, cleanUndefined({
        workspaceId: WORKSPACE_ID,
        produto_id: productId,
        product_id: productId,
        codigo_barras: barcode,
        fonte: source.fonte,
        status: source.status,
        dados_normalizados: source.dados ?? null,
        dados_brutos_json: source.dados_brutos_json ?? null,
        data_consulta: source.data_consulta,
        createdAt: FieldValue.serverTimestamp(),
      }));
    }
    await batch.commit();
  }

  static normalizedFromProduct(product: Product) {
    return ProductNormalizer.fromInternalProduct(product);
  }
}
