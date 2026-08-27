import "server-only";

import { InternalCompanyRepository } from "@/lib/company/internal-company-repository";
import { dbAdmin } from "@/lib/firebase-admin";
import {
  getInterCobrancaSettings,
  interCobrancaReadiness,
  type InterCobrancaPayer,
} from "@/lib/integrations/inter/config.server";
import { todayInClosureTimezone } from "../cash-closures/date";
import { addBusinessDays } from "./inter-cobranca";
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
    const [payer, settings] = await Promise.all([
      resolveConfiguredInterCobrancaPayer(),
      Promise.resolve(getInterCobrancaSettings()),
    ]);
    const today = todayInClosureTimezone();
    return {
      ...readiness,
      payer: { name: payer.nome, cpfCnpj: payer.cpfCnpj },
      issueSettings: {
        dueBusinessDays: settings.dueBusinessDays,
        suggestedDueDates: {
          1: addBusinessDays(today, 1, settings.holidays),
          2: addBusinessDays(today, 2, settings.holidays),
        },
      },
    };
  } catch (error) {
    return {
      ...readiness,
      ready: false,
      reason: error instanceof Error ? error.message : "Pagador institucional da Cobrança Inter inválido.",
    };
  }
}
