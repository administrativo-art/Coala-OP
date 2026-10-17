import type { NormalizedCompanyData } from "@/lib/company/company-lookup-types";
import type { InterCobrancaPayer } from "@/lib/integrations/inter/config.server";

export const INTER_COBRANCA_PAYER_MAX_LENGTHS = {
  nome: 100,
  endereco: 100,
  bairro: 60,
  cidade: 60,
  uf: 2,
  email: 50,
  numero: 10,
  complemento: 30,
} as const;

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function required(value: string, label: string, maxLength: number) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`O cadastro do pagador Inter não informou ${label}.`);
  return normalized.slice(0, maxLength);
}

function optional(value: string, maxLength: number) {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function optionalEmail(value: string) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length > INTER_COBRANCA_PAYER_MAX_LENGTHS.email) return undefined;
  return normalized;
}

export function interCobrancaPayerFromCompany(company: NormalizedCompanyData): InterCobrancaPayer {
  const cpfCnpj = company.cnpj.replace(/\D/g, "");
  if (cpfCnpj.length !== 14) throw new Error("O CNPJ do pagador Inter é inválido.");
  const cep = company.cep.replace(/\D/g, "");
  if (cep.length !== 8) throw new Error("O CEP do pagador Inter é inválido.");
  const complemento = optional(company.complemento, INTER_COBRANCA_PAYER_MAX_LENGTHS.complemento);
  const email = optionalEmail(company.email);

  return {
    cpfCnpj,
    tipoPessoa: "JURIDICA",
    nome: required(company.razao_social, "a razão social", INTER_COBRANCA_PAYER_MAX_LENGTHS.nome),
    endereco: required(company.logradouro, "o logradouro", INTER_COBRANCA_PAYER_MAX_LENGTHS.endereco),
    numero: required(company.numero, "o número", INTER_COBRANCA_PAYER_MAX_LENGTHS.numero),
    bairro: required(company.bairro, "o bairro", INTER_COBRANCA_PAYER_MAX_LENGTHS.bairro),
    cidade: required(company.cidade, "a cidade", INTER_COBRANCA_PAYER_MAX_LENGTHS.cidade),
    uf: required(company.uf, "a UF", INTER_COBRANCA_PAYER_MAX_LENGTHS.uf).toUpperCase(),
    cep,
    ...(complemento ? { complemento } : {}),
    ...(email ? { email } : {}),
  };
}
