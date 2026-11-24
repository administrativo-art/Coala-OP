import { z } from 'zod';
import { isCivilDate } from '../employment-reference/resolve';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,180}$/);
const reason = z.string().trim().min(10, 'Escreva ao menos 10 caracteres.').max(1000);
export const dayCorrectionQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), employeeUid: id.optional(),
}).strict();
export const dayCorrectionAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), employeeUid: id, workDate: z.string().refine(isCivilDate), reason }).strict(),
  z.object({ action: z.literal('respond'), id, expectedVersion: z.number().int().positive(), reason, adjustmentId: id.optional() }).strict(),
  z.object({ action: z.literal('cancel'), id, expectedVersion: z.number().int().positive(), reason }).strict(),
  z.object({ action: z.literal('accept'), id, expectedVersion: z.number().int().positive(), reason }).strict(),
  z.object({ action: z.literal('return'), id, expectedVersion: z.number().int().positive(), reason }).strict(),
]);
export type DayCorrectionInput = z.infer<typeof dayCorrectionAction>;
export type DayCorrection = {
  id: string; workspaceId: string; employeeUid: string; workDate: string; competence: string;
  unitIds: string[]; status: 'requested' | 'responded' | 'resolved'; version: number;
  reason: string; response: string | null; adjustmentId: string | null;
  actorKeys: string[];
  requestedBy: string; updatedAt: string;
  history: { action: DayCorrectionInput['action']; actorUid: string; reason: string; at: string; adjustmentId: string | null }[];
};
