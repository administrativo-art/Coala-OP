import type { Entity } from '@/types';

export type CompanyDataSource = 'internal' | 'brasilapi' | 'viacep' | 'cache' | 'manual' | 'sintegra';

export type IcmsTaxpayerStatus = 'sim' | 'nao' | 'nao_informado';

export type StateRegistrationStatus =
  | 'ativa'
  | 'inativa'
  | 'suspensa'
  | 'baixada'
  | 'nao_consultada'
  | 'nao_informado';

export type NormalizedCnae = {
  codigo: string;
  descricao: string;
};

export type NormalizedCompanyData = {
  id?: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao_cadastral: string;
  data_abertura: string;
  natureza_juridica: string;
  cnae_principal_codigo: string;
  cnae_principal_descricao: string;
  cnaes_secundarios: NormalizedCnae[];
  inscricao_estadual: string;
  contribuinte_icms: IcmsTaxpayerStatus;
  situacao_inscricao_estadual: StateRegistrationStatus;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  telefone: string;
  email: string;
  tipo_empresa: string;
  origem_dados: CompanyDataSource;
  data_ultima_consulta: string;
  observacoes: string;
};

export type CompanyLookupSourceResult = {
  fonte: CompanyDataSource;
  status: 'found' | 'not_found' | 'error' | 'skipped';
  mensagem?: string;
  dados?: NormalizedCompanyData;
  dados_brutos_json?: unknown;
  data_consulta: string;
};

export type CompanyLookupAlert = {
  type: 'info' | 'warning' | 'error';
  message: string;
};

export type CompanyLookupResponse = {
  found: boolean;
  source: CompanyDataSource;
  message: string;
  company?: NormalizedCompanyData;
  entity?: Entity;
  alerts: CompanyLookupAlert[];
  sources: CompanyLookupSourceResult[];
  fromCache?: boolean;
  fromInternal?: boolean;
  canManualRegister: boolean;
};

export type CompanySavePayload = {
  company: NormalizedCompanyData;
  entity?: Partial<Entity>;
  sourceResults?: CompanyLookupSourceResult[];
};
