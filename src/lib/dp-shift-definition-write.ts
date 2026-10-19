import type { DPShiftDefinition } from '@/types';

export type DPShiftDefinitionUpdate = Partial<Omit<DPShiftDefinition, 'id' | 'createdAt' | 'updatedAt'>>;

const EDITABLE_SHIFT_DEFINITION_FIELDS = [
  'code', 'name', 'startTime', 'endTime', 'breakStart', 'breakEnd', 'breakType',
  'breakDurationMinutes', 'breakWindowStart', 'breakWindowEnd', 'unitId', 'unitName',
  'unitIds', 'unitNames', 'daysOfWeek', 'bizneoTemplateId', 'journeyIds', 'description',
  'configurationNotes', 'overnight', 'expectedPunches', 'executionUnitPolicy', 'isArchived',
] as const satisfies readonly (keyof DPShiftDefinitionUpdate)[];

const NULLABLE_SHIFT_DEFINITION_FIELDS = new Set<keyof DPShiftDefinitionUpdate>([
  'breakStart', 'breakEnd', 'breakDurationMinutes', 'breakWindowStart', 'breakWindowEnd',
  'unitId', 'unitName', 'bizneoTemplateId', 'description', 'configurationNotes', 'expectedPunches',
]);

/**
 * Mantém o PATCH do catálogo de turnos preso à mesma allowlist do servidor.
 * Documentos sincronizados podem carregar metadados legados; eles nunca devem
 * voltar para uma API com schema estrito.
 */
export function buildShiftDefinitionUpdatePayload(input: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  for (const field of EDITABLE_SHIFT_DEFINITION_FIELDS) {
    if (!Object.hasOwn(input, field)) continue;
    const value = input[field];
    if (value !== undefined) payload[field] = value;
    else if (NULLABLE_SHIFT_DEFINITION_FIELDS.has(field)) payload[field] = null;
  }
  return payload;
}
