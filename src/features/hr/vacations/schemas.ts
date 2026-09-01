import { z } from 'zod';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato correto.');

const receiptValuesSchema = z.object({
  grossAmount: z.coerce.number().finite().min(0).max(10_000_000),
  discountAmount: z.coerce.number().finite().min(0).max(10_000_000),
  netAmount: z.coerce.number().finite().positive().max(10_000_000),
  paymentDate: isoDateSchema.nullish(),
});

const reviewReceiptSchema = z.object({
  action: z.literal('review_receipt'),
  decision: z.enum(['approved', 'correction_required']),
  values: receiptValuesSchema.optional(),
  notes: z.string().trim().max(2_000).optional(),
  reason: z.string().trim().max(2_000).optional(),
}).superRefine((value, context) => {
  if (value.decision === 'approved' && !value.values) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['values'],
      message: 'Confirme os valores do recibo antes de aprová-lo.',
    });
  }
  if (value.decision === 'correction_required' && !value.reason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'Informe o que a contabilidade precisa corrigir.',
    });
  }
});

const vacationCoreSchema = z.object({
  cycleId: z.string().trim().regex(/^\d{4}-\d{4}$/, 'Informe o ciclo no formato 2025-2026.'),
  recordType: z.enum(['gozo', 'venda']),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  days: z.coerce.number().int().min(1).max(30),
  returnDate: isoDateSchema.optional(),
}).superRefine((value, context) => {
  if (value.recordType !== 'gozo') {
    if (value.days > 10) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['days'],
        message: 'O abono não pode superar 10 dias.',
      });
    }
    return;
  }
  if (!value.startDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'Informe o início das férias.' });
  }
  if (!value.endDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Informe o término das férias.' });
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'O término deve ser posterior ao início.' });
  }
});

export const createVacationSchema = z.object({
  userId: z.string().trim().min(1).max(180),
  status: z.enum(['PENDING', 'APPROVED', 'PLANNED']).default('PLANNED'),
  vacation: vacationCoreSchema,
});

export const updateVacationSchema = z.union([
  z.object({ action: z.literal('update_record'), vacation: vacationCoreSchema }),
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject') }),
  z.object({ action: z.literal('generate_notice') }),
  z.object({ action: z.literal('validate_notice') }),
  z.object({ action: z.literal('send_notice') }),
  z.object({ action: z.literal('sync_notice') }),
  z.object({ action: z.literal('send_accountant') }),
  reviewReceiptSchema,
  z.object({ action: z.literal('prepare_payment') }),
  z.object({ action: z.literal('sync_payment') }),
  z.object({ action: z.literal('retry_receipt_signature') }),
  z.object({ action: z.literal('sync_receipt_signature') }),
  z.object({ action: z.literal('finalize_workflow') }),
]);

export type VacationCoreInput = z.infer<typeof vacationCoreSchema>;
export type CreateVacationInput = z.infer<typeof createVacationSchema>;
export type UpdateVacationInput = z.infer<typeof updateVacationSchema>;
export type ReviewVacationReceiptInput = z.infer<typeof reviewReceiptSchema>;
