import { AppError } from "@/lib/observability/app-error";
import { financialAgentMappingSchema, type FinancialAgentRequest } from "./contracts";

export const MAX_AGENT_MAPPINGS = 100;
function blocked(code: string, safeMessage: string): never {
  throw new AppError({ code, kind: "EXPECTED_BUSINESS", safeMessage });
}

/** Resolve by payment date, never by name, amount or inferred merchant identity. */
export function resolveFinancialAgentMapping(documents: unknown[],
  request: FinancialAgentRequest, workspaceId: string) {
  if (documents.length > MAX_AGENT_MAPPINGS) {
    blocked("FINANCIAL_AGENT_MAPPING_LIMIT", "Vínculos Stone excedem o limite da consulta; revise o cadastro.");
  }
  const parsed = documents.map(document => financialAgentMappingSchema.safeParse(document));
  if (parsed.some(result => !result.success)) {
    blocked("FINANCIAL_AGENT_MAPPING_INVALID", "Existe um vínculo Stone incompleto ou inválido. Revise o cadastro oficial.");
  }
  const mappings = parsed.flatMap(result => result.success ? [result.data] : []);
  // The repository filters these fields; fail closed if its contract is violated.
  if (mappings.some(mapping => mapping.workspaceId !== workspaceId || !mapping.stoneCodes.includes(request.stoneCode))) {
    blocked("FINANCIAL_AGENT_MAPPING_SCOPE", "Os vínculos não correspondem ao escopo autorizado.");
  }
  const eligible = mappings.filter(mapping => mapping.validFrom <= request.referenceDate &&
    (!mapping.validTo || mapping.validTo >= request.referenceDate) &&
    (mapping.status === "active" || !!mapping.validTo));
  // Terminal partitions cannot be attributed from the current merchant-wide reader.
  if (eligible.length > 1 || eligible.some(mapping => mapping.terminalIds.length > 0)) {
    blocked("FINANCIAL_AGENT_MAPPING_AMBIGUOUS", "O StoneCode tem vínculos concorrentes ou por terminal. A leitura por unidade exige vínculo inequívoco.");
  }
  const mapping = eligible[0];
  if (!mapping || mapping.kioskId !== request.kioskId) {
    blocked("FINANCIAL_AGENT_MAPPING_REQUIRED", "Cadastre ou confirme o vínculo oficial entre unidade, StoneCode e conta para a data consultada.");
  }
  return mapping;
}

export function validateFinancialAgentReferences(kiosk: unknown, account: unknown, workspaceId: string) {
  const valid = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  // Legacy operational kiosks have no workspaceId in this single-workspace deployment.
  // Financial bank accounts must have explicit ownership; no inferred account association.
  if (!valid(kiosk) || (kiosk.workspaceId !== undefined && kiosk.workspaceId !== workspaceId) ||
      !valid(account) || account.workspaceId !== workspaceId) {
    blocked("FINANCIAL_AGENT_REFERENCES_INVALID", "Unidade ou conta não encontrada no workspace. Confirme os cadastros oficiais.");
  }
  // Do not drop historical records solely because the unit/account is now inactive.
}
