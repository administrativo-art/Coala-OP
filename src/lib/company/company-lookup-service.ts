import type { CompanyLookupAlert, CompanyLookupResponse, CompanyLookupSourceResult, NormalizedCompanyData } from './company-lookup-types';
import { CnpjValidator } from './cnpj-validator';
import { CompanyNormalizer } from './company-normalizer';
import { InternalCompanyRepository } from './internal-company-repository';
import { BrasilApiCnpjProvider } from './providers/brasil-api-cnpj-provider';
import { ViaCepProvider } from './providers/via-cep-provider';
import { UnconfiguredSintegraProvider } from './providers/sintegra-provider';

function situationAlert(company?: NormalizedCompanyData): CompanyLookupAlert[] {
  const situation = company?.situacao_cadastral ?? '';
  if (/baixad|inapt|suspens/i.test(situation)) {
    return [{ type: 'warning', message: 'A situação cadastral desta empresa exige atenção antes do cadastro.' }];
  }
  return [];
}

function notFoundResponse(cnpj: string, sources: CompanyLookupSourceResult[], message: string): CompanyLookupResponse {
  return {
    found: false,
    source: 'manual',
    message,
    company: {
      cnpj,
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
    },
    alerts: [{ type: 'info', message }],
    sources,
    canManualRegister: true,
  };
}

export class CompanyLookupService {
  constructor(
    private readonly repository: InternalCompanyRepository,
    private readonly brasilApiProvider = new BrasilApiCnpjProvider(),
    private readonly viaCepProvider = new ViaCepProvider(),
    private readonly sintegraProvider = new UnconfiguredSintegraProvider(),
  ) {}

  async lookup(rawCnpj: string, userId: string, options: { forceExternal?: boolean; skipInternal?: boolean } = {}): Promise<CompanyLookupResponse> {
    const validation = CnpjValidator.validate(rawCnpj);
    if (!validation.valid) {
      await this.repository.logLookup({
        cnpj: validation.clean || rawCnpj,
        userId,
        sources: [],
        resultado: 'invalid',
        erro: validation.message,
      });

      return {
        found: false,
        source: 'manual',
        message: validation.message ?? 'CNPJ inválido. Verifique os números informados.',
        alerts: [{ type: 'error', message: validation.message ?? 'CNPJ inválido. Verifique os números informados.' }],
        sources: [],
        canManualRegister: false,
      };
    }

    const cnpj = validation.clean;
    if (!options.skipInternal && !options.forceExternal) {
      const existing = await this.repository.findByCnpj(cnpj);
      if (existing) {
        const company = InternalCompanyRepository.normalizedFromEntity(existing);
        const source: CompanyLookupSourceResult = {
          fonte: 'internal',
          status: 'found',
          mensagem: 'Empresa já cadastrada. Dados carregados da base interna.',
          dados: company,
          data_consulta: new Date().toISOString(),
        };
        const response: CompanyLookupResponse = {
          found: true,
          source: 'internal',
          message: 'Empresa já cadastrada. Dados carregados da base interna.',
          company,
          entity: existing,
          alerts: [{ type: 'info', message: 'Empresa já cadastrada. Dados carregados da base interna.' }, ...situationAlert(company)],
          sources: [source],
          fromInternal: true,
          canManualRegister: false,
        };
        await this.repository.logLookup({ cnpj, userId, sources: response.sources, resultado: 'found' });
        return response;
      }

      const cacheTtlHours = Number(process.env.CNPJ_LOOKUP_CACHE_TTL_HOURS ?? 24);
      const cached = await this.repository.readCache(cnpj, cacheTtlHours);
      if (cached) {
        await this.repository.logLookup({
          cnpj,
          userId,
          sources: cached.sources,
          resultado: cached.found ? 'found' : 'not_found',
        });
        return {
          ...cached,
          fromCache: true,
          alerts: cached.alerts?.length ? cached.alerts : [{ type: 'info', message: cached.message }],
        };
      }
    }

    const sources: CompanyLookupSourceResult[] = [];
    const brasilApi = await this.brasilApiProvider.lookup(cnpj);
    sources.push(brasilApi);
    if (brasilApi.status === 'error') {
      console.error('[CompanyLookupService] BrasilAPI error', brasilApi.mensagem, brasilApi.dados_brutos_json);
    }

    if (brasilApi.status !== 'found' || !brasilApi.dados) {
      const message = brasilApi.status === 'error'
        ? 'Não foi possível consultar a BrasilAPI no momento. Você pode preencher os dados manualmente.'
        : 'CNPJ válido, mas não encontrado nas bases consultadas.';
      const response = notFoundResponse(cnpj, sources, message);
      await this.repository.writeCache(cnpj, response);
      await this.repository.logLookup({
        cnpj,
        userId,
        sources,
        resultado: brasilApi.status === 'error' ? 'error' : 'not_found',
        erro: brasilApi.status === 'error' ? brasilApi.mensagem : undefined,
      });
      return response;
    }

    let company = brasilApi.dados;
    const alerts: CompanyLookupAlert[] = [];
    const viaCep = company.cep ? await this.viaCepProvider.lookup(company.cep) : await this.viaCepProvider.lookup('');
    sources.push(viaCep);

    if (viaCep.status === 'found' && viaCep.dados) {
      const merged = CompanyNormalizer.mergeAddressWithViaCep(company, viaCep.dados);
      company = merged.company;
      if (merged.conflicts.length > 0) {
        alerts.push({
          type: 'warning',
          message: 'Endereco da BrasilAPI diverge do ViaCEP. Os dados da BrasilAPI foram mantidos para revisão manual.',
        });
      }
    } else if (viaCep.status === 'not_found' || viaCep.status === 'error') {
      alerts.push({ type: 'warning', message: viaCep.mensagem ?? 'Revise o endereço manualmente.' });
      if (viaCep.status === 'error') console.error('[CompanyLookupService] ViaCEP error', viaCep.mensagem, viaCep.dados_brutos_json);
    }

    sources.push(await this.sintegraProvider.lookup({ cnpj, uf: company.uf }));
    alerts.push(...situationAlert(company));

    const response: CompanyLookupResponse = {
      found: true,
      source: 'brasilapi',
      message: 'CNPJ encontrado. Revise os dados antes de salvar.',
      company,
      alerts,
      sources,
      canManualRegister: true,
    };

    await this.repository.writeCache(cnpj, response);
    await this.repository.logLookup({ cnpj, userId, sources, resultado: 'found' });
    return response;
  }
}
