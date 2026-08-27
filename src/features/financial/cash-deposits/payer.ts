import type { NormalizedCompanyData } from "@/lib/company/company-lookup-types";
import type { InterCobrancaPayer } from "@/lib/integrations/inter/config.server";

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`O cadastro do pagador Inter não informou ${label}.`);
  return normalized;
}

export function interCobrancaPayerFromCompany(company: NormalizedCompanyData): InterCobrancaPayer {
  const cpfCnpj = company.cnpj.replace(/\D/g, "");
  if (cpfCnpj.length !== 14) throw new Error("O CNPJ do pagador Inter é inválido.");
  const cep = company.cep.replace(/\D/g, "");
  if (cep.length !== 8) throw new Error("O CEP do pagador Inter é inválido.");

  return {
    cpfCnpj,
    tipoPessoa: "JURIDICA",
    nome: required(company.razao_social, "a razão social"),
    endereco: required(company.logradouro, "o logradouro"),
    numero: required(company.numero, "o número"),
    bairro: required(company.bairro, "o bairro"),
    cidade: required(company.cidade, "a cidade"),
    uf: required(company.uf, "a UF").toUpperCase(),
    cep,
    ...(company.complemento.trim() ? { complemento: company.complemento.trim() } : {}),
    ...(company.email.trim() ? { email: company.email.trim() } : {}),
  };
}
