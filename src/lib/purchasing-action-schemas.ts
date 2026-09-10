import { z } from 'zod';

export const cancelPurchaseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Informe um motivo com pelo menos 3 caracteres.')
    .max(500, 'O motivo deve ter no máximo 500 caracteres.'),
});

export const revertPurchaseStageSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Informe um motivo com pelo menos 3 caracteres.')
    .max(500, 'O motivo deve ter no máximo 500 caracteres.'),
});
