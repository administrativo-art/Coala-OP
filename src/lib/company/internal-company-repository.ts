import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { Entity } from '@/types';
import { WORKSPACE_ID } from '@/lib/workspace';
import type { CompanyLookupResponse, CompanyLookupSourceResult, CompanySavePayload, NormalizedCompanyData } from './company-lookup-types';
import { CnpjValidator } from './cnpj-validator';
import { CompanyNormalizer } from './company-normalizer';

function cleanUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(cleanUndefined) as T;
  }

  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue;
    clone[key] = cleanUndefined(entry);
  }
  return clone as T;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export class InternalCompanyRepository {
  constructor(private readonly db: Firestore) {}

  async findByCnpj(rawCnpj: string): Promise<Entity | null> {
    const validation = CnpjValidator.validate(rawCnpj);
    const clean = validation.clean || CnpjValidator.clean(rawCnpj);
    const formatted = clean.length === 14 ? CnpjValidator.format(clean) : rawCnpj;
    const candidates = unique([clean, formatted, rawCnpj]);

    for (const field of ['cnpj', 'document'] as const) {
      for (const value of candidates) {
        const snap = await this.db.collection('entities').where(field, '==', value).limit(1).get();
        if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() } as Entity;
      }
    }

    return null;
  }

  async readCache(cnpj: string, ttlHours: number): Promise<CompanyLookupResponse | null> {
    const clean = CnpjValidator.clean(cnpj);
    const snap = await this.db.collection('cnpjLookupCache').doc(clean).get();
    if (!snap.exists) return null;
    const data = snap.data() as CompanyLookupResponse & { updatedAt?: string };
    const updatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
    if (!updatedAt || Date.now() - updatedAt > ttlHours * 60 * 60 * 1000) return null;
    return { ...data, fromCache: true, source: data.source === 'internal' ? 'internal' : 'cache' };
  }

  async writeCache(cnpj: string, response: CompanyLookupResponse) {
    await this.db.collection('cnpjLookupCache').doc(CnpjValidator.clean(cnpj)).set(
      cleanUndefined({
        ...response,
        fromCache: false,
        updatedAt: new Date().toISOString(),
      }),
      { merge: true },
    );
  }

  async logLookup(params: {
    cnpj: string;
    userId: string;
    sources: CompanyLookupSourceResult[];
    resultado: 'found' | 'not_found' | 'invalid' | 'error';
    erro?: string;
  }) {
    await this.db.collection('consultas_cnpj').add(
      cleanUndefined({
        workspaceId: WORKSPACE_ID,
        cnpj: CnpjValidator.clean(params.cnpj),
        usuario_id: params.userId,
        fonte_consultada: params.sources.map((source) => source.fonte).join(','),
        fontes_consultadas: params.sources.map((source) => source.fonte),
        resultado: params.resultado,
        erro: params.erro ?? null,
        dados_brutos_json: params.sources.map((source) => ({
          fonte: source.fonte,
          status: source.status,
          dados_brutos_json: source.dados_brutos_json ?? null,
          mensagem: source.mensagem ?? null,
        })),
        criado_em: new Date().toISOString(),
        createdAt: FieldValue.serverTimestamp(),
      }),
    );
  }

  async saveCompany(payload: CompanySavePayload, userId: string) {
    const validation = CnpjValidator.validate(payload.company.cnpj);
    if (!validation.valid) throw new Error(validation.message ?? 'CNPJ inválido. Verifique os números informados.');

    const existing = await this.findByCnpj(validation.clean);
    const targetId = payload.entity?.id ?? payload.company.id;
    if (existing && existing.id !== targetId) {
      throw new Error('Empresa já cadastrada. Dados carregados da base interna.');
    }

    const now = new Date().toISOString();
    const entityData = CompanyNormalizer.toEntity(
      {
        ...payload.company,
        cnpj: validation.clean,
        data_ultima_consulta: payload.company.data_ultima_consulta || now,
      },
      payload.entity ?? {},
    );

    const ref = targetId
      ? this.db.collection('entities').doc(targetId)
      : this.db.collection('entities').doc();

    if (targetId) {
      await ref.set(cleanUndefined({ ...entityData, updatedAt: now, updatedBy: userId }), { merge: true });
    } else {
      await ref.set(cleanUndefined({ ...entityData, workspaceId: WORKSPACE_ID, createdAt: now, createdBy: userId }));
    }

    await this.saveSources(ref.id, validation.clean, payload.sourceResults ?? []);
    return { id: ref.id };
  }

  async updateCompany(id: string, entity: Partial<Entity> & Record<string, unknown>, userId: string) {
    const rawCnpj = String(entity.cnpj ?? entity.document ?? '');
    if (rawCnpj) {
      const validation = CnpjValidator.validate(rawCnpj);
      if (!validation.valid) throw new Error(validation.message ?? 'CNPJ inválido. Verifique os números informados.');

      const existing = await this.findByCnpj(validation.clean);
      if (existing && existing.id !== id) {
        throw new Error('Empresa já cadastrada. Dados carregados da base interna.');
      }

      entity.cnpj = validation.clean;
      entity.document = CnpjValidator.format(validation.clean);
    }

    await this.db.collection('entities').doc(id).set(
      cleanUndefined({
        ...entity,
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      }),
      { merge: true },
    );
    return { id };
  }

  async saveSources(entityId: string, cnpj: string, sources: CompanyLookupSourceResult[]) {
    const relevantSources = sources.filter((source) => source.dados || source.dados_brutos_json);
    if (relevantSources.length === 0) return;

    const batch = this.db.batch();
    for (const source of relevantSources) {
      const ref = this.db.collection('fontes_empresa').doc();
      batch.set(ref, cleanUndefined({
        workspaceId: WORKSPACE_ID,
        empresa_id: entityId,
        entity_id: entityId,
        cnpj: CnpjValidator.clean(cnpj),
        fonte: source.fonte,
        status: source.status,
        mensagem: source.mensagem ?? null,
        dados_normalizados: source.dados ?? null,
        dados_brutos_json: source.dados_brutos_json ?? null,
        data_consulta: source.data_consulta,
        createdAt: FieldValue.serverTimestamp(),
      }));
    }
    await batch.commit();
  }

  async getConsultationHistoryByEntityId(entityId: string) {
    const entitySnap = await this.db.collection('entities').doc(entityId).get();
    if (!entitySnap.exists) return [];

    const entity = { id: entitySnap.id, ...entitySnap.data() } as Entity;
    const cnpj = CnpjValidator.clean(String((entity as Entity & { cnpj?: string }).cnpj ?? entity.document ?? ''));
    if (!cnpj) return [];

    const snap = await this.db.collection('consultas_cnpj').where('cnpj', '==', cnpj).limit(100).get();
    return snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => String((b as { criado_em?: string }).criado_em ?? '').localeCompare(String((a as { criado_em?: string }).criado_em ?? '')));
  }

  static normalizedFromEntity(entity: Entity): NormalizedCompanyData {
    return CompanyNormalizer.fromEntity(entity);
  }
}
