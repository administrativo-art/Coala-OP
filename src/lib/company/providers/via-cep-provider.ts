import type { CompanyLookupSourceResult } from '../company-lookup-types';
import { CompanyNormalizer } from '../company-normalizer';
import { fetchJsonWithTimeout } from './provider-utils';

export type ViaCepAddress = {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  estado?: string;
  ibge?: string;
  gia?: string;
  ddd?: string;
  siafi?: string;
  erro?: boolean;
};

function cleanCep(value?: string) {
  return String(value ?? '').replace(/\D/g, '');
}

export class ViaCepProvider {
  async lookup(cep: string): Promise<CompanyLookupSourceResult> {
    const clean = cleanCep(cep);
    const data_consulta = new Date().toISOString();
    if (clean.length !== 8) {
      return {
        fonte: 'viacep',
        status: 'skipped',
        mensagem: 'CEP inválido para consulta no ViaCEP.',
        data_consulta,
      };
    }

    const response = await fetchJsonWithTimeout<ViaCepAddress>(`https://viacep.com.br/ws/${clean}/json/`);
    if (response.status === 400) {
      return {
        fonte: 'viacep',
        status: 'error',
        mensagem: 'CEP inválido para consulta no ViaCEP.',
        dados_brutos_json: response.data ?? { error: response.error },
        data_consulta,
      };
    }

    if (!response.ok || !response.data) {
      return {
        fonte: 'viacep',
        status: 'error',
        mensagem: 'ViaCEP indisponível. Revise o endereço manualmente.',
        dados_brutos_json: response.data ?? { error: response.error },
        data_consulta,
      };
    }

    if (response.data.erro) {
      return {
        fonte: 'viacep',
        status: 'not_found',
        mensagem: 'CEP não encontrado no ViaCEP. Revise o endereço manualmente.',
        dados_brutos_json: response.data,
        data_consulta,
      };
    }

    return {
      fonte: 'viacep',
      status: 'found',
      mensagem: 'Endereço validado pelo ViaCEP.',
      dados: CompanyNormalizer.fromViaCep(response.data),
      dados_brutos_json: response.data,
      data_consulta,
    };
  }
}
