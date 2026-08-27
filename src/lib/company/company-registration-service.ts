import type { Entity } from '@/types';
import type { CompanyLookupSourceResult, NormalizedCompanyData } from './company-lookup-types';
import { CnpjValidator } from './cnpj-validator';
import { CompanyNormalizer } from './company-normalizer';
import { InternalCompanyRepository } from './internal-company-repository';

export class CompanyRegistrationService {
  constructor(private readonly repository: InternalCompanyRepository) {}

  async saveConfirmedCompany(params: {
    company: NormalizedCompanyData;
    entity?: Partial<Entity>;
    sourceResults?: CompanyLookupSourceResult[];
    userId: string;
  }) {
    return this.repository.saveCompany(
      {
        company: params.company,
        entity: params.entity,
        sourceResults: params.sourceResults,
      },
      params.userId,
    );
  }

  async updateCompany(params: {
    id: string;
    entity: Partial<Entity> & Record<string, unknown>;
    userId: string;
  }) {
    return this.repository.updateCompany(params.id, params.entity, params.userId);
  }

  static normalizedCompanyFromEntityPayload(entity: Partial<Entity> & Record<string, unknown>): NormalizedCompanyData {
    const cnpj = CnpjValidator.clean(String(entity.cnpj ?? entity.document ?? ''));
    return {
      cnpj,
      razao_social: String(entity.razao_social ?? entity.name ?? ''),
      nome_fantasia: String(entity.nome_fantasia ?? entity.fantasyName ?? ''),
      situacao_cadastral: String(entity.situacao_cadastral ?? ''),
      data_abertura: String(entity.data_abertura ?? ''),
      natureza_juridica: String(entity.natureza_juridica ?? ''),
      cnae_principal_codigo: String(entity.cnae_principal_codigo ?? ''),
      cnae_principal_descricao: String(entity.cnae_principal_descricao ?? ''),
      cnaes_secundarios: Array.isArray(entity.cnaes_secundarios_json) ? entity.cnaes_secundarios_json as NormalizedCompanyData['cnaes_secundarios'] : [],
      inscricao_estadual: String(entity.inscricao_estadual ?? ''),
      contribuinte_icms: (entity.contribuinte_icms as NormalizedCompanyData['contribuinte_icms']) ?? 'nao_informado',
      situacao_inscricao_estadual: (entity.situacao_inscricao_estadual as NormalizedCompanyData['situacao_inscricao_estadual']) ?? 'nao_consultada',
      cep: String(entity.cep ?? entity.address?.zipCode ?? ''),
      logradouro: String(entity.logradouro ?? entity.address?.street ?? ''),
      numero: String(entity.numero ?? entity.address?.number ?? ''),
      complemento: String(entity.complemento ?? entity.address?.complement ?? ''),
      bairro: String(entity.bairro ?? entity.address?.neighborhood ?? ''),
      cidade: String(entity.cidade ?? entity.address?.city ?? ''),
      uf: String(entity.uf ?? entity.address?.state ?? ''),
      telefone: String(entity.telefone ?? entity.contact?.phone ?? ''),
      email: String(entity.email ?? entity.contact?.email ?? ''),
      tipo_empresa: String(entity.tipo_empresa ?? ''),
      origem_dados: (entity.origem_dados as NormalizedCompanyData['origem_dados']) ?? 'manual',
      data_ultima_consulta: String(entity.data_ultima_consulta_cnpj ?? new Date().toISOString()),
      observacoes: String(entity.observacoes ?? entity.notes ?? ''),
    };
  }

  static entityPayloadFromCompany(company: NormalizedCompanyData, entity?: Partial<Entity>) {
    return CompanyNormalizer.toEntity(company, entity);
  }
}
