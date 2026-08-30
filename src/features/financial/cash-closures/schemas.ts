import { z } from "zod";

export const closureDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato yyyy-mm-dd.")
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Data inválida.");

export const syncCashClosureSchema = z.object({
  kioskId: z.string().trim().min(1).max(160),
  date: closureDateSchema,
});

export const saveCashClosureDraftSchema = z.object({
  countingSessionId: z.string().uuid().optional(),
  lines: z.array(z.object({
    id: z.string().trim().min(1).max(300),
    reportedCents: z.number().int().safe().min(0).nullable().optional(),
    countedCents: z.number().int().safe().min(0).nullable().optional(),
    reportedNote: z.string().trim().max(1000).nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  })).max(500),
});

export const cashClosureReasonSchema = z.object({
  reason: z.string().trim().min(3, "Informe um motivo com pelo menos 3 caracteres.").max(1000),
  operatorId: z.string().trim().min(1).max(300).optional(),
});

export const finalizeCashClosureOperatorSchema = z.object({
  operatorId: z.string().trim().min(1).max(300),
  countingSessionId: z.string().uuid(),
}).strict();

export const cashClosureExpectedAdjustmentSchema = z.object({
  lineId: z.string().trim().min(1).max(300),
  correctedExpectedCents: z.number().int().safe().min(0).max(100_000_000),
  reason: z.string().trim().min(3, "Informe o motivo da correção.").max(1000),
});

export const restoreCashClosureExpectedSchema = z.object({
  lineId: z.string().trim().min(1).max(300),
  reason: z.string().trim().min(3, "Informe o motivo da restauração.").max(1000),
});

export const cashClosureListQuerySchema = z.object({
  kioskId: z.string().trim().min(1).max(160).optional(),
  year: z.coerce.number().int().min(2020).max(2200).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export const manualCashDepositSplitSchema = z.object({
  operatorId: z.string().trim().min(1).max(300),
  partsCents: z.array(z.number().int().safe().positive().max(500_000)).min(2).max(100),
});
