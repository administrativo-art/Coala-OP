import { z } from 'zod';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Data inválida.');

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);

export const bizneoTimeRangeSchema = z.object({
  start_at: timeSchema,
  end_at: timeSchema,
}).superRefine((range, context) => {
  if (normalizeTime(range.start_at) >= normalizeTime(range.end_at)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'O início do intervalo deve ser anterior ao fim.',
      path: ['end_at'],
    });
  }
});

export type BizneoTimeRange = z.infer<typeof bizneoTimeRangeSchema>;

export const bizneoScheduleShiftSchema = z.object({
  bizneoUserId: z.number().int().positive(),
  date: isoDateSchema,
  userName: z.string().trim().min(1).max(180),
  timeRanges: z.array(bizneoTimeRangeSchema).min(1).max(4).superRefine((ranges, context) => {
    const ordered = [...ranges].sort((left, right) => normalizeTime(left.start_at).localeCompare(normalizeTime(right.start_at)));
    for (let index = 1; index < ordered.length; index += 1) {
      if (normalizeTime(ordered[index - 1]!.end_at) > normalizeTime(ordered[index]!.start_at)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Os intervalos do turno não podem se sobrepor.',
          path: [index],
        });
      }
    }
  }),
  name: z.string().trim().min(1).max(180).optional(),
  taxonId: z.number().int().positive().optional(),
});

export const pushBizneoScheduleSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  shifts: z.array(bizneoScheduleShiftSchema).min(1).max(500),
}).superRefine((input, context) => {
  const targets = new Set<string>();
  input.shifts.forEach((shift, index) => {
    const target = `${shift.bizneoUserId}:${shift.date}`;
    if (targets.has(target)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Há mais de um turno para o mesmo colaborador e data.',
        path: ['shifts', index],
      });
    }
    targets.add(target);
  });
});

export type BizneoScheduleShift = z.infer<typeof bizneoScheduleShiftSchema>;

function normalizeTime(value: string) {
  return value.length === 5 ? `${value}:00` : value;
}

export function buildPublishedBizneoSchedulePayload(shift: Omit<BizneoScheduleShift, 'userName'>) {
  return {
    one_time_schedule: {
      date: shift.date,
      state: 'published' as const,
      ...(shift.name ? { name: shift.name } : {}),
      ...(shift.taxonId ? { taxon_id: shift.taxonId } : {}),
      time_ranges: shift.timeRanges,
    },
  };
}
