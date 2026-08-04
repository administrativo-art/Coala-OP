import "server-only";

import { InternalCompanyRepository } from "@/lib/company/internal-company-repository";
import { dbAdmin } from "@/lib/firebase-admin";
import {
  getInterCobrancaSettings,
  interCobrancaReadiness,
  type InterCobrancaPayer,
} from "@/lib/integrations/inter/config.server";
import { interCobrancaPayerFromCompany } from "./payer";

export async function resolveConfiguredInterCobrancaPayer(): Promise<InterCobrancaPayer> {
  const { payerCnpj } = getInterCobrancaSettings();
  const repository = new InternalCompanyRepository(dbAdmin);
  const entity = await repository.findByCnpj(payerCnpj);
  if (!entity) {
    throw new Error("O CNPJ configurado como pagador do depósito não foi encontrado em Entidades.");
  }
  return interCobrancaPayerFromCompany(InternalCompanyRepository.normalizedFromEntity(entity));
}

export async function configuredInterCobrancaReadiness() {
  const readiness = interCobrancaReadiness();
  if (!readiness.ready) return readiness;
  try {
    await resolveConfiguredInterCobrancaPayer();
    return readiness;
  } catch (error) {
    return {
      ...readiness,
      ready: false,
      reason: error instanceof Error ? error.message : "Pagador institucional da Cobrança Inter inválido.",
    };
  }
}
