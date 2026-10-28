import { z } from 'zod';

const id = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/);

export const absenceCoverageRouteSchema = z.object({ requestId: id }).strict();

export const absenceCoverageCandidatesQuerySchema = z.object({
  displacedId: z.string().regex(/^[0-9a-f]{64}$/),
  search: z.string().trim().max(60).optional().transform((value) => value || undefined),
}).strict();

export const absenceCoverageDecisionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('cover'),
    displacedId: z.string().regex(/^[0-9a-f]{64}$/),
    substituteUid: id,
    exceptionReason: z.string().trim().min(3).max(500).optional(),
    operationId: z.string().uuid(),
  }).strict(),
  z.object({
    mode: z.enum(['closed', 'understaffed']),
    displacedId: z.string().regex(/^[0-9a-f]{64}$/),
    operationId: z.string().uuid(),
  }).strict(),
]);

export type AbsenceCoverageDecisionInput = z.infer<typeof absenceCoverageDecisionSchema>;
