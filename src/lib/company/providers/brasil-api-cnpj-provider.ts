import type { CompanyLookupSourceResult } from '../company-lookup-types';
import { CnpjValidator } from '../cnpj-validator';
import { CompanyNormalizer } from '../company-normalizer';
import { fetchJsonWithTimeout } from './provider-utils';

export type BrasilApiCnpj = {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string | null;
  descricao_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  natureza_juridica?: string;
  cnae_fiscal?: number | string;
  cnae_fiscal_descricao?: string;
  cnaes_secundarios?: Array<{ codigo?: number | string; descricao?: string }>;
  descricao_tipo_de_logradouro?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  email?: string | null;
  qsa?: Array<{
    nome_socio?: string;
    qualificacao_socio?: string;
    nome_representante_legal?: string;
    qualificacao_representante_legal?: string;
  }>;
};

export class BrasilApiCnpjProvider {
  async lookup(cnpj: string): Promise<CompanyLookupSourceResult> {
    const validation = CnpjValidator.validate(cnpj);
    const data_consulta = new Date().toISOString();
    if (!validation.valid) {
      return {
        fonte: 'brasilapi',
        status: 'skipped',
        mensagem: validation.message,
        data_consulta,
      };
    }

    const url = `https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(validation.clean)}`;
    const response = await fetchJsonWithTimeout<BrasilApiCnpj>(url);
    if (response.status === 404) {
      return {
        fonte: 'brasilapi',
        status: 'not_found',
        mensagem: 'CNPJ válido, mas não encontrado nas bases consultadas.',
        data_consulta,
      };
    }

    if (!response.ok || !response.data?.cnpj) {
      return {
        fonte: 'brasilapi',
        status: 'error',
        mensagem: 'Não foi possível consultar a BrasilAPI no momento. Você pode preencher os dados manualmente.',
        dados_brutos_json: response.data ?? { error: response.error },
        data_consulta,
      };
    }

    return {
      fonte: 'brasilapi',
      status: 'found',
      mensagem: 'CNPJ encontrado. Revise os dados antes de salvar.',
      dados: CompanyNormalizer.fromBrasilApi(response.data),
      dados_brutos_json: response.data,
      data_consulta,
    };
  }
}
