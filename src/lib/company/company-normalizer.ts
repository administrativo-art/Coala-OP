import type { Entity } from '@/types';
import type { BrasilApiCnpj } from './providers/brasil-api-cnpj-provider';
import type { ViaCepAddress } from './providers/via-cep-provider';
import type { NormalizedCompanyData, NormalizedCnae } from './company-lookup-types';
import { CnpjValidator } from './cnpj-validator';

function onlyDigits(value?: string | null) {
  return String(value ?? '').replace(/\D/g, '');
}

function cleanText(value?: string | number | null) {
  return String(value ?? '').trim();
}

function cleanEmail(value?: string | null) {
  const valueText = cleanText(value);
  return valueText.includes('@') ? valueText.toLowerCase() : '';
}

function formatCep(value?: string | null) {
  const digits = onlyDigits(value);
  if (digits.length !== 8) return cleanText(value);
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}-${digits.slice(5)}`;
}

function formatPhone(value?: string | null) {
  const digits = onlyDigits(value);
  if (!digits || /^0+$/.test(digits)) return '';
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return cleanText(value);
}

function composeStreet(type?: string, street?: string) {
  const parts = [cleanText(type), cleanText(street)].filter(Boolean);
  return parts.join(' ');
}

function normalizeCnae(cnae?: { codigo?: string | number; descricao?: string }): NormalizedCnae | null {
  const codigo = cleanText(cnae?.codigo);
  const descricao = cleanText(cnae?.descricao);
  if (!codigo && !descricao) return null;
  return { codigo, descricao };
}

function emptyCompany(): NormalizedCompanyData {
  return {
    cnpj: '',
    razao_social: '',
    nome_fantasia: '',
    situacao_cadastral: '',
    data_abertura: '',
    natureza_juridica: '',
    cnae_principal_codigo: '',
    cnae_principal_descricao: '',
    cnaes_secundarios: [],
    inscricao_estadual: '',
    contribuinte_icms: 'nao_informado',
    situacao_inscricao_estadual: 'nao_consultada',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    telefone: '',
    email: '',
    tipo_empresa: '',
    origem_dados: 'manual',
    data_ultima_consulta: new Date().toISOString(),
    observacoes: '',
  };
}

export class CompanyNormalizer {
  static fromBrasilApi(data: BrasilApiCnpj): NormalizedCompanyData {
    const company = emptyCompany();
    const primaryCnae = normalizeCnae({
      codigo: data.cnae_fiscal,
      descricao: data.cnae_fiscal_descricao,
    });

    return {
      ...company,
      cnpj: CnpjValidator.clean(data.cnpj ?? ''),
      razao_social: cleanText(data.razao_social),
      nome_fantasia: cleanText(data.nome_fantasia),
      situacao_cadastral: cleanText(data.descricao_situacao_cadastral),
      data_abertura: cleanText(data.data_inicio_atividade),
      natureza_juridica: cleanText(data.natureza_juridica),
      cnae_principal_codigo: primaryCnae?.codigo ?? '',
      cnae_principal_descricao: primaryCnae?.descricao ?? '',
      cnaes_secundarios: (data.cnaes_secundarios ?? [])
        .map(normalizeCnae)
        .filter((item): item is NormalizedCnae => Boolean(item)),
      cep: formatCep(data.cep),
      logradouro: composeStreet(data.descricao_tipo_de_logradouro, data.logradouro),
      numero: cleanText(data.numero),
      complemento: cleanText(data.complemento),
      bairro: cleanText(data.bairro),
      cidade: cleanText(data.municipio),
      uf: cleanText(data.uf).toUpperCase(),
      telefone: formatPhone(data.ddd_telefone_1 || data.ddd_telefone_2),
      email: cleanEmail(data.email),
      origem_dados: 'brasilapi',
      data_ultima_consulta: new Date().toISOString(),
    };
  }

  static fromViaCep(data: ViaCepAddress): NormalizedCompanyData {
    return {
      ...emptyCompany(),
      cep: formatCep(data.cep),
      logradouro: cleanText(data.logradouro),
      complemento: cleanText(data.complemento),
      bairro: cleanText(data.bairro),
      cidade: cleanText(data.localidade),
      uf: cleanText(data.uf).toUpperCase(),
      origem_dados: 'viacep',
      data_ultima_consulta: new Date().toISOString(),
    };
  }

  static mergeAddressWithViaCep(company: NormalizedCompanyData, viaCep?: NormalizedCompanyData) {
    if (!viaCep) return { company, conflicts: [] as string[] };

    const conflicts: string[] = [];
    const conflictFields: Array<keyof Pick<NormalizedCompanyData, 'logradouro' | 'bairro' | 'cidade' | 'uf'>> = [
      'logradouro',
      'bairro',
      'cidade',
      'uf',
    ];

    for (const field of conflictFields) {
      const external = String(company[field] ?? '').trim().toUpperCase();
      const viaCepValue = String(viaCep[field] ?? '').trim().toUpperCase();
      if (external && viaCepValue && external !== viaCepValue) {
        conflicts.push(field);
      }
    }

    return {
      company: {
        ...company,
        cep: company.cep || viaCep.cep,
        logradouro: company.logradouro || viaCep.logradouro,
        bairro: company.bairro || viaCep.bairro,
        cidade: company.cidade || viaCep.cidade,
        uf: company.uf || viaCep.uf,
      },
      conflicts,
    };
  }

  static fromEntity(entity: Entity): NormalizedCompanyData {
    const record = entity as Entity & Record<string, unknown>;
    return {
      ...emptyCompany(),
      id: entity.id,
      cnpj: CnpjValidator.clean(String(record.cnpj ?? entity.document ?? '')),
      razao_social: String(record.razao_social ?? entity.name ?? ''),
      nome_fantasia: String(record.nome_fantasia ?? entity.fantasyName ?? ''),
      situacao_cadastral: String(record.situacao_cadastral ?? (entity.status === 'inactive' ? 'INATIVA' : 'ATIVA')),
      data_abertura: String(record.data_abertura ?? ''),
      natureza_juridica: String(record.natureza_juridica ?? ''),
      cnae_principal_codigo: String(record.cnae_principal_codigo ?? ''),
      cnae_principal_descricao: String(record.cnae_principal_descricao ?? ''),
      cnaes_secundarios: Array.isArray(record.cnaes_secundarios_json)
        ? (record.cnaes_secundarios_json as NormalizedCnae[])
        : [],
      inscricao_estadual: String(record.inscricao_estadual ?? ''),
      contribuinte_icms: (record.contribuinte_icms as NormalizedCompanyData['contribuinte_icms']) ?? 'nao_informado',
      situacao_inscricao_estadual: (record.situacao_inscricao_estadual as NormalizedCompanyData['situacao_inscricao_estadual']) ?? 'nao_consultada',
      cep: entity.address?.zipCode ?? '',
      logradouro: entity.address?.street ?? '',
      numero: entity.address?.number ?? '',
      complemento: entity.address?.complement ?? '',
      bairro: entity.address?.neighborhood ?? '',
      cidade: entity.address?.city ?? '',
      uf: entity.address?.state ?? '',
      telefone: entity.contact?.phone ?? '',
      email: entity.contact?.email ?? '',
      tipo_empresa: String(record.tipo_empresa ?? ''),
      origem_dados: (record.origem_dados as NormalizedCompanyData['origem_dados']) ?? 'internal',
      data_ultima_consulta: String(record.data_ultima_consulta_cnpj ?? ''),
      observacoes: entity.notes ?? String(record.observacoes ?? ''),
    };
  }

  static toEntity(company: NormalizedCompanyData, overrides: Partial<Entity> = {}): Omit<Entity, 'id'> & Record<string, unknown> {
    const formattedCnpj = CnpjValidator.format(company.cnpj);
    return {
      type: 'pessoa_juridica',
      name: company.razao_social,
      fantasyName: company.nome_fantasia,
      nickname: overrides.nickname ?? company.nome_fantasia,
      document: formattedCnpj,
      cnpj: company.cnpj,
      razao_social: company.razao_social,
      nome_fantasia: company.nome_fantasia,
      situacao_cadastral: company.situacao_cadastral,
      data_abertura: company.data_abertura,
      natureza_juridica: company.natureza_juridica,
      cnae_principal_codigo: company.cnae_principal_codigo,
      cnae_principal_descricao: company.cnae_principal_descricao,
      cnaes_secundarios_json: company.cnaes_secundarios,
      inscricao_estadual: company.inscricao_estadual,
      contribuinte_icms: company.contribuinte_icms,
      situacao_inscricao_estadual: company.situacao_inscricao_estadual,
      cep: company.cep,
      logradouro: company.logradouro,
      numero: company.numero,
      complemento: company.complemento,
      bairro: company.bairro,
      cidade: company.cidade,
      uf: company.uf,
      telefone: company.telefone,
      email: company.email,
      tipo_empresa: company.tipo_empresa,
      origem_dados: company.origem_dados,
      data_ultima_consulta_cnpj: company.data_ultima_consulta,
      observacoes: company.observacoes,
      address: {
        street: company.logradouro,
        number: company.numero,
        complement: company.complemento,
        neighborhood: company.bairro,
        city: company.cidade,
        state: company.uf,
        zipCode: company.cep,
      },
      contact: {
        phone: company.telefone,
        email: company.email,
      },
      responsible: overrides.responsible ?? '',
      status: /baixada|inapta|suspensa|inativa/i.test(company.situacao_cadastral) ? 'inactive' : 'active',
      notes: company.observacoes,
      imageUrl: overrides.imageUrl ?? '',
      ...overrides,
    };
  }
}
