import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CompanyNormalizer } from '../../../src/lib/company/company-normalizer';
import { CnpjValidator } from '../../../src/lib/company/cnpj-validator';
import type { BrasilApiCnpj } from '../../../src/lib/company/providers/brasil-api-cnpj-provider';
import type { ViaCepAddress } from '../../../src/lib/company/providers/via-cep-provider';

test('valida e formata CNPJ', () => {
  const valid = CnpjValidator.validate('64.433.090/0001-97');
  assert.equal(valid.valid, true);
  assert.equal(valid.clean, '64433090000197');
  assert.equal(valid.formatted, '64.433.090/0001-97');

  const invalid = CnpjValidator.validate('11.111.111/1111-11');
  assert.equal(invalid.valid, false);
  assert.equal(invalid.message, 'CNPJ inválido. Verifique os números informados.');
});

test('normaliza dados de empresa e mescla endereço do ViaCEP', () => {
  const brasilApiFixture: BrasilApiCnpj = {
    cnpj: '64433090000197',
    razao_social: 'GAP INDUSTRIA GRAFICA LTDA',
    nome_fantasia: 'NATUCOPOS EXPRESS',
    descricao_situacao_cadastral: 'ATIVA',
    data_inicio_atividade: '2024-01-01',
    natureza_juridica: '206-2 - Sociedade Empresária Limitada',
    cnae_fiscal: 1813001,
    cnae_fiscal_descricao: 'Impressão de material para uso publicitário',
    cep: '72546036',
    logradouro: 'Rua Ione Inácio de Brito',
    numero: 'LT 15',
    bairro: 'Riacho Fundo I',
    municipio: 'Brasília',
    uf: 'DF',
    ddd_telefone_1: '6133551591',
    email: 'fiscal@exemplo.com',
  };

  const company = CompanyNormalizer.fromBrasilApi(brasilApiFixture);
  assert.equal(company.cnpj, '64433090000197');
  assert.equal(company.razao_social, 'GAP INDUSTRIA GRAFICA LTDA');
  assert.equal(company.nome_fantasia, 'NATUCOPOS EXPRESS');
  assert.equal(company.cep, '72.546-036');
  assert.equal(company.cnae_principal_codigo, '1813001');

  const viaCepFixture: ViaCepAddress = {
    cep: '72546-036',
    logradouro: 'Rua Ione Inácio de Brito',
    bairro: 'Riacho Fundo I',
    localidade: 'Brasília',
    uf: 'DF',
  };

  const merged = CompanyNormalizer.mergeAddressWithViaCep(company, CompanyNormalizer.fromViaCep(viaCepFixture));
  assert.equal(merged.company.cidade, 'Brasília');
  assert.equal(merged.company.uf, 'DF');
});
