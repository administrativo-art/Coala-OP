import "server-only";

import { InternalCompanyRepository } from "@/lib/company/internal-company-repository";
import { dbAdmin } from "@/lib/firebase-admin";

export type DocumentLegalEntitySnapshot = {
  entityId: string | null;
  legalName: string;
  tradeName: string;
  cnpj: string;
  address: string;
  capturedAt: string;
};

function joinedAddress(company: {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}) {
  return [
    [company.logradouro, company.numero].filter(Boolean).join(", "),
    company.complemento,
    company.bairro,
    [company.cidade, company.uf].filter(Boolean).join("/"),
    company.cep ? `CEP ${company.cep}` : "",
  ].filter(Boolean).join(", ");
}

export async function resolveDocumentLegalEntitySnapshot(params: {
  cnpj: unknown;
  fallbackName: unknown;
  fallbackAddress: unknown;
}): Promise<DocumentLegalEntitySnapshot> {
  const cnpj = String(params.cnpj ?? "").replace(/\D/g, "");
  const fallback: DocumentLegalEntitySnapshot = {
    entityId: null,
    legalName: String(params.fallbackName ?? ""),
    tradeName: "",
    cnpj,
    address: String(params.fallbackAddress ?? ""),
    capturedAt: new Date().toISOString(),
  };
  if (cnpj.length !== 14) return fallback;
  const repository = new InternalCompanyRepository(dbAdmin);
  const entity = await repository.findByCnpj(cnpj);
  if (!entity) return fallback;
  const company = InternalCompanyRepository.normalizedFromEntity(entity);
  return {
    entityId: entity.id,
    legalName: company.razao_social || fallback.legalName,
    tradeName: company.nome_fantasia,
    cnpj: company.cnpj || cnpj,
    address: joinedAddress(company) || fallback.address,
    capturedAt: new Date().toISOString(),
  };
}
