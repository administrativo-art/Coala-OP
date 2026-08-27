import "server-only";

import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { InternalCompanyRepository } from "@/lib/company/internal-company-repository";
import { dbAdmin } from "@/lib/firebase-admin";
import type { Entity } from "@/types";

export const ASO_CLINIC_EMAIL_MATRIX = {
  name: "CT Sorvetes LTDA",
  cnpj: "14276603000125",
  contacts: "(99) 9-8111-1119 (Tiago Brasil) ou (98) 9-8809-0880 (Cesar Thimótheo)",
} as const;

function matrixAddress(company: ReturnType<typeof InternalCompanyRepository.normalizedFromEntity>) {
  const cepDigits = company.cep.replace(/\D/g, "");
  const cep = cepDigits.length === 8
    ? `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}`
    : company.cep;
  return [
    [company.logradouro, company.numero ? `nº ${company.numero}` : ""].filter(Boolean).join(", "),
    company.complemento,
    company.bairro,
    [company.cidade, company.uf].filter(Boolean).join(" - "),
    cep ? `CEP ${cep}` : "",
  ].filter(Boolean).join(", ");
}

/**
 * Resolves the institutional company displayed in the clinic e-mail only.
 * The onboarding employer unit remains untouched and continues to drive the
 * integration, guide and employment records.
 */
export async function resolveAsoClinicEmailCompany() {
  const formattedCnpj = CnpjValidator.format(ASO_CLINIC_EMAIL_MATRIX.cnpj);
  const snapshot = await dbAdmin.collection("entities")
    .where("document", "==", formattedCnpj)
    .limit(1)
    .get();
  if (snapshot.empty) {
    throw new Error("O cadastro empresarial da matriz não foi encontrado para o envio à clínica.");
  }

  const entity = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Entity;
  const company = InternalCompanyRepository.normalizedFromEntity(entity);
  const address = matrixAddress(company);
  if (!address) {
    throw new Error("O endereço da matriz não está preenchido no cadastro empresarial.");
  }

  return {
    companyName: ASO_CLINIC_EMAIL_MATRIX.name,
    companyCnpj: formattedCnpj,
    companyAddress: address,
    companyContacts: ASO_CLINIC_EMAIL_MATRIX.contacts,
  };
}
