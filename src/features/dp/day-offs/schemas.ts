import { z } from 'zod';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Data inválida.');

export const dayOffSourceSchema = z.enum(['predicted', 'manual', 'retry']);

export const publishDayOffSchema = z.object({
  userId: z.string().trim().min(1).max(180),
  unitId: z.string().trim().min(1).max(180),
  date: isoDateSchema,
  source: dayOffSourceSchema,
});

export const removeDayOffSchema = z.object({
  shiftId: z.string().trim().min(1).max(180),
  userId: z.string().trim().min(1).max(180),
  unitId: z.string().trim().min(1).max(180),
  date: isoDateSchema,
});

export const dayOffRouteSchema = z.object({
  scheduleId: z.string().trim().min(1).max(180),
});

export type PublishDayOffInput = z.infer<typeof publishDayOffSchema>;
export type RemoveDayOffInput = z.infer<typeof removeDayOffSchema>;

export type PublishDayOffResult = {
  dayOff: {
    scheduleId: string;
    shiftId: string;
    userId: string;
    unitId: string;
    date: string;
    source: 'predicted' | 'manual';
    bizneoSyncStatus: 'published';
  };
  alreadyPublished: boolean;
};

export type RemoveDayOffResult = {
  removed: true;
  alreadyRemoved: boolean;
};
