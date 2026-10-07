import { z } from 'zod';
import type { BaseProductStockLevel } from '@/types';

export class BaseProductPolicyValidationError extends Error {}

export function writableBaseProductPayload(body: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(body).filter(([key]) =>
    !['replenishmentPreview', 'replenishmentPolicyVersion'].includes(key)));
}

const levelSchema = z.object({
  min: z.number().finite().nonnegative().optional(),
  override: z.boolean().optional(),
  supplyMode: z.enum(['cd', 'direct']).optional(),
  leadTime: z.number().finite().nonnegative().optional(),
  safetyStock: z.number().finite().nonnegative().optional(),
}).passthrough();

export function parseBaseProductStockLevels(
  input: unknown,
  existing: Record<string, BaseProductStockLevel> = {},
  canUseUnit: (kioskId: string) => boolean,
  policyEnabled = true,
): Record<string, BaseProductStockLevel> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 200) {
    throw new BaseProductPolicyValidationError('Níveis por unidade inválidos.');
  }
  const next = { ...existing };
  for (const [kioskId, raw] of Object.entries(input)) {
    if (!kioskId || kioskId.includes('.') || kioskId.includes('/') || !canUseUnit(kioskId)) {
      throw new BaseProductPolicyValidationError('Unidade de estoque sem acesso ou inválida.');
    }
    const parsed = levelSchema.parse(raw);
    const previous = existing[kioskId] ?? { override: false };
    const supplyMode = parsed.supplyMode ?? previous.supplyMode ?? 'cd';
    const leadTime = parsed.leadTime ?? previous.leadTime;
    if (supplyMode === 'direct' && (!Number.isFinite(leadTime) || (leadTime ?? 0) <= 0)) {
      throw new BaseProductPolicyValidationError('Compra direta exige prazo positivo nesta unidade.');
    }
    next[kioskId] = {
      ...previous,
      supplyMode,
      leadTime,
      safetyStock: parsed.safetyStock ?? previous.safetyStock,
      override: policyEnabled ? false : parsed.override ?? previous.override ?? false,
      // A política automática owns min and every calculation field.
      min: policyEnabled ? previous.min ?? 0 : parsed.min ?? previous.min ?? 0,
      ...(policyEnabled ? {
        calculationStatus: previous.calculationStatus ?? 'pending',
        source: previous.source ?? 'none',
        sourceLimitation: previous.sourceLimitation ?? 'Aguardando recálculo automático.',
      } : {}),
    };
    if (!policyEnabled && (parsed.min !== undefined || parsed.override !== undefined)) {
      delete next[kioskId].calculationStatus;
    }
  }
  return next;
}
