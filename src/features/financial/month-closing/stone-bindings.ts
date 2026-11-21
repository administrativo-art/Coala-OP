import type { FinancialAgentMapping } from "@/features/financial/agent/contracts";

/** Um vínculo Stone (unidade × StoneCode) com a vigência em que vale. */
export type StoneBinding = { id: string; kioskId: string; stoneCode: string; validFrom: string; validTo: string | null };

/**
 * Mesma elegibilidade da resolução por data usada nas telas de Vendas e Taxas (`resolveFinancialAgentMapping`):
 * vale o vínculo ativo **ou** o já encerrado que tem data de fim, nunca o por terminal.
 */
const eligible = (mapping: FinancialAgentMapping) => mapping.terminalIds.length === 0 && (mapping.status === "active" || !!mapping.validTo);

const bindingsOf = (mapping: FinancialAgentMapping): StoneBinding[] => mapping.stoneCodes.map((stoneCode) => ({
  id: mapping.id, kioskId: mapping.kioskId, stoneCode, validFrom: mapping.validFrom, validTo: mapping.validTo ?? null,
}));

const coversDay = (mapping: FinancialAgentMapping, day: string) => mapping.validFrom <= day && (!mapping.validTo || mapping.validTo >= day);

/** Vendas: todo vínculo elegível que vale em algum dia da competência; cada um responde pelos seus dias. */
export function salesBindings(mappings: FinancialAgentMapping[], from: string, through: string): StoneBinding[] {
  return mappings
    .filter((mapping) => eligible(mapping) && mapping.validFrom <= through && (!mapping.validTo || mapping.validTo >= from))
    .flatMap(bindingsOf);
}

/**
 * Taxas: a conferência Stone do mês é única por StoneCode e fica ligada ao vínculo vigente na data de referência
 * (o último dia do mês ou o último dia publicado). Vínculos concorrentes para o mesmo StoneCode são ambíguos e
 * falham fechado, como na tela de Taxas.
 */
export function feeBindings(mappings: FinancialAgentMapping[], referenceDay: string): StoneBinding[] {
  const byCode = new Map<string, StoneBinding[]>();
  for (const mapping of mappings.filter((entry) => eligible(entry) && coversDay(entry, referenceDay))) {
    for (const binding of bindingsOf(mapping)) byCode.set(binding.stoneCode, [...(byCode.get(binding.stoneCode) ?? []), binding]);
  }
  return [...byCode.values()].map((entries) => {
    if (entries.length > 1) throw new Error(`O StoneCode ${entries[0].stoneCode} tem vínculos concorrentes em ${referenceDay}.`);
    return entries[0];
  });
}
