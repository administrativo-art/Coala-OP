import type { CompanyLookupSourceResult } from '../company-lookup-types';

export type SintegraLookupInput = {
  cnpj: string;
  uf?: string;
};

export interface SintegraProvider {
  lookup(input: SintegraLookupInput): Promise<CompanyLookupSourceResult>;
}

export class UnconfiguredSintegraProvider implements SintegraProvider {
  async lookup(_input: SintegraLookupInput): Promise<CompanyLookupSourceResult> {
    return {
      fonte: 'sintegra',
      status: 'skipped',
      mensagem: 'Integração Sintegra não configurada nesta versão.',
      data_consulta: new Date().toISOString(),
    };
  }
}
